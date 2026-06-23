"""
Metas de Faturamento — Módulo Comercial
Endpoints de KPIs/gráficos baseados em Postgres (tabela <schema>.faturamento).

A tabela é populada externamente pelo script gerar_metas_faturamento.py
via save_to_postgres(df), que recria a tabela a cada execução.

Filtra dados apenas de Janeiro/Fevereiro/Março (v1) via EMISSAO_faturamento.
"""
import os
from typing import Optional, Dict, Any, List
from threading import Lock

from fastapi import APIRouter, HTTPException, Depends, Query

from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from db_utils import get_db_connection

router = APIRouter(prefix="/metas-faturamento", tags=["Metas de Faturamento"])

# ─────────────────────────────────────────────
#  Configuração
# ─────────────────────────────────────────────
DB_SCHEMA = os.environ.get("DB_SCHEMA", "portal_chamado")
TABLE = f'"{DB_SCHEMA}".faturamento'

# Lock pra evitar consultas duplicadas em "refresh" (mantido por compat)
_refresh_lock = Lock()
_refresh_in_progress = False

# Cache do mapeamento canonico -> coluna real (resolve sufixos _x/_y de pandas merge)
_col_map_cache: Optional[Dict[str, str]] = None
_col_map_lock = Lock()


def _resolve_columns(cur) -> Dict[str, str]:
    """
    Mapeia nomes canonicos para nomes reais na tabela.
    Resolve sufixos _x/_y/_1 deixados por pandas.merge().
    """
    global _col_map_cache
    with _col_map_lock:
        if _col_map_cache is not None:
            return _col_map_cache
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s",
            (DB_SCHEMA, "faturamento"),
        )
        actual = {r[0] for r in cur.fetchall()}

        def pick(*candidates: str) -> str:
            for c in candidates:
                if c in actual:
                    return c
            # fallback — retorna o primeiro pra erro ser explicito
            return candidates[0]

        m = {
            "fantasia_vendedor": pick("fantasia_vendedor", "fantasia_vendedor_x", "fantasia_vendedor_y", "fantasia_pad"),
            "regional": pick("gerencia_regional", "gerencia_regional_x", "regional", "regional_x", "regional_y"),
            "descricao_segmento": pick("descricao_segmento", "descricao_segmento_x", "descricao_segmento_y"),
            "vlr_financeiro": pick("vlr_financeiro", "vlr_financeiro_x", "vlr_financeiro_y"),
            "faturamento_semst": pick("faturamento_semst", "faturamento_sem_st", "faturamento_semst_x"),
            "meta_vendedor": pick("meta_vendedor", "meta_vendedor_x", "meta"),
            "meta_regional": pick("meta_regional", "meta_regional_x"),
            "emissao_faturamento": pick("emissao_faturamento", "emissao_faturamento_x"),
            "data_atualizacao": pick("data_atualizacao", "data_atualizacao_x"),
            "devolucao": pick("devolucao", "devolucao_x", "devolucao_y"),
            # Novas colunas pra KPIs
            "status": pick("status_pedido", "status_pedido_x", "status", "status_x"),
            "pedido": pick("pedido", "pedido_x"),
            "quantidade": pick("quantidade", "quantidade_x"),
            "total_item": pick("total_item", "total_item_x"),
            "cod_origem": pick("cod_origem", "cod_origem_x"),
            # data do pedido (independente do faturamento)
            "emissao": pick("emissao", "emissao_x"),
            # Colunas para o detalhamento (drill-down)
            "razao": pick("razao", "razao_x", "razao_y", "razao_social", "nome", "nome_x"),
            "codigo_produto": pick("codigo_produto", "codigo_produto_x"),
            "nota_fiscal": pick("nota_fiscal", "nota_fiscal_x", "nota_fiscal_faturamento"),
            "familia": pick("familia", "familia_x", "familia_y", "familia_norm"),
            "bu": pick("bu", "bu_x", "unidade_negocio"),
            "area_de_negocio": pick("area_de_negocio", "area_de_negocio_x", "area_negocio"),
            "categorias": pick("categorias", "categorias_x", "categoria"),
            "canal": pick("canal", "canal_x"),
            "linha": pick("linha", "linha_x", "linha_c"),
        }
        _col_map_cache = m
        print(f"[METAS] Colunas resolvidas: {m}")
        return m


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def _ensure_permission(user_id: Optional[str]):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    if not check_module_permission(user_id, "metas_faturamento"):
        raise HTTPException(status_code=403, detail="Acesso negado.")


def _table_exists(cur) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema=%s AND table_name=%s",
        (DB_SCHEMA, "faturamento"),
    )
    return cur.fetchone() is not None


def _build_filters(cols: Dict[str, str], ano=None, mes=None, vendedor=None, regional=None, segmento=None):
    """
    Retorna (sql_where, params) com filtros aplicados.
    Sem filtro forcado de mes — todos os meses do ano.
    """
    ef = cols["emissao_faturamento"]
    where = [f'"{ef}" IS NOT NULL']
    params: List[Any] = []
    if ano:
        where.append(f'EXTRACT(YEAR FROM "{ef}") = %s')
        params.append(int(ano))
    if mes:
        # Aceita "3" ou "1,2,3" (multi-mes)
        try:
            meses = [int(x) for x in str(mes).split(',') if x.strip()]
            meses = [m for m in meses if 1 <= m <= 12]
            if len(meses) == 1:
                where.append(f'EXTRACT(MONTH FROM "{ef}") = %s')
                params.append(meses[0])
            elif len(meses) > 1:
                placeholders = ','.join(['%s'] * len(meses))
                where.append(f'EXTRACT(MONTH FROM "{ef}") IN ({placeholders})')
                params.extend(meses)
        except Exception:
            pass
    if vendedor:
        where.append(f'"{cols["fantasia_vendedor"]}" = %s')
        params.append(vendedor)
    if regional:
        where.append(f'"{cols["regional"]}" = %s')
        params.append(regional)
    if segmento:
        where.append(f'"{cols["descricao_segmento"]}" = %s')
        params.append(segmento)
    return " AND ".join(where), params


def _dev_sql(cols: Dict[str, str]) -> str:
    """Linha de devolucao: coluna pode conter 'S', 'sim', '1', etc."""
    dev = cols["devolucao"]
    return f"(LOWER(COALESCE(\"{dev}\"::text, '')) IN ('s', 'sim', '1', 'true', 't', 'y', 'yes'))"


def _data_unavailable():
    return HTTPException(status_code=503, detail="Dados de metas de faturamento não disponíveis. Carregue a base primeiro.")


# ─────────────────────────────────────────────
#  Endpoints
# ─────────────────────────────────────────────
@router.get("/debug")
def debug_info(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Endpoint de diagnostico — mostra schema usado, colunas e contagem."""
    _ensure_permission(user_id)
    info: Dict[str, Any] = {"DB_SCHEMA": DB_SCHEMA, "TABLE": TABLE}
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Schema atual da conexao
        cur.execute("SELECT current_schema(), current_database()")
        cs, cdb = cur.fetchone()
        info["current_schema"] = cs
        info["current_database"] = cdb

        # Existe a tabela?
        info["table_exists"] = _table_exists(cur)
        if info["table_exists"]:
            cur.execute(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
                (DB_SCHEMA, "faturamento"),
            )
            info["columns"] = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
            cur.execute(f"SELECT COUNT(*) FROM {TABLE}")
            info["row_count"] = cur.fetchone()[0]

            # Distribuicao de status_pedido com SUM(total_item) e count
            try:
                cols = _resolve_columns(cur)
                st = cols.get("status"); ti = cols.get("total_item")
                if st and ti:
                    cur.execute(f'''
                        SELECT "{st}"::text AS status, COUNT(*) AS qtd, COALESCE(SUM("{ti}"), 0) AS total
                        FROM {TABLE}
                        GROUP BY "{st}"::text
                        ORDER BY qtd DESC
                        LIMIT 30
                    ''')
                    info["status_distribuicao"] = [
                        {"status": s, "qtd": int(q), "total_item": float(t or 0)}
                        for s, q, t in cur.fetchall()
                    ]
                    info["status_coluna"] = st
                    info["total_item_coluna"] = ti
            except Exception as e:
                info["status_diag_error"] = str(e)
        return info
    except Exception as e:
        import traceback
        info["error"] = f"{type(e).__name__}: {e}"
        info["trace"] = traceback.format_exc()
        return info
    finally:
        cur.close()
        conn.close()


def _safe_endpoint(fn):
    """Wrapper que captura excecoes e retorna 500 com mensagem util pro log."""
    def wrapped(*args, **kwargs):
        import traceback
        try:
            return fn(*args, **kwargs)
        except HTTPException:
            raise
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[METAS] {fn.__name__} ERROR: {e}\n{tb}")
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:300]}")
    wrapped.__name__ = fn.__name__
    wrapped.__wrapped__ = fn
    return wrapped


@router.get("/status")
def status(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            return {"last_refresh_at": None, "refreshing": _refresh_in_progress, "has_data": False}
        try:
            cols = _resolve_columns(cur)
            da = cols["data_atualizacao"]
            cur.execute(f'SELECT MAX("{da}") FROM {TABLE}')
            row = cur.fetchone()
            last = row[0] if row else None
        except Exception as e:
            print(f"[METAS] status: erro lendo data_atualizacao: {e}")
            last = None
        return {
            "last_refresh_at": last.isoformat() if last else None,
            "refreshing": _refresh_in_progress,
            "has_data": True,
        }
    finally:
        cur.close()
        conn.close()


@router.get("/filtros")
def get_filtros(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        ef = cols["emissao_faturamento"]
        fv = cols["fantasia_vendedor"]
        rg = cols["regional"]
        sg = cols["descricao_segmento"]

        cur.execute(f"""
            SELECT DISTINCT EXTRACT(YEAR FROM "{ef}")::int AS ano
            FROM {TABLE}
            WHERE "{ef}" IS NOT NULL
            ORDER BY ano DESC
        """)
        anos = [r[0] for r in cur.fetchall() if r[0] is not None]

        cur.execute(f'SELECT DISTINCT "{fv}" FROM {TABLE} WHERE "{fv}" IS NOT NULL AND "{fv}" <> \'\' ORDER BY "{fv}"')
        vendedores = [r[0] for r in cur.fetchall()]

        cur.execute(f'SELECT DISTINCT "{rg}" FROM {TABLE} WHERE "{rg}" IS NOT NULL AND "{rg}" <> \'\' ORDER BY "{rg}"')
        regionais = [r[0] for r in cur.fetchall()]

        cur.execute(f'SELECT DISTINCT "{sg}" FROM {TABLE} WHERE "{sg}" IS NOT NULL AND "{sg}" <> \'\' ORDER BY "{sg}"')
        segmentos = [r[0] for r in cur.fetchall()]

        return {"anos": anos, "vendedores": vendedores, "regionais": regionais, "segmentos": segmentos}
    except Exception as e:
        import traceback
        print(f"[METAS] get_filtros ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/kpis")
def get_kpis(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    mes: Optional[str] = Query(None),
    vendedor: Optional[str] = Query(None),
    regional: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
):
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        where_sql, params = _build_filters(cols, ano, mes, vendedor, regional, segmento)
        DEV = _dev_sql(cols)
        vlr = cols["vlr_financeiro"]; fst = cols["faturamento_semst"]
        fv = cols["fantasia_vendedor"]; mv = cols["meta_vendedor"]; ef = cols["emissao_faturamento"]
        st = cols["status"]; pd = cols["pedido"]; qt = cols["quantidade"]
        ti = cols["total_item"]; co = cols["cod_origem"]

        # Faturamento, Fat sem ST, Devolucoes, Unidades, Ticket, Preco, Positivacao (filtrados por emissao_faturamento)
        cur.execute(
            f'''SELECT
                  COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS faturamento,
                  COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{fst}" ELSE 0 END), 0) AS fat_semst,
                  COALESCE(SUM(CASE WHEN {DEV} THEN "{vlr}" ELSE 0 END), 0) AS devolucoes,
                  COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{qt}" ELSE 0 END), 0) AS unidades,
                  COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{ti}" ELSE 0 END), 0) AS sum_total_item,
                  COUNT(DISTINCT CASE WHEN NOT {DEV} THEN "{pd}" END) AS pedidos_distintos,
                  COUNT(DISTINCT CASE WHEN NOT {DEV} THEN "{co}" END) AS cod_origem_distintos
                FROM {TABLE}
                WHERE {where_sql}''',
            params,
        )
        fat, fat_semst, dev, uni, sti, ped_d, co_d = cur.fetchone()

        # Carteira: pedidos status 1 e 4 (ainda nao faturados, sem emissao_faturamento)
        # Usa filtros de vendedor/regional/segmento mas filtra por EMISSAO (data do pedido)
        em = cols.get("emissao")
        carteira_where = ["1=1"]
        carteira_params: List[Any] = []
        if vendedor:
            carteira_where.append(f'"{cols["fantasia_vendedor"]}" = %s'); carteira_params.append(vendedor)
        if regional:
            carteira_where.append(f'"{cols["regional"]}" = %s'); carteira_params.append(regional)
        if segmento:
            carteira_where.append(f'"{cols["descricao_segmento"]}" = %s'); carteira_params.append(segmento)
        # Filtro de ano/mes via EMISSAO (data do pedido) se a coluna existir
        if em and ano:
            carteira_where.append(f'EXTRACT(YEAR FROM "{em}") = %s'); carteira_params.append(int(ano))
        if em and mes:
            try:
                meses = [int(x) for x in str(mes).split(',') if x.strip()]
                meses = [m for m in meses if 1 <= m <= 12]
                if len(meses) == 1:
                    carteira_where.append(f'EXTRACT(MONTH FROM "{em}") = %s'); carteira_params.append(meses[0])
                elif len(meses) > 1:
                    placeholders = ','.join(['%s'] * len(meses))
                    carteira_where.append(f'EXTRACT(MONTH FROM "{em}") IN ({placeholders})')
                    carteira_params.extend(meses)
            except Exception:
                pass
        carteira_where.append(f"BTRIM(SPLIT_PART(COALESCE(\"{st}\"::text, ''), '.', 1)) IN ('1','4','01','04')")
        cur.execute(
            f'''SELECT COALESCE(SUM("{ti}"), 0) FROM {TABLE} WHERE {" AND ".join(carteira_where)}''',
            carteira_params,
        )
        cart = cur.fetchone()[0]

        # Meta total: soma por (vendedor, mes)
        cur.execute(
            f'''SELECT COALESCE(SUM(meta), 0) FROM (
                  SELECT "{fv}", EXTRACT(YEAR FROM "{ef}")::int AS y, EXTRACT(MONTH FROM "{ef}")::int AS m,
                         MAX(COALESCE("{mv}", 0)) AS meta
                  FROM {TABLE}
                  WHERE {where_sql}
                    AND "{fv}" IS NOT NULL AND "{fv}" <> ''
                  GROUP BY "{fv}", y, m
                ) sub''',
            params,
        )
        meta = cur.fetchone()[0]

        fat_f = float(fat or 0); fat_st_f = float(fat_semst or 0); meta_f = float(meta or 0); dev_f = float(dev or 0)
        uni_f = float(uni or 0); sti_f = float(sti or 0); cart_f = float(cart or 0)
        ped_d_f = int(ped_d or 0); co_d_f = int(co_d or 0)
        pct = (fat_f / meta_f * 100.0) if meta_f > 0 else 0.0
        ticket_medio = (sti_f / ped_d_f) if ped_d_f > 0 else 0.0
        preco_medio = (sti_f / uni_f) if uni_f > 0 else 0.0

        return {
            "faturamento_total": round(fat_f, 2),
            "faturamento_semst_total": round(fat_st_f, 2),
            "meta_total": round(meta_f, 2),
            "percentual_atingimento": round(pct, 2),
            "devolucoes_total": round(dev_f, 2),
            "carteira_total": round(cart_f, 2),
            "unidades_faturadas": round(uni_f, 2),
            "ticket_medio": round(ticket_medio, 2),
            "preco_medio": round(preco_medio, 2),
            "positivacao": co_d_f,
        }
    except Exception as e:
        import traceback
        print(f"[METAS] get_kpis ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/por-vendedor")
def get_por_vendedor(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    mes: Optional[str] = Query(None),
    regional: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    comparar: Optional[bool] = Query(False),
):
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        where_sql, params = _build_filters(cols, ano=ano, mes=mes, regional=regional, segmento=segmento)
        DEV = _dev_sql(cols)
        vlr = cols["vlr_financeiro"]; fst = cols["faturamento_semst"]
        fv = cols["fantasia_vendedor"]; mv = cols["meta_vendedor"]; ef = cols["emissao_faturamento"]
        # Faturamento + faturamento_semst por vendedor; meta = SUM(MAX por mes)
        cur.execute(
            f'''SELECT v.nome,
                       v.faturamento,
                       v.faturamento_semst,
                       COALESCE(mt.meta, 0) AS meta
                FROM (
                  SELECT "{fv}" AS nome,
                         COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS faturamento,
                         COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{fst}" ELSE 0 END), 0) AS faturamento_semst
                  FROM {TABLE}
                  WHERE {where_sql}
                    AND "{fv}" IS NOT NULL AND "{fv}" <> ''
                  GROUP BY "{fv}"
                ) v
                LEFT JOIN (
                  SELECT vendedor, SUM(meta) AS meta FROM (
                    SELECT "{fv}" AS vendedor,
                           EXTRACT(YEAR FROM "{ef}")::int AS y,
                           EXTRACT(MONTH FROM "{ef}")::int AS m,
                           MAX(COALESCE("{mv}", 0)) AS meta
                    FROM {TABLE}
                    WHERE {where_sql}
                      AND "{fv}" IS NOT NULL AND "{fv}" <> ''
                    GROUP BY "{fv}", y, m
                  ) sub GROUP BY vendedor
                ) mt ON mt.vendedor = v.nome
                ORDER BY v.faturamento DESC''',
            params + params,
        )
        result = []
        for nome, fat, fat_st, meta in cur.fetchall():
            f = float(fat or 0); fs = float(fat_st or 0); m = float(meta or 0)
            pct = (f / m * 100.0) if m > 0 else 0.0
            result.append({"nome": nome, "faturamento": round(f, 2), "faturamento_semst": round(fs, 2),
                          "meta": round(m, 2), "percentual": round(pct, 2)})

        # Comparacao com ano anterior
        if comparar and ano:
            ano_ant = int(ano) - 1
            where_ant, params_ant = _build_filters(cols, ano_ant, mes, None, regional, segmento)
            cur.execute(
                f'''SELECT "{fv}" AS nome,
                           COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS fat_ant
                    FROM {TABLE}
                    WHERE {where_ant}
                      AND "{fv}" IS NOT NULL AND "{fv}" <> \'\'
                    GROUP BY "{fv}"''',
                params_ant,
            )
            ant_map = {nm: float(v or 0) for nm, v in cur.fetchall()}
            for r in result:
                fa = ant_map.get(r["nome"], 0.0)
                r["faturamento_anterior"] = round(fa, 2)
                r["variacao_pct"] = round(((r["faturamento"] - fa) / fa * 100.0), 2) if fa > 0 else None

        return result
    except Exception as e:
        import traceback
        print(f"[METAS] get_por_vendedor ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/por-regional")
def get_por_regional(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    mes: Optional[str] = Query(None),
    vendedor: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    comparar: Optional[bool] = Query(False),
):
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        where_sql, params = _build_filters(cols, ano=ano, mes=mes, vendedor=vendedor, segmento=segmento)
        DEV = _dev_sql(cols)
        vlr = cols["vlr_financeiro"]; fst = cols["faturamento_semst"]
        rg = cols["regional"]; mr = cols["meta_regional"]; ef = cols["emissao_faturamento"]
        # Faturamento + sem ST por gerencia_regional; meta = SUM(MAX por mes)
        cur.execute(
            f'''SELECT r.regional,
                       r.faturamento,
                       r.faturamento_semst,
                       COALESCE(mt.meta, 0) AS meta
                FROM (
                  SELECT "{rg}" AS regional,
                         COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS faturamento,
                         COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{fst}" ELSE 0 END), 0) AS faturamento_semst
                  FROM {TABLE}
                  WHERE {where_sql}
                    AND "{rg}" IS NOT NULL AND "{rg}" <> ''
                  GROUP BY "{rg}"
                ) r
                LEFT JOIN (
                  SELECT regional, SUM(meta) AS meta FROM (
                    SELECT "{rg}" AS regional,
                           EXTRACT(YEAR FROM "{ef}")::int AS y,
                           EXTRACT(MONTH FROM "{ef}")::int AS m,
                           MAX(COALESCE("{mr}", 0)) AS meta
                    FROM {TABLE}
                    WHERE {where_sql}
                      AND "{rg}" IS NOT NULL AND "{rg}" <> ''
                    GROUP BY "{rg}", y, m
                  ) sub GROUP BY regional
                ) mt ON mt.regional = r.regional
                ORDER BY r.faturamento DESC''',
            params + params,
        )
        result = [
            {"regional": reg, "faturamento": round(float(fat or 0), 2),
             "faturamento_semst": round(float(fst_v or 0), 2), "meta": round(float(meta or 0), 2)}
            for reg, fat, fst_v, meta in cur.fetchall()
        ]

        # Comparacao com ano anterior
        if comparar and ano:
            ano_ant = int(ano) - 1
            where_ant, params_ant = _build_filters(cols, ano_ant, mes, vendedor, None, segmento)
            cur.execute(
                f'''SELECT "{rg}" AS regional,
                           COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS fat_ant
                    FROM {TABLE}
                    WHERE {where_ant}
                      AND "{rg}" IS NOT NULL AND "{rg}" <> \'\'
                    GROUP BY "{rg}"''',
                params_ant,
            )
            ant_map = {reg: float(v or 0) for reg, v in cur.fetchall()}
            for r in result:
                fa = ant_map.get(r["regional"], 0.0)
                r["faturamento_anterior"] = round(fa, 2)
                r["variacao_pct"] = round(((r["faturamento"] - fa) / fa * 100.0), 2) if fa > 0 else None

        return result
    except Exception as e:
        import traceback
        print(f"[METAS] get_por_regional ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/detalhes")
def get_detalhes(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    mes: Optional[str] = Query(None),
    vendedor: Optional[str] = Query(None),
    regional: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    limit: int = Query(2000, le=10000),
):
    """Retorna linhas detalhadas (drill-down) para abrir em modal."""
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        where_sql, params = _build_filters(cols, ano, mes, vendedor, regional, segmento)
        DEV = _dev_sql(cols)

        # Helper pra coluna existente OU NULL
        def col(key: str, alias: str) -> str:
            c = cols.get(key)
            # Se a coluna canonica caiu em fallback inexistente, retorna NULL
            cur2 = conn.cursor()
            cur2.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s",
                (DB_SCHEMA, "faturamento", c),
            )
            exists = cur2.fetchone()
            cur2.close()
            return f'"{c}" AS {alias}' if exists else f'NULL AS {alias}'

        ef = cols["emissao_faturamento"]
        select_cols = [
            f'EXTRACT(YEAR FROM "{ef}")::int AS ano',
            f'EXTRACT(MONTH FROM "{ef}")::int AS mes',
            f'"{cols["fantasia_vendedor"]}" AS vendedor',
            col("pedido", "pedido"),
            col("status", "status_pedido"),
            col("codigo_produto", "codigo_produto"),
            col("cod_origem", "cod_origem"),
            col("razao", "razao"),
            col("quantidade", "quantidade"),
            col("total_item", "total_item"),
            col("faturamento_semst", "faturamento_semst"),
            col("nota_fiscal", "nota_fiscal"),
            col("familia", "familia"),
            col("bu", "bu"),
            col("area_de_negocio", "area_de_negocio"),
            col("categorias", "categorias"),
            col("canal", "canal"),
            col("linha", "linha"),
        ]

        cur.execute(
            f'''SELECT {", ".join(select_cols)}
                FROM {TABLE}
                WHERE {where_sql}
                  AND NOT {DEV}
                ORDER BY ano, mes, vendedor
                LIMIT %s''',
            params + [int(limit)],
        )
        rows = cur.fetchall()
        col_names = [d[0] for d in cur.description]
        result: List[Dict[str, Any]] = []
        for r in rows:
            d = dict(zip(col_names, r))
            # Numericos -> float arredondado
            for k in ("quantidade", "total_item", "faturamento_semst"):
                if d.get(k) is not None:
                    try:
                        d[k] = round(float(d[k]), 2)
                    except Exception:
                        pass
            result.append(d)
        return {"total": len(result), "limite": int(limit), "rows": result}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[METAS] get_detalhes ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/pedidos-pivot")
def pedidos_pivot(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    vendedor: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    apenas_carteira: Optional[bool] = Query(False),
):
    """Matriz Regional x Mes baseada em EMISSAO (data do pedido)."""
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        em = cols.get("emissao"); rg = cols["regional"]; ti = cols["total_item"]
        pd = cols["pedido"]; st = cols["status"]
        fv = cols["fantasia_vendedor"]; sg = cols["descricao_segmento"]

        if not em:
            raise HTTPException(status_code=503, detail="Coluna emissao nao encontrada na tabela.")

        where = [f'"{em}" IS NOT NULL']
        params: List[Any] = []
        if ano:
            where.append(f'EXTRACT(YEAR FROM "{em}") = %s'); params.append(int(ano))
        if vendedor:
            where.append(f'"{fv}" = %s'); params.append(vendedor)
        if segmento:
            where.append(f'"{sg}" = %s'); params.append(segmento)
        if apenas_carteira:
            where.append(f"BTRIM(SPLIT_PART(COALESCE(\"{st}\"::text, ''), '.', 1)) IN ('1','4','01','04')")

        cur.execute(
            f'''SELECT "{rg}" AS regional,
                       EXTRACT(MONTH FROM "{em}")::int AS mes,
                       COALESCE(SUM("{ti}"), 0) AS total,
                       COUNT(DISTINCT "{pd}") AS qtd_pedidos
                FROM {TABLE}
                WHERE {" AND ".join(where)}
                  AND "{rg}" IS NOT NULL AND "{rg}" <> \'\'
                GROUP BY "{rg}", mes
                ORDER BY "{rg}", mes''',
            params,
        )
        return [
            {"regional": r, "mes": int(m), "total": round(float(t or 0), 2), "qtd_pedidos": int(q or 0)}
            for r, m, t, q in cur.fetchall()
        ]
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[METAS] pedidos_pivot ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/pedidos-detalhes")
def pedidos_detalhes(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    mes: Optional[int] = Query(None),
    regional: Optional[str] = Query(None),
    vendedor: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    apenas_carteira: Optional[bool] = Query(False),
    limit: int = Query(2000, le=10000),
):
    """Detalhes dos pedidos por EMISSAO (data do pedido)."""
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        em = cols.get("emissao")
        if not em:
            raise HTTPException(status_code=503, detail="Coluna emissao nao encontrada.")
        rg = cols["regional"]; fv = cols["fantasia_vendedor"]; sg = cols["descricao_segmento"]
        st = cols["status"]

        where = [f'"{em}" IS NOT NULL']
        params: List[Any] = []
        if ano:
            where.append(f'EXTRACT(YEAR FROM "{em}") = %s'); params.append(int(ano))
        if mes:
            where.append(f'EXTRACT(MONTH FROM "{em}") = %s'); params.append(int(mes))
        if regional:
            where.append(f'"{rg}" = %s'); params.append(regional)
        if vendedor:
            where.append(f'"{fv}" = %s'); params.append(vendedor)
        if segmento:
            where.append(f'"{sg}" = %s'); params.append(segmento)
        if apenas_carteira:
            where.append(f"BTRIM(SPLIT_PART(COALESCE(\"{st}\"::text, ''), '.', 1)) IN ('1','4','01','04')")

        def col(key: str, alias: str) -> str:
            c = cols.get(key)
            cur2 = conn.cursor()
            cur2.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s",
                (DB_SCHEMA, "faturamento", c),
            )
            exists = cur2.fetchone()
            cur2.close()
            return f'"{c}" AS {alias}' if exists else f'NULL AS {alias}'

        select_cols = [
            f'EXTRACT(YEAR FROM "{em}")::int AS ano',
            f'EXTRACT(MONTH FROM "{em}")::int AS mes',
            f'"{em}" AS emissao',
            f'"{rg}" AS regional',
            f'"{fv}" AS vendedor',
            col("pedido", "pedido"),
            col("status", "status_pedido"),
            col("codigo_produto", "codigo_produto"),
            col("cod_origem", "cod_origem"),
            col("razao", "razao"),
            col("quantidade", "quantidade"),
            col("total_item", "total_item"),
            col("nota_fiscal", "nota_fiscal"),
            col("familia", "familia"),
            col("bu", "bu"),
            col("area_de_negocio", "area_de_negocio"),
            col("categorias", "categorias"),
            col("canal", "canal"),
            col("linha", "linha"),
        ]

        cur.execute(
            f'''SELECT {", ".join(select_cols)}
                FROM {TABLE}
                WHERE {" AND ".join(where)}
                ORDER BY ano, mes, regional, vendedor
                LIMIT %s''',
            params + [int(limit)],
        )
        rows = cur.fetchall()
        col_names = [d[0] for d in cur.description]
        result: List[Dict[str, Any]] = []
        for r in rows:
            d = dict(zip(col_names, r))
            for k in ("quantidade", "total_item"):
                if d.get(k) is not None:
                    try: d[k] = round(float(d[k]), 2)
                    except Exception: pass
            if d.get("emissao"):
                try: d["emissao"] = d["emissao"].isoformat()
                except Exception: pass
            result.append(d)
        return {"total": len(result), "limite": int(limit), "rows": result}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[METAS] pedidos_detalhes ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.get("/serie-mensal")
def get_serie_mensal(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    ano: Optional[int] = Query(None),
    vendedor: Optional[str] = Query(None),
    regional: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
):
    """Série mensal Jan/Fev/Mar comparando ano atual vs anterior."""
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            raise _data_unavailable()
        cols = _resolve_columns(cur)
        DEV = _dev_sql(cols)
        ef = cols["emissao_faturamento"]; vlr = cols["vlr_financeiro"]
        fv = cols["fantasia_vendedor"]; rg = cols["regional"]; sg = cols["descricao_segmento"]

        ano_atual = int(ano) if ano else None
        if not ano_atual:
            cur.execute(f'SELECT MAX(EXTRACT(YEAR FROM "{ef}"))::int FROM {TABLE} WHERE "{ef}" IS NOT NULL')
            r = cur.fetchone()
            ano_atual = int(r[0]) if r and r[0] else 2026
        ano_anterior = ano_atual - 1

        extra_where = []
        extra_params: List[Any] = []
        if vendedor:
            extra_where.append(f'"{fv}" = %s'); extra_params.append(vendedor)
        if regional:
            extra_where.append(f'"{rg}" = %s'); extra_params.append(regional)
        if segmento:
            extra_where.append(f'"{sg}" = %s'); extra_params.append(segmento)
        extra_sql = (" AND " + " AND ".join(extra_where)) if extra_where else ""

        cur.execute(
            f'''SELECT EXTRACT(YEAR FROM "{ef}")::int AS ano,
                       EXTRACT(MONTH FROM "{ef}")::int AS mes,
                       COALESCE(SUM(CASE WHEN NOT {DEV} THEN "{vlr}" ELSE 0 END), 0) AS faturamento
                FROM {TABLE}
                WHERE "{ef}" IS NOT NULL
                  AND EXTRACT(YEAR FROM "{ef}") IN (%s, %s)
                  {extra_sql}
                GROUP BY ano, mes''',
            [ano_atual, ano_anterior] + extra_params,
        )
        agg: Dict[tuple, float] = {}
        for a, m, v in cur.fetchall():
            agg[(int(a), int(m))] = float(v or 0)

        nomes = {1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
                 7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez"}
        return [
            {"mes": nomes[m], "atual": round(agg.get((ano_atual, m), 0.0), 2), "anterior": round(agg.get((ano_anterior, m), 0.0), 2)}
            for m in range(1, 13)
        ]
    except Exception as e:
        import traceback
        print(f"[METAS] get_serie_mensal ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        cur.close()
        conn.close()


@router.post("/refresh")
def refresh(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """
    No-op: dados são atualizados externamente pelo script (gerar_metas_faturamento.py).
    Mantido pra compat com o frontend; apenas retorna status atual.
    """
    _ensure_permission(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if not _table_exists(cur):
            return {"status": "no_data", "message": "Tabela ainda não existe. Rode o script externo."}
        cols = _resolve_columns(cur)
        da = cols["data_atualizacao"]
        cur.execute(f'SELECT MAX("{da}"), COUNT(*) FROM {TABLE}')
        last, total = cur.fetchone()
        return {
            "status": "ok",
            "message": f"Tabela com {total} linhas (atualização externa).",
            "last_refresh_at": last.isoformat() if last else None,
        }
    finally:
        cur.close()
        conn.close()
