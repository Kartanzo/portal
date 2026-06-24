"""
Torre de Controle S&OP — Dashboard de Fabrica

Replica o pipeline do n8n (workflow ProducaoPcp) dentro do portal.
Endpoints:
- GET /sop-dashboard/data            -> retorna cache (rapido). Se nao existir, executa queries.
- GET /sop-dashboard/data?refresh=1  -> forca execucao (botao Atualizar do frontend).

Cache: tabela Postgres sop_dashboard_cache (compartilhada entre replicas e isolada
por ambiente via search_path/DB_SCHEMA). Substitui o antigo arquivo local
sop_dashboard_cache.json, que era por instancia.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta, date
import os
import json
import logging
import time
import pandas as pd

# Timezone Brasil/SaoPaulo (UTC-3, sem horario de verao desde 2019)
BR_TZ = timezone(timedelta(hours=-3))

from db_utils import get_db_connection
from permission_utils import check_module_permission
from core.config import IMPORTED_ITEM_CODES, PROJECT_ID, CREDENTIALS_PATH
from auth_utils import get_user_id_from_session
from core import dummy

router = APIRouter()
logger = logging.getLogger(__name__)

SOP_CACHE_KEY = "sop_dashboard"


def _ensure_sop_cache_table(cur) -> None:
    """Cria a tabela de cache sob demanda (idempotente). Fica no schema atual
    (search_path/DB_SCHEMA), isolando homolog de producao automaticamente."""
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sop_dashboard_cache (
            cache_key   TEXT PRIMARY KEY,
            payload     JSONB NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _read_sop_cache() -> Optional[Dict[str, Any]]:
    """Le o payload consolidado do Postgres (compartilhado entre replicas).
    Retorna None se nao houver cache ou em caso de falha (recalcula no caller)."""
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                _ensure_sop_cache_table(cur)
                conn.commit()
                cur.execute(
                    "SELECT payload FROM sop_dashboard_cache WHERE cache_key = %s",
                    (SOP_CACHE_KEY,),
                )
                row = cur.fetchone()
            if not row:
                return None
            payload = row[0]
            if isinstance(payload, str):
                payload = json.loads(payload)
            return payload
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"Cache S&OP indisponivel no banco, recalculando: {e}")
        return None


def _write_sop_cache(payload: Dict[str, Any]) -> None:
    """Persiste o payload consolidado no Postgres (compartilhado entre replicas)."""
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                _ensure_sop_cache_table(cur)
                cur.execute(
                    """
                    INSERT INTO sop_dashboard_cache (cache_key, payload, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (cache_key)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                    """,
                    (SOP_CACHE_KEY, json.dumps(payload, ensure_ascii=False, default=str)),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Erro ao salvar cache S&OP no banco: {e}")

# Planilha "ItensImportados" usada pelo workflow n8n ProducaoPcp (nó googleSheets).
# Mantemos paridade lendo a mesma fonte em runtime.
SHEET_ID_ITENS_IMPORTADOS = "1FKRHFyzPpiifBKoPTN5D9JSd66i0frvJ282E7TpZSMk"
# gid explícito das abas (paridade com o n8n, que usa gid no sheetName).
# Se as abas forem reordenadas, get_worksheet(0) pega a errada — por isso ancoramos no gid.
SHEET_GID_ITENS_IMPORTADOS = 0
SHEET_GID_ITENS_INATIVOS = 1361747565
BLACKLIST_TTL_SECONDS = 600
_blacklist_cache: Dict[str, Any] = {"data": None, "ts": 0.0}
_inactive_cache: Dict[str, Any] = {"data": None, "ts": 0.0}


def _load_blacklist_imported_items() -> List[str]:
    """Lê a aba 'ItensImportados' do Google Sheets (mesma do n8n).

    [DUMMY] Fonte externa (Google Sheets) substituida por dados dummy deterministicos.
    Cacheia em memoria por BLACKLIST_TTL_SECONDS. Retorna a lista de SKUs importados
    (IMPORTED_ITEM_CODES do config.py serve como pool fixo/deterministico).
    """
    now = time.time()
    cached = _blacklist_cache.get("data")
    if cached is not None and (now - _blacklist_cache.get("ts", 0)) < BLACKLIST_TTL_SECONDS:
        return cached

    codes: List[str] = [str(c).strip() for c in IMPORTED_ITEM_CODES]
    _blacklist_cache["data"] = codes
    _blacklist_cache["ts"] = now
    logger.info(f"Blacklist S&OP (dummy): {len(codes)} SKUs")
    return codes


def _load_inactive_items() -> List[str]:
    """Lê a aba 'ItensInativos' do Google Sheets (mesma do nó FormataListaSql do n8n).

    [DUMMY] Fonte externa (Google Sheets) substituida por dados dummy deterministicos.
    Cacheia em memoria por BLACKLIST_TTL_SECONDS. Retorna lista vazia (sem filtro),
    preservando o comportamento atual do dashboard.
    """
    now = time.time()
    cached = _inactive_cache.get("data")
    if cached is not None and (now - _inactive_cache.get("ts", 0)) < BLACKLIST_TTL_SECONDS:
        return cached

    codes: List[str] = []
    _inactive_cache["data"] = codes
    _inactive_cache["ts"] = now
    logger.info(f"ItensInativos S&OP (dummy): {len(codes)} SKUs")
    return codes


def get_bq_client():
    """Reusa a mesma estrategia do modulo Importacao.

    [DUMMY] BigQuery substituido por dados dummy deterministicos. Retorna None
    (cliente nao e mais necessario — _bq_to_dict gera dados dummy a partir do SQL).
    O app sobe SEM credenciais GCP.
    """
    return None


# ============================================================================
# QUERIES — Replicam exatamente as do workflow n8n ProducaoPcp
# ============================================================================

def _build_sql_vendas_hist_proxy(inactive_codes: Optional[List[str]] = None) -> str:
    """Monta o SQL do mix histórico (paridade com nó Vendas2025 do n8n),
    injetando o filtro `CODIGO_PRODUTO NOT IN (...)` a partir de `ItensInativos`.

    Se a lista estiver vazia, retorna o SQL sem o filtro (comportamento anterior).
    """
    if inactive_codes:
        # Sanitiza para evitar quebra de SQL (somente alfanumericos/underscore/hifen)
        safe = []
        for c in inactive_codes:
            s = str(c).strip()
            if s and all(ch.isalnum() or ch in ('_', '-') for ch in s):
                safe.append(f"'{s}'")
        not_in_clause = (
            f"    AND CODIGO_PRODUTO NOT IN ({', '.join(safe)})" if safe else ""
        )
    else:
        not_in_clause = ""

    return f"""
WITH base_4anos AS (
  SELECT
    TRIM(UPPER(GERENCIA_REGIONAL)) AS Regional,
    TRIM(UPPER(FAMILIA)) AS Familia,
    CODIGO_PRODUTO,
    DESCRICAO_PRODUTO,
    UNIDADE_MEDIDA,
    EXTRACT(MONTH FROM SAFE_CAST(EMISSAO AS DATETIME)) AS Mes_Numerico,
    EXTRACT(YEAR FROM SAFE_CAST(EMISSAO AS DATETIME)) AS Ano,
    COALESCE(SAFE_CAST(TOTAL_ITEM AS FLOAT64), 0) AS val_num,
    COALESCE(SAFE_CAST(QUANTIDADE AS FLOAT64), 0) AS qtd_num
  FROM `projeto-rpa-empresa-2023.VENDAS.VendasHistoricasDois`
  WHERE
    EXTRACT(YEAR FROM SAFE_CAST(EMISSAO AS DATETIME))
      BETWEEN EXTRACT(YEAR FROM CURRENT_DATE()) - 4
      AND EXTRACT(YEAR FROM CURRENT_DATE()) - 1
    AND CODIGO_PRODUTO LIKE '104%'
    AND TRIM(UPPER(FAMILIA)) NOT IN ('NAN', 'AGRICOLA')
{not_in_clause}
),
perfil_medio AS (
  SELECT
    Regional, Familia, Mes_Numerico, CODIGO_PRODUTO,
    ANY_VALUE(DESCRICAO_PRODUTO) AS DESCRICAO_PRODUTO,
    ANY_VALUE(UNIDADE_MEDIDA) AS UNIDADE_MEDIDA,
    SUM(val_num) AS valor_acumulado_4anos
  FROM base_4anos
  GROUP BY 1, 2, 3, 4
),
precos_atuais AS (
  SELECT
    CODIGO_PRODUTO,
    COALESCE(SAFE_DIVIDE(SUM(val_num), SUM(qtd_num)), 0) AS preco_medio_estatico
  FROM base_4anos
  WHERE Ano = EXTRACT(YEAR FROM CURRENT_DATE()) - 1
    AND Mes_Numerico BETWEEN 8 AND 12
  GROUP BY 1
)
SELECT
  h.Regional, h.Familia, h.Mes_Numerico, h.CODIGO_PRODUTO,
  h.DESCRICAO_PRODUTO, h.UNIDADE_MEDIDA,
  SAFE_DIVIDE(h.valor_acumulado_4anos, 4) AS valor_bruto_historico,
  SAFE_DIVIDE(
    h.valor_acumulado_4anos,
    SUM(h.valor_acumulado_4anos) OVER(PARTITION BY h.Regional, h.Familia, h.Mes_Numerico)
  ) AS share_mensal,
  COALESCE(p.preco_medio_estatico, 0) AS preco_medio
FROM perfil_medio h
LEFT JOIN precos_atuais p ON h.CODIGO_PRODUTO = p.CODIGO_PRODUTO
"""

SQL_REALIZADO_ANO_ATUAL = """
SELECT 'Venda' as Tipo, CODIGO_PRODUTO AS Codigo,
  EXTRACT(YEAR FROM SAFE_CAST(EMISSAO AS DATETIME)) AS Ano,
  EXTRACT(MONTH FROM SAFE_CAST(EMISSAO AS DATETIME)) AS Mes,
  SUM(SAFE_CAST(QUANTIDADE AS FLOAT64)) AS Qtd_Real
FROM `projeto-rpa-empresa-2023.VENDAS.VendasHistoricasDois`
WHERE EXTRACT(YEAR FROM SAFE_CAST(EMISSAO AS DATETIME)) = EXTRACT(YEAR FROM CURRENT_DATE())
  AND CODIGO_PRODUTO LIKE '104%'
  AND STATUS_PEDIDO NOT IN ('3', '7')
  AND NOT (PEDIDO LIKE 'PVM%' OR PEDIDO LIKE 'PVB%')
  AND COALESCE(DEVOLUCAO, '') != 'SIM'
  AND DESC_TIPODOCUMENTO NOT IN ('SAC', 'BONIFICACAO', 'TROCA', 'DISPLAY', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT 'Producao' as Tipo, CODIGO_MATERIAL AS Codigo,
  EXTRACT(YEAR FROM SAFE_CAST(DATA_PONTAMENTO AS DATETIME)) AS Ano,
  EXTRACT(MONTH FROM SAFE_CAST(DATA_PONTAMENTO AS DATETIME)) AS Mes,
  SUM(SAFE_CAST(QUANTIDADE AS FLOAT64)) AS Qtd_Real
FROM `projeto-rpa-empresa-2023.VENDAS.ApontamentosProducao`
WHERE EXTRACT(YEAR FROM SAFE_CAST(DATA_PONTAMENTO AS DATETIME)) = EXTRACT(YEAR FROM CURRENT_DATE())
  AND CODIGO_MATERIAL LIKE '104%'
GROUP BY 1, 2, 3, 4
"""

SQL_ESTOQUE = """
WITH CombinedEstoque AS (
  SELECT CODIGO_ITEM AS Codigo, 0 AS Est_Fabrica,
    CASE WHEN CODIGO_LOCAL LIKE '13%' THEN SAFE_CAST(SALDO_TOTAL AS FLOAT64) ELSE 0 END AS Est_Log_Bruto,
    CASE WHEN CODIGO_LOCAL LIKE '13%' THEN SAFE_CAST(RESERVA AS FLOAT64) ELSE 0 END AS Est_Log_Reserva,
    CASE WHEN CODIGO_LOCAL LIKE '13%' THEN SAFE_CAST(DISPONIVEL AS FLOAT64) ELSE 0 END AS Est_Log_Disp
  FROM `projeto-rpa-empresa-2023.VENDAS.estoque_logistica`
  WHERE CODIGO_ITEM LIKE '104%' AND CODIGO_ITEM NOT LIKE '%MP' AND CODIGO_ITEM NOT LIKE '%PA'
  UNION ALL
  SELECT CODIGO_PRODUTO AS Codigo,
    SAFE_CAST(QUANTIDADE_FISICO AS FLOAT64) AS Est_Fabrica,
    0 AS Est_Log_Bruto, 0 AS Est_Log_Reserva, 0 AS Est_Log_Disp
  FROM `projeto-rpa-empresa-2023.VENDAS.EstoqueProducao`
  WHERE CODIGO_LOCAL = '01001' AND CODIGO_PRODUTO LIKE '104%'
    AND CODIGO_PRODUTO NOT LIKE '%MP' AND CODIGO_PRODUTO NOT LIKE '%PA'
)
SELECT Codigo, SUM(Est_Fabrica) AS Est_Fabrica, SUM(Est_Log_Bruto) AS Est_Log_Bruto,
  SUM(Est_Log_Reserva) AS Est_Log_Reserva, SUM(Est_Log_Disp) AS Est_Log_Disp
FROM CombinedEstoque GROUP BY 1
"""

SQL_OPS_HIST = """
SELECT CODIGO_MATERIAL AS Codigo, OP AS Numero_OP,
  EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_OP AS DATETIME)) AS Ano_Emissao,
  EXTRACT(MONTH FROM SAFE_CAST(EMISSAO_OP AS DATETIME)) AS Mes_Emissao,
  MAX(SAFE_CAST(EMISSAO_OP AS DATETIME)) as Data_Emissao_Full,
  MAX(SAFE_CAST(DATA_PONTAMENTO AS DATETIME)) as Ultimo_Apontamento,
  MAX(SAFE_CAST(QUANTIDADE_PLANEJADA AS FLOAT64)) AS Qtd_OP_Planejada,
  SUM(SAFE_CAST(QUANTIDADE_APONTADA AS FLOAT64)) AS Qtd_OP_Realizada,
  GREATEST(MAX(SAFE_CAST(QUANTIDADE_PLANEJADA AS FLOAT64)) -
           SUM(SAFE_CAST(QUANTIDADE_APONTADA AS FLOAT64)), 0) AS Saldo_A_Produzir
FROM `projeto-rpa-empresa-2023.VENDAS.ApontamentosProducao`
WHERE SAFE_CAST(EMISSAO_OP AS DATETIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 15 DAY)
  AND CODIGO_MATERIAL LIKE '104%'
GROUP BY 1, 2, 3, 4
HAVING Saldo_A_Produzir > 0
ORDER BY Data_Emissao_Full DESC
"""

SQL_OPS_ABERTO = """
SELECT CODIGO_MATERIAL AS Codigo, OP AS Numero_OP,
  EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_OP AS DATETIME)) AS Ano_Emissao,
  EXTRACT(MONTH FROM SAFE_CAST(EMISSAO_OP AS DATETIME)) AS Mes_Emissao,
  MAX(SAFE_CAST(EMISSAO_OP AS DATETIME)) as Data_Emissao_Full,
  CAST(NULL AS DATETIME) as Ultimo_Apontamento,
  MAX(SAFE_CAST(QUANTIDADE_PLANEJADA AS FLOAT64)) AS Qtd_OP_Planejada,
  MAX(SAFE_CAST(QUANTIDADE_APONTADA AS FLOAT64)) AS Qtd_OP_Realizada,
  GREATEST(MAX(SAFE_CAST(QUANTIDADE_PLANEJADA AS FLOAT64)) -
           MAX(SAFE_CAST(QUANTIDADE_APONTADA AS FLOAT64)), 0) AS Saldo_A_Produzir
FROM `projeto-rpa-empresa-2023.VENDAS.opemaberto`
WHERE CODIGO_MATERIAL LIKE '104%'
GROUP BY 1, 2, 3, 4
HAVING Saldo_A_Produzir > 0
ORDER BY Data_Emissao_Full DESC
"""

SQL_FATURAMENTO_ANO_ATUAL = """
SELECT CODIGO_PRODUTO AS Codigo,
  EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) AS Ano,
  EXTRACT(MONTH FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) AS Mes,
  SUM(SAFE_CAST(QUANTIDADE_UTILIZADANANOTAFISCAL AS FLOAT64)) AS Qtd_Faturada
FROM `projeto-rpa-empresa-2023.VENDAS.Controle_de_logistica_carteira`
WHERE EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) = EXTRACT(YEAR FROM CURRENT_DATE())
  AND status_descricao IN ('5 - Liberado', '5 - Liberado e Inutilizado', '6 - Parcial')
  AND DESC_TIPODOCUMENTO NOT IN ('SAC', 'BONIFICACAO', 'TROCA', 'DISPLAY', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
  AND CODIGO_PRODUTO LIKE '104%'
GROUP BY 1, 2, 3
"""

SQL_CARTEIRA = """
SELECT CODIGO_PRODUTO AS Codigo,
  EXTRACT(YEAR FROM COALESCE(
      SAFE.PARSE_DATE('%d/%m/%Y', SUBSTR(CAST(ENTREGA AS STRING), 1, 10)),
      SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(ENTREGA AS STRING), 1, 10)),
      SAFE_CAST(ENTREGA AS DATE), SAFE_CAST(EMISSAO AS DATE))) AS Ano_Ref,
  EXTRACT(MONTH FROM COALESCE(
      SAFE.PARSE_DATE('%d/%m/%Y', SUBSTR(CAST(ENTREGA AS STRING), 1, 10)),
      SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(ENTREGA AS STRING), 1, 10)),
      SAFE_CAST(ENTREGA AS DATE), SAFE_CAST(EMISSAO AS DATE))) AS Mes_Ref,
  SUM(COALESCE(SAFE_CAST(QUANTIDADE AS FLOAT64), 0) -
      COALESCE(SAFE_CAST(QUANTIDADE_UTILIZADANANOTAFISCAL AS FLOAT64), 0)) AS Qtd_Carteira
FROM `projeto-rpa-empresa-2023.VENDAS.Controle_de_logistica_carteira`
WHERE status_descricao IN ('4 - Liberado', '1 - Em aberto')
  AND DESC_TIPODOCUMENTO NOT IN ('SAC', 'BONIFICACAO', 'TROCA', 'DISPLAY', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
  AND CODIGO_PRODUTO LIKE '104%'
GROUP BY 1, 2, 3
HAVING Qtd_Carteira > 0
ORDER BY 1, 2, 3
"""

SQL_DETALHE_PEDIDOS = """
SELECT CODIGO_PRODUTO AS Codigo, PEDIDO AS Pedido, RAZAO AS Cliente,
  SAFE_CAST(EMISSAO AS STRING) AS Emissao, SAFE_CAST(ENTREGA AS STRING) AS Entrega,
  SAFE_CAST(EMISSAO_ORIGINAL AS STRING) AS EmissaoOriginal,
  (COALESCE(SAFE_CAST(QUANTIDADE AS FLOAT64), 0) -
   COALESCE(SAFE_CAST(QUANTIDADE_UTILIZADANANOTAFISCAL AS FLOAT64), 0)) AS Saldo
FROM `projeto-rpa-empresa-2023.VENDAS.Metas_por_faturamento`
WHERE STATUS_PEDIDO IN ('1','4')
  AND DESC_TIPODOCUMENTO IS NOT NULL
  AND DESC_TIPODOCUMENTO NOT IN ('DISPLAY','CAMPANHAS','RAPEL','MOSTRUARIO','None','CONTRATOS')
  AND PEDIDO NOT LIKE 'PVM%'
ORDER BY ENTREGA ASC
"""

SQL_BASE_ABC = """
SELECT CODIGO_PRODUTO,
  ANY_VALUE(DESCRICAO_PRODUTO) as Descricao,
  ANY_VALUE(TRIM(UPPER(FAMILIA))) as Familia,
  SUM(SAFE_CAST(TOTAL_ITEM AS FLOAT64)) as Valor_2025
FROM `projeto-rpa-empresa-2023.VENDAS.VendasHistoricasDois`
WHERE EXTRACT(YEAR FROM SAFE_CAST(EMISSAO AS DATETIME)) = EXTRACT(YEAR FROM CURRENT_DATE()) - 1
  AND CODIGO_PRODUTO LIKE '104%'
  AND STATUS_PEDIDO NOT IN ('3', '7')
  AND NOT (PEDIDO LIKE 'PVM%' OR PEDIDO LIKE 'PVB%')
  AND COALESCE(DEVOLUCAO, '') != 'SIM'
  AND DESC_TIPODOCUMENTO NOT IN ('SAC', 'BONIFICACAO', 'TROCA', 'DISPLAY', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
GROUP BY 1
ORDER BY 4 DESC
"""

SQL_INDICADORES = """
WITH vendas_recentes AS (
  SELECT CODIGO_PRODUTO, SUM(SAFE_CAST(QUANTIDADE AS FLOAT64)) AS Qtd_44d
  FROM `projeto-rpa-empresa-2023.VENDAS.VendasHistoricasDois`
  WHERE SAFE_CAST(EMISSAO AS DATETIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 44 DAY)
    AND CODIGO_PRODUTO LIKE '104%'
    AND STATUS_PEDIDO NOT IN ('3', '7')
    AND NOT (PEDIDO LIKE 'PVM%' OR PEDIDO LIKE 'PVB%')
    AND COALESCE(DEVOLUCAO, '') != 'SIM'
    AND DESC_TIPODOCUMENTO NOT IN ('SAC', 'BONIFICACAO', 'TROCA', 'DISPLAY', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
  GROUP BY 1
),
prod_recente AS (
  SELECT CODIGO_MATERIAL, SUM(SAFE_CAST(QUANTIDADE AS FLOAT64)) AS Qtd_44d
  FROM `projeto-rpa-empresa-2023.VENDAS.ApontamentosProducao`
  WHERE SAFE_CAST(DATA_PONTAMENTO AS DATETIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 44 DAY)
    AND CODIGO_MATERIAL LIKE '104%'
  GROUP BY 1
)
SELECT COALESCE(v.CODIGO_PRODUTO, p.CODIGO_MATERIAL) AS Codigo,
  ROUND(SAFE_DIVIDE(COALESCE(v.Qtd_44d, 0), 44), 2) AS Media_Venda_44Dias,
  ROUND(SAFE_DIVIDE(COALESCE(p.Qtd_44d, 0), 44), 2) AS Media_Prod_44Dias
FROM vendas_recentes v
FULL OUTER JOIN prod_recente p ON v.CODIGO_PRODUTO = p.CODIGO_MATERIAL
"""

SQL_PREV_COMERCIAL = """
SELECT
  TRIM(UPPER(regional)) AS regional_meta,
  TRIM(UPPER(familia)) AS familia_meta,
  CAST(EXTRACT(MONTH FROM concat) AS INTEGER) AS mes_meta,
  CAST(concat AS TEXT) AS data_original,
  CAST(valor AS FLOAT) AS valor_meta_total
FROM previsao_comercial_sop
WHERE tipo = 'previsao_comercial'
  AND EXTRACT(YEAR FROM concat) = EXTRACT(YEAR FROM CURRENT_DATE)
"""

SQL_OTMZ_AI = """
SELECT codigo_produto, descricao_produto, sequencia_producao,
  quantidade_necessaria, total_item, contador_pedidos_atendidos, pedidos_atendidos
FROM otmz_prod_sop
LIMIT 200
"""


# ============================================================================
# FORECAST TOP-DOWN (replica do nó "Resultados" do n8n)
# ============================================================================

def _safe_float(v) -> float:
    try:
        if v is None:
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def _norm(s: str) -> str:
    if not s:
        return ""
    return str(s).strip().upper()


def calcular_forecast_top_down(historico: List[dict], metas: List[dict]) -> List[dict]:
    """
    Cruza metas comerciais (R$) com mix histórico para gerar Meta_Qtd_Projetada por SKU.
    Replica a lógica JS do nó 'Resultados' do n8n.
    """
    mapa_regional: Dict[str, List[dict]] = {}
    mapa_global: Dict[str, dict] = {}

    for h in historico:
        regional = _norm(h.get('Regional'))
        familia = _norm(h.get('Familia'))
        mes = h.get('Mes_Numerico')
        if not regional or not familia or not mes:
            continue
        chave_reg = f"{regional}_{familia}_{mes}"
        mapa_regional.setdefault(chave_reg, []).append(h)
        chave_glob = f"{familia}_{mes}"
        if chave_glob not in mapa_global:
            mapa_global[chave_glob] = {"totalFamilia": 0.0, "produtos": []}
        mapa_global[chave_glob]["totalFamilia"] += _safe_float(h.get('valor_bruto_historico'))
        mapa_global[chave_glob]["produtos"].append(h)

    resultado: List[dict] = []
    for m in metas:
        regional_m = _norm(m.get('regional_meta'))
        familia_m = _norm(m.get('familia_meta'))
        mes_m = m.get('mes_meta')
        if not regional_m or not familia_m or not mes_m:
            continue
        chave_reg = f"{regional_m}_{familia_m}_{mes_m}"
        chave_glob = f"{familia_m}_{mes_m}"
        produtos: List[dict] = []
        origem = ""

        if chave_reg in mapa_regional and mapa_regional[chave_reg]:
            produtos = mapa_regional[chave_reg]
            origem = "Histórico Regional (Exato)"
        elif chave_glob in mapa_global and mapa_global[chave_glob]["produtos"]:
            dados = mapa_global[chave_glob]
            produtos = []
            for prod in dados["produtos"]:
                share_glob = (
                    _safe_float(prod.get('valor_bruto_historico')) / dados["totalFamilia"]
                    if dados["totalFamilia"] > 0 else 0
                )
                produtos.append({
                    'CODIGO_PRODUTO': prod.get('CODIGO_PRODUTO'),
                    'DESCRICAO_PRODUTO': prod.get('DESCRICAO_PRODUTO'),
                    'UNIDADE_MEDIDA': prod.get('UNIDADE_MEDIDA'),
                    'valor_bruto_historico': prod.get('valor_bruto_historico'),
                    'preco_medio': prod.get('preco_medio'),
                    'share_mensal': share_glob,
                })
            origem = "Estimativa Global (Fallback)"

        if produtos:
            for prod in produtos:
                share = _safe_float(prod.get('share_mensal'))
                preco = _safe_float(prod.get('preco_medio'))
                valor_total = _safe_float(m.get('valor_meta_total'))
                meta_valor = valor_total * share
                meta_qtd = round(meta_valor / preco) if preco > 0 else 0
                if meta_valor > 0.01:
                    resultado.append({
                        'Regional': m.get('regional_meta'),
                        'Familia': m.get('familia_meta'),
                        'Mes': mes_m,
                        'Codigo_Produto': prod.get('CODIGO_PRODUTO'),
                        'Descricao': prod.get('DESCRICAO_PRODUTO'),
                        'Unidade': prod.get('UNIDADE_MEDIDA'),
                        'Meta_Valor_Projetada': round(meta_valor, 2),
                        'Meta_Qtd_Projetada': meta_qtd,
                        'Origem_Calculo': origem,
                    })
    return resultado


def calcular_curva_abc(metas_resultado: List[dict], hist_abc: List[dict]) -> List[dict]:
    """Replica o nó CurvaAbc."""
    total_2025 = sum(_safe_float(h.get('Valor_2025')) for h in hist_abc)
    map_2025: Dict[str, dict] = {}
    accum = 0.0
    for idx, item in enumerate(hist_abc):
        val = _safe_float(item.get('Valor_2025'))
        accum += val
        pct = accum / total_2025 if total_2025 > 0 else 0
        classe = 'A' if pct <= 0.80 else ('B' if pct <= 0.95 else 'C')
        map_2025[item.get('CODIGO_PRODUTO')] = {
            'valor': val, 'rank': idx + 1, 'classe': classe,
            'descricao': item.get('Descricao'), 'familia': item.get('Familia'),
        }

    agg_2026: Dict[str, dict] = {}
    total_2026 = 0.0
    for m in metas_resultado:
        cod = m.get('Codigo_Produto')
        val = _safe_float(m.get('Meta_Valor_Projetada'))
        if cod not in agg_2026:
            agg_2026[cod] = {'valor': 0.0, 'desc': m.get('Descricao')}
        agg_2026[cod]['valor'] += val
        total_2026 += val

    arr = sorted(
        [{'cod': k, **v} for k, v in agg_2026.items()],
        key=lambda x: x['valor'], reverse=True
    )
    accum2026 = 0.0
    out: List[dict] = []
    for idx, item in enumerate(arr):
        accum2026 += item['valor']
        pct = accum2026 / total_2026 if total_2026 > 0 else 0
        cl_2026 = 'A' if pct <= 0.80 else ('B' if pct <= 0.95 else 'C')
        d2025 = map_2025.get(item['cod'], {'valor': 0, 'rank': 999, 'classe': 'Novo'})
        out.append({
            'Codigo': item['cod'],
            'Descricao': item['desc'],
            'Familia': d2025.get('familia'),
            'Valor_Meta_2026': item['valor'],
            'Classe_2026': cl_2026,
            'Rank_2026': idx + 1,
            'Valor_Hist_2025': d2025['valor'],
            'Classe_2025': d2025['classe'],
            'Rank_2025': d2025['rank'],
            'Status': 'Estável' if d2025['classe'] == cl_2026 else f"{d2025['classe']} -> {cl_2026}",
        })
    return out


# ============================================================================
# Endpoint principal
# ============================================================================

# ============================================================================
# [DUMMY] Geradores deterministicos — substituem o BigQuery.
# Preservam EXATAMENTE o shape (colunas) consumido pelo frontend e pelos
# calculos de forecast/curva ABC. Cobrem os 12 meses de dummy.ANO_BASE (2026).
# ============================================================================

_DUMMY_ANO = dummy.ANO_BASE
_DUMMY_REGIONAIS = ["SUDESTE", "SUL", "NORDESTE", "CENTRO-OESTE", "NORTE"]


def _dummy_skus():
    """Pool deterministico de SKUs (familia '104%'), com descricao/unidade/familia.
    Reusa dummy.PRODUTOS (todos comecam com '104') e deriva a familia da categoria."""
    out = []
    for cod, desc, un, cat in dummy.PRODUTOS:
        out.append({
            "CODIGO_PRODUTO": cod,
            "DESCRICAO_PRODUTO": desc,
            "UNIDADE_MEDIDA": un,
            "FAMILIA": cat.upper(),
        })
    return out


def _dummy_historico(inactive_codes: Optional[List[str]] = None) -> List[dict]:
    """Shape de _build_sql_vendas_hist_proxy: Regional, Familia, Mes_Numerico,
    CODIGO_PRODUTO, DESCRICAO_PRODUTO, UNIDADE_MEDIDA, valor_bruto_historico,
    share_mensal, preco_medio."""
    inativos = set(str(c).strip() for c in (inactive_codes or []))
    skus = [s for s in _dummy_skus() if s["CODIGO_PRODUTO"] not in inativos]
    rows: List[dict] = []
    # Agrega valor por (regional, familia, mes) para calcular share_mensal coerente.
    grupos: Dict[tuple, list] = {}
    for reg in _DUMMY_REGIONAIS:
        for s in skus:
            r = dummy.rng("sop_hist", reg, s["CODIGO_PRODUTO"])
            preco = round(r.uniform(15.0, 320.0), 2)
            for mes in range(1, 13):
                rm = dummy.rng("sop_hist_mes", reg, s["CODIGO_PRODUTO"], mes)
                valor_bruto = round(rm.uniform(500.0, 80000.0), 2)
                row = {
                    "Regional": reg,
                    "Familia": s["FAMILIA"],
                    "Mes_Numerico": mes,
                    "CODIGO_PRODUTO": s["CODIGO_PRODUTO"],
                    "DESCRICAO_PRODUTO": s["DESCRICAO_PRODUTO"],
                    "UNIDADE_MEDIDA": s["UNIDADE_MEDIDA"],
                    "valor_bruto_historico": valor_bruto,
                    "share_mensal": 0.0,  # preenchido abaixo
                    "preco_medio": preco,
                }
                rows.append(row)
                grupos.setdefault((reg, s["FAMILIA"], mes), []).append(row)
    # share_mensal = valor_bruto / soma do grupo (Regional, Familia, Mes)
    for grp in grupos.values():
        total = sum(x["valor_bruto_historico"] for x in grp) or 1.0
        for x in grp:
            x["share_mensal"] = round(x["valor_bruto_historico"] / total, 6)
    return rows


def _dummy_realizado() -> List[dict]:
    """Shape SQL_REALIZADO_ANO_ATUAL: Tipo, Codigo, Ano, Mes, Qtd_Real."""
    rows: List[dict] = []
    for tipo in ("Venda", "Producao"):
        for s in _dummy_skus():
            for mes in range(1, 13):
                r = dummy.rng("sop_real", tipo, s["CODIGO_PRODUTO"], mes)
                rows.append({
                    "Tipo": tipo,
                    "Codigo": s["CODIGO_PRODUTO"],
                    "Ano": _DUMMY_ANO,
                    "Mes": mes,
                    "Qtd_Real": float(r.randint(10, 1200)),
                })
    return rows


def _dummy_estoque() -> List[dict]:
    """Shape SQL_ESTOQUE: Codigo, Est_Fabrica, Est_Log_Bruto, Est_Log_Reserva, Est_Log_Disp."""
    rows: List[dict] = []
    for s in _dummy_skus():
        r = dummy.rng("sop_estoque", s["CODIGO_PRODUTO"])
        bruto = float(r.randint(0, 5000))
        reserva = float(r.randint(0, int(bruto) if bruto else 1))
        rows.append({
            "Codigo": s["CODIGO_PRODUTO"],
            "Est_Fabrica": float(r.randint(0, 3000)),
            "Est_Log_Bruto": bruto,
            "Est_Log_Reserva": reserva,
            "Est_Log_Disp": round(bruto - reserva, 2),
        })
    return rows


def _dummy_ops(chave: str, com_apontamento: bool) -> List[dict]:
    """Shape SQL_OPS_HIST / SQL_OPS_ABERTO: Codigo, Numero_OP, Ano_Emissao,
    Mes_Emissao, Data_Emissao_Full, Ultimo_Apontamento, Qtd_OP_Planejada,
    Qtd_OP_Realizada, Saldo_A_Produzir. Saldo_A_Produzir > 0 (paridade com HAVING)."""
    rows: List[dict] = []
    skus = _dummy_skus()
    # 2 OPs por SKU, datas cobrindo os 12 meses de 2026.
    datas = dummy.datas_no_ano(max(24, len(skus) * 2), _DUMMY_ANO, chave)
    i = 0
    for s in skus:
        for _ in range(2):
            d = datas[i % len(datas)]
            i += 1
            r = dummy.rng(chave, s["CODIGO_PRODUTO"], i)
            planejada = float(r.randint(200, 2000))
            realizada = float(r.randint(0, int(planejada) - 1))
            saldo = round(planejada - realizada, 2)
            if saldo <= 0:
                saldo = round(planejada, 2)
            dt_emissao = datetime(d.year, d.month, d.day)
            rows.append({
                "Codigo": s["CODIGO_PRODUTO"],
                "Numero_OP": f"OP{_DUMMY_ANO}{i:05d}",
                "Ano_Emissao": d.year,
                "Mes_Emissao": d.month,
                "Data_Emissao_Full": dt_emissao.strftime("%Y-%m-%d %H:%M:%S"),
                "Ultimo_Apontamento": (dt_emissao.strftime("%Y-%m-%d %H:%M:%S")
                                       if com_apontamento else None),
                "Qtd_OP_Planejada": planejada,
                "Qtd_OP_Realizada": realizada,
                "Saldo_A_Produzir": saldo,
            })
    rows.sort(key=lambda x: x["Data_Emissao_Full"], reverse=True)
    return rows


def _dummy_faturamento() -> List[dict]:
    """Shape SQL_FATURAMENTO_ANO_ATUAL: Codigo, Ano, Mes, Qtd_Faturada."""
    rows: List[dict] = []
    for s in _dummy_skus():
        for mes in range(1, 13):
            r = dummy.rng("sop_fat", s["CODIGO_PRODUTO"], mes)
            rows.append({
                "Codigo": s["CODIGO_PRODUTO"],
                "Ano": _DUMMY_ANO,
                "Mes": mes,
                "Qtd_Faturada": float(r.randint(5, 900)),
            })
    return rows


def _dummy_carteira() -> List[dict]:
    """Shape SQL_CARTEIRA: Codigo, Ano_Ref, Mes_Ref, Qtd_Carteira (>0)."""
    rows: List[dict] = []
    for s in _dummy_skus():
        for mes in range(1, 13):
            r = dummy.rng("sop_cart", s["CODIGO_PRODUTO"], mes)
            rows.append({
                "Codigo": s["CODIGO_PRODUTO"],
                "Ano_Ref": _DUMMY_ANO,
                "Mes_Ref": mes,
                "Qtd_Carteira": float(r.randint(1, 600)),
            })
    return rows


def _dummy_detalhe() -> List[dict]:
    """Shape SQL_DETALHE_PEDIDOS: Codigo, Pedido, Cliente, Emissao, Entrega,
    EmissaoOriginal, Saldo. Datas como string (paridade com SAFE_CAST AS STRING)."""
    rows: List[dict] = []
    skus = _dummy_skus()
    # Pedidos espalhados pelos 12 meses; alguns atrasados (entrega no passado).
    datas = dummy.datas_no_ano(60, _DUMMY_ANO, "sop_detalhe")
    for idx, d in enumerate(datas):
        r = dummy.rng("sop_detalhe_row", idx)
        s = skus[idx % len(skus)]
        cliente = dummy.escolher(r, dummy.CLIENTES)
        emissao = datetime(d.year, d.month, d.day)
        # entrega = emissao + alguns dias (alguns ja vencidos no ano)
        entrega = emissao + timedelta(days=r.randint(-30, 20))
        rows.append({
            "Codigo": s["CODIGO_PRODUTO"],
            "Pedido": f"PV{_DUMMY_ANO}{idx:05d}",
            "Cliente": cliente,
            "Emissao": emissao.strftime("%Y-%m-%d %H:%M:%S"),
            "Entrega": entrega.strftime("%Y-%m-%d %H:%M:%S"),
            "EmissaoOriginal": emissao.strftime("%Y-%m-%d %H:%M:%S"),
            "Saldo": float(r.randint(1, 400)),
        })
    rows.sort(key=lambda x: x["Entrega"])
    return rows


def _dummy_base_abc() -> List[dict]:
    """Shape SQL_BASE_ABC: CODIGO_PRODUTO, Descricao, Familia, Valor_2025.
    Ordenado por Valor_2025 desc (paridade com ORDER BY 4 DESC)."""
    rows: List[dict] = []
    for s in _dummy_skus():
        r = dummy.rng("sop_abc", s["CODIGO_PRODUTO"])
        rows.append({
            "CODIGO_PRODUTO": s["CODIGO_PRODUTO"],
            "Descricao": s["DESCRICAO_PRODUTO"],
            "Familia": s["FAMILIA"],
            "Valor_2025": round(r.uniform(50000.0, 2000000.0), 2),
        })
    rows.sort(key=lambda x: x["Valor_2025"], reverse=True)
    return rows


def _dummy_indicadores() -> List[dict]:
    """Shape SQL_INDICADORES: Codigo, Media_Venda_44Dias, Media_Prod_44Dias."""
    rows: List[dict] = []
    for s in _dummy_skus():
        r = dummy.rng("sop_ind", s["CODIGO_PRODUTO"])
        rows.append({
            "Codigo": s["CODIGO_PRODUTO"],
            "Media_Venda_44Dias": round(r.uniform(1.0, 80.0), 2),
            "Media_Prod_44Dias": round(r.uniform(1.0, 80.0), 2),
        })
    return rows


def _dummy_metas() -> List[dict]:
    """Shape SQL_PREV_COMERCIAL (Postgres): regional_meta, familia_meta, mes_meta,
    data_original, valor_meta_total. Regionais/familias batem com _dummy_historico
    para o forecast top-down gerar resultados em TODOS os 12 meses de 2026."""
    familias = sorted({s["FAMILIA"] for s in _dummy_skus()})
    rows: List[dict] = []
    for reg in _DUMMY_REGIONAIS:
        for fam in familias:
            for mes in range(1, 13):
                r = dummy.rng("sop_meta", reg, fam, mes)
                d = date(_DUMMY_ANO, mes, 1)
                rows.append({
                    "regional_meta": reg,
                    "familia_meta": fam,
                    "mes_meta": mes,
                    "data_original": d.strftime("%Y-%m-%d"),
                    "valor_meta_total": round(r.uniform(50000.0, 800000.0), 2),
                })
    return rows


def _dummy_otmz() -> List[dict]:
    """Shape SQL_OTMZ_AI (Postgres): codigo_produto, descricao_produto,
    sequencia_producao, quantidade_necessaria, total_item,
    contador_pedidos_atendidos, pedidos_atendidos."""
    rows: List[dict] = []
    for seq, s in enumerate(_dummy_skus(), start=1):
        r = dummy.rng("sop_otmz", s["CODIGO_PRODUTO"])
        n_ped = r.randint(1, 6)
        peds = [f"PV{_DUMMY_ANO}{r.randint(0, 59):05d}" for _ in range(n_ped)]
        rows.append({
            "codigo_produto": s["CODIGO_PRODUTO"],
            "descricao_produto": s["DESCRICAO_PRODUTO"],
            "sequencia_producao": seq,
            "quantidade_necessaria": float(r.randint(50, 3000)),
            "total_item": round(r.uniform(1000.0, 90000.0), 2),
            "contador_pedidos_atendidos": n_ped,
            "pedidos_atendidos": ', '.join(peds),
        })
    return rows


# Mapeia cada SQL constante para o gerador dummy equivalente (dispatch por identidade
# de objeto string nao e confiavel — usamos marcadores textuais unicos de cada SQL).
def _bq_to_dict(client, sql: str) -> List[dict]:
    """[DUMMY] Substitui a execucao no BigQuery: identifica a query pelo conteudo
    e devolve dados dummy deterministicos com o MESMO shape de colunas."""
    try:
        if "valor_bruto_historico" in sql and "share_mensal" in sql:
            # _build_sql_vendas_hist_proxy — extrai inactive_codes do NOT IN (...)
            inactive = None
            if "CODIGO_PRODUTO NOT IN (" in sql:
                import re as _re
                m = _re.search(r"CODIGO_PRODUTO NOT IN \(([^)]*)\)", sql)
                if m:
                    inactive = [c.strip().strip("'") for c in m.group(1).split(",") if c.strip()]
            return _dummy_historico(inactive)
        if "'Venda' as Tipo" in sql or "'Producao' as Tipo" in sql:
            return _dummy_realizado()
        if "CombinedEstoque" in sql:
            return _dummy_estoque()
        if "ApontamentosProducao" in sql and "INTERVAL 15 DAY" in sql:
            return _dummy_ops("sop_ops_hist", com_apontamento=True)
        if "opemaberto" in sql:
            return _dummy_ops("sop_ops_aberto", com_apontamento=False)
        if "Qtd_Faturada" in sql:
            return _dummy_faturamento()
        if "Qtd_Carteira" in sql:
            return _dummy_carteira()
        if "Metas_por_faturamento" in sql:
            return _dummy_detalhe()
        if "Valor_2025" in sql:
            return _dummy_base_abc()
        if "Media_Venda_44Dias" in sql or "vendas_recentes" in sql:
            return _dummy_indicadores()
        logger.warning("SQL dummy nao mapeado; retornando vazio.")
        return []
    except Exception as e:
        logger.error(f"Erro em BQ (dummy): {e}")
        return []


@router.get("/sop-dashboard/data")
def get_sop_dashboard_data(
    refresh: bool = False,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Retorna o JSON consolidado para a Torre S&OP. Usa cache se existir, salvo quando refresh=true."""
    if not check_module_permission(user_id or '', 'sop_dashboard'):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    # Sem refresh: retorna cache se houver (Postgres - compartilhado entre replicas)
    if not refresh:
        cached = _read_sop_cache()
        if cached is not None:
            return cached

    started_at = datetime.now(BR_TZ)
    try:
        bq = get_bq_client()
    except Exception as e:
        logger.error(f"Erro ao conectar BigQuery: {e}")
        raise HTTPException(status_code=500, detail=f"BigQuery indisponivel: {e}")

    # 0. Lista de itens inativos (mesma fonte do nó FormataListaSql do n8n)
    inactive_codes = _load_inactive_items()

    # 1. BigQuery (10 queries)
    historico = _bq_to_dict(bq, _build_sql_vendas_hist_proxy(inactive_codes))
    realizado = _bq_to_dict(bq, SQL_REALIZADO_ANO_ATUAL)
    estoque = _bq_to_dict(bq, SQL_ESTOQUE)
    ops_hist = _bq_to_dict(bq, SQL_OPS_HIST)
    ops_aberto = _bq_to_dict(bq, SQL_OPS_ABERTO)
    faturamento = _bq_to_dict(bq, SQL_FATURAMENTO_ANO_ATUAL)
    carteira = _bq_to_dict(bq, SQL_CARTEIRA)
    detalhe = _bq_to_dict(bq, SQL_DETALHE_PEDIDOS)
    base_abc = _bq_to_dict(bq, SQL_BASE_ABC)
    indicadores = _bq_to_dict(bq, SQL_INDICADORES)

    # 2. Postgres (2 queries) — [DUMMY] tabelas previsao_comercial_sop e otmz_prod_sop
    #    sao alimentadas por pipelines externos; substituidas por dados dummy
    #    deterministicos com o MESMO shape de colunas.
    metas = _dummy_metas()
    otmz = _dummy_otmz()

    # 3. Forecast Top-Down + Curva ABC (no backend)
    resultados = calcular_forecast_top_down(historico, metas)
    curva_abc = calcular_curva_abc(resultados, base_abc)

    # 3b. Calcular late_orders no backend (mesma logica do otimizador plano_producao.py)
    from modulo.plano_producao import parse_data_pt as _parse_dt
    _hoje = pd.Timestamp.now().normalize()
    _corte5d = _hoje - pd.Timedelta(days=5)
    _df_det = pd.DataFrame(detalhe)
    _late_orders_backend = []
    if not _df_det.empty and 'Entrega' in _df_det.columns:
        _df_det['_dt_entrega'] = _df_det['Entrega'].apply(_parse_dt)
        _df_det['_dt_emissao_orig'] = _df_det.get('EmissaoOriginal', pd.Series(dtype=object)).apply(_parse_dt)
        _df_det['_saldo'] = pd.to_numeric(_df_det.get('Saldo', 0), errors='coerce').fillna(0)
        _meta = _df_det.groupby('Pedido').agg(
            entrega=('_dt_entrega', 'min'),
            emissao_orig=('_dt_emissao_orig', 'min'),
        ).reset_index()
        _mesma = _meta['entrega'] == _meta['emissao_orig']
        _meta['atraso'] = (_mesma & (_meta['entrega'] < _corte5d)) | (~_mesma & (_meta['entrega'] < _hoje))
        _peds_atrasados = set(_meta[_meta['atraso']]['Pedido'])
        for _, row in _df_det.iterrows():
            ped = row.get('Pedido', '')
            if ped not in _peds_atrasados:
                continue
            dt = row['_dt_entrega']
            if pd.isna(dt):
                continue
            diff_days = (_hoje - dt).days
            mes_nome = dt.strftime('%b/%y')
            _late_orders_backend.append({
                'ped': ped, 'cli': row.get('Cliente', ''),
                'cod': row.get('Codigo', ''), 'desc': '',
                'dt': row.get('Entrega', ''), 'dias': int(diff_days),
                'qtd': float(row['_saldo']), 'mesAno': mes_nome,
                'sortDt': dt.year * 100 + dt.month,
            })
        _late_orders_backend.sort(key=lambda x: -x['dias'])
    logger.info(f"Late orders backend: {len(_peds_atrasados) if not _df_det.empty and 'Entrega' in _df_det.columns else 0} pedidos, {len(_late_orders_backend)} itens")

    # 4. Blacklist - le do Google Sheets (mesma fonte do n8n), fallback IMPORTED_ITEM_CODES
    blacklist = _load_blacklist_imported_items()

    elapsed = (datetime.now(BR_TZ) - started_at).total_seconds()

    payload = {
        'meta': {
            'updated_at': started_at.isoformat(),
            'elapsed_seconds': round(elapsed, 2),
        },
        'resultados': resultados,           # = nó Resultados do n8n
        'realizado': realizado,             # vendas + producao do ano
        'estoque': estoque,
        'ops_hist': ops_hist,
        'ops_aberto': ops_aberto,
        'faturamento': faturamento,
        'carteira': carteira,
        'detalhe': detalhe,
        'base_abc': base_abc,
        'indicadores': indicadores,
        'curva_abc': curva_abc,
        'otmz_ai': otmz,
        'blacklist': blacklist,
        'late_orders_backend': _late_orders_backend,
    }

    # Salva cache para proximas requisicoes (Postgres - compartilhado entre replicas)
    _write_sop_cache(payload)

    return payload


# =============================================================================
# ENVIO WHATSAPP — recebe HTML/anexo pronto do frontend (DOM capture)
# =============================================================================
import base64 as _b64
from pydantic import BaseModel as _BM

_ALLOWED_MIMETYPES = {
    'text/html',
    'application/pdf',
    'image/png',
    'image/jpeg',
}
# WhatsApp limita arquivos a ~16MB. base64 = 4/3 do binario → cap em ~22MB de string.
_MAX_BASE64_LEN = 22 * 1024 * 1024


class EnviarSopWhatsAppBody(_BM):
    numero: str
    caption: str
    filename: str
    mimetype: str
    data_base64: str


class EnviarSopWhatsAppInterativoBody(_BM):
    numero: str
    db_main: list = []
    db_drill: dict = {}
    db_ai: list = []
    db_aging: list = []
    db_late: list = []
    periods: list = []
    kpis_topo: dict = {}
    total_late_vol: int = 0
    total_backlog_vol: int = 0
    current_year: int = 0
    current_month: int = 0


@router.post("/sop-dashboard/enviar-whatsapp")
def enviar_sop_dashboard_whatsapp(
    body: EnviarSopWhatsAppBody,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not check_module_permission(user_id or '', 'sop_dashboard'):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    if body.mimetype not in _ALLOWED_MIMETYPES:
        raise HTTPException(status_code=400,
                            detail=f"Tipo de arquivo nao permitido: {body.mimetype}.")

    # Remove whitespace que alguns geradores embutem (incluindo \n e espacos)
    b64_clean = ''.join((body.data_base64 or '').split())
    if not b64_clean:
        raise HTTPException(status_code=400, detail="Arquivo vazio (data_base64 ausente).")
    if len(b64_clean) > _MAX_BASE64_LEN:
        mb_aprox = (len(b64_clean) * 3 / 4) / (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"Arquivo grande demais (~{mb_aprox:.1f} MB). Limite ~16 MB."
        )
    try:
        binario = _b64.b64decode(b64_clean, validate=False)
        if not binario:
            raise ValueError("vazio")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Base64 invalido: {e}")
    body.data_base64 = b64_clean

    # Sanitiza filename simples (sem path)
    safe_name = (body.filename or 'sop_dashboard.html').replace('\\', '_').replace('/', '_')[:120]
    caption = (body.caption or '')[:1024]

    from modulo.whatsapp_config import enviar_arquivo_whatsapp
    return enviar_arquivo_whatsapp(
        user_id=user_id,
        numero=body.numero,
        origem='sop_dashboard',
        referencia_id=None,
        caption=caption,
        filename=safe_name,
        mimetype=body.mimetype,
        data_base64=body.data_base64,
    )


@router.get("/sop-dashboard/debug-buckets")
def debug_buckets(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Diagnostico das transformacoes payload -> buckets do template HTML."""
    if not check_module_permission(user_id or '', 'sop_dashboard'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    payload = _read_sop_cache()
    if payload is None:
        return {"erro": "cache nao existe; abra a tela da Torre S&OP"}
    sample = {}
    for k, v in payload.items():
        if isinstance(v, list):
            sample[k] = {
                "type": "list", "len": len(v),
                "sample0": v[0] if v else None,
            }
        elif isinstance(v, dict):
            keys = list(v.keys())[:5]
            sample[k] = {"type": "dict", "keys_sample": keys}
        else:
            sample[k] = {"type": type(v).__name__, "val": str(v)[:200]}
    from modulo import sop_html_render
    db_late = sop_html_render.build_db_late(payload)
    return {
        "payload_keys": list(payload.keys()),
        "payload_sample": sample,
        "db_late_len": len(db_late),
        "db_late_sample0": db_late[0] if db_late else None,
        "hoje_br": sop_html_render._now_br().isoformat(),
    }


@router.post("/sop-dashboard/enviar-whatsapp-interativo")
def enviar_sop_dashboard_whatsapp_interativo(
    body: EnviarSopWhatsAppInterativoBody,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """
    Gera o HTML interativo (mesmo formato do n8n) no servidor e envia
    via WAHA. O frontend so passa o numero — nada do conteudo do
    arquivo trafega pela rede do cliente.
    """
    if not check_module_permission(user_id or '', 'sop_dashboard'):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    from modulo import sop_html_render
    try:
        html = sop_html_render.gerar_html_from_buckets(
            db_main=body.db_main,
            db_drill=body.db_drill,
            db_ai=body.db_ai,
            db_aging=body.db_aging,
            db_late=body.db_late,
            periods=body.periods,
            total_late_vol=body.total_late_vol,
            total_backlog_vol=body.total_backlog_vol,
            current_year=body.current_year,
            current_month=body.current_month,
        )
        data_b64 = _b64.b64encode(html.encode('utf-8')).decode('ascii')
        caption = sop_html_render.gerar_caption_from_kpis(
            body.kpis_topo, body.total_late_vol, body.total_backlog_vol
        )
        filename = sop_html_render.gerar_filename()
    except Exception as e:
        logger.error(f"Erro ao gerar HTML SOP: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Falha ao gerar HTML: {e}")

    from modulo.whatsapp_config import enviar_arquivo_whatsapp
    return enviar_arquivo_whatsapp(
        user_id=user_id,
        numero=body.numero,
        origem='sop_dashboard_interativo',
        referencia_id=None,
        caption=caption,
        filename=filename,
        mimetype='text/html',
        data_base64=data_b64,
    )
