"""Módulo RH/DP — Configurações (Sindicatos + Parâmetros key-value)."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Any
from pydantic import BaseModel
from datetime import datetime
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/rh/config", tags=["rh-config"])
logger = logging.getLogger(__name__)


PARAMETROS_PADRAO = [
    ('jornada_padrao_horas', '44', 'Horas semanais padrão (44h)'),
    ('jornada_diaria_horas', '8.8', 'Horas diárias padrão'),
    ('prazo_aprovacao_bh_horas', '48', 'Prazo de aprovação BH/Extra (horas)'),
    ('prazo_aprovacao_saida_horas', '24', 'Prazo de aprovação F 102 — Saída (horas)'),
    ('experiencia_1_dias', '45', '1º período de experiência (dias)'),
    ('experiencia_2_dias', '90', '2º período de experiência (dias)'),
    ('ferias_aviso_min_dias', '30', 'Dias mínimos de aviso prévio de férias'),
]


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_sindicatos (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            cnpj TEXT,
            categoria TEXT,
            contato_email TEXT,
            contato_telefone TEXT,
            data_base TEXT,
            cct_url TEXT,
            ativo BOOLEAN DEFAULT TRUE,
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
        CREATE TABLE IF NOT EXISTS rh_parametros (
            chave TEXT PRIMARY KEY,
            valor TEXT,
            descricao TEXT,
            updated_at TIMESTAMP DEFAULT NOW(),
            updated_by INTEGER
        )
        """
    )
    for chave, valor, desc in PARAMETROS_PADRAO:
        cur.execute(
            "INSERT INTO rh_parametros (chave, valor, descricao) VALUES (%s, %s, %s) ON CONFLICT (chave) DO NOTHING",
            (chave, valor, desc),
        )
    conn.commit()
    for ddl in [
        "ALTER TABLE rh_sindicatos ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_sindicatos ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
        "ALTER TABLE rh_parametros ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
    ]:
        try:
            cur.execute(ddl); conn.commit()
        except Exception as e:
            conn.rollback(); logger.warning(f"ALTER falhou: {e}")
    cur.close()
    conn.close()


class SindicatoIn(BaseModel):
    nome: str
    cnpj: Optional[str] = None
    categoria: Optional[str] = None
    contato_email: Optional[str] = None
    contato_telefone: Optional[str] = None
    data_base: Optional[str] = None
    cct_url: Optional[str] = None
    ativo: Optional[bool] = True
    observacoes: Optional[str] = None


class ParametroIn(BaseModel):
    chave: str
    valor: Optional[str] = None
    descricao: Optional[str] = None


SIND_COLS = ['id', 'nome', 'cnpj', 'categoria', 'contato_email', 'contato_telefone', 'data_base', 'cct_url', 'ativo', 'observacoes', 'created_at', 'updated_at']


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_config", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Configurações")
    return user_id


# ====== SINDICATOS ======

@router.get("/sindicatos")
def listar_sindicatos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(f"SELECT {', '.join(SIND_COLS)} FROM rh_sindicatos ORDER BY ativo DESC, nome")
    rows = [_row(r, SIND_COLS) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"sindicatos": rows, "total": len(rows)}


@router.post("/sindicatos")
def criar_sindicato(payload: SindicatoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_sindicatos ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/sindicatos/{sid}")
def atualizar_sindicato(sid: int, payload: SindicatoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_sindicatos SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, sid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Sindicato não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/sindicatos/{sid}")
def remover_sindicato(sid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE rh_sindicatos SET ativo = FALSE, updated_at = NOW() WHERE id = %s", (sid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Sindicato não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


# ====== PARÂMETROS ======

@router.get("/parametros")
def listar_parametros(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT chave, valor, descricao FROM rh_parametros ORDER BY chave")
    rows = [{"chave": r[0], "valor": r[1], "descricao": r[2]} for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"parametros": rows}


@router.put("/parametros/{chave}")
def atualizar_parametro(chave: str, payload: ParametroIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO rh_parametros (chave, valor, descricao, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
           ON CONFLICT (chave) DO UPDATE SET
                valor = EXCLUDED.valor,
                descricao = COALESCE(EXCLUDED.descricao, rh_parametros.descricao),
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()""",
        (chave, payload.valor, payload.descricao, uid),
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}
