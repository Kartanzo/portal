from fastapi import APIRouter, HTTPException, Header, Body, Depends
from typing import Optional
from uuid import UUID
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter()
logger = logging.getLogger(__name__)

MODULE_ID = 'financeiro_dre2025'


@router.get("/dre2025/bases")
def list_dre2025_bases(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT b.id, b.name, b.created_at, u.name as created_by_name
            FROM dre2025_bases b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE b.is_active = TRUE
            ORDER BY b.created_at DESC
        """)
        rows = cur.fetchall()
        return [{"id": str(r[0]), "name": r[1], "created_at": r[2].isoformat() if r[2] else None, "created_by_name": r[3] or "—"} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/dre2025/bases")
def create_dre2025_base(
    data: dict = Body(...),
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    name = data.get('name', '')
    dre_data = data.get('dre_data', {})
    sheets_data = data.get('sheets_data', {})

    if not name or not dre_data:
        raise HTTPException(status_code=400, detail="Nome e dados DRE são obrigatórios.")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO dre2025_bases (name, dre_data, sheets_data, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
        """, (name.strip(), json.dumps(dre_data), json.dumps(sheets_data), user_id))
        row = cur.fetchone()
        conn.commit()
        return {"id": str(row[0]), "name": name, "created_at": row[1].isoformat()}
    except Exception as e:
        conn.rollback()
        logger.error(f"create_dre2025_base error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/dre2025/bases/{base_id}")
def get_dre2025_base(base_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, name, dre_data, sheets_data, created_at, COALESCE(observations, '{}')
            FROM dre2025_bases
            WHERE id = %s AND is_active = TRUE
        """, (str(base_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        return {
            "id": str(row[0]),
            "name": row[1],
            "dre_data": row[2],
            "sheets_data": row[3],
            "created_at": row[4].isoformat() if row[4] else None,
            "observations": row[5] if isinstance(row[5], dict) else {}
        }
    finally:
        cur.close()
        conn.close()


@router.delete("/dre2025/bases/{base_id}")
def delete_dre2025_base(base_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE dre2025_bases SET is_active = FALSE WHERE id = %s RETURNING id", (str(base_id),))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        conn.commit()
        return {"message": "Base removida."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.put("/dre2025/bases/{base_id}/observations")
def update_dre2025_observations(
    base_id: UUID,
    data: dict = Body(...),
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        obs = data.get('observations', {})
        cur.execute("UPDATE dre2025_bases SET observations = %s WHERE id = %s AND is_active = TRUE RETURNING id",
                    (json.dumps(obs), str(base_id)))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        conn.commit()
        return {"message": "Observações salvas."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()
