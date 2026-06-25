"""Módulo Fábrica — Dashboard de Produção.

DERIVA todos os indicadores da MESMA fonte dummy da Programação:
  - `programacao.carregar_ops()`  -> OPs determinísticas (qtd_op = programado, apontada = produzido, máquina, produto)
  - `maquina_produto_tempo` (SELECT) -> peças/hora do Cadastro de Máquinas
  - `core.dummy`                  -> nomes de máquina, produtos, categorias (Linha A..E)

Paradas e refugo NÃO existem em tabela neste projeto (assim como as OPs, que são
geradas on-the-fly). Por isso são gerados aqui de forma DETERMINÍSTICA via
`core.dummy.rng(...)` — mesma semente => números reprodutíveis e coerentes com a
Programação. NENHUMA escrita no banco: só leitura (SELECT) das tabelas deste projeto.

OEE = Disponibilidade × Performance × Qualidade.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import datetime, timezone, timedelta
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from core import dummy
from modulo.programacao import carregar_ops

router = APIRouter(prefix="/producao", tags=["producao_dashboard"])
logger = logging.getLogger(__name__)

MODULE_ID = "producao_dashboard"

# Janela do turno usada como base de cálculo (minutos planejados por máquina/turno).
_TURNO_MIN = 480  # 8h
_MOTIVOS_PARADA = ["Setup / troca de molde", "Falta de matéria-prima",
                   "Manutenção corretiva", "Ajuste de processo", "Parada operacional"]


def _uid(user_id: Optional[str]):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    if not check_module_permission(user_id, MODULE_ID, "can_view"):
        raise HTTPException(status_code=403, detail="Sem permissão para Dashboard de Produção")
    return user_id


def _pecas_hora_map():
    """{(maquina_nome, cod_item): pecas_hora} a partir do Cadastro de Máquinas. Só leitura."""
    out = {}
    conn = cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT m.nome, t.cod_item, t.pecas_hora "
            "FROM maquina_produto_tempo t JOIN maquinas m ON m.id = t.maquina_id "
            "WHERE t.pecas_hora IS NOT NULL"
        )
        for nome, cod, pph in cur.fetchall():
            try:
                out[(str(nome).strip(), str(cod).strip())] = float(pph)
            except (TypeError, ValueError):
                pass
    except Exception as e:  # tabela ausente/sem seed: cai no fallback determinístico
        logger.warning(f"producao_dashboard: leitura de peças/hora falhou ({e}); usando fallback dummy")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
    return out


def _clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


@router.get("/dashboard")
def dashboard(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)

    ops = carregar_ops()
    pph_map = _pecas_hora_map()

    # índice de categoria por código de produto (Linha A..E)
    cat_por_cod = {c.strip(): cat for (c, _d, _u, cat) in dummy.PRODUTOS}
    nomes_maquina = [nome for (_id, nome) in dummy.MAQUINAS]

    # ---- agrega OPs por máquina e por linha; monta lista de ordens ----
    por_maquina = {nome: {"prog": 0.0, "prod": 0.0, "pph": []} for nome in nomes_maquina}
    por_linha = {}
    ordens = []
    refugo_total = retrabalho_total = sucata_total = 0.0
    prod_total = prog_total = 0.0

    for op in ops:
        maq = str(op.get("k01t_002", "")).strip()
        cod = str(op.get("codigo", "")).strip()
        prog = float(op.get("qtd_op") or 0)
        prod = float(op.get("apontada") or 0)
        prog_total += prog
        prod_total += prod

        if maq in por_maquina:
            por_maquina[maq]["prog"] += prog
            por_maquina[maq]["prod"] += prod
            pph = pph_map.get((maq, cod))
            if pph:
                por_maquina[maq]["pph"].append(pph)

        linha = cat_por_cod.get(cod, "Linha A")
        l = por_linha.setdefault(linha, {"realizado": 0.0, "meta": 0.0})
        l["realizado"] += prod
        l["meta"] += prog

        # refugo/retrabalho/sucata determinísticos por OP
        r = dummy.rng("prod_refugo", op.get("numero_op"))
        taxa_ref = r.uniform(0.005, 0.045)
        refugo = round(prod * taxa_ref)
        retrabalho = round(prod * r.uniform(0.003, 0.02))
        sucata = round(refugo * r.uniform(0.1, 0.3), 1)
        refugo_total += refugo
        retrabalho_total += retrabalho
        sucata_total += sucata

        progresso = round((prod / prog) * 100) if prog > 0 else 0
        if progresso >= 100:
            status = "Concluída"
        elif prod <= 0:
            status = "Aguardando"
        else:
            status = "Em produção"
        ordens.append({
            "numero_op": op.get("numero_op"),
            "produto": op.get("descricao"),
            "codigo": cod,
            "maquina": maq,
            "qtd_prog": prog,
            "realizado": prod,
            "progresso": progresso,
            "previsao": op.get("inicio_real"),
            "status": status,
            "refugo": refugo,
        })

    # ---- por máquina: status + OEE (Disp × Perf × Qual) ----
    maquinas_out, oee_por_maquina = [], []
    oee_acc, oee_n = 0.0, 0
    cont_status = {"Produzindo": 0, "Setup": 0, "Parada": 0}
    for nome in nomes_maquina:
        agg = por_maquina[nome]
        rp = dummy.rng("prod_parada", nome)
        tem_producao = agg["prod"] > 0

        # paradas determinísticas (minutos no turno)
        parada_min = rp.randint(0, 70) if tem_producao else rp.randint(120, 300)
        rodando = max(0, _TURNO_MIN - parada_min)

        disp = _clamp(rodando / _TURNO_MIN)
        # performance: produzido vs teórico (peças/hora × horas rodando)
        pph_avg = (sum(agg["pph"]) / len(agg["pph"])) if agg["pph"] else float(rp.randint(60, 320))
        teorico = pph_avg * (rodando / 60.0)
        perf = _clamp(agg["prod"] / teorico) if teorico > 0 else 0.0
        qual = _clamp(rp.uniform(0.93, 0.995)) if tem_producao else 0.0
        oee = round(disp * perf * qual * 100, 1)

        if not tem_producao:
            status = "Parada"
        elif parada_min >= 45 and rp.random() < 0.5:
            status = "Setup"
        elif parada_min >= 60:
            status = "Parada"
        else:
            status = "Produzindo"
        cont_status[status] = cont_status.get(status, 0) + 1

        item = {
            "maquina": nome,
            "status": status,
            "oee": oee,
            "disponibilidade": round(disp * 100, 1),
            "performance": round(perf * 100, 1),
            "qualidade": round(qual * 100, 1),
            "parada_min": parada_min,
            "produzido": round(agg["prod"]),
            "programado": round(agg["prog"]),
        }
        maquinas_out.append(item)
        oee_por_maquina.append({"maquina": nome, "oee": oee,
                                "disponibilidade": item["disponibilidade"],
                                "performance": item["performance"],
                                "qualidade": item["qualidade"]})
        if tem_producao:
            oee_acc += oee
            oee_n += 1

    oee_geral = round(oee_acc / oee_n, 1) if oee_n else 0.0

    # ---- linha do tempo do turno (determinística) ----
    rt = dummy.rng("prod_timeline")
    seg_setup = rt.randint(8, 16)
    seg_parada = rt.randint(6, 14)
    seg_prod2 = rt.randint(15, 25)
    seg_prod1 = max(5, 100 - seg_setup - seg_parada - seg_prod2 - 5)
    timeline = {
        "segmentos": [
            {"tipo": "Produção", "pct": seg_prod1, "cor": "#16a34a"},
            {"tipo": "Setup", "pct": seg_setup, "cor": "#ca8a04"},
            {"tipo": "Parada", "pct": seg_parada, "cor": "#dc2626"},
            {"tipo": "Produção", "pct": seg_prod2, "cor": "#16a34a"},
            {"tipo": "Ocioso", "pct": max(0, 100 - seg_prod1 - seg_setup - seg_parada - seg_prod2), "cor": "#475569"},
        ],
        "eventos": [
            {"hora": "06:00", "tipo": "ok", "texto": "Início do turno — produção iniciada"},
            {"hora": "08:42", "tipo": "setup", "texto": f"Setup para troca de molde — {seg_setup} min"},
            {"hora": "09:56", "tipo": "stop", "texto": f"Parada não planejada — {rt.choice(_MOTIVOS_PARADA)}"},
            {"hora": "10:18", "tipo": "ok", "texto": "Retomada da produção"},
        ],
    }

    refugo_pct = round((refugo_total / prod_total) * 100, 1) if prod_total else 0.0
    n_concluidas = sum(1 for o in ordens if o["status"] == "Concluída")
    n_producao = sum(1 for o in ordens if o["status"] == "Em produção")
    n_aguardando = sum(1 for o in ordens if o["status"] == "Aguardando")

    return {
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "kpis": {
            "oee_geral": oee_geral,
            "volume_produzido": round(prod_total),
            "volume_meta": round(prog_total),
            "volume_pct": round((prod_total / prog_total) * 100, 1) if prog_total else 0.0,
            "ordens_total": len(ordens),
            "ordens_producao": n_producao,
            "ordens_concluidas": n_concluidas,
            "ordens_aguardando": n_aguardando,
            "refugo_pct": refugo_pct,
            "refugo_total": round(refugo_total),
        },
        "maquinas": maquinas_out,
        "resumo_maquinas": cont_status,
        "oee_por_maquina": oee_por_maquina,
        "volume_por_linha": [
            {"linha": k, "realizado": round(v["realizado"]), "meta": round(v["meta"])}
            for k, v in sorted(por_linha.items())
        ],
        "ordens": sorted(ordens, key=lambda o: o["progresso"], reverse=True),
        "timeline": timeline,
        "refugo": {
            "refugo": round(refugo_total),
            "retrabalho": round(retrabalho_total),
            "sucata": round(sucata_total, 1),
            "taxa": refugo_pct,
            "por_tipo": [
                {"tipo": "Refugo", "valor": round(refugo_total)},
                {"tipo": "Retrabalho", "valor": round(retrabalho_total)},
                {"tipo": "Sucata (kg)", "valor": round(sucata_total, 1)},
            ],
        },
    }
