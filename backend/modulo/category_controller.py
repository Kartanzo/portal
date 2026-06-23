from fastapi import APIRouter, HTTPException, Depends, Query, Header
from db_utils import get_db_connection
from permission_utils import check_module_permission
from pydantic import BaseModel
from typing import List, Optional
import uuid

router = APIRouter()

class CategoryCreate(BaseModel):
    sector: str
    name: str

class SubcategoryCreate(BaseModel):
    category_id: Optional[str] = None
    name: str

@router.get("/categories")
def get_categories(sector: Optional[str] = None):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if sector:
            cur.execute("SELECT id, sector, name, created_at FROM ticket_categories WHERE sector = %s ORDER BY name", (sector,))
        else:
            cur.execute("SELECT id, sector, name, created_at FROM ticket_categories ORDER BY sector, name")
        rows = cur.fetchall()
        return [{"id": str(r[0]), "sector": r[1], "name": r[2], "created_at": r[3]} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@router.post("/categories")
def create_category(cat: CategoryCreate, user_id: str = Header(..., alias="user-id")):
    if not check_module_permission(user_id, 'ticket_categories_management', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO ticket_categories (sector, name)
            VALUES (%s, %s)
            RETURNING id
        """, (cat.sector, cat.name))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": str(new_id), "message": "Categoria criada com sucesso"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@router.delete("/categories/{id}")
def delete_category(id: str, user_id: str = Header(..., alias="user-id")):
    if not check_module_permission(user_id, 'ticket_categories_management', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM ticket_categories WHERE id = %s", (id,))
        conn.commit()
        return {"message": "Categoria excluída com sucesso"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@router.get("/categories/{category_id}/subcategories")
def get_subcategories(category_id: str):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, category_id, name, created_at FROM ticket_subcategories WHERE category_id = %s ORDER BY name", (category_id,))
        rows = cur.fetchall()
        return [{"id": str(r[0]), "category_id": str(r[1]), "name": r[2], "created_at": r[3]} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@router.post("/categories/{category_id}/subcategories")
def create_subcategory(category_id: str, sub: SubcategoryCreate, user_id: str = Header(..., alias="user-id")):
    if not check_module_permission(user_id, 'ticket_categories_management', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Use category_id from path if needed, but sub.category_id is also there
        curr_cat_id = category_id or getattr(sub, 'category_id', None)
        cur.execute("""
            INSERT INTO ticket_subcategories (category_id, name)
            VALUES (%s, %s)
            RETURNING id
        """, (curr_cat_id, sub.name))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": str(new_id), "message": "Subcategoria criada com sucesso"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@router.delete("/subcategories/{id}")
def delete_subcategory(id: str, user_id: str = Header(..., alias="user-id")):
    if not check_module_permission(user_id, 'ticket_categories_management', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM ticket_subcategories WHERE id = %s", (id,))
        conn.commit()
        return {"message": "Subcategoria excluída com sucesso"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


