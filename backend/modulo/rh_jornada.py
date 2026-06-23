"""Módulo RH/DP — Jornada (Banco de Horas + Férias)."""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from modulo.rh_audit import audit

router = APIRouter(prefix="/rh/jornada", tags=["rh-jornada"])
logger = logging.getLogger(__name__)


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_banco_horas (
            id SERIAL PRIMARY KEY,
            colaborador_id INTEGER NOT NULL REFERENCES rh_colaboradores(id) ON DELETE CASCADE,
            data DATE NOT NULL,
            horas NUMERIC(5,2) NOT NULL,
            tipo TEXT NOT NULL,
            motivo TEXT,
            solicitante_id INTEGER,
            status TEXT DEFAULT 'pendente',
            aprovado_por INTEGER,
            aprovado_em TIMESTAMP,
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_ferias (
            id SERIAL PRIMARY KEY,
            colaborador_id INTEGER NOT NULL REFERENCES rh_colaboradores(id) ON DELETE CASCADE,
            data_inicio DATE NOT NULL,
            data_fim DATE NOT NULL,
            dias INTEGER,
            periodo_aquisitivo_inicio DATE,
            periodo_aquisitivo_fim DATE,
            status TEXT DEFAULT 'pendente',
            abono_pecuniario BOOLEAN DEFAULT FALSE,
            abono_dias INTEGER,
            adiantamento_13 BOOLEAN DEFAULT FALSE,
            observacoes TEXT,
            aprovado_por INTEGER,
            aprovado_em TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_bh_colab ON rh_banco_horas(colaborador_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_bh_data ON rh_banco_horas(data)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_bh_status ON rh_banco_horas(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_ferias_colab ON rh_ferias(colaborador_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_ferias_status ON rh_ferias(status)")
    conn.commit()
    # users.id e' UUID — converte colunas INTEGER que guardam user_id para TEXT
    for ddl in [
        "ALTER TABLE rh_banco_horas ALTER COLUMN solicitante_id TYPE TEXT USING solicitante_id::TEXT",
        "ALTER TABLE rh_banco_horas ALTER COLUMN aprovado_por TYPE TEXT USING aprovado_por::TEXT",
        "ALTER TABLE rh_banco_horas ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_banco_horas ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
        "ALTER TABLE rh_ferias ALTER COLUMN aprovado_por TYPE TEXT USING aprovado_por::TEXT",
        "ALTER TABLE rh_ferias ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_ferias ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
    ]:
        try:
            cur.execute(ddl); conn.commit()
        except Exception as e:
            conn.rollback(); logger.warning(f"ALTER falhou: {e}")
    cur.close()
    conn.close()


class BHIn(BaseModel):
    colaborador_id: int
    data: date
    horas: float
    tipo: str  # 'extra' | 'bh+' | 'bh-'
    motivo: Optional[str] = None
    solicitante_id: Optional[int] = None
    status: Optional[str] = 'pendente'
    observacoes: Optional[str] = None


class FeriasIn(BaseModel):
    colaborador_id: int
    data_inicio: date
    data_fim: date
    dias: Optional[int] = None
    periodo_aquisitivo_inicio: Optional[date] = None
    periodo_aquisitivo_fim: Optional[date] = None
    status: Optional[str] = 'pendente'
    abono_pecuniario: Optional[bool] = False
    abono_dias: Optional[int] = None
    adiantamento_13: Optional[bool] = False
    observacoes: Optional[str] = None


BH_COLS = ['id', 'colaborador_id', 'data', 'horas', 'tipo', 'motivo', 'solicitante_id', 'status', 'aprovado_por', 'aprovado_em', 'observacoes', 'created_at', 'updated_at']
FER_COLS = ['id', 'colaborador_id', 'data_inicio', 'data_fim', 'dias', 'periodo_aquisitivo_inicio', 'periodo_aquisitivo_fim', 'status', 'abono_pecuniario', 'abono_dias', 'adiantamento_13', 'observacoes', 'aprovado_por', 'aprovado_em', 'created_at', 'updated_at']


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        elif hasattr(v, '__float__') and not isinstance(v, (int, bool)):
            d[k] = float(v)
        else:
            d[k] = v
    return d


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_jornada", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Jornada")
    return user_id


# ====== BANCO DE HORAS ======

@router.get("/banco-horas")
def listar_bh(
    colaborador_id: Optional[int] = Query(None),
    mes: Optional[str] = Query(None, description="YYYY-MM"),
    status: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if colaborador_id:
        where.append("bh.colaborador_id = %s"); params.append(colaborador_id)
    if mes:
        where.append("TO_CHAR(bh.data, 'YYYY-MM') = %s"); params.append(mes)
    if status:
        where.append("bh.status = %s"); params.append(status)
    if tipo:
        where.append("bh.tipo = %s"); params.append(tipo)
    sql = f"""
        SELECT bh.{', bh.'.join(BH_COLS)}, c.nome AS colaborador_nome, c.setor AS colaborador_setor
          FROM rh_banco_horas bh
          LEFT JOIN rh_colaboradores c ON c.id = bh.colaborador_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY bh.data DESC, bh.id DESC"
    cur.execute(sql, params)
    out = []
    for r in cur.fetchall():
        d = _row(r[:len(BH_COLS)], BH_COLS)
        d['colaborador_nome'] = r[-2]
        d['colaborador_setor'] = r[-1]
        out.append(d)
    cur.close()
    conn.close()
    return {"itens": out, "total": len(out)}


@router.post("/banco-horas")
def criar_bh(payload: BHIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if not data.get('solicitante_id'):
        data['solicitante_id'] = uid
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_banco_horas ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/banco-horas/{bid}")
def atualizar_bh(bid: int, payload: BHIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_banco_horas SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, bid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.post("/banco-horas/{bid}/aprovar")
def aprovar_bh(bid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_banco_horas SET status='aprovado', aprovado_por=%s, aprovado_em=NOW(), updated_at=NOW() WHERE id=%s",
        (uid, bid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    audit('banco_horas', bid, 'aprovou', uid)
    return {"ok": True}


@router.post("/banco-horas/{bid}/rejeitar")
def rejeitar_bh(bid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_banco_horas SET status='rejeitado', aprovado_por=%s, aprovado_em=NOW(), updated_at=NOW() WHERE id=%s",
        (uid, bid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    audit('banco_horas', bid, 'rejeitou', uid)
    return {"ok": True}


@router.delete("/banco-horas/{bid}")
def remover_bh(bid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_banco_horas WHERE id = %s", (bid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


# ====== FÉRIAS ======

@router.get("/ferias")
def listar_ferias(
    colaborador_id: Optional[int] = Query(None),
    ano: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if colaborador_id:
        where.append("f.colaborador_id = %s"); params.append(colaborador_id)
    if ano:
        where.append("EXTRACT(YEAR FROM f.data_inicio) = %s"); params.append(ano)
    if status:
        where.append("f.status = %s"); params.append(status)
    sql = f"""
        SELECT f.{', f.'.join(FER_COLS)}, c.nome AS colaborador_nome, c.setor AS colaborador_setor
          FROM rh_ferias f
          LEFT JOIN rh_colaboradores c ON c.id = f.colaborador_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY f.data_inicio DESC"
    cur.execute(sql, params)
    out = []
    for r in cur.fetchall():
        d = _row(r[:len(FER_COLS)], FER_COLS)
        d['colaborador_nome'] = r[-2]
        d['colaborador_setor'] = r[-1]
        out.append(d)
    cur.close()
    conn.close()
    return {"ferias": out, "total": len(out)}


@router.post("/ferias")
def criar_ferias(payload: FeriasIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if not data.get('dias') and data.get('data_inicio') and data.get('data_fim'):
        data['dias'] = (data['data_fim'] - data['data_inicio']).days + 1
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_ferias ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/ferias/{fid}")
def atualizar_ferias(fid: int, payload: FeriasIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if not data.get('dias') and data.get('data_inicio') and data.get('data_fim'):
        data['dias'] = (data['data_fim'] - data['data_inicio']).days + 1
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_ferias SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, fid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Férias não encontradas")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.post("/ferias/{fid}/aprovar")
def aprovar_ferias(fid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_ferias SET status='aprovado', aprovado_por=%s, aprovado_em=NOW(), updated_at=NOW() WHERE id=%s",
        (uid, fid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    audit('ferias', fid, 'aprovou', uid)
    return {"ok": True}


@router.post("/ferias/{fid}/rejeitar")
def rejeitar_ferias(fid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_ferias SET status='rejeitado', aprovado_por=%s, aprovado_em=NOW(), updated_at=NOW() WHERE id=%s",
        (uid, fid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    audit('ferias', fid, 'rejeitou', uid)
    return {"ok": True}


@router.delete("/ferias/{fid}")
def remover_ferias(fid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_ferias WHERE id = %s", (fid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}
