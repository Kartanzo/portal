"""Módulo RH/DP — Colaboradores.

Endpoints CRUD básicos para a tela /rh/colaboradores.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
import os
import re
import shutil
from core.config import UPLOAD_DIR
from typing import Optional, List
from pydantic import BaseModel
from datetime import date, datetime
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from modulo.rh_audit import audit

router = APIRouter(prefix="/rh/colaboradores", tags=["rh-colaboradores"])
logger = logging.getLogger(__name__)


def ensure_table():
    """Cria tabela rh_colaboradores se não existir + colunas faltantes."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_colaboradores (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            cpf TEXT,
            rg TEXT,
            data_nascimento DATE,
            foto_url TEXT,
            email TEXT,
            telefone TEXT,
            endereco TEXT,
            matricula TEXT,
            cargo TEXT,
            setor TEXT,
            salario NUMERIC(12,2),
            jornada TEXT,
            tipo TEXT,
            ctps TEXT,
            data_admissao DATE,
            data_demissao DATE,
            status TEXT DEFAULT 'ativo',
            banco_nome TEXT,
            banco_agencia TEXT,
            banco_conta TEXT,
            observacoes TEXT,
            gestor_id INTEGER REFERENCES rh_colaboradores(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    # ALTER IF NOT EXISTS — auto-heal em ambientes que já têm a tabela
    for col, ddl in [
        ("foto_url", "ALTER TABLE rh_colaboradores ADD COLUMN IF NOT EXISTS foto_url TEXT"),
        ("observacoes", "ALTER TABLE rh_colaboradores ADD COLUMN IF NOT EXISTS observacoes TEXT"),
        ("gestor_id", "ALTER TABLE rh_colaboradores ADD COLUMN IF NOT EXISTS gestor_id INTEGER"),
        # created_by/updated_by precisam aceitar UUID (users.id é UUID)
        ("created_by_text", "ALTER TABLE rh_colaboradores ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT"),
        ("updated_by_text", "ALTER TABLE rh_colaboradores ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT"),
        # Acessos extras gerenciados independente da admissão
        ("acessos_extras", "ALTER TABLE rh_colaboradores ADD COLUMN IF NOT EXISTS acessos_extras JSONB DEFAULT '{}'::jsonb"),
    ]:
        try:
            cur.execute(ddl)
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.warning(f"ALTER {col} falhou: {e}")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_colaboradores_status ON rh_colaboradores(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_colaboradores_setor ON rh_colaboradores(setor)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_colaboradores_cpf ON rh_colaboradores(cpf)")
    conn.commit()
    cur.close()
    conn.close()


class ColaboradorIn(BaseModel):
    nome: str
    cpf: Optional[str] = None
    rg: Optional[str] = None
    data_nascimento: Optional[date] = None
    foto_url: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    matricula: Optional[str] = None
    cargo: Optional[str] = None
    setor: Optional[str] = None
    salario: Optional[float] = None
    jornada: Optional[str] = None
    tipo: Optional[str] = None  # CLT | PJ | Temporario | Estagiario
    ctps: Optional[str] = None
    data_admissao: Optional[date] = None
    data_demissao: Optional[date] = None
    status: Optional[str] = "ativo"  # ativo | afastado | demitido | experiencia
    banco_nome: Optional[str] = None
    banco_agencia: Optional[str] = None
    banco_conta: Optional[str] = None
    observacoes: Optional[str] = None
    gestor_id: Optional[int] = None


def _row_to_dict(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


COLS = [
    "id", "nome", "cpf", "rg", "data_nascimento", "foto_url", "email", "telefone",
    "endereco", "matricula", "cargo", "setor", "salario", "jornada", "tipo", "ctps",
    "data_admissao", "data_demissao", "status", "banco_nome", "banco_agencia",
    "banco_conta", "observacoes", "gestor_id", "created_at", "updated_at",
]


def _require_view(user_id: Optional[str]):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    if not check_module_permission(user_id, "rh_colaboradores", "can_view"):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Colaboradores")
    return user_id


def _require_edit(user_id: Optional[str]):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    if not check_module_permission(user_id, "rh_colaboradores", "can_edit"):
        raise HTTPException(status_code=403, detail="Sem permissão para editar RH · Colaboradores")
    return user_id


@router.get("")
def listar(
    search: Optional[str] = Query(None),
    setor: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _require_view(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    where = []
    params: list = []
    if search:
        where.append("(nome ILIKE %s OR cpf ILIKE %s OR email ILIKE %s OR matricula ILIKE %s)")
        like = f"%{search}%"
        params += [like, like, like, like]
    if setor:
        where.append("setor = %s")
        params.append(setor)
    if status:
        where.append("status = %s")
        params.append(status)
    if tipo:
        where.append("tipo = %s")
        params.append(tipo)
    sql = f"SELECT {', '.join(COLS)} FROM rh_colaboradores"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY nome"
    cur.execute(sql, params)
    rows = [_row_to_dict(r, COLS) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"colaboradores": rows, "total": len(rows)}


@router.get("/{cid}")
def obter(cid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(f"SELECT {', '.join(COLS)} FROM rh_colaboradores WHERE id = %s", (cid,))
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    return _row_to_dict(r, COLS)


@router.post("")
def criar(payload: ColaboradorIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _require_edit(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = [c for c in data.keys()]
    placeholders = ", ".join(["%s"] * (len(cols) + 2))
    sql = (
        f"INSERT INTO rh_colaboradores ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({placeholders}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    audit('colaborador', new_id, 'criou', uid, {'nome': data.get('nome')})
    return {"id": new_id, "ok": True}


@router.put("/{cid}")
def atualizar(cid: int, payload: ColaboradorIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _require_edit(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    sql = f"UPDATE rh_colaboradores SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s"
    cur.execute(sql, list(data.values()) + [uid, cid])
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    audit('colaborador', cid, 'editou', uid)
    return {"ok": True}


@router.delete("/{cid}")
def remover(cid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Soft delete: marca status='demitido' e data_demissao=hoje."""
    uid = _require_edit(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE rh_colaboradores
           SET status = 'demitido',
               data_demissao = COALESCE(data_demissao, CURRENT_DATE),
               updated_at = NOW(),
               updated_by = %s
         WHERE id = %s
        """,
        (uid, cid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.put("/{cid}/acessos")
def atualizar_acessos(cid: int, payload: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Atualiza o JSON de acessos_extras do colaborador (gerenciado independente da admissão)."""
    import json as _j
    uid = _require_edit(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_colaboradores SET acessos_extras = %s::jsonb, updated_at = NOW(), updated_by = %s WHERE id = %s",
        (_j.dumps(payload or {}), uid, cid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.get("/{cid}/acessos")
def obter_acessos(cid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    import json as _j
    _require_view(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT acessos_extras FROM rh_colaboradores WHERE id = %s", (cid,))
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    val = r[0]
    if isinstance(val, str):
        try: val = _j.loads(val)
        except: val = {}
    return val or {}


@router.post("/{cid}/foto")
def upload_foto(cid: int, arquivo: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Upload da foto do colaborador. Substitui foto anterior se houver."""
    uid = _require_edit(user_id)
    ensure_table()
    rh_dir = os.path.join(UPLOAD_DIR, "rh_fotos")
    os.makedirs(rh_dir, exist_ok=True)
    clean = re.sub(r'[^\w\-.]', '_', arquivo.filename or 'foto.jpg')
    safe = f"colab_{cid}_{int(datetime.now().timestamp())}_{clean}"
    full_path = os.path.join(rh_dir, safe)
    try:
        with open(full_path, 'wb') as buf:
            shutil.copyfileobj(arquivo.file, buf)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao salvar foto: {e}")
    url = f"/uploads/rh_fotos/{safe}"
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE rh_colaboradores SET foto_url = %s, updated_at = NOW(), updated_by = %s WHERE id = %s", (url, uid, cid))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "foto_url": url}


@router.get("/_meta/distinct")
def distincts(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Setores/cargos/tipos distintos pro frontend popular filtros e selects."""
    _require_view(user_id)
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    def _col(c):
        cur.execute(f"SELECT DISTINCT {c} FROM rh_colaboradores WHERE {c} IS NOT NULL AND {c} <> '' ORDER BY {c}")
        return [r[0] for r in cur.fetchall()]
    out = {"setores": _col("setor"), "cargos": _col("cargo"), "tipos": _col("tipo")}
    cur.close()
    conn.close()
    return out
