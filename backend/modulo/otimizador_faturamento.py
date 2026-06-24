"""Módulo Fábrica — Otimizador de Faturamento.

Elo final da cadeia PCP. Consome a PROGRAMAÇÃO oficial (programacao_versao), não o
plano cru. Mostra os PEDIDOS COMPLETOS (do otimizador de produção) por pedido inteiro,
com, por produto: demanda, estoque disponível, reserva, físico e quantidade em produção.

Ordenação (CRÍTICO):
  1) previsão de término definida pela Programação (a data manda);
  2) regra de atraso (dentro da mesma data: atrasados primeiro);
  3) valor total do pedido (desempate: maior primeiro).
Pedidos cujos produtos precisam de produção mas não estão na Programação ficam num
bucket "sem data de programação", indicando o(s) produto(s) faltante(s).

Ver docs/spec_otimizador_faturamento.md.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any, List, Tuple
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission, check_sector_permission
from auth_utils import get_user_id_from_session
# Reuso da camada Programação (fonte da verdade do faturamento)
from modulo.programacao import (
    compute_liberacoes, _build_prog_snapshot, _snapshot_hash, _ensure_prog_versao,
    carregar_ops, _bq_client, _parse_dt_flex, _user_name,
)
from pydantic import BaseModel

router = APIRouter(prefix="/otimizador-faturamento", tags=["otimizador_faturamento"])
logger = logging.getLogger(__name__)

MODULE_ID = "otimizador_faturamento"


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, MODULE_ID, lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para o Otimizador de Faturamento")
    return user_id


def _norm(cod) -> str:
    """Normaliza código igual ao plano (remove 'BR', strip) para casar estoque/OPs/detalhe."""
    return str(cod or "").replace("BR", "").strip()


# ---- Fontes de estoque e produção (BigQuery) ----

# Saldo físico = disponível + reserva da logística (sem EstoqueProducao).
FAT_SQL_ESTOQUE = """
SELECT CODIGO_ITEM AS Codigo,
       SUM(CASE WHEN CODIGO_LOCAL LIKE '13%' THEN SAFE_CAST(DISPONIVEL AS FLOAT64) ELSE 0 END) AS Disponivel,
       SUM(CASE WHEN CODIGO_LOCAL LIKE '13%' THEN SAFE_CAST(RESERVA AS FLOAT64) ELSE 0 END) AS Reserva
FROM `projeto-rpa-empresa-2023.VENDAS.estoque_logistica`
WHERE CODIGO_ITEM IS NOT NULL
GROUP BY 1
"""

# 18/06: query da carteira FRESH — idêntica à do plano_producao (única fonte de verdade).
# Otim. Faturamento puxa pedidos em aberto AGORA, não snapshot do plano. Plano oficial
# continua sendo fonte das libs de produção (snapshot físico). Pedidos faturados saem,
# pedidos novos entram (sem libs de produção alocadas, só cobrem via estoque/reserva).
# Status de pedido permitidos na carteira em aberto do Otimizador de Faturamento.
# 1 = Em aberto, 4 = Liberado. Selecionáveis pelo usuário no Configurador.
# (O saldo parcial continua detectado por STATUS=5, fixo — independe desta seleção.)
FAT_STATUS_PERMITIDOS = ('1', '4')


def _normalizar_status(status) -> tuple:
    """Valida a seleção de status contra o whitelist {1,4}. Vazio/inválido => default (1,4)."""
    if isinstance(status, str):
        status = [status]
    if not status:
        return FAT_STATUS_PERMITIDOS
    sel = {str(s).strip() for s in status if str(s).strip() in FAT_STATUS_PERMITIDOS}
    # preserva a ordem do whitelist e cai pro default se nada válido restou
    return tuple(s for s in FAT_STATUS_PERMITIDOS if s in sel) or FAT_STATUS_PERMITIDOS


def _fat_sql_carteira(status: tuple = FAT_STATUS_PERMITIDOS) -> str:
    """Monta a query da carteira FRESH com os status selecionados (whitelist 1,4).
    O CTE faturado_parcial continua fixo em STATUS=5 (detecção de saldo parcial)."""
    in_clause = ", ".join("'{}'".format(s) for s in status)
    return """
WITH aberto AS (
  SELECT RAZAO, EMISSAO, ENTREGA, EMISSAO_ORIGINAL, PEDIDO, DESCRICAO_PRODUTO,
         CODIGO_PRODUTO, TOTAL_ITEM, QUANTIDADE, DESC_TIPODOCUMENTO,
         STATUS_PEDIDO, SITUACAO, GERENCIA_REGIONAL
  FROM `projeto-rpa-empresa-2023.VENDAS.Metas_por_faturamento`
  WHERE STATUS_PEDIDO IN (""" + in_clause + """)
    AND DESC_TIPODOCUMENTO IS NOT NULL
    AND DESC_TIPODOCUMENTO NOT IN ('DISPLAY','CAMPANHAS','RAPEL','MOSTRUARIO','None','CONTRATOS')
    AND PEDIDO NOT LIKE 'PVM%'
),
faturado_parcial AS (
  -- Pedidos onde EXISTEM linhas STATUS=5 (faturadas) E linhas STATUS=1/4 (abertas) coexistindo.
  -- Sinal de SALDO: parte já foi faturada, sobrou item em aberto (ex: MBK-0166197).
  SELECT DISTINCT PEDIDO
  FROM `projeto-rpa-empresa-2023.VENDAS.Metas_por_faturamento`
  WHERE STATUS_PEDIDO = '5' AND PEDIDO IN (SELECT PEDIDO FROM aberto)
)
SELECT a.*, (fp.PEDIDO IS NOT NULL) AS tem_saldo_parcial
FROM aberto a
LEFT JOIN faturado_parcial fp ON fp.PEDIDO = a.PEDIDO
"""


# Cache em memória do estoque (BigQuery) — evita refazer a query a cada entrada na tela.
_EST_CACHE: Dict[str, object] = {"data": None, "ts": 0.0}
_EST_TTL = 300  # 5 min
# Cache da carteira fresh (mesmo TTL — refresh=True força nova query).
# Cache da carteira fresh keyed por conjunto de status (mesmo TTL — refresh=True força nova query).
_CART_CACHE: Dict[str, dict] = {}
_CART_TTL = 300  # 5 min


def _carregar_estoque(refresh: bool = False) -> Dict[str, Dict[str, float]]:
    import time
    agora = time.time()
    if not refresh and _EST_CACHE["data"] is not None and (agora - float(_EST_CACHE["ts"])) < _EST_TTL:
        return _EST_CACHE["data"]  # type: ignore[return-value]
    client = _bq_client()
    rows = client.query(FAT_SQL_ESTOQUE).result()
    est: Dict[str, Dict[str, float]] = {}
    for r in rows:
        cod = _norm(r["Codigo"])
        if not cod:
            continue
        est[cod] = {
            "disponivel": float(r["Disponivel"] or 0),
            "reserva": float(r["Reserva"] or 0),
        }
    _EST_CACHE["data"] = est
    _EST_CACHE["ts"] = agora
    return est


def _producao_por_codigo(refresh: bool = False) -> Dict[str, float]:
    """Quantidade em produção por código = soma de (planejada - apontada) das OPs abertas (situação 8)."""
    ops = carregar_ops(refresh)
    prod: Dict[str, float] = {}
    for op in ops:
        cod = _norm(op.get("codigo"))
        if not cod:
            continue
        restante = float(op.get("qtd_op") or 0) - float(op.get("apontada") or 0)
        if restante < 0:
            restante = 0.0
        prod[cod] = prod.get(cod, 0.0) + restante
    return prod


def _carteira_aberta_fresh_bq(refresh: bool = False, status=None) -> Dict[str, dict]:
    """18/06: Carteira FRESH do BigQuery (pedidos em aberto AGORA).

    Retorna Dict[ped_id, {cliente, emissao, entrega, tipo, valor_total, itens:[{sku, qtd, valor_linha, descricao}]}].
    Faturado entre a hora do plano e agora ⇒ pedido some daqui ⇒ some do Otim.Faturamento.
    Pedido NOVO desde o plano ⇒ entra aqui ⇒ aparece no Otim.Faturamento (só fatura se estoque/reserva cobre).

    `status`: seleção de STATUS_PEDIDO (whitelist 1=Em aberto, 4=Liberado). None/vazio => ambos.
    """
    import time
    status_sel = _normalizar_status(status)
    cache_key = ",".join(status_sel)
    agora = time.time()
    ent = _CART_CACHE.get(cache_key)
    if not refresh and ent is not None and (agora - float(ent["ts"])) < _CART_TTL:
        return ent["data"]  # type: ignore[return-value]
    client = _bq_client()
    rows = list(client.query(_fat_sql_carteira(status_sel)).result())
    out: Dict[str, dict] = {}
    for r in rows:
        ped = str(r["PEDIDO"] or "").strip()
        if not ped:
            continue
        sku = _norm(r["CODIGO_PRODUTO"])
        try:
            qtd = float(r["QUANTIDADE"] or 0)
        except Exception:
            qtd = 0.0
        try:
            valor_linha = float(r["TOTAL_ITEM"] or 0)
        except Exception:
            valor_linha = 0.0
        p = out.get(ped)
        if not p:
            # tipo dominante: se houver 'PEND' na situação, vira PENDENTE_FINANCEIRO; senão usa DESC_TIPODOCUMENTO normalizado
            tipo = str(r["DESC_TIPODOCUMENTO"] or "").strip().upper()
            sit = str(r["SITUACAO"] or "").strip()
            if sit == "1":
                tipo = "PENDENTE_FINANCEIRO"
            entrega = r["ENTREGA"]
            emissao = r["EMISSAO"]
            p = {
                "cliente": str(r["RAZAO"] or "").strip(),
                "emissao": str(emissao) if emissao else None,
                "entrega": str(entrega) if entrega else None,
                "tipo": tipo,
                "valor_total": 0.0,
                "tem_saldo_parcial": bool(r.get("tem_saldo_parcial")) if hasattr(r, "get") else bool(r["tem_saldo_parcial"]),
                "itens": [],
            }
            out[ped] = p
        p["valor_total"] += valor_linha
        p["itens"].append({
            "sku": sku,
            "qtd": qtd,
            "valor_linha": valor_linha,
            "descricao": str(r["DESCRICAO_PRODUTO"] or "").strip(),
        })
    _CART_CACHE[cache_key] = {"data": out, "ts": agora}
    return out


def _enriquecer_plano_com_carteira_fresh(plano: dict, carteira: Dict[str, dict]) -> Tuple[dict, dict]:
    """18/06: Mescla plano oficial com carteira FRESH.

    - Pedido no plano + na carteira → mantém (no_plano=True), tipo/cliente/entrega podem ser atualizados do fresh
    - Pedido no plano, NÃO na carteira → REMOVE (foi faturado/cancelado entre plano e agora)
    - Pedido na carteira, NÃO no plano → ADICIONA (no_plano=False), sem libs de produção; só faturável via estoque/reserva

    Retorna (plano_modificado, info_dict) onde info_dict tem listas de removidos/novos pra meta.
    """
    plano = dict(plano)  # shallow copy — totais/pedidos_completos/detalhe_alocacao mutáveis
    totais = dict(plano.get("totais") or {})

    abertos = set(carteira.keys())
    no_plano_set: set = set()

    # 1) Universo original do plano
    peds_atend_raw = totais.get("pedidos_atendidos") or []
    pedidos_completos_orig = plano.get("pedidos_completos") or []
    universo_plano: set = set()
    for p in peds_atend_raw:
        universo_plano.add(str(p))
    for pc in pedidos_completos_orig:
        pid = str(pc.get("pedido") or "").strip()
        if pid:
            universo_plano.add(pid)

    # 2) Determina removidos e novos
    removidos = sorted(universo_plano - abertos)
    novos = sorted(abertos - universo_plano)
    no_plano_set = universo_plano & abertos

    # 3) Filtra detalhe_alocacao: tira linhas dos pedidos removidos
    rem_set = set(removidos)
    detalhe_alocacao_orig = plano.get("detalhe_alocacao") or []
    detalhe_filtrado = [d for d in detalhe_alocacao_orig if str(d.get("pedido") or "").strip() not in rem_set]
    plano["detalhe_alocacao"] = detalhe_filtrado

    # 4) Filtra pedidos_completos: tira removidos
    pedidos_completos_filtrado = [pc for pc in pedidos_completos_orig
                                   if str(pc.get("pedido") or "").strip() not in rem_set]

    # 5) Adiciona pedidos novos da carteira fresh
    pedidos_itens_map = dict(totais.get("pedidos_itens") or {})
    pedidos_clientes = dict(totais.get("pedidos_clientes") or {})
    pedidos_entregas = dict(totais.get("pedidos_entregas") or {})
    pedidos_emissao = dict(totais.get("pedidos_emissao") or {})
    pedidos_tipos = dict(totais.get("pedidos_tipos") or {})
    pedidos_valores = dict(totais.get("pedidos_valores") or {})

    # Atualiza com fresh (pra mantidos também — fresh tem prioridade pra cliente/entrega)
    for ped, info in carteira.items():
        pedidos_clientes[ped] = info.get("cliente") or pedidos_clientes.get(ped)
        pedidos_entregas[ped] = info.get("entrega") or pedidos_entregas.get(ped)
        pedidos_emissao[ped] = info.get("emissao") or pedidos_emissao.get(ped)
        pedidos_tipos[ped] = info.get("tipo") or pedidos_tipos.get(ped)
        pedidos_valores[ped] = float(info.get("valor_total") or 0)
        # itens fresh — só usa pra novos (mantidos têm detalhe_alocacao)
        if ped in novos:
            pedidos_itens_map[ped] = [{
                "sku": it["sku"],
                "demanda": it["qtd"],
                "valor": it["valor_linha"],
                "descricao": it.get("descricao", ""),
            } for it in info.get("itens", [])]

    # Universo atendido pro solver = todos os abertos
    peds_atend_novo = sorted(abertos)

    # 18/06: pedidos com SALDO (faturamento parcial) — itens em aberto remanescentes de pedidos já parcialmente faturados.
    pedidos_saldo_list = sorted(ped for ped, info in carteira.items() if info.get("tem_saldo_parcial"))
    totais.update({
        "pedidos_atendidos": peds_atend_novo,
        "pedidos_itens": pedidos_itens_map,
        "pedidos_clientes": pedidos_clientes,
        "pedidos_entregas": pedidos_entregas,
        "pedidos_emissao": pedidos_emissao,
        "pedidos_tipos": pedidos_tipos,
        "pedidos_valores": pedidos_valores,
        "pedidos_no_plano": sorted(no_plano_set),  # lista pra JSON-friendly
        "pedidos_saldo": pedidos_saldo_list,  # 18/06: faturamento parcial detectado no BQ
    })
    plano["totais"] = totais

    # pedidos_completos = mantidos + stubs dos novos (pra fallback que itera essa lista)
    for ped in novos:
        info = carteira[ped]
        pedidos_completos_filtrado.append({
            "pedido": ped,
            "cliente": info.get("cliente"),
            "entrega": info.get("entrega"),
            "emissao": info.get("emissao"),
            "tipo": info.get("tipo"),
            "valor_total": float(info.get("valor_total") or 0),
        })
    plano["pedidos_completos"] = pedidos_completos_filtrado

    info_meta = {
        "pedidos_removidos": removidos,
        "pedidos_novos": novos,
        "pedidos_no_plano_qtd": len(no_plano_set),
        "pedidos_removidos_qtd": len(removidos),
        "pedidos_novos_qtd": len(novos),
    }
    return plano, info_meta


# ---- Núcleo (puro, testável): monta os pedidos do faturamento ----

def _ts(iso) -> float:
    """Timestamp de um ISO (para ordenar); -inf se vazio/inválido (= 'mais cedo')."""
    dt = _parse_dt_flex(iso) if iso else None
    return dt.timestamp() if dt else float("-inf")


def _ts_data(s) -> float:
    """Timestamp aceitando BR 'DD/MM/YYYY' ou ISO 'YYYY-MM-DD'. 0.0 se vazio/inválido
    (NB: difere de _ts que retorna -inf — pra trava de timing precisamos detectar 'sem data')."""
    iso = _to_iso_date(s)
    if not iso:
        return 0.0
    dt = _parse_dt_flex(iso)
    return dt.timestamp() if dt else 0.0


def _to_iso_date(s) -> str:
    """Converte DD/MM/YYYY (BR) ou YYYY-MM-DD pra YYYY-MM-DD. Vazio = ''."""
    if not s:
        return ""
    s = str(s).strip()[:10]
    if "/" in s:
        try:
            d, m, y = s.split("/")
            return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except Exception:
            return s
    return s


def _qtd_prod_ate_entrega(cod: str, ped: str, pedidos_entregas: dict,
                          pool_libs: dict, consumido_libs: list, usa_prod: bool) -> float:
    """17/06 (Thiago): saldo de produção do SKU já programada e ainda não consumida.
    Regra: a entrega original do pedido NÃO bloqueia lib. Pedido atrasado + lib futura = faturável.
    O que importa é a lib estar pronta — libs atrasadas (previsao_termino < hoje) já foram
    rejeitadas na montagem do pool em _gerar_resultado. Aqui só somamos consumido + residual."""
    if not usa_prod:
        return 0.0
    cons = sum(float(l.get("qtd") or 0) for l in (consumido_libs or []))
    resid = sum(float(l.get("qtd") or 0) for l in pool_libs.get(cod, []))
    return cons + resid


def montar_faturamento(plano: dict, liberacoes_por_produto: dict,
                       estoque: Dict[str, Dict[str, float]], producao: Dict[str, float],
                       fontes=None, ordem_consumo: Optional[str] = None,
                       alpha: float = 0.05) -> dict:
    """Monta os pedidos faturáveis (por pedido inteiro) ordenados pela previsão de ENTREGA.

    - Saldo físico = disponível (+ reserva, se considerar_reserva). É **abatido em cascata**:
      cada pedido consome o saldo; o próximo pedido que usa o produto vê o que sobrou.
      (Cálculo só aqui; não altera o BigQuery.)
    - Data do pedido = previsão de ENTREGA (campo Entrega/data_fim do lote na Programação).
      Pedido coberto totalmente por estoque (após abatimento) = PRONTO (disponível agora).
    - Pedido que precisa produzir algo fora da Programação -> bucket "sem data".
    """
    detalhe = plano.get("detalhe_alocacao", []) or []
    totais = plano.get("totais", {}) or {}
    plano_rows = plano.get("plano", []) or []
    dias_map = totais.get("pedidos_dias_atraso", {}) or {}
    # 18/06 (V2): set de pedidos que estavam no plano oficial (libs alocadas).
    # Pedidos NOVOS da carteira fresh têm no_plano=False — só faturam via estoque/reserva.
    _peds_no_plano_set = set(str(x) for x in (totais.get("pedidos_no_plano") or []))
    # 18/06: pedidos com SALDO (faturamento parcial — algumas linhas já faturadas no ERP).
    _peds_saldo_set = set(str(x) for x in (totais.get("pedidos_saldo") or []))

    # Todos os pedidos atendidos pelo otimizador (estoque + produção)
    # Fallback para planos antigos sem pedidos_atendidos: usa pedidos_completos (só estoque)
    _ped_atend_raw = totais.get("pedidos_atendidos") or []
    if _ped_atend_raw:
        todos_atendidos = [str(p) for p in _ped_atend_raw]
    else:
        pedidos_completos_fb = plano.get("pedidos_completos", []) or []
        todos_atendidos = [str(pc.get("pedido")) for pc in pedidos_completos_fb if pc.get("pedido")]
    pedidos_valores   = totais.get("pedidos_valores", {}) or {}
    pedidos_clientes  = totais.get("pedidos_clientes", {}) or {}
    pedidos_atrasados = totais.get("pedidos_atrasados", {}) or {}
    pedidos_emissao   = totais.get("pedidos_emissao", {}) or {}
    # Enriquece com dados de pedidos_completos quando totais não tem os campos
    for pc in (plano.get("pedidos_completos", []) or []):
        pid = str(pc.get("pedido", ""))
        if pid and pid not in pedidos_valores: pedidos_valores[pid] = float(pc.get("valor") or 0)
        if pid and pid not in pedidos_clientes: pedidos_clientes[pid] = str(pc.get("cliente") or "")
        if pid and pid not in pedidos_atrasados: pedidos_atrasados[pid] = bool(pc.get("atrasado"))
        if pid and pid not in pedidos_emissao: pedidos_emissao[pid] = pc.get("emissao") or ""

    # Itens por pedido via detalhe_alocacao (pedidos 100% cobertos por estoque)
    por_pedido_stock: Dict[str, List[dict]] = {}
    for d in detalhe:
        por_pedido_stock.setdefault(str(d.get("pedido")), []).append(d)

    # Itens por pedido via plano de produção (pedidos que precisam de produção)
    por_pedido_prod: Dict[str, List[dict]] = {}
    for row in plano_rows:
        dem = row.get("DEMANDA_POR_PEDIDO", {}) or {}
        val = row.get("VALOR_ITEM_POR_PEDIDO", {}) or {}
        sku = str(row.get("CODIGO_PRODUTO", "")).strip()
        desc = str(row.get("DESCRICAO", "")).strip()
        for ped_id, qty in dem.items():
            if float(qty or 0) > 0:
                por_pedido_prod.setdefault(str(ped_id), []).append({
                    "sku": sku, "descricao": desc,
                    "qtd": float(qty), "valor_linha": float((val or {}).get(ped_id, 0) or 0),
                })

    # Fallback: pedidos_itens do plan totais (pedidos 100% cobertos por estoque, sem producao)
    pedidos_itens_map = totais.get("pedidos_itens", {}) or {}

    def get_itens(ped: str) -> List[dict]:
        """Itens: detalhe_alocacao > plano_rows > pedidos_itens (fallback estoque puro)."""
        if ped in por_pedido_stock:
            return sorted(por_pedido_stock[ped], key=lambda d: _norm(d.get("sku")))
        if ped in por_pedido_prod:
            return sorted(por_pedido_prod[ped], key=lambda d: _norm(d.get("sku")))
        raw = pedidos_itens_map.get(ped, [])
        return sorted([{'sku': it['sku'], 'qtd': it['demanda'],
                        'descricao': it.get('descricao', ''), 'valor_linha': it.get('valor', 0)}
                       for it in raw], key=lambda d: _norm(d.get("sku")))

    # Fontes do saldo de cobertura (configurável): disponível, reserva, produção.
    fontes = set(fontes or ["disponivel", "reserva", "producao"])
    usa_disp = "disponivel" in fontes
    usa_reserva = "reserva" in fontes
    usa_prod = "producao" in fontes

    # Pools separados — permitem medir consumo discriminado por fonte na cascata.
    # F10.1: cascata disp → reserva → produção. Cada pool decrementa só do consumo daquela fonte.
    pool_disp: Dict[str, float] = {}
    pool_reserva: Dict[str, float] = {}
    for cod, e in (estoque or {}).items():
        pool_disp[cod] = float(e.get("disponivel") or 0) if usa_disp else 0.0
        pool_reserva[cod] = float(e.get("reserva") or 0) if usa_reserva else 0.0
    # F10 ajuste 12/06: pool de produção como FILA CRONOLÓGICA de liberações da Programação.
    # Cada SKU tem lista [{qtd, previsao_termino, maquina_id}] ordenada por data ASC (mais cedo primeiro).
    # Pedidos prioritários (estratégia ativa) consomem liberações mais cedo; pedidos com entrega
    # mais longe ficam com liberações mais tarde. previsao_termino do produto = data da ÚLTIMA
    # liberação consumida (não a primeira) — garante "só faturar quando a data da produção chegar".
    # G1.1 (16/06): filtra produção atrasada (previsao_termino < hoje) também no greedy E1 — alinhar
    # à regra canonical do Thiago "produção atrasada não é saldo". Antes só o ILP-B filtrava,
    # então E1 podia marcar pedido PRONTO com lib vencida (audit 16/06).
    from datetime import datetime as _dt_g
    _hoje_ts_greedy = _ts(_dt_g.now().strftime("%Y-%m-%d"))
    pool_libs: Dict[str, List[dict]] = {}
    if usa_prod:
        for cod, info in (liberacoes_por_produto or {}).items():
            libs_raw = (info or {}).get("liberacoes", []) or []
            pool_libs[cod] = sorted(
                [{"qtd": float(l.get("qtd") or 0),
                  # Fallback: lote sem previsao calculada usa data de entrega do lote
                  "previsao_termino": l.get("previsao_termino") or l.get("entrega"),
                  "maquina_id": l.get("maquina_id")}
                 for l in libs_raw
                 if float(l.get("qtd") or 0) > 0
                 and _ts(l.get("previsao_termino") or l.get("entrega")) >= _hoje_ts_greedy],
                key=lambda x: _ts(x.get("previsao_termino"))
            )
    # 17/06: snapshot do total de produção liberada por SKU ANTES de qualquer cascata.
    # Usado pelo frontend pra mostrar 'producao_inicial → saldo_producao' linha a linha
    # (igual estoque_disponivel → saldo_disponivel). O bruto é fixo entre pedidos do mesmo SKU.
    producao_inicial_por_sku: Dict[str, float] = {
        cod: sum(float(l.get("qtd") or 0) for l in libs) for cod, libs in pool_libs.items()
    }

    pedidos_entregas = totais.get("pedidos_entregas", {}) or {}
    tipos_map = totais.get("pedidos_tipos", {}) or {}
    situacao_map = totais.get("pedidos_situacao", {}) or {}

    def _get_tipo(ped: str) -> str:
        if str(situacao_map.get(ped, '') or '') == '1':
            return 'PENDENTE_FINANCEIRO'
        return str(tipos_map.get(ped, '') or '')

    def _ord_entrega(s):  # 'DD/MM/YYYY' -> 'YYYYMMDD' (ordenável); vazio = fim
        try:
            d, m, y = str(s).strip()[:10].split("/")
            return f"{int(y):04d}{int(m):02d}{int(d):02d}"
        except Exception:
            return "99999999"

    def _entrega_prog(cod):
        return (liberacoes_por_produto.get(cod, {}) or {}).get("entrega")

    # F10.3: ordem do consumo segue a estratégia ativa (não sempre entrega ASC).
    # E1 (default/None) = entrega ASC → atrasado → valor DESC (comportamento original).
    # E2 (valor)        = valor DESC → entrega ASC (desempate).
    # E3 (atraso)       = dias_atraso DESC → entrega ASC.
    # E4 (combinado)    = valor*(1+α*atraso) DESC → entrega ASC.
    if ordem_consumo == "valor":
        _sort_key = lambda ped: (
            -float(pedidos_valores.get(ped, 0) or 0),
            _ord_entrega(pedidos_entregas.get(ped, '')),
        )
    elif ordem_consumo == "atraso":
        _sort_key = lambda ped: (
            -int(dias_map.get(ped, 0) or 0),
            _ord_entrega(pedidos_entregas.get(ped, '')),
        )
    elif ordem_consumo == "combinado":
        def _comb_score(ped):
            v = float(pedidos_valores.get(ped, 0) or 0)
            a = int(dias_map.get(ped, 0) or 0)
            return v * (1.0 + alpha * a)
        _sort_key = lambda ped: (
            -_comb_score(ped),
            _ord_entrega(pedidos_entregas.get(ped, '')),
        )
    else:
        _sort_key = lambda ped: (
            _ord_entrega(pedidos_entregas.get(ped, '')),
            0 if bool(pedidos_atrasados.get(ped)) else 1,
            -float(pedidos_valores.get(ped, 0) or 0),
        )
    ordenados = sorted(todos_atendidos, key=_sort_key)

    faturaveis: List[dict] = []
    sem_data: List[dict] = []
    for ped in ordenados:
        valor_total = float(pedidos_valores.get(ped, 0) or 0)
        atrasado    = bool(pedidos_atrasados.get(ped, False))
        dias_atraso = int(dias_map.get(ped, 0) or 0)

        produtos = []
        produtos_faltando = []
        usou_producao = False
        prev_entregas = []
        itens_pedido = get_itens(ped)
        for d in itens_pedido:
            cod = _norm(d.get("sku"))
            demanda = float(d.get("qtd") or 0)
            est = estoque.get(cod, {"disponivel": 0.0, "reserva": 0.0})
            fisico_total = (float(est.get("disponivel") or 0) if usa_disp else 0.0) \
                           + (float(est.get("reserva") or 0) if usa_reserva else 0.0)
            # F10.1: cascata 3-etapas explícita — consumo separado por fonte.
            # 1) Disponível primeiro
            saldo_disp = float(pool_disp.get(cod, 0.0))
            usado_disp = min(demanda, saldo_disp) if saldo_disp > 0 else 0.0
            pool_disp[cod] = saldo_disp - usado_disp
            rem = demanda - usado_disp
            # 2) Reserva depois
            saldo_reserva = float(pool_reserva.get(cod, 0.0))
            usado_reserva = min(rem, saldo_reserva) if (rem > 0 and saldo_reserva > 0) else 0.0
            pool_reserva[cod] = saldo_reserva - usado_reserva
            rem = rem - usado_reserva
            # 3) Produção em ordem CRONOLÓGICA das liberações (mais cedo primeiro).
            # 17/06 (Thiago): a entrega original do pedido NÃO bloqueia lib. Pedido atrasado
            # com lib futura = faturável (sai na data da lib). Libs atrasadas já foram filtradas
            # do pool em _gerar_resultado (previsao_termino >= hoje). "Quando sai" do pedido =
            # última lib consumida (que pode ser > entrega original — sinaliza atraso adicional).
            usado_prod = 0.0
            consumido_libs: List[dict] = []
            if usa_prod and rem > 1e-9:
                for lib in pool_libs.get(cod, []):
                    if rem <= 1e-9:
                        break
                    if lib["qtd"] <= 1e-9:
                        continue
                    take = min(rem, lib["qtd"])
                    lib["qtd"] -= take
                    rem -= take
                    usado_prod += take
                    consumido_libs.append({
                        "qtd": round(take, 2),
                        "previsao_termino": lib.get("previsao_termino"),
                        "maquina_id": lib.get("maquina_id"),
                    })
            falta = rem
            # previsao_termino do produto = data da ÚLTIMA liberação consumida (a mais longe).
            # Se nenhuma liberação foi consumida, fallback pra _entrega_prog (compat).
            ent_prod_fallback = _entrega_prog(cod)
            ent_prod = consumido_libs[-1]["previsao_termino"] if consumido_libs else ent_prod_fallback
            if usado_prod > 1e-9:
                usou_producao = True
                if ent_prod:
                    prev_entregas.append(ent_prod)
            if falta > 1e-9:
                usou_producao = True
                if ent_prod_fallback:
                    # Tinha programação mas insuficiente — registra previsão pra cálculo de "quando sai"
                    prev_entregas.append(ent_prod or ent_prod_fallback)
                # 18/06 Fix contrato canonical (all-or-nothing): falta > 0 ⇒ pedido NÃO é faturável,
                # independente de ter programação parcial. Antes só "sem_programacao" tirava do bucket;
                # agora "programacao_insuficiente" também tira. Mantém rastro de motivo_item distinto.
                produtos_faltando.append({"sku": cod, "descricao": d.get("descricao", ""),
                                          "demanda": demanda,
                                          "coberto": round(max(0.0, demanda - falta), 2),
                                          "falta": round(falta, 2),
                                          "motivo_item": "programacao_insuficiente" if ent_prod_fallback else "sem_programacao"})
            # saldo de produção restante = soma das qtds restantes na fila do SKU
            saldo_prod_restante = sum(l["qtd"] for l in pool_libs.get(cod, [])) if usa_prod else 0.0
            # F10.2: saldo (compat) = sobra de disp + reserva nos pools (pós-cascata)
            saldo_now_pos = float(pool_disp.get(cod, 0.0)) + float(pool_reserva.get(cod, 0.0))
            prod_obj = {
                "sku": cod,
                "descricao": d.get("descricao", ""),
                "demanda": demanda,
                "valor": float(d.get("valor_linha") or 0),
                "estoque_disponivel": float(est.get("disponivel") or 0),
                "estoque_fisico": round(fisico_total, 2),    # físico = disp + reserva (total, conforme fontes)
                "saldo": round(saldo_now_pos, 2),             # saldo de estoque restante (cascata) — compat
                "saldo_disponivel": round(float(pool_disp.get(cod, 0.0)), 2),
                "saldo_reserva": round(float(pool_reserva.get(cod, 0.0)), 2),
                "qtd_em_producao": float(producao.get(cod, 0.0)),
                # Fix 16/06 (P2): produção LIBERADA até a data de entrega do pedido.
                # Soma libs com previsao_termino <= entrega_pedido (consumidas por este pedido + residuais aplicáveis).
                "qtd_em_producao_ate_entrega": round(_qtd_prod_ate_entrega(
                    cod, ped, pedidos_entregas, pool_libs, consumido_libs, usa_prod
                ), 2),
                # 17/06: producao_inicial = total de produção liberada do SKU ANTES de qualquer cascata
                # (constante entre pedidos do mesmo SKU). saldo_producao = pool atual após esse pedido.
                # Frontend renderiza 'producao_inicial → saldo_producao' linha a linha (igual estoque).
                "producao_inicial": round(producao_inicial_por_sku.get(cod, 0.0), 2),
                "saldo_producao": round(saldo_prod_restante, 2),  # restante na fila (pós-cascata cronológica)
                "falta": round(max(0.0, falta), 2),
                "consumo_disponivel": round(usado_disp, 2),
                "consumo_reserva": round(usado_reserva, 2),
                "consumo_producao": round(usado_prod, 2),
                "previsao_termino": ent_prod,
                # F10 ajuste 12/06: liberações = AS QUE ESTE PEDIDO CONSUMIU (não a lista global do SKU).
                # Frontend mostra "X em DD/MM (M5) + Y em DD/MM (M3)" só pro que esse pedido pegou.
                "liberacoes": consumido_libs,
            }
            if usa_reserva:
                prod_obj["reserva"] = float(est.get("reserva") or 0)
            produtos.append(prod_obj)

        pedido_obj = {
            "pedido": ped,
            "cliente": str(pedidos_clientes.get(ped, '') or ''),
            "valor_total_pedido": valor_total,
            "atrasado": atrasado, "dias_atraso": dias_atraso,
            "emissao": pedidos_emissao.get(ped) or None,
            "entrega": pedidos_entregas.get(ped) or None,
            "tipo": _get_tipo(ped),
            "produtos": produtos,
            # 18/06 (V2): flag se o pedido estava modelado pelo plano oficial (libs alocadas)
            # ou se veio NOVO da carteira fresh (só fatura via estoque/reserva).
            "no_plano": ped in _peds_no_plano_set,
            # 18/06: pedido com SALDO = faturamento parcial (algumas linhas STATUS=5 já saíram,
            # restaram itens em aberto STATUS=1/4). Pedido aparece com SKUs remanescentes só.
            "saldo": ped in _peds_saldo_set,
        }
        if produtos_faltando:
            pedido_obj["produtos_faltando"] = produtos_faltando
            # 18/06: motivo dominante reflete o cenário real. Se ALGUM SKU não tem programação,
            # 'sem_programacao' prevalece (situação mais grave). Senão, 'programacao_insuficiente'
            # (todos têm fila, mas alguma quantidade falta).
            pedido_obj["motivo"] = "sem_programacao" if any(
                pf.get("motivo_item") == "sem_programacao" for pf in produtos_faltando
            ) else "programacao_insuficiente"
            sem_data.append(pedido_obj)
            continue
        if usou_producao:
            pedido_obj["previsao_termino"] = (max(prev_entregas, key=_ts) if prev_entregas else None)
            pedido_obj["pronto"] = False
        else:
            pedido_obj["previsao_termino"] = None           # coberto por estoque -> disponível agora
            pedido_obj["pronto"] = True
        faturaveis.append(pedido_obj)
    # exibição mantém a ordem por data de entrega do pedido (mais antigo -> mais recente)

    valor_faturavel = round(sum(p["valor_total_pedido"] for p in faturaveis), 2)
    return {
        "pedidos": faturaveis,
        "sem_data_programacao": sem_data,
        "fontes": sorted(fontes),
        "considerar_reserva": "reserva" in fontes,   # compat
        "calc_versao": "v4: fontes(disp/reserva/producao) + cascata + ordem por entrega",  # marcador de deploy
        "totais": {
            "n_pedidos_faturaveis": len(faturaveis),
            "n_sem_data": len(sem_data),
            "valor_faturavel": valor_faturavel,
            "n_pedidos_completos": len(todos_atendidos),
            "valor_bonificacao": round(sum(p["valor_total_pedido"] for p in faturaveis if p.get("tipo") == 'BONIFICACAO'), 2),
            "valor_pendente_financeiro": round(sum(p["valor_total_pedido"] for p in faturaveis if p.get("tipo") == 'PENDENTE_FINANCEIRO'), 2),
            "valor_padrao": round(sum(p["valor_total_pedido"] for p in faturaveis if not p.get("tipo")), 2),
            "valor_nao_faturavel": round(sum(p["valor_total_pedido"] for p in sem_data), 2),
        },
    }


# ---- Otimização ILP (PuLP) — 4 estratégias ---------------------------------
# E1 ('completar_com_saldo') = greedy atual (montar_faturamento).
# E2 ('max_valor'), E3 ('max_atrasados'), E4 ('max_combinado') usam ILP CBC.
# Tudo-ou-nada: pedido só é selecionado se TODA sua demanda cabe no saldo total
# (estoque + reserva + produção) das fontes ativas. NÃO permite faturamento parcial.

def otimizar_faturamento_pulp(plano: dict, liberacoes_por_produto: dict,
                              estoque: Dict[str, Dict[str, float]], producao: Dict[str, float],
                              fontes=None, estrategia: str = "max_valor", alpha: float = 0.05) -> dict:
    """Escolhe subconjunto de pedidos que maximiza objetivo respeitando saldo por SKU.

    estrategia:
      - 'max_valor'      : max Σ valor_p · x_p
      - 'max_atrasados'  : max Σ dias_atraso_p · x_p
      - 'max_combinado'  : max Σ valor_p · (1 + alpha · dias_atraso_p) · x_p

    Em qualquer falha (PuLP indisponível, solver erro, sem candidatos), faz fallback
    para o greedy `montar_faturamento` — comportamento E1.
    """
    # Helper de clone raso por liberação: evita que `montar_faturamento` mute `lib["qtd"]`
    # no `liberacoes_por_produto` original (side-effect detectado na auditoria 16/06).
    # Sem clone, o cálculo paralelo de v_e1 (delta_vs_e1) lia libs já consumidas.
    def _libs_clone(libs_by_prod):
        return {cod: {**(info or {}),
                      "liberacoes": [{**l} for l in ((info or {}).get("liberacoes") or [])]}
                for cod, info in (libs_by_prod or {}).items()}

    try:
        import pulp
    except Exception as e:
        logger.warning(f"PuLP indisponível ({e}); fallback greedy")
        _res_fb = montar_faturamento(plano, liberacoes_por_produto, estoque, producao, fontes=fontes)
        _res_fb.setdefault("meta", {})["solver"] = "greedy_fallback_no_pulp"
        return _res_fb

    fontes = set(fontes or ["disponivel", "reserva", "producao"])
    usa_disp = "disponivel" in fontes
    usa_reserva = "reserva" in fontes
    usa_prod = "producao" in fontes

    totais = plano.get("totais", {}) or {}
    todos_atendidos = list(totais.get("pedidos_atendidos") or [])
    pedidos_completos_fb = plano.get("pedidos_completos", []) or []
    if not todos_atendidos:
        todos_atendidos = [str(pc.get("pedido")) for pc in pedidos_completos_fb if pc.get("pedido")]

    # F11.1: demanda do UNIVERSO COMPLETO (totais.pedidos_itens) — não só dos 128 do detalhe_alocacao.
    # Antes: candidatos = todos_atendidos ∩ detalhe_alocacao → E2-E4 viam só ~26% dos pedidos
    # e devolviam menos R$ que o greedy E1. Agora todos os pedidos atendidos entram no modelo.
    pedidos_itens = totais.get("pedidos_itens") or {}
    demanda: Dict[str, Dict[str, float]] = {}
    for ped, itens in pedidos_itens.items():
        ped_s = str(ped or "")
        if not ped_s:
            continue
        # Shape canonical: lista de dicts {sku, demanda, descricao, valor}
        for it in (itens or []):
            sku_n = _norm(it.get("sku", ""))
            if not sku_n:
                continue
            qtd = float(it.get("demanda") or it.get("qtd") or 0)
            if qtd <= 0:
                continue
            demanda.setdefault(ped_s, {}).setdefault(sku_n, 0.0)
            demanda[ped_s][sku_n] += qtd
    # Fallback: se totais.pedidos_itens vier vazio, usa detalhe_alocacao (compat).
    if not demanda:
        for d in (plano.get("detalhe_alocacao") or []):
            ped = str(d.get("pedido", "") or "")
            sku = _norm(d.get("sku", ""))
            if not ped or not sku:
                continue
            qtd = float(d.get("qtd") or d.get("quantidade") or 0)
            demanda.setdefault(ped, {}).setdefault(sku, 0.0)
            demanda[ped][sku] += qtd

    # F11.1: valores/atrasos do universo completo (totais.pedidos_valores / pedidos_dias_atraso).
    # pedidos_completos cobria só ~128 pedidos; agora 482.
    pv = totais.get("pedidos_valores") or {}
    pda = totais.get("pedidos_dias_atraso") or {}
    valores = {str(k): float(v or 0) for k, v in pv.items()}
    atrasos = {str(k): max(0, int(v or 0)) for k, v in pda.items()}
    # Fallback aditivo com pedidos_completos (não sobrescreve o universo).
    for pc in pedidos_completos_fb:
        k = str(pc.get("pedido", ""))
        if k and k not in valores:
            valores[k] = float(pc.get("valor") or pc.get("valor_total") or 0)
        if k and k not in atrasos:
            atrasos[k] = max(0, int(pc.get("dias_atraso") or 0))

    # F11.1 caminho B: capacidade TEMPORAL (não agregada).
    # Estoque disp+reserva conta como disponível desde sempre (t = -inf).
    # Liberações de produção contam só a partir da própria previsao_termino, e SÓ se
    # previsao_termino >= hoje (regra canonical Thiago 12/06: produção atrasada não é saldo —
    # ou já virou estoque, ou ficou retida na fábrica = problema operacional).
    from datetime import datetime as _dt
    hoje_ts = _ts(_dt.now().strftime("%Y-%m-%d"))

    # Capacidade base (disp + reserva): disponível em qualquer corte de tempo
    cap_base: Dict[str, float] = {}
    for sku, e in (estoque or {}).items():
        v = 0.0
        if usa_disp:    v += float(e.get("disponivel") or 0)
        if usa_reserva: v += float(e.get("reserva") or 0)
        cap_base[sku] = v

    # Liberações futuras por SKU (após filtro hoje) + tracking das atrasadas pra UI
    libs_por_sku: Dict[str, list] = {}
    atrasadas = {"n_liberacoes": 0, "qtd_total": 0.0, "skus": set()}
    if usa_prod:
        for cod, info in (liberacoes_por_produto or {}).items():
            libs_raw = (info or {}).get("liberacoes", []) or []
            futuras = []
            for l in libs_raw:
                q = float(l.get("qtd") or 0)
                if q <= 0:
                    continue
                # Fallback: lote sem previsao_termino calculada usa data de entrega do lote
                pt = l.get("previsao_termino") or l.get("entrega")
                if _ts(pt) >= hoje_ts:
                    futuras.append({"qtd": q, "previsao_termino": pt})
                else:
                    atrasadas["n_liberacoes"] += 1
                    atrasadas["qtd_total"] += q
                    atrasadas["skus"].add(cod)
            libs_por_sku[cod] = sorted(futuras, key=lambda x: _ts(x["previsao_termino"]))

    candidatos = [str(p) for p in todos_atendidos if str(p) in demanda]
    if not candidatos:
        _res_fb = montar_faturamento(plano, liberacoes_por_produto, estoque, producao, fontes=fontes)
        _res_fb.setdefault("meta", {})["solver"] = "greedy_fallback_no_candidates"
        return _res_fb

    # SKUs efetivamente demandados
    todos_skus = set()
    for p in candidatos:
        todos_skus.update(demanda.get(p, {}).keys())

    # 17/06: capacidade MULTI-PERÍODO (reverte decisão agregada 12/06).
    # Pra cada (SKU, corte T): Σ demanda[p][sku]·x_p sobre p com entrega≤T  ≤  estoque[sku] + Σ libs[sku] com prev≤T
    # Pedido sem data_entrega entra como T=+∞ (só compete pela capacidade total). Garante que solver
    # não promete pedido cuja lib chega depois da data de entrega.
    pedidos_entregas = totais.get("pedidos_entregas") or {}
    INF = float('inf')
    def _t_ped(p):
        ts = _ts_data(pedidos_entregas.get(p) or "")
        return ts if ts > 0 else INF
    entregas_ped = {p: _t_ped(p) for p in candidatos}
    cortes_finitos = sorted({t for t in entregas_ped.values() if t < INF})
    tem_sem_data = any(t == INF for t in entregas_ped.values())
    cortes = cortes_finitos + ([INF] if tem_sem_data else [])

    def _libs_ate(sku, T):
        libs = libs_por_sku.get(sku, [])
        if T == INF:
            return sum(l["qtd"] for l in libs)
        return sum(l["qtd"] for l in libs if _ts_data(l["previsao_termino"]) <= T)

    prob = pulp.LpProblem("otimizador_faturamento", pulp.LpMaximize)
    x = {p: pulp.LpVariable(f"x_{p}", cat="Binary") for p in candidatos}

    if estrategia == "max_valor":
        prob += pulp.lpSum(valores.get(p, 0) * x[p] for p in candidatos)
    elif estrategia == "max_atrasados":
        prob += pulp.lpSum(atrasos.get(p, 0) * x[p] for p in candidatos)
    else:
        prob += pulp.lpSum(valores.get(p, 0) * (1 + alpha * atrasos.get(p, 0)) * x[p] for p in candidatos)

    # 17/06 (Thiago): entrega original do pedido não restringe lib. Volta pra capacidade agregada —
    # cap_sku = estoque/reserva + Σ libs futuras (todas). Pedido atrasado + lib futura = faturável.
    # "Quando sai" do pedido reflete a última lib consumida (calculado em montar_faturamento).
    for sku in todos_skus:
        cap_agg = cap_base.get(sku, 0.0) + sum(l["qtd"] for l in libs_por_sku.get(sku, []))
        prob += pulp.lpSum(demanda.get(p, {}).get(sku, 0.0) * x[p] for p in candidatos) <= cap_agg, f"cap_{sku}"

    try:
        solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=30)
        prob.solve(solver)
    except Exception as e:
        logger.warning(f"PuLP solver erro ({e}); fallback greedy")
        _res_fb = montar_faturamento(plano, liberacoes_por_produto, estoque, producao, fontes=fontes)
        _res_fb.setdefault("meta", {})["solver"] = "greedy_fallback_solver_error"
        _res_fb["meta"]["solver_error"] = str(e)
        return _res_fb

    # G3.2: capturar status do CBC pra UI saber se a solução é Optimal ou sub-ótima
    solver_status_name = pulp.LpStatus.get(prob.status, "Unknown")
    if solver_status_name != "Optimal":
        logger.warning(f"PuLP status={solver_status_name} (estrategia={estrategia}); seguindo com solução parcial")

    selecionados = set(p for p in candidatos if (x[p].value() or 0) > 0.5)
    totais_novo = {**totais, "pedidos_atendidos": list(selecionados)}
    plano_otim = {**plano, "totais": totais_novo}
    # F10.4: mapeia estratégia → ordem_consumo pra que o consumo cascata respeite
    # a prioridade que o solver decidiu (não a ordem por entrega default).
    _ordem_map = {"max_valor": "valor", "max_atrasados": "atraso", "max_combinado": "combinado"}
    ordem_consumo = _ordem_map.get(estrategia)
    # G2.1: deepcopy raso das libs antes da cascata principal — evita side-effect
    # que contaminava o cálculo paralelo de v_e1 (delta_vs_e1) abaixo.
    res = montar_faturamento(plano_otim, _libs_clone(liberacoes_por_produto), estoque, producao,
                             fontes=fontes, ordem_consumo=ordem_consumo, alpha=alpha)
    res["estrategia"] = estrategia
    # G3.1/G3.2: telemetria do solver (Optimal / Not Solved / Infeasible / Unbounded / Undefined)
    res.setdefault("meta", {})["solver"] = "pulp_optimal" if solver_status_name == "Optimal" else "pulp_partial"
    res["meta"]["solver_status"] = solver_status_name
    if estrategia == "max_combinado":
        res["alpha"] = alpha
    # F11.1 B: surfaçar libs de produção atrasada que foram ignoradas pra UI mostrar o gap operacional
    atrasadas_meta = None
    if atrasadas["n_liberacoes"] > 0:
        atrasadas_meta = {
            "n_liberacoes": atrasadas["n_liberacoes"],
            "qtd_total": round(atrasadas["qtd_total"], 2),
            "skus": sorted(atrasadas["skus"]),
        }
        res.setdefault("meta", {})["producao_atrasada_ignorada"] = atrasadas_meta
    # F11.1 B: NÃO comparar com E1 como guard-rail. ILP-B rejeita pedidos cuja liberação chega
    # depois da entrega — comportamento intencional (regra temporal Thiago). E1 não tem essa
    # restrição e aceita; comparar valor_faturavel entre os dois é injusto e mascara a regra.
    # Em vez disso, surfaçar a comparação como informação em meta.delta_vs_e1 pro usuário ver
    # o ganho líquido R$ da estratégia ILP-B vs greedy E1 sobre o mesmo universo (libs futuro).
    # delta_rs > 0 = ILP-B ganhou; delta_rs < 0 = greedy E1 teria entregado mais.
    try:
        v_ilp = float((res.get("totais") or {}).get("valor_faturavel") or 0)
        # G2.1: cada lib é clonada (shallow) — `montar_faturamento` muta `lib["qtd"]` in-loop.
        # Sem clone, este cálculo de v_e1 lia libs já consumidas pelo call principal acima.
        libs_futuro = {cod: {**(info or {}),
                              "liberacoes": [{**l} for l in ((info or {}).get("liberacoes") or [])
                                             if _ts(l.get("previsao_termino")) >= hoje_ts and float(l.get("qtd") or 0) > 0]}
                       for cod, info in (liberacoes_por_produto or {}).items()}
        res_e1 = montar_faturamento(plano, libs_futuro, estoque, producao, fontes=fontes)
        # 17/06: comparação justa — só pedidos com cobertura completa em ambos.
        # ILP-B é all-or-nothing (todo pedido aceito é completo). Greedy E1 aceita parcial,
        # então `valor_faturavel` total inclui pedidos com produtos_faltando — inflate.
        # Normaliza ambos pra "valor de pedidos 100% cobertos" → comparação apple-to-apple.
        v_e1 = sum((pp.get("valor_total_pedido") or 0) for pp in (res_e1.get("pedidos") or [])
                   if not pp.get("produtos_faltando"))
        peds_e1 = {pp.get("pedido") for pp in (res_e1.get("pedidos") or []) if not pp.get("produtos_faltando")}
        peds_ilp = {pp.get("pedido") for pp in (res.get("pedidos") or [])}
        rejeitados_temporal = sorted(peds_e1 - peds_ilp)
        if rejeitados_temporal:
            res.setdefault("meta", {})["delta_vs_e1"] = {
                "valor_e1_futuro": round(v_e1, 2),
                "valor_ilp": round(v_ilp, 2),
                "delta_rs": round(v_ilp - v_e1, 2),
                "n_pedidos_rejeitados_por_restricao_temporal": len(rejeitados_temporal),
                "pedidos_rejeitados": rejeitados_temporal[:50],  # cap pra payload
            }
        # G3.3: assert monotonicidade — ILP-B devia >= greedy E1 no MESMO universo (libs_futuro).
        # Quando ILP < greedy: regressão silenciosa do solver. Marca `meta.regressao_solver`
        # pra UI exibir; não falha (pode ser sub-ótimo no time limit, ou edge case válido).
        # 17/06: comparação em R$ só faz sentido pra estratégias que otimizam R$ (max_valor /
        # max_combinado). max_atrasados otimiza Σ dias_atraso·x_p — naturalmente entrega
        # menos R$ que greedy E1 sem ser regressão. Pular detector nesse caso.
        # 17/06: trigger mais conservador. Só dispara se diferença for MATERIAL (>10% do valor E1).
        # Pequenas diferenças (greedy ordem-by-entrega vs ILP subset-ótimo no mesmo universo) são
        # esperadas e não indicam bug — ILP pode escolher subset diferente sem ser sub-ótimo.
        # max_atrasados otimiza dias_atraso, não R$ — comparar R$ é injusto, sempre pula.
        delta_pct = ((v_e1 - v_ilp) / v_e1) if v_e1 > 0 else 0
        if estrategia == "max_atrasados":
            pass
        elif (v_e1 - v_ilp) > 0.01 and delta_pct > 0.10:
            res.setdefault("meta", {})["regressao_solver"] = {
                "valor_e1": round(v_e1, 2),
                "valor_ilp": round(v_ilp, 2),
                "delta_perda_rs": round(v_e1 - v_ilp, 2),
                "estrategia": estrategia,
                "solver_status": solver_status_name,
            }
            logger.warning(f"Regressao solver: ILP={v_ilp:.2f} < E1={v_e1:.2f} "
                           f"(estrategia={estrategia}, status={solver_status_name})")
    except Exception as e:
        logger.warning(f"Meta delta_vs_e1/regressao erro ({e}); seguindo.")
    return res


# ---- Carregamento da Programação oficial + plano ----

def _carregar_prog_versao(cur, programacao_versao_id: Optional[str]):
    """Retorna (programacao_versao_id, plano_versao_id, snapshot) da versão informada
    ou da oficial mais recente. None se não houver."""
    row = None
    if programacao_versao_id:
        cur.execute("SELECT id, plano_versao_id, snapshot FROM programacao_versao WHERE id = %s", (programacao_versao_id,))
        row = cur.fetchone()
    else:
        # F11.2: preferir a programação oficial CUJO plano_versao_id é o plano oficial atual.
        # Se não houver (programação ainda não rodada sobre o plano novo), cai na mais recente
        # e o _gerar_resultado marca meta.stale=true pra UI alertar.
        cur.execute(
            "SELECT pv.id, pv.plano_versao_id, pv.snapshot "
            "FROM programacao_versao pv "
            "JOIN plano_producao_versoes pp ON pp.id::text = pv.plano_versao_id::text "
            "WHERE pv.oficial = TRUE AND pp.oficial = TRUE "
            "ORDER BY COALESCE(pv.oficial_em, pv.created_at) DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                "SELECT id, plano_versao_id, snapshot FROM programacao_versao WHERE oficial = TRUE "
                "ORDER BY COALESCE(oficial_em, created_at) DESC LIMIT 1"
            )
            row = cur.fetchone()
    if not row:
        return None
    snap = row[2]
    if isinstance(snap, str):
        snap = json.loads(snap)
    return str(row[0]), str(row[1]), snap


def _carregar_plano(cur, plano_versao_id: str) -> Optional[dict]:
    cur.execute(
        "SELECT totais, pedidos_completos, detalhe_alocacao, plano FROM plano_producao_versoes WHERE id = %s",
        (plano_versao_id,)
    )
    row = cur.fetchone()
    if not row:
        return None

    def _j(v):
        return json.loads(v) if isinstance(v, str) else (v or [])
    return {
        "totais": _j(row[0]),
        "pedidos_completos": _j(row[1]),
        "detalhe_alocacao": _j(row[2]),
        "plano": _j(row[3]),
    }


def gerar_com_filtros(plano: dict, liber: dict, estoque: dict, producao: dict, filtros: Optional[dict]) -> dict:
    """Aplica filtros de simulação e monta o faturamento.
    Filtros: remover_produtos / remover_clientes (antes da montagem) e dias / semana_iso
    (sobre a previsão de término, depois da montagem)."""
    filtros = filtros or {}
    fontes = filtros.get("fontes") or ["disponivel", "reserva", "producao"]
    rem_prod = set(_norm(p) for p in (filtros.get("remover_produtos") or []))
    rem_cli = set(str(c).strip() for c in (filtros.get("remover_clientes") or []))
    rem_ped = set(str(x).strip() for x in (filtros.get("remover_pedidos") or []))
    rem_tipos = set(str(t).strip() for t in (filtros.get("remover_tipos") or []))
    # 17/06: remover_produtos agora remove PEDIDOS COMPLETOS que dependem do SKU
    # (decisão Thiago). Antes só filtrava detalhe_alocacao — pedido continuava no
    # universo do solver e aparecia como "produto faltando" artificialmente.
    # Varre detalhe_alocacao do plano e infere quais pedidos têm o SKU removido.
    if rem_prod:
        for d in (plano.get("detalhe_alocacao") or []):
            if _norm(d.get("sku")) in rem_prod:
                rem_ped.add(str(d.get("pedido") or "").strip())
        # 18/06 (V2): cobre pedidos NOVOS da carteira fresh (sem linha em detalhe_alocacao).
        # Sem isso, remover_produtos no Configurador deixava DIRETOS com SKU removido passar.
        pedidos_itens_v2 = (plano.get("totais") or {}).get("pedidos_itens") or {}
        for ped_v2, itens_v2 in pedidos_itens_v2.items():
            if any(_norm(it.get("sku")) in rem_prod for it in itens_v2):
                rem_ped.add(str(ped_v2).strip())
    totais_plano = plano.get("totais", {}) or {}
    tipos_map_f = totais_plano.get("pedidos_tipos", {}) or {}
    situacao_map_f = totais_plano.get("pedidos_situacao", {}) or {}
    clientes_map_f = totais_plano.get("pedidos_clientes", {}) or {}
    def _tipo_ped(ped):
        if str(situacao_map_f.get(str(ped), '') or '') == '1': return 'PENDENTE_FINANCEIRO'
        return str(tipos_map_f.get(str(ped), '') or '')
    def _ped_ok(ped):
        p = str(ped).strip()
        return (p not in rem_ped
                and _tipo_ped(p) not in rem_tipos
                and str(clientes_map_f.get(p, '') or '').strip() not in rem_cli)

    # Filtra totais.pedidos_atendidos / pedidos_itens / pedidos_clientes
    # quando remover pedidos/tipos/clientes — senão o universo do solver
    # (ILP + greedy) ignora o filtro e LEROY/etc reaparecem na lista.
    totais_orig = plano.get("totais", {}) or {}
    if rem_ped or rem_tipos or rem_cli:
        ped_atend_orig = totais_orig.get("pedidos_atendidos", []) or []
        ped_atend_filt = [p for p in ped_atend_orig if _ped_ok(p)]
        ped_itens_orig = totais_orig.get("pedidos_itens", {}) or {}
        ped_itens_filt = {k: v for k, v in ped_itens_orig.items() if _ped_ok(k)}
        ped_cli_orig = totais_orig.get("pedidos_clientes", {}) or {}
        ped_cli_filt = {k: v for k, v in ped_cli_orig.items() if _ped_ok(k)}
        totais_filt = {**totais_orig,
                       "pedidos_atendidos": ped_atend_filt,
                       "pedidos_itens": ped_itens_filt,
                       "pedidos_clientes": ped_cli_filt}
    else:
        totais_filt = totais_orig

    plano2 = {
        "totais": totais_filt,
        "plano": plano.get("plano", []) or [],
        "pedidos_completos": [pc for pc in (plano.get("pedidos_completos") or [])
                              if str(pc.get("cliente", "")).strip() not in rem_cli
                              and _ped_ok(pc.get("pedido", ""))],
        "detalhe_alocacao": [d for d in (plano.get("detalhe_alocacao") or [])
                             if _norm(d.get("sku")) not in rem_prod
                             and str(d.get("cliente", "")).strip() not in rem_cli
                             and _ped_ok(d.get("pedido", ""))],
    }
    # Dispatcher de estratégia (4 modos do Configurador):
    #   'completar_com_saldo' (default) -> greedy montar_faturamento
    #   'max_valor' | 'max_atrasados' | 'max_combinado' -> ILP PuLP
    estrategia = (filtros.get("estrategia") or "completar_com_saldo").strip()
    if estrategia in ("max_valor", "max_atrasados", "max_combinado"):
        try:
            alpha = float(filtros.get("alpha", 0.05))
        except Exception:
            alpha = 0.05
        res = otimizar_faturamento_pulp(plano2, liber, estoque, producao,
                                        fontes=fontes, estrategia=estrategia, alpha=alpha)
    else:
        res = montar_faturamento(plano2, liber, estoque, producao, fontes=fontes)

    # Filtro por DATA DE ENTREGA do pedido (que todo pedido tem). Pedido sem entrega não é
    # filtrado fora (evita "sumir com tudo"). Comparação em ISO 'YYYY-MM-DD'.
    periodo_de = (filtros.get("periodo_de") or "").strip()   # "YYYY-MM-DD"
    periodo_ate = (filtros.get("periodo_ate") or "").strip()
    if periodo_de or periodo_ate:
        def _dia_br(s):  # 'DD/MM/YYYY' -> 'YYYY-MM-DD'
            try:
                d, m, y = str(s).strip()[:10].split("/")
                return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            except Exception:
                return None

        def passa(p):
            e = _dia_br(p.get("entrega"))
            if not e:
                return True  # sem data de entrega -> mantém
            if periodo_de and e < periodo_de:
                return False
            if periodo_ate and e > periodo_ate:
                return False
            return True
        res["pedidos"] = [p for p in res["pedidos"] if passa(p)]
        res["sem_data_programacao"] = [p for p in res["sem_data_programacao"] if passa(p)]
        res["totais"]["n_pedidos_faturaveis"] = len(res["pedidos"])
        res["totais"]["n_sem_data"] = len(res["sem_data_programacao"])
        res["totais"]["valor_faturavel"] = round(sum(p["valor_total_pedido"] for p in res["pedidos"]), 2)

    # 17/06: filtro "Faturável hoje" — só MANTÉM pedidos completos prontos por estoque/reserva ou
    # cuja previsao_termino (data efetiva de saída) é hoje. Pedidos completos que sairiam em outro
    # dia são simplesmente DESCARTADOS (não vão pra incompletos). Pedidos já incompletos
    # (sem_data_programacao) NÃO são afetados — continuam intactos.
    if filtros.get("faturavel_hoje"):
        from datetime import datetime as _dt_fh
        _hoje_iso = _dt_fh.now().strftime("%Y-%m-%d")
        def _sai_hoje(p):
            if p.get("pronto"):
                return True
            pt = p.get("previsao_termino")
            if not pt:
                return False
            return str(pt)[:10] <= _hoje_iso
        res["pedidos"] = [p for p in res["pedidos"] if _sai_hoje(p)]

    # Recalcula TODOS os totais com base nos pedidos finais (após todos os filtros)
    fat = res["pedidos"]
    sem = res["sem_data_programacao"]
    res["totais"]["n_pedidos_faturaveis"]    = len(fat)
    res["totais"]["n_sem_data"]              = len(sem)
    res["totais"]["valor_faturavel"]         = round(sum(p["valor_total_pedido"] for p in fat), 2)
    res["totais"]["valor_bonificacao"]       = round(sum(p["valor_total_pedido"] for p in fat if p.get("tipo") == 'BONIFICACAO'), 2)
    res["totais"]["valor_pendente_financeiro"] = round(sum(p["valor_total_pedido"] for p in fat if p.get("tipo") == 'PENDENTE_FINANCEIRO'), 2)
    res["totais"]["valor_padrao"]            = round(sum(p["valor_total_pedido"] for p in fat if not p.get("tipo")), 2)
    res["totais"]["valor_nao_faturavel"]     = round(sum(p["valor_total_pedido"] for p in sem), 2)
    res["filtros"] = filtros
    # Fix 16/06 (Guia consumo): numerar pedidos faturáveis sequencialmente (1..N) na ordem do solver.
    # UI usa esse índice pra mostrar "#1 ► #2 ► #3" e guiar consumo crescente.
    for i, p in enumerate(res.get("pedidos") or []):
        p["ordem_consumo"] = i + 1
        # Status 100% saldo: pedido só é faturável quando cascata cobre toda a demanda.
        # produtos_faltando vazio + sem `motivo` = PRONTO. Backend já filtra mas reforçamos flag.
        tem_falta = bool(p.get("produtos_faltando"))
        p["cobertura_completa"] = not tem_falta and not p.get("motivo")
    return res


def _gerar_resultado(programacao_versao_id: Optional[str], refresh: bool = False,
                     filtros: Optional[dict] = None) -> dict:
    """Gera o resultado do faturamento (sem persistir). Reusado por /gerar, /simular e /salvar-versao."""
    _ensure_prog_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    stale_meta = {}
    try:
        prog = _carregar_prog_versao(cur, programacao_versao_id)
        if not prog:
            raise HTTPException(status_code=404, detail="Nenhuma versão oficial da Programação encontrada. Salve uma versão oficial na Programação.")
        prog_id, plano_id, snapshot = prog
        plano = _carregar_plano(cur, plano_id)
        if not plano:
            raise HTTPException(status_code=404, detail="Plano de produção da versão não encontrado")
        # 17/06: marca se a versão EM USO é oficial (frontend usa pra mostrar chip Oficial/Rascunho)
        try:
            cur.execute("SELECT oficial, COALESCE(oficial_em, created_at), created_by_name FROM programacao_versao WHERE id::text = %s", (str(prog_id),))
            _vu = cur.fetchone()
            if _vu:
                stale_meta["versao_em_uso_oficial"] = bool(_vu[0])
                stale_meta["versao_em_uso_em"] = _vu[1].isoformat() if _vu[1] else None
                stale_meta["versao_em_uso_por_nome"] = _vu[2]
        except Exception as _vue:
            logger.warning(f"versao_em_uso check erro ({_vue})")
        # F11.2 staleness (executar enquanto cursor ainda está aberto)
        try:
            cur.execute(
                "SELECT id, COALESCE(oficial_em, created_at) FROM plano_producao_versoes "
                "WHERE oficial = TRUE ORDER BY COALESCE(oficial_em, created_at) DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                stale_meta["plano_oficial_atual_id"] = str(row[0])
                stale_meta["plano_oficial_atual_em"] = row[1].isoformat() if row[1] else None
                stale_meta["stale"] = str(row[0]) != str(plano_id)
            cur.execute("SELECT COALESCE(oficial_em, created_at) FROM plano_producao_versoes WHERE id::text = %s", (str(plano_id),))
            r2 = cur.fetchone()
            if r2 and r2[0]:
                stale_meta["plano_usado_em"] = r2[0].isoformat()
            cur.execute("SELECT COALESCE(oficial_em, created_at) FROM programacao_versao WHERE id::text = %s", (str(prog_id),))
            r3 = cur.fetchone()
            if r3 and r3[0]:
                stale_meta["programacao_em"] = r3[0].isoformat()
            # Fase A (16/06): detectar divergência entre board ATUAL (programacao_board) e snapshot
            # da versão oficial usada. Quando user limpa board mas não salva nova versão oficial,
            # o Otimizador continua lendo snapshot antigo → surfaçar pro UI alertar.
            # 17/06: comparar HASH de conteúdo (não só COUNT). Reusa _build_prog_snapshot +
            # _snapshot_hash garantindo apple-to-apple com o snapshot oficial. Pega remanejo
            # de máquina, qtd, ordem, lote, previsao_termino — não só add/remove de item.
            try:
                snap_itens = (snapshot or {}).get("itens") or []
                n_snap = sum(1 for i in snap_itens if i)
                board_snap = _build_prog_snapshot(cur, str(plano_id))
                board_itens = (board_snap or {}).get("itens") or []
                n_board = sum(1 for i in board_itens if i)
                snap_h = _snapshot_hash(snapshot or {})
                board_h = _snapshot_hash(board_snap or {})
                stale_meta["snapshot_n_itens"] = n_snap
                stale_meta["board_n_itens"] = n_board
                stale_meta["snapshot_hash"] = snap_h
                stale_meta["board_hash"] = board_h
                stale_meta["board_divergente"] = (board_h != snap_h)
                # 17/06: detecta versão auto-salva mais nova que a oficial usada.
                # Front exibe banner "salvar como oficial?" sem bloquear o Otimizador.
                cur.execute(
                    "SELECT id, created_at, oficial, created_by_name, hash "
                    "FROM programacao_versao WHERE plano_versao_id = %s "
                    "ORDER BY created_at DESC LIMIT 1",
                    (str(plano_id),)
                )
                lv = cur.fetchone()
                if lv:
                    stale_meta["ultima_versao_id"] = str(lv[0])
                    stale_meta["ultima_versao_em"] = lv[1].isoformat() if lv[1] else None
                    stale_meta["ultima_versao_oficial"] = bool(lv[2])
                    stale_meta["ultima_versao_por_nome"] = lv[3]
                    stale_meta["ultima_versao_hash"] = lv[4]
                    stale_meta["versao_mais_nova_que_oficial"] = (
                        not bool(lv[2]) and str(lv[0]) != str(prog_id)
                    )
            except Exception as _be:
                logger.warning(f"board_divergente check erro ({_be})")
        except Exception as _se:
            logger.warning(f"meta.stale erro ({_se})")
    finally:
        cur.close()
        conn.close()

    try:
        estoque = _carregar_estoque(refresh)
    except Exception as e:
        logger.error(f"Erro ao carregar estoque (BigQuery): {e}")
        raise HTTPException(status_code=502, detail=f"Erro ao carregar estoque: {e}")
    try:
        producao = _producao_por_codigo(refresh)
    except Exception as e:
        logger.error(f"Erro ao carregar produção (OPs): {e}")
        producao = {}

    # 18/06 (V2): carteira FRESH do BigQuery quando refresh=True. Mescla com o plano oficial:
    # pedidos faturados saem, pedidos novos entram (sem libs de produção). Flag no_plano por pedido.
    if refresh:
        try:
            carteira = _carteira_aberta_fresh_bq(refresh=True, status=(filtros or {}).get("status"))
            plano, _carteira_meta = _enriquecer_plano_com_carteira_fresh(plano, carteira)
            from datetime import datetime as _dt_cf
            stale_meta["carteira_fresh_em"] = _dt_cf.utcnow().isoformat() + "Z"
            stale_meta.update(_carteira_meta)
        except Exception as _ce:
            logger.error(f"Erro ao buscar carteira fresh (BigQuery): {_ce}")
            # Falha não-fatal: segue com plano snapshot (comportamento antigo) e sinaliza no meta.
            stale_meta["carteira_fresh_erro"] = str(_ce)

    liber = compute_liberacoes(snapshot).get("produtos", {})
    try:
        resultado = gerar_com_filtros(plano, liber, estoque, producao, filtros)
    except Exception as _e:
        import traceback as _tb
        _msg = f"{type(_e).__name__}: {_e}\n{_tb.format_exc()}"
        logger.error(f"Erro em gerar_com_filtros: {_msg}")
        raise HTTPException(status_code=500, detail=_msg)
    # Merge: preserva meta populada pelo ILP-B (delta_vs_e1, producao_atrasada_ignorada)
    existing_meta = resultado.get("meta") or {}
    resultado["meta"] = {**existing_meta,
                          "programacao_versao_id": prog_id,
                          "plano_versao_id": plano_id,
                          **stale_meta}
    return resultado


@router.get("/gerar")
def gerar(programacao_versao_id: Optional[str] = None, refresh: bool = False,
          user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Gera o faturamento sobre a Programação oficial (ou a versão informada).
    Retorna pedidos completos por pedido inteiro, ordenados pela previsão de término."""
    _uid(user_id)
    return _gerar_resultado(programacao_versao_id, refresh)


# ============================================================================
# Versões de faturamento (snapshots congelados) + comparação + detecção de mudança.
# ============================================================================

def _ensure_fat_versao():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faturamento_versao (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            programacao_versao_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by TEXT,
            created_by_name TEXT,
            resultado JSONB NOT NULL,
            oficial BOOLEAN DEFAULT FALSE,
            oficial_em TIMESTAMPTZ,
            oficial_por TEXT,
            oficial_por_nome TEXT
        )
        """
    )
    # Fase B (16/06): colunas pra rastrear cadeia Plano→Programação→Otim.Fat,
    # filtros do Configurador usados na versão, e totais resumidos pra UI listar sem deserializar.
    cur.execute("ALTER TABLE faturamento_versao ADD COLUMN IF NOT EXISTS plano_versao_id TEXT")
    cur.execute("ALTER TABLE faturamento_versao ADD COLUMN IF NOT EXISTS filtros JSONB")
    cur.execute("ALTER TABLE faturamento_versao ADD COLUMN IF NOT EXISTS totais_resumo JSONB")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fat_versao_created ON faturamento_versao(created_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fat_versao_oficial ON faturamento_versao(oficial) WHERE oficial = TRUE")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fat_versao_plano ON faturamento_versao(plano_versao_id)")
    # Fase C (16/06): lock real — só UMA `faturamento_versao` pode ser oficial globalmente.
    # Migração idempotente: cleanup do legado (backup + desmarca antigas) + UNIQUE INDEX parcial.
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_fat_oficial_unique') THEN
                CREATE TABLE IF NOT EXISTS faturamento_versao_oficial_cleanup_backup AS
                    SELECT *, NOW() AS backup_em FROM faturamento_versao WHERE oficial = TRUE;
                UPDATE faturamento_versao SET oficial = FALSE
                WHERE oficial = TRUE AND id NOT IN (
                    SELECT id FROM faturamento_versao
                    WHERE oficial = TRUE
                    ORDER BY COALESCE(oficial_em, created_at) DESC LIMIT 1
                );
                CREATE UNIQUE INDEX idx_fat_oficial_unique
                    ON faturamento_versao(oficial) WHERE oficial = TRUE;
            END IF;
        END $$;
    """)
    conn.commit()
    cur.close()
    conn.close()


def _resumo_totais(resultado: dict) -> dict:
    """Extrai um dict pequeno dos totais pra UI listar versões sem precisar do JSONB cheio."""
    t = (resultado or {}).get("totais") or {}
    m = (resultado or {}).get("meta") or {}
    return {
        "n_pedidos_faturaveis": t.get("n_pedidos_faturaveis"),
        "n_sem_data": t.get("n_sem_data"),
        "valor_faturavel": t.get("valor_faturavel"),
        "valor_nao_faturavel": t.get("valor_nao_faturavel"),
        "estrategia": m.get("estrategia") or (resultado or {}).get("estrategia"),
        "solver": m.get("solver"),
        "solver_status": m.get("solver_status"),
    }


def _purge_versoes_antigas(cur, manter_top: int = 50):
    """Mantém as `manter_top` versões NÃO oficiais mais recentes (oficiais nunca removidas)."""
    cur.execute(
        "DELETE FROM faturamento_versao WHERE oficial = FALSE AND id NOT IN ("
        "  SELECT id FROM faturamento_versao WHERE oficial = FALSE "
        "  ORDER BY created_at DESC LIMIT %s"
        ")",
        (manter_top,),
    )


def _persistir_versao(cur, resultado: dict, filtros: Optional[dict],
                      prog_id: Optional[str], plano_id: Optional[str],
                      uid: Optional[str], nome: Optional[str], oficial: bool = False):
    """INSERT em faturamento_versao usando o cursor da transação corrente.
    Retorna (id, created_at)."""
    if oficial:
        cur.execute("UPDATE faturamento_versao SET oficial = FALSE WHERE oficial = TRUE")
    cur.execute(
        "INSERT INTO faturamento_versao "
        "(programacao_versao_id, plano_versao_id, filtros, totais_resumo, "
        " created_by, created_by_name, resultado, oficial) "
        "VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s, %s::jsonb, %s) RETURNING id, created_at",
        (prog_id, plano_id,
         json.dumps(filtros or {}, ensure_ascii=False, default=str),
         json.dumps(_resumo_totais(resultado), ensure_ascii=False, default=str),
         str(uid) if uid else None, nome,
         json.dumps(resultado, ensure_ascii=False, default=str), bool(oficial)),
    )
    row = cur.fetchone()
    if oficial and row:
        cur.execute(
            "UPDATE faturamento_versao SET oficial_em = NOW(), oficial_por = %s, oficial_por_nome = %s WHERE id = %s",
            (str(uid) if uid else None, nome, row[0]),
        )
    return row[0], row[1]


class SalvarFatBody(BaseModel):
    programacao_versao_id: Optional[str] = None
    oficial: Optional[bool] = False
    # F11.X1: snapshot da configuração ativa (estratégia, fontes, filtros) pro versionamento.
    # Sem isso, "salvar versão" usava só defaults e perdia o cenário do Configurador.
    filtros: Optional[dict] = None


class OficialFatBody(BaseModel):
    oficial: bool = True


@router.post("/salvar-versao")
def salvar_versao(body: SalvarFatBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Congela o faturamento atual numa versão (snapshot). Pode marcar como oficial."""
    uid = _uid(user_id, edit=True)
    if body.oficial and not check_sector_permission(user_id, 'Logística'):
        raise HTTPException(status_code=403, detail="Apenas usuários da Logística podem definir a versão oficial.")
    _ensure_fat_versao()
    resultado = _gerar_resultado(body.programacao_versao_id, refresh=True, filtros=body.filtros)
    meta = resultado.get("meta") or {}
    prog_id = meta.get("programacao_versao_id")
    plano_id = meta.get("plano_versao_id")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        nome = _user_name(cur, uid)
        vid, created_at = _persistir_versao(cur, resultado, body.filtros, prog_id, plano_id,
                                            uid, nome, oficial=bool(body.oficial))
        _purge_versoes_antigas(cur)
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return {"id": str(vid), "oficial": bool(body.oficial),
            "created_at": (created_at.isoformat() if created_at else None),
            "programacao_versao_id": prog_id, "plano_versao_id": plano_id,
            "totais": resultado.get("totais")}


@router.get("/versoes")
def versoes(
    offset: int = 0, limit: int = 20, oficial_only: bool = False,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Lista versões de faturamento, da mais nova para a mais antiga.
    Fase B (16/06): paginação (offset/limit) + filtro oficial_only + colunas novas (plano, filtros, resumo)."""
    _uid(user_id)
    _ensure_fat_versao()
    limit = max(1, min(100, int(limit or 20)))
    offset = max(0, int(offset or 0))
    where = "WHERE oficial = TRUE" if oficial_only else ""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM faturamento_versao {where}")
        total = int((cur.fetchone() or [0])[0])
        cur.execute(
            f"SELECT id, programacao_versao_id, plano_versao_id, created_at, created_by_name, "
            f"oficial, oficial_em, oficial_por_nome, totais_resumo, filtros "
            f"FROM faturamento_versao {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        out = [{
            "id": str(r[0]), "programacao_versao_id": r[1], "plano_versao_id": r[2],
            "created_at": (r[3].isoformat() if r[3] else None),
            "created_by_name": r[4], "oficial": bool(r[5]),
            "oficial_em": (r[6].isoformat() if r[6] else None),
            "oficial_por_nome": r[7],
            "totais_resumo": (json.loads(r[8]) if isinstance(r[8], str) else r[8]),
            "filtros": (json.loads(r[9]) if isinstance(r[9], str) else r[9]),
        } for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"versoes": out, "total": total, "offset": offset, "limit": limit}


@router.get("/versoes/{versao_id}")
def carregar_versao(versao_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Fase B (16/06): carrega resultado completo de uma versão antiga pra revisitar no UI."""
    _uid(user_id)
    _ensure_fat_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, programacao_versao_id, plano_versao_id, created_at, created_by_name, "
            "oficial, oficial_em, oficial_por_nome, filtros, resultado "
            "FROM faturamento_versao WHERE id = %s",
            (versao_id,),
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Versão de faturamento não encontrada")
        resultado = json.loads(r[9]) if isinstance(r[9], str) else r[9]
    finally:
        cur.close()
        conn.close()
    return {
        "id": str(r[0]), "programacao_versao_id": r[1], "plano_versao_id": r[2],
        "created_at": (r[3].isoformat() if r[3] else None),
        "created_by_name": r[4], "oficial": bool(r[5]),
        "oficial_em": (r[6].isoformat() if r[6] else None),
        "oficial_por_nome": r[7],
        "filtros": (json.loads(r[8]) if isinstance(r[8], str) else r[8]),
        "resultado": resultado,
    }


@router.put("/versoes/{versao_id}/oficial")
def marcar_oficial(versao_id: str, body: OficialFatBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Marca/desmarca uma versão de faturamento como oficial (única oficial por vez)."""
    uid = _uid(user_id, edit=True)
    if not check_sector_permission(user_id, 'Logística'):
        raise HTTPException(status_code=403, detail="Apenas usuários da Logística podem definir a versão oficial.")
    _ensure_fat_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM faturamento_versao WHERE id = %s", (versao_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Versão de faturamento não encontrada")
        nome = _user_name(cur, uid)
        if body.oficial:
            cur.execute("UPDATE faturamento_versao SET oficial = FALSE WHERE oficial = TRUE")
            cur.execute(
                "UPDATE faturamento_versao SET oficial = TRUE, oficial_em = NOW(), oficial_por = %s, oficial_por_nome = %s WHERE id = %s",
                (str(uid), nome, versao_id),
            )
        else:
            cur.execute(
                "UPDATE faturamento_versao SET oficial = FALSE, oficial_em = NULL, oficial_por = NULL, oficial_por_nome = NULL WHERE id = %s",
                (versao_id,),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return {"ok": True, "oficial": body.oficial}


def comparar_faturamento(base: dict, novo: dict) -> dict:
    """Diff por pedido entre dois resultados de faturamento: novos, removidos, data, valor, posição."""
    def idx(res):
        m = {}
        for i, p in enumerate(res.get("pedidos", []) or []):
            m[str(p.get("pedido"))] = (i, p)
        return m

    ma, mb = idx(base), idx(novo)
    novos, removidos, data_mudou, valor_mudou, posicao_mudou = [], [], [], [], []
    for ped, (i, pb) in mb.items():
        if ped not in ma:
            novos.append({"pedido": ped, "cliente": pb.get("cliente"),
                          "previsao_termino": pb.get("previsao_termino"), "valor": pb.get("valor_total_pedido")})
    for ped, (ia, pa) in ma.items():
        if ped not in mb:
            removidos.append({"pedido": ped, "cliente": pa.get("cliente"),
                              "previsao_termino": pa.get("previsao_termino"), "valor": pa.get("valor_total_pedido")})
            continue
        ib, pb = mb[ped]
        if pa.get("previsao_termino") != pb.get("previsao_termino"):
            data_mudou.append({"pedido": ped, "cliente": pa.get("cliente"),
                               "previsao_base": pa.get("previsao_termino"), "previsao_novo": pb.get("previsao_termino")})
        va, vb = float(pa.get("valor_total_pedido") or 0), float(pb.get("valor_total_pedido") or 0)
        if va != vb:
            valor_mudou.append({"pedido": ped, "cliente": pa.get("cliente"),
                                "valor_base": va, "valor_novo": vb, "delta": round(vb - va, 2)})
        if ia != ib:
            posicao_mudou.append({"pedido": ped, "cliente": pa.get("cliente"), "pos_base": ia, "pos_novo": ib})
    return {
        "novos": novos, "removidos": removidos, "data_mudou": data_mudou,
        "valor_mudou": valor_mudou, "posicao_mudou": posicao_mudou,
        "resumo": {"novos": len(novos), "removidos": len(removidos), "data": len(data_mudou),
                   "valor": len(valor_mudou), "posicao": len(posicao_mudou)},
    }


def _carregar_fat_resultado(cur, versao_id: str) -> Optional[dict]:
    cur.execute("SELECT resultado FROM faturamento_versao WHERE id = %s", (versao_id,))
    row = cur.fetchone()
    if not row:
        return None
    res = row[0]
    return json.loads(res) if isinstance(res, str) else res


# F11.X3: expor versão salva completa (faltava — frontend recebia 404 ao tentar abrir histórico)
@router.get("/versoes/{versao_id}")
def get_versao(versao_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Retorna o snapshot salvo de uma versão de faturamento (resultado + meta + filtros)."""
    _uid(user_id, edit=False)
    _ensure_fat_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, programacao_versao_id, created_at, created_by_name, oficial, oficial_em, oficial_por_nome, resultado "
            "FROM faturamento_versao WHERE id = %s",
            (versao_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Versão não encontrada")
        res = row[7]
        resultado = json.loads(res) if isinstance(res, str) else res
        return {
            "id": str(row[0]),
            "programacao_versao_id": row[1],
            "created_at": row[2].isoformat() if row[2] else None,
            "created_by_name": row[3],
            "oficial": bool(row[4]),
            "oficial_em": row[5].isoformat() if row[5] else None,
            "oficial_por_nome": row[6],
            "resultado": resultado,
        }
    finally:
        cur.close()
        conn.close()


@router.get("/comparar")
def comparar(base: str, novo: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Diff por pedido entre duas versões salvas de faturamento."""
    _uid(user_id)
    _ensure_fat_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        a = _carregar_fat_resultado(cur, base)
        b = _carregar_fat_resultado(cur, novo)
    finally:
        cur.close()
        conn.close()
    if a is None or b is None:
        raise HTTPException(status_code=404, detail="Versão (base ou nova) não encontrada")
    return comparar_faturamento(a, b)


@router.get("/tem-versao-nova")
def tem_versao_nova(
    faturamento_versao_id: str,
    programacao_versao_id_em_uso: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    """Indica se a Programação oficial mudou desde a versão usada no resultado em uso.
    17/06: se `programacao_versao_id_em_uso` for informada, compara contra ela (após Atualizar,
    o resultado atual já usa a programação mais nova — não deve mais mostrar 'mudou').
    Caso contrário, compara contra a programação usada na versão de faturamento informada (compat)."""
    _uid(user_id)
    _ensure_fat_versao()
    _ensure_prog_versao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT programacao_versao_id FROM faturamento_versao WHERE id = %s", (faturamento_versao_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Versão de faturamento não encontrada")
        base_prog = str(row[0]) if row[0] is not None else None
        cur.execute(
            "SELECT id, COALESCE(oficial_em, created_at) FROM programacao_versao WHERE oficial = TRUE "
            "ORDER BY COALESCE(oficial_em, created_at) DESC LIMIT 1"
        )
        of = cur.fetchone()
    finally:
        cur.close()
        conn.close()
    oficial_id = str(of[0]) if of else None
    # 17/06: comparação contra a versão EM USO (resultado atual). Se Atualizar trouxe a oficial
    # mais nova, em_uso == oficial_id e o banner some.
    referencia = programacao_versao_id_em_uso or base_prog
    mudou = bool(oficial_id and oficial_id != referencia)
    return {
        "mudou": mudou,
        "base_programacao_versao_id": base_prog,
        "programacao_versao_id_em_uso": programacao_versao_id_em_uso,
        "programacao_oficial_id": oficial_id,
        "programacao_oficial_em": (of[1].isoformat() if of and of[1] else None),
    }


# ============================================================================
# Simulador de cenários ("e se") — filtros + salvar com label (congelado).
# ============================================================================

def _ensure_fat_simulacao():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faturamento_simulacao (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            programacao_versao_id TEXT,
            label TEXT NOT NULL,
            filtros JSONB NOT NULL DEFAULT '{}'::jsonb,
            resultado JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by TEXT,
            created_by_name TEXT
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fat_sim_created ON faturamento_simulacao(created_at DESC)")
    conn.commit()
    cur.close()
    conn.close()


class SimularBody(BaseModel):
    programacao_versao_id: Optional[str] = None
    filtros: Optional[dict] = None
    refresh: Optional[bool] = False


class SalvarSimBody(BaseModel):
    label: str
    programacao_versao_id: Optional[str] = None
    filtros: Optional[dict] = None


@router.post("/simular")
def simular(body: SimularBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Roda um cenário do Configurador. Fase B (16/06): cada 'Processar' cria versão automaticamente
    (oficial=FALSE) pro Histórico. Operador escolhe depois quais tornar oficial."""
    uid = _uid(user_id)
    resultado = _gerar_resultado(body.programacao_versao_id, bool(body.refresh), body.filtros)
    # Auto-versão: registra cada execução no histórico (oficial=FALSE; operador decide depois)
    try:
        _ensure_fat_versao()
        meta = resultado.get("meta") or {}
        prog_id = meta.get("programacao_versao_id")
        plano_id = meta.get("plano_versao_id")
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            nome = _user_name(cur, uid) if uid else None
            vid, created_at = _persistir_versao(cur, resultado, body.filtros, prog_id, plano_id,
                                                uid, nome, oficial=False)
            _purge_versoes_antigas(cur)
            conn.commit()
            resultado.setdefault("meta", {})["faturamento_versao_id"] = str(vid)
            resultado["meta"]["faturamento_versao_em"] = created_at.isoformat() if created_at else None
        finally:
            cur.close()
            conn.close()
    except Exception as _ve:
        logger.warning(f"Auto-versão faturamento erro ({_ve}); seguindo sem persistir versão.")
    return resultado


@router.post("/simulacoes")
def salvar_simulacao(body: SalvarSimBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Salva um cenário simulado com label. Resultado congelado no momento do salvamento."""
    uid = _uid(user_id, edit=True)
    if not (body.label or "").strip():
        raise HTTPException(status_code=400, detail="label é obrigatório")
    _ensure_fat_simulacao()
    resultado = _gerar_resultado(body.programacao_versao_id, True, body.filtros)
    prog_id = (resultado.get("meta") or {}).get("programacao_versao_id")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        nome = _user_name(cur, uid)
        cur.execute(
            "INSERT INTO faturamento_simulacao (programacao_versao_id, label, filtros, resultado, created_by, created_by_name) "
            "VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s) RETURNING id, created_at",
            (prog_id, body.label.strip(), json.dumps(body.filtros or {}, ensure_ascii=False, default=str),
             json.dumps(resultado, ensure_ascii=False, default=str), str(uid), nome),
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return {"id": str(row[0]), "label": body.label.strip(),
            "created_at": (row[1].isoformat() if row[1] else None), "totais": resultado.get("totais")}


@router.get("/simulacoes")
def listar_simulacoes(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista cenários salvos (com labels)."""
    _uid(user_id)
    _ensure_fat_simulacao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, label, programacao_versao_id, filtros, created_at, created_by_name, (resultado->'totais') "
            "FROM faturamento_simulacao ORDER BY created_at DESC LIMIT 200"
        )
        out = [{
            "id": str(r[0]), "label": r[1], "programacao_versao_id": r[2],
            "filtros": (json.loads(r[3]) if isinstance(r[3], str) else r[3]),
            "created_at": (r[4].isoformat() if r[4] else None), "created_by_name": r[5],
            "totais": (json.loads(r[6]) if isinstance(r[6], str) else r[6]),
        } for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"simulacoes": out, "total": len(out)}


@router.get("/simulacoes-comparar")
def comparar_simulacoes(a: str, b: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Compara dois cenários salvos (diff por pedido)."""
    _uid(user_id)
    _ensure_fat_simulacao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ra = _carregar_sim_resultado(cur, a)
        rb = _carregar_sim_resultado(cur, b)
    finally:
        cur.close()
        conn.close()
    if ra is None or rb is None:
        raise HTTPException(status_code=404, detail="Cenário (a ou b) não encontrado")
    return comparar_faturamento(ra, rb)


def _carregar_sim_resultado(cur, sim_id: str) -> Optional[dict]:
    cur.execute("SELECT resultado FROM faturamento_simulacao WHERE id = %s", (sim_id,))
    row = cur.fetchone()
    if not row:
        return None
    res = row[0]
    return json.loads(res) if isinstance(res, str) else res


@router.get("/simulacoes/{sim_id}")
def obter_simulacao(sim_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Carrega um cenário salvo (resultado congelado)."""
    _uid(user_id)
    _ensure_fat_simulacao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, label, programacao_versao_id, filtros, resultado, created_at, created_by_name "
            "FROM faturamento_simulacao WHERE id = %s", (sim_id,)
        )
        r = cur.fetchone()
    finally:
        cur.close()
        conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="Cenário não encontrado")
    return {
        "id": str(r[0]), "label": r[1], "programacao_versao_id": r[2],
        "filtros": (json.loads(r[3]) if isinstance(r[3], str) else r[3]),
        "resultado": (json.loads(r[4]) if isinstance(r[4], str) else r[4]),
        "created_at": (r[5].isoformat() if r[5] else None), "created_by_name": r[6],
    }


# 18/06: Itens críticos pra produção — SKUs que estão segurando pedidos no Otim.Faturamento.
# Programador da Programação usa pra priorizar produção.
@router.get("/itens-criticos")
def itens_criticos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Agrega SKUs faltantes dos pedidos incompletos (sem_data_programacao).
    Retorna ranking por valor bloqueado descendente."""
    _uid(user_id)
    resultado = _gerar_resultado(None, refresh=True, filtros=None)
    sem_data = resultado.get("sem_data_programacao") or []
    agg: Dict[str, dict] = {}
    for p in sem_data:
        peso_pedido = float(p.get("valor_total_pedido") or 0)
        pf = p.get("produtos_faltando") or []
        # Distribui valor do pedido proporcionalmente ao numero de SKUs faltantes
        # (heuristica simples: cada SKU faltante "segura" 1/N do pedido).
        n_pf = max(1, len(pf))
        for pr in pf:
            sku = _norm(pr.get("sku"))
            if not sku: continue
            motivo = pr.get("motivo_item") or "sem_programacao"
            a = agg.setdefault(sku, {
                "sku": sku,
                "descricao": pr.get("descricao") or "",
                "qtd_faltante_total": 0.0,
                "n_pedidos_afetados": 0,
                "valor_bloqueado": 0.0,
                "motivos": {"sem_programacao": 0, "programacao_insuficiente": 0},
                "pedidos": [],
            })
            a["qtd_faltante_total"] += float(pr.get("falta") or 0)
            a["n_pedidos_afetados"] += 1
            a["valor_bloqueado"] += peso_pedido / n_pf
            a["motivos"][motivo] = a["motivos"].get(motivo, 0) + 1
            a["pedidos"].append({
                "pedido": p.get("pedido"),
                "cliente": p.get("cliente"),
                "qtd": float(pr.get("falta") or 0),
                "valor_pedido": peso_pedido,
            })
    lista = sorted(agg.values(), key=lambda x: -x["valor_bloqueado"])
    # arredonda
    for x in lista:
        x["qtd_faltante_total"] = round(x["qtd_faltante_total"], 2)
        x["valor_bloqueado"] = round(x["valor_bloqueado"], 2)
    totais = {
        "n_skus_criticos": len(lista),
        "n_pedidos_incompletos": len(sem_data),
        "valor_bloqueado_total": round(sum(float(p.get("valor_total_pedido") or 0) for p in sem_data), 2),
    }
    return {"totais": totais, "itens": lista}


@router.delete("/simulacoes/{sim_id}")
def remover_simulacao(sim_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Remove um cenário salvo."""
    _uid(user_id, edit=True)
    _ensure_fat_simulacao()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM faturamento_simulacao WHERE id = %s", (sim_id,))
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return {"ok": True}


# =============================================================================
# 18/06: HISTÓRICO de faturamento (Auditoria) — STATUS=5,6 no BQ vs plano vigente na data de NF
# =============================================================================

FAT_SQL_HISTORICO = """
SELECT NOTA_FISCAL, NOTA_FISCAL_EMISSAO, PEDIDO, RAZAO, CODIGO_PRODUTO,
       DESCRICAO_PRODUTO, QUANTIDADE, TOTAL_ITEM, STATUS_PEDIDO,
       DESC_TIPODOCUMENTO, EMISSAO, ENTREGA
FROM `projeto-rpa-empresa-2023.VENDAS.Metas_por_faturamento`
WHERE STATUS_PEDIDO IN ('5','6')
  AND NOTA_FISCAL_EMISSAO IS NOT NULL
  AND DESC_TIPODOCUMENTO IS NOT NULL
  AND DESC_TIPODOCUMENTO NOT IN ('DISPLAY','CAMPANHAS','RAPEL','MOSTRUARIO','None','CONTRATOS')
  AND PEDIDO NOT LIKE 'PVM%'
  AND SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(NOTA_FISCAL_EMISSAO AS STRING), 1, 10)) BETWEEN @de AND @ate
ORDER BY NOTA_FISCAL_EMISSAO DESC, PEDIDO, CODIGO_PRODUTO
"""


@router.get("/historico")
def historico_faturamento(de: str, ate: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """18/06: Histórico de faturamento (STATUS=5,6) por data de emissão da NF.
    Cruza com o plano oficial VIGENTE na data de NF — mostra se o pedido estava
    no plano de produção ou veio direto.

    Params:
      de, ate: 'YYYY-MM-DD' (intervalo de NOTA_FISCAL_EMISSAO).
    """
    _uid(user_id)
    from datetime import datetime as _dt_h
    try:
        _dt_h.strptime(de, "%Y-%m-%d")
        _dt_h.strptime(ate, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="Datas devem estar em YYYY-MM-DD")

    # 1) Query BQ — STATUS=5/6 no range
    try:
        from google.cloud.bigquery import ScalarQueryParameter, QueryJobConfig
        client = _bq_client()
        cfg = QueryJobConfig(query_parameters=[
            ScalarQueryParameter("de", "DATE", de),
            ScalarQueryParameter("ate", "DATE", ate),
        ])
        rows = list(client.query(FAT_SQL_HISTORICO, job_config=cfg).result())
    except Exception as e:
        logger.error(f"Erro ao buscar histórico do BQ: {e}")
        raise HTTPException(status_code=502, detail=f"Erro BigQuery: {e}")

    # 2) Pra cada data única de NF, busca o plano oficial vigente naquele dia
    conn = get_db_connection()
    cur = conn.cursor()
    plano_cache: Dict[str, set] = {}  # data -> set(pedidos_atendidos)
    try:
        datas_nf = set()
        for r in rows:
            d = r["NOTA_FISCAL_EMISSAO"]
            if d:
                datas_nf.add(str(d)[:10])
        for data in datas_nf:
            # plano oficial vigente em <data>: oficial=TRUE com oficial_em<=data (mais recente)
            # fallback: created_at<=data se oficial_em é NULL
            cur.execute("""
                SELECT totais->'pedidos_atendidos' AS atend
                FROM plano_producao_versoes
                WHERE oficial = TRUE AND COALESCE(oficial_em, created_at) <= %s::date + interval '1 day'
                ORDER BY COALESCE(oficial_em, created_at) DESC LIMIT 1
            """, (data,))
            r2 = cur.fetchone()
            if r2 and r2[0]:
                plano_cache[data] = set(str(p) for p in (r2[0] or []))
            else:
                plano_cache[data] = set()
    finally:
        cur.close()
        conn.close()

    # 3) Agrega por pedido e calcula valor_total_pedido
    pedidos_agg: Dict[str, dict] = {}
    for r in rows:
        ped = str(r["PEDIDO"] or "").strip()
        if not ped:
            continue
        nf = str(r["NOTA_FISCAL"] or "").strip()
        nf_emissao = str(r["NOTA_FISCAL_EMISSAO"])[:10] if r["NOTA_FISCAL_EMISSAO"] else None
        try:
            qtd = float(r["QUANTIDADE"] or 0)
            valor_item = float(r["TOTAL_ITEM"] or 0)
        except Exception:
            qtd = 0.0
            valor_item = 0.0
        p = pedidos_agg.setdefault(ped, {
            "pedido": ped,
            "cliente": str(r["RAZAO"] or "").strip(),
            "tipo": str(r["DESC_TIPODOCUMENTO"] or "").strip(),
            "nota_fiscal": nf,
            "nf_emissao": nf_emissao,
            "emissao_pedido": str(r["EMISSAO"]) if r["EMISSAO"] else None,
            "entrega": str(r["ENTREGA"]) if r["ENTREGA"] else None,
            "status_pedido": str(r["STATUS_PEDIDO"]),
            "valor_total_pedido": 0.0,
            "itens": [],
        })
        p["valor_total_pedido"] += valor_item
        p["itens"].append({
            "sku": _norm(r["CODIGO_PRODUTO"]),
            "descricao": str(r["DESCRICAO_PRODUTO"] or "").strip(),
            "qtd": qtd,
            "valor_item": valor_item,
        })
        # estava_no_plano: usa o plano vigente na data daquela NF
        plano_set = plano_cache.get(nf_emissao or "", set())
        p["estava_no_plano"] = bool(plano_set and ped in plano_set)

    pedidos_list = sorted(pedidos_agg.values(), key=lambda p: (p["nf_emissao"] or "", p["pedido"]), reverse=True)
    totais = {
        "n_pedidos": len(pedidos_list),
        "n_itens": sum(len(p["itens"]) for p in pedidos_list),
        "valor_total": round(sum(p["valor_total_pedido"] for p in pedidos_list), 2),
        "n_no_plano": sum(1 for p in pedidos_list if p["estava_no_plano"]),
        "n_direto": sum(1 for p in pedidos_list if not p["estava_no_plano"]),
        "valor_no_plano": round(sum(p["valor_total_pedido"] for p in pedidos_list if p["estava_no_plano"]), 2),
        "valor_direto": round(sum(p["valor_total_pedido"] for p in pedidos_list if not p["estava_no_plano"]), 2),
    }
    return {"de": de, "ate": ate, "totais": totais, "pedidos": pedidos_list}
