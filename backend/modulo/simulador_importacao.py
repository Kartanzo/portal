"""
Simulador de Importação — calcula custo final BRL a partir do preço em RMB (Yuan).

Fórmula:
    RMB / divisor_rmb_usd     = USD          (divisor padrão = 7, editável)
    USD * cotacao_usd_brl     = BRL          (cotação editável; padrão = última fetch)
    BRL * multiplicador_final = Custo final  (multiplicador = 1.45, fixo)

Endpoints:
    GET  /simulador-importacao/cambio              — última cotação salva (auto-refresh após 08:00)
    POST /simulador-importacao/cambio/atualizar    — força fetch agora na AwesomeAPI
    GET  /simulador-importacao/itens               — lista itens do catálogo MOQ (codigo, descricao, preco_rmb)

Permissões: module_id = 'simulador_importacao'

--- RELATÓRIO DUMMY (rodar SEM fontes externas) ---
(a) Externas substituídas: requests.get a AwesomeAPI (USD-BRL,USD-CNY), Frankfurter
    (api.frankfurter.app) e open.er-api.com. Os 3 fetchers e _fetch_cotacao_cascata
    agora retornam valores dummy determinísticos via _dummy_cotacao() (core.dummy.rng).
    Nenhum BigQuery/gspread/Drive presente neste módulo. Postgres (simulador_cambio,
    simulador_simulacoes, importacao_v2_moq) mantido intacto. requests permanece
    importado (no-op) para não alterar imports/assinaturas.
(b) Shape preservado: _fetch_cotacao_cascata -> (brl: float, cny: float|None, src: str);
    endpoints /cambio e /cambio/atualizar continuam salvando via _save_rate e retornando
    {id, rate, fetched_at, source, [yuan_usd], [auto_refreshed], [is_fallback], ...}.
    Frontend (Comex/SimuladorImportacao.tsx) consome data.rate e data.yuan_usd — inalterado.
(c) Teste real (cd backend && /c/Python312/python ..., get_db_connection mockado p/ lançar
    erro se chamado): _dummy_cotacao() determinístico (5.1036, 7.0225) em 2 chamadas;
    cascata -> brl=5.1036 cny=7.0225 source='awesomeapi'; série 12 meses 2026 com variação
    por mês (USD-BRL ~5.07-5.18, USD-CNY ~7.00-7.09); 12/12 meses cobertos; sem DB no fetch.
(d) Não confirmados: o campo cny representa USD->CNY (Yuan por USD, ~7), usado como sugestão
    de divisor_rmb_usd no frontend — por isso NÃO usei CNY≈0.70 (que seria BRL/CNY) para não
    quebrar a semântica do divisor existente.
"""
from __future__ import annotations

from datetime import datetime, time
from typing import Optional, List

import requests  # mantido: assinaturas/no-op dummy preservam imports originais
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_utils import get_user_id_from_session
from db_utils import get_db_connection
from permission_utils import check_module_permission
from core import dummy


router = APIRouter(prefix="/simulador-importacao", tags=["Simulador Importacao"])
MODULE_ID = "simulador_importacao"

AWESOME_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL,USD-CNY"
FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=BRL,CNY"
OPEN_ER_URL = "https://open.er-api.com/v6/latest/USD"


def ensure_simulador_cambio_table():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simulador_cambio (
                id          SERIAL PRIMARY KEY,
                par         VARCHAR(10) NOT NULL DEFAULT 'USD-BRL',
                rate        NUMERIC(12,4) NOT NULL,
                fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                source      VARCHAR(40) NOT NULL DEFAULT 'awesomeapi'
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_simulador_cambio_fetched ON simulador_cambio(fetched_at DESC)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simulador_simulacoes (
                id              SERIAL PRIMARY KEY,
                user_id         VARCHAR(64) NOT NULL,
                nome            VARCHAR(160) NOT NULL,
                descricao       TEXT,
                cotacao_usd_brl NUMERIC(12,4) NOT NULL,
                divisor_rmb_usd NUMERIC(8,4) NOT NULL,
                multiplicador   NUMERIC(8,4) NOT NULL,
                itens           JSONB NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_simulador_simulacoes_user ON simulador_simulacoes(user_id, created_at DESC)")
        conn.commit()
        print("[simulador_importacao] ensure_simulador_cambio_table OK")
    except Exception as e:
        conn.rollback()
        print(f"[simulador_importacao] ensure_table ERROR: {type(e).__name__}: {e}")
        raise
    finally:
        cur.close(); conn.close()


DEFAULT_FALLBACK_RATE = 5.20  # cotação padrão se TODAS as APIs falharem


def _dummy_cotacao() -> tuple[float, float | None]:
    """Cotação dummy determinística (USD->BRL, USD->CNY) — sem fontes externas.

    Varia levemente por dia/mês de ANO_BASE (2026), mantendo USD~5.10 BRL e
    CNY~7.05 por USD (divisor RMB/USD usado pelo simulador).
    """
    hoje = datetime.now()
    r = dummy.rng("simulador_cambio", hoje.year, hoje.month, hoje.day)
    brl = round(5.10 + r.uniform(-0.10, 0.10), 4)   # USD->BRL ~5.10
    cny = round(7.05 + r.uniform(-0.05, 0.05), 4)   # USD->CNY ~7.05 (Yuan por USD)
    return brl, cny


def _fetch_awesomeapi() -> tuple[float, float | None]:
    # Dummy: sem HTTP externo. Mantém assinatura/retorno (USD->BRL, USD->CNY).
    return _dummy_cotacao()


def _fetch_frankfurter() -> tuple[float, float | None]:
    """Frankfurter (api.frankfurter.app) — Banco Central Europeu, sem chave."""
    # Dummy: sem HTTP externo. Mantém assinatura/retorno (USD->BRL, USD->CNY).
    return _dummy_cotacao()


def _fetch_open_er() -> tuple[float, float | None]:
    """Open Exchange Rates API (open.er-api.com) — sem chave."""
    # Dummy: sem HTTP externo. Mantém assinatura/retorno (USD->BRL, USD->CNY).
    return _dummy_cotacao()


def _fetch_cotacao_cascata() -> tuple[float, float | None, str]:
    """Tenta as APIs em cascata. Retorna (rate_brl, rate_cny_or_None, fonte)."""
    # Dummy: a "cascata" sempre resolve na primeira fonte com valores determinísticos.
    errors = []
    for fn, src in (
        (_fetch_awesomeapi, "awesomeapi"),
        (_fetch_frankfurter, "frankfurter"),
        (_fetch_open_er, "openerapi"),
    ):
        try:
            brl, cny = fn()
            return brl, cny, src
        except Exception as e:
            errors.append(f"{src}: {type(e).__name__}: {e}")
    raise RuntimeError("Todas as APIs de cotação falharam: " + " | ".join(errors))


def _save_rate(rate: float, source: str = "awesomeapi") -> dict:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO simulador_cambio (par, rate, source) VALUES ('USD-BRL', %s, %s) RETURNING id, rate, fetched_at, source",
            (rate, source),
        )
        row = cur.fetchone()
        conn.commit()
        return {"id": row[0], "rate": float(row[1]), "fetched_at": row[2].isoformat(), "source": row[3]}
    finally:
        cur.close(); conn.close()


def _get_last_rate() -> Optional[dict]:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, rate, fetched_at, source FROM simulador_cambio ORDER BY fetched_at DESC LIMIT 1")
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "rate": float(row[1]), "fetched_at": row[2].isoformat(), "source": row[3], "raw_dt": row[2]}
    finally:
        cur.close(); conn.close()


def _is_stale(fetched_at: datetime) -> bool:
    """Considera stale se o último fetch foi antes das 08:00 de hoje e já passou das 08:00."""
    try:
        tz = fetched_at.tzinfo
        now = datetime.now(tz) if tz else datetime.now()
        today_8h = datetime.combine(now.date(), time(8, 0))
        if tz:
            today_8h = today_8h.replace(tzinfo=tz)
        # Garante comparação consistente (ambos naive ou ambos aware)
        fa = fetched_at if (fetched_at.tzinfo is None) == (today_8h.tzinfo is None) else fetched_at.replace(tzinfo=None)
        n = now if (now.tzinfo is None) == (today_8h.tzinfo is None) else now.replace(tzinfo=None)
        return n >= today_8h and fa < today_8h
    except Exception:
        return False


def seed_dummy_simulador(admin_id: str) -> dict:
    """Insere 1+ cotações dummy (USD-BRL ~5.10) na tabela simulador_cambio.

    Idempotente: só insere se a tabela estiver vazia (nenhuma cotação salva).
    Usa _dummy_cotacao() para o valor e _save_rate() para persistir, mantendo
    o mesmo shape/fonte dos endpoints. admin_id é aceito por consistência de
    assinatura com os demais seeds (a tabela não tem coluna de usuário).
    """
    ensure_simulador_cambio_table()
    last = _get_last_rate()
    if last is not None:
        return {"status": "skipped", "reason": "já existe cotação", "inserted": 0}
    try:
        brl, _cny = _dummy_cotacao()
        saved = _save_rate(brl, source="seed_dummy")
        return {"status": "ok", "inserted": 1, "rate": saved["rate"], "id": saved["id"]}
    except Exception as e:
        print(f"seed_dummy_simulador error: {e}")
        return {"status": "error", "error": str(e)}


@router.get("/cambio")
def get_cambio(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    ensure_simulador_cambio_table()
    last = _get_last_rate()
    # Auto-refresh diário às 08:00
    if last is None or _is_stale(last["raw_dt"]):
        try:
            rate, yuan_usd, src = _fetch_cotacao_cascata()
            saved = _save_rate(rate, source=src)
            saved["auto_refreshed"] = True
            saved["yuan_usd"] = yuan_usd
            return saved
        except Exception as e:
            if last:
                last.pop("raw_dt", None)
                last["auto_refresh_error"] = str(e)
                return last
            saved = _save_rate(DEFAULT_FALLBACK_RATE, source="fallback")
            saved["fetch_error"] = str(e)
            saved["is_fallback"] = True
            return saved
    last.pop("raw_dt", None)
    return last


@router.post("/cambio/atualizar")
def atualizar_cambio(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    ensure_simulador_cambio_table()
    try:
        rate, yuan_usd, src = _fetch_cotacao_cascata()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao buscar cotação em todas as APIs: {e}")
    saved = _save_rate(rate, source=src)
    saved["yuan_usd"] = yuan_usd
    return saved


class SimuladorItem(BaseModel):
    codigo: str
    descricao: str
    preco_rmb: float
    moq: float
    unit: str


class SimulacaoItem(BaseModel):
    codigo: str
    descricao: str
    preco_rmb: float
    quantidade: float


class SimulacaoCreate(BaseModel):
    nome: str
    descricao: Optional[str] = None
    cotacao_usd_brl: float
    divisor_rmb_usd: float
    multiplicador: float
    itens: List[SimulacaoItem]


@router.get("/simulacoes")
def listar_simulacoes(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, nome, descricao, cotacao_usd_brl, divisor_rmb_usd, multiplicador,
                   jsonb_array_length(itens) AS qtd_itens, created_at
              FROM simulador_simulacoes
             WHERE user_id = %s
             ORDER BY created_at DESC
        """, (user_id or "",))
        rows = cur.fetchall()
        return [{
            "id": r[0], "nome": r[1], "descricao": r[2],
            "cotacao_usd_brl": float(r[3]), "divisor_rmb_usd": float(r[4]),
            "multiplicador": float(r[5]), "qtd_itens": r[6],
            "created_at": r[7].isoformat(),
        } for r in rows]
    finally:
        cur.close(); conn.close()


@router.get("/simulacoes/{sim_id}")
def carregar_simulacao(sim_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, nome, descricao, cotacao_usd_brl, divisor_rmb_usd, multiplicador, itens, created_at
              FROM simulador_simulacoes
             WHERE id = %s AND user_id = %s
        """, (sim_id, user_id or ""))
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Simulação não encontrada.")
        return {
            "id": r[0], "nome": r[1], "descricao": r[2],
            "cotacao_usd_brl": float(r[3]), "divisor_rmb_usd": float(r[4]),
            "multiplicador": float(r[5]), "itens": r[6],
            "created_at": r[7].isoformat(),
        }
    finally:
        cur.close(); conn.close()


@router.post("/simulacoes")
def salvar_simulacao(body: SimulacaoCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    if not body.nome.strip():
        raise HTTPException(status_code=400, detail="Nome obrigatório.")
    if not body.itens:
        raise HTTPException(status_code=400, detail="Adicione ao menos um item.")
    import json as _json
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO simulador_simulacoes
                (user_id, nome, descricao, cotacao_usd_brl, divisor_rmb_usd, multiplicador, itens)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id, created_at
        """, (
            user_id or "", body.nome.strip(), (body.descricao or "").strip() or None,
            body.cotacao_usd_brl, body.divisor_rmb_usd, body.multiplicador,
            _json.dumps([it.model_dump() for it in body.itens]),
        ))
        row = cur.fetchone()
        conn.commit()
        return {"id": row[0], "created_at": row[1].isoformat()}
    finally:
        cur.close(); conn.close()


@router.delete("/simulacoes/{sim_id}")
def excluir_simulacao(sim_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM simulador_simulacoes WHERE id = %s AND user_id = %s", (sim_id, user_id or ""))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Simulação não encontrada.")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close(); conn.close()


@router.get("/itens", response_model=List[SimuladorItem])
def listar_itens(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or "", MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT codigo,
                   COALESCE(name_cn, english_description, descricao, codigo) AS descricao,
                   COALESCE(price, 0)   AS preco_rmb,
                   COALESCE(moq, 0)     AS moq,
                   COALESCE(unit, '')   AS unit
              FROM importacao_v2_moq
             WHERE COALESCE(price, 0) > 0
             ORDER BY codigo
        """)
        rows = cur.fetchall()
        return [
            {"codigo": r[0], "descricao": r[1] or r[0], "preco_rmb": float(r[2]), "moq": float(r[3]), "unit": r[4]}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()
