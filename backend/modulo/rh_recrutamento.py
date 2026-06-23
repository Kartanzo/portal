"""Módulo RH/DP — Recrutamento (Vagas + Candidatos)."""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/rh/recrutamento", tags=["rh-recrutamento"])
logger = logging.getLogger(__name__)


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_vagas (
            id SERIAL PRIMARY KEY,
            titulo TEXT NOT NULL,
            setor TEXT,
            tipo TEXT,
            n_posicoes INTEGER DEFAULT 1,
            gestor_id INTEGER,
            descricao TEXT,
            requisitos TEXT,
            salario_min NUMERIC(12,2),
            salario_max NUMERIC(12,2),
            jornada TEXT,
            local_trabalho TEXT,
            data_abertura DATE DEFAULT CURRENT_DATE,
            prazo DATE,
            data_fechamento DATE,
            status TEXT DEFAULT 'aberta',
            motivo_fechamento TEXT,
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
        CREATE TABLE IF NOT EXISTS rh_candidatos (
            id SERIAL PRIMARY KEY,
            vaga_id INTEGER NOT NULL REFERENCES rh_vagas(id) ON DELETE CASCADE,
            nome TEXT NOT NULL,
            cpf TEXT,
            email TEXT,
            telefone TEXT,
            cv_url TEXT,
            status TEXT DEFAULT 'triagem',
            observacoes TEXT,
            entrevista_data TIMESTAMP,
            parecer TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_vagas_status ON rh_vagas(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_candidatos_vaga ON rh_candidatos(vaga_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_candidatos_status ON rh_candidatos(status)")
    conn.commit()
    for ddl in [
        "ALTER TABLE rh_vagas ALTER COLUMN gestor_id TYPE TEXT USING gestor_id::TEXT",
        "ALTER TABLE rh_vagas ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_vagas ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
        "ALTER TABLE rh_candidatos ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_candidatos ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
    ]:
        try:
            cur.execute(ddl); conn.commit()
        except Exception as e:
            conn.rollback(); logger.warning(f"ALTER falhou: {e}")
    cur.close()
    conn.close()


class VagaIn(BaseModel):
    titulo: str
    setor: Optional[str] = None
    tipo: Optional[str] = None  # CLT | PJ | Temporario | Estagiario
    n_posicoes: Optional[int] = 1
    gestor_id: Optional[int] = None
    descricao: Optional[str] = None
    requisitos: Optional[str] = None
    salario_min: Optional[float] = None
    salario_max: Optional[float] = None
    jornada: Optional[str] = None
    local_trabalho: Optional[str] = None
    data_abertura: Optional[date] = None
    prazo: Optional[date] = None
    status: Optional[str] = 'aberta'
    observacoes: Optional[str] = None


class CandidatoIn(BaseModel):
    vaga_id: int
    nome: str
    cpf: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    cv_url: Optional[str] = None
    status: Optional[str] = 'triagem'
    observacoes: Optional[str] = None
    entrevista_data: Optional[datetime] = None
    parecer: Optional[str] = None


VAGA_COLS = [
    'id', 'titulo', 'setor', 'tipo', 'n_posicoes', 'gestor_id', 'descricao', 'requisitos',
    'salario_min', 'salario_max', 'jornada', 'local_trabalho', 'data_abertura', 'prazo',
    'data_fechamento', 'status', 'motivo_fechamento', 'observacoes', 'created_at', 'updated_at',
]
CAND_COLS = [
    'id', 'vaga_id', 'nome', 'cpf', 'email', 'telefone', 'cv_url', 'status', 'observacoes',
    'entrevista_data', 'parecer', 'created_at', 'updated_at',
]


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_recrutamento", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Recrutamento")
    return user_id


# ============ VAGAS ============

@router.get("/vagas")
def listar_vagas(
    search: Optional[str] = Query(None),
    setor: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if search:
        where.append("(titulo ILIKE %s OR setor ILIKE %s OR descricao ILIKE %s)")
        like = f"%{search}%"
        params += [like, like, like]
    if setor:
        where.append("setor = %s"); params.append(setor)
    if status:
        where.append("status = %s"); params.append(status)
    sql = f"SELECT {', '.join(VAGA_COLS)}, (SELECT COUNT(*) FROM rh_candidatos WHERE vaga_id = rh_vagas.id) AS n_candidatos FROM rh_vagas"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY data_abertura DESC, id DESC"
    cur.execute(sql, params)
    out = []
    for r in cur.fetchall():
        d = _row(r[:-1], VAGA_COLS)
        d['n_candidatos'] = r[-1]
        out.append(d)
    cur.close()
    conn.close()
    return {"vagas": out, "total": len(out)}


@router.get("/vagas/{vid}")
def obter_vaga(vid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(f"SELECT {', '.join(VAGA_COLS)} FROM rh_vagas WHERE id = %s", (vid,))
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="Vaga não encontrada")
    return _row(r, VAGA_COLS)


@router.post("/vagas")
def criar_vaga(payload: VagaIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = [c for c in data.keys()]
    sql = (
        f"INSERT INTO rh_vagas ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/vagas/{vid}")
def atualizar_vaga(vid: int, payload: VagaIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    sql = f"UPDATE rh_vagas SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s"
    cur.execute(sql, list(data.values()) + [uid, vid])
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Vaga não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.post("/vagas/{vid}/fechar")
def fechar_vaga(vid: int, motivo: Optional[str] = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """UPDATE rh_vagas SET status='fechada', data_fechamento=CURRENT_DATE,
                  motivo_fechamento=%s, updated_at=NOW(), updated_by=%s WHERE id=%s""",
        (motivo, uid, vid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Vaga não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/vagas/{vid}")
def remover_vaga(vid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_vagas WHERE id = %s", (vid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Vaga não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


# ============ CANDIDATOS ============

@router.get("/vagas/{vid}/candidatos")
def listar_candidatos(vid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        f"SELECT {', '.join(CAND_COLS)} FROM rh_candidatos WHERE vaga_id = %s ORDER BY created_at DESC",
        (vid,),
    )
    rows = [_row(r, CAND_COLS) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"candidatos": rows, "total": len(rows)}


@router.post("/candidatos")
def criar_candidato(payload: CandidatoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = [c for c in data.keys()]
    sql = (
        f"INSERT INTO rh_candidatos ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/candidatos/{cid}")
def atualizar_candidato(cid: int, payload: CandidatoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    sql = f"UPDATE rh_candidatos SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s"
    cur.execute(sql, list(data.values()) + [uid, cid])
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Candidato não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/candidatos/{cid}")
def remover_candidato(cid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_candidatos WHERE id = %s", (cid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Candidato não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}
