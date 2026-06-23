"""Auditoria genérica do módulo RH/DP.

Registra criação, edição, aprovação, rejeição, remoção de qualquer entidade.
Quem incluiu, quem editou, quem aprovou, etc — com data/hora.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, Any
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/rh/audit", tags=["rh-audit"])
logger = logging.getLogger(__name__)


def ensure_table():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_audit_log (
            id SERIAL PRIMARY KEY,
            entidade TEXT NOT NULL,
            entidade_id TEXT NOT NULL,
            acao TEXT NOT NULL,
            user_id TEXT,
            user_nome TEXT,
            detalhes JSONB DEFAULT '{}'::jsonb,
            data TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_audit_entidade ON rh_audit_log(entidade, entidade_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_audit_data ON rh_audit_log(data DESC)")
    conn.commit()
    cur.close()
    conn.close()


def audit(entidade: str, entidade_id: Any, acao: str, user_id: Optional[str], detalhes: Optional[dict] = None):
    """Registra um evento de auditoria. NUNCA levanta exceção — log apenas."""
    try:
        ensure_table()
        conn = get_db_connection()
        cur = conn.cursor()
        # Resolve nome do user pra preservar mesmo se ele for deletado depois
        nome = None
        if user_id:
            try:
                cur.execute("SELECT name FROM users WHERE id = %s", (str(user_id),))
                r = cur.fetchone()
                if r: nome = r[0]
            except Exception:
                pass
        cur.execute(
            """INSERT INTO rh_audit_log (entidade, entidade_id, acao, user_id, user_nome, detalhes)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)""",
            (entidade, str(entidade_id), acao, str(user_id) if user_id else None, nome, json.dumps(detalhes or {})),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.warning(f"[AUDIT] Falha ao registrar {entidade}#{entidade_id} {acao}: {e}")


@router.get("/{entidade}/{eid}")
def listar(entidade: str, eid: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista o histórico de auditoria de uma entidade específica."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    # Permissão: qualquer permissão de RH dá direito a ver auditoria.
    # (alternativa mais restrita: exigir módulo correspondente)
    if not any(check_module_permission(user_id, m, "can_view") for m in [
        "rh_dashboard", "rh_colaboradores", "rh_recrutamento", "rh_documentos",
        "rh_jornada", "rh_movimentacoes", "rh_aprovacoes", "rh_equipamentos", "rh_config",
    ]):
        raise HTTPException(status_code=403, detail="Sem permissão")
    ensure_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, acao, user_id, user_nome, detalhes, data
             FROM rh_audit_log
            WHERE entidade = %s AND entidade_id = %s
            ORDER BY data DESC""",
        (entidade, eid),
    )
    rows = []
    for r in cur.fetchall():
        det = r[4]
        if isinstance(det, str):
            try: det = json.loads(det)
            except: det = {}
        rows.append({
            "id": r[0], "acao": r[1],
            "user_id": r[2], "user_nome": r[3],
            "detalhes": det or {},
            "data": r[5].isoformat() if r[5] else None,
        })
    cur.close()
    conn.close()
    return {"historico": rows}
