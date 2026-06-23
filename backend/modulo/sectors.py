from fastapi import APIRouter, HTTPException, Header, Depends
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel
import json

from db_utils import get_db_connection
from permission_utils import check_module_permission
from core.email import notify_user
import logging
from auth_utils import get_user_id_from_session

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/strategic-sectors")
def get_strategic_sectors():
    """
    Retorna os setores permitidos para módulos estratégicos (strategic_map, strategic_kanban)
    e os usuários desses setores, buscando diretamente da tabela role_permissions.
    Usado pelo frontend para montar os filtros de Setor, Participante, Aguardando Retorno e Criado Por.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Buscar allowed_sectors da role_permissions para módulos estratégicos
        # Prioridade: strategic_map > action_plans da role 'admin' (que tem os setores corretos configurados)
        cur.execute("SELECT permissions FROM role_permissions WHERE role = 'admin'")
        row = cur.fetchone()
        
        allowed_sectors = []
        if row:
            perms = row[0]
            if isinstance(perms, str):
                try:
                    perms = json.loads(perms)
                except:
                    perms = {}
            
            # Tentar strategic_map primeiro, depois action_plans
            strategic_perms = perms.get('strategic_map') or perms.get('action_plans') or {}
            allowed_sectors = strategic_perms.get('allowed_sectors', [])

        # 2. Buscar usuários que pertencem aos setores permitidos (excluindo role 'user')
        allowed_users = []
        if allowed_sectors:
            # Montar query com os setores permitidos
            sector_conditions = " OR ".join(["sector ILIKE %s" for _ in allowed_sectors])
            query = f"""
                SELECT id, name, sector, role
                FROM users
                WHERE is_active = TRUE
                AND role IN ('admin', 'super_user', 'ceo')
                AND ({sector_conditions})
                ORDER BY name
            """
            cur.execute(query, [s for s in allowed_sectors])
            rows = cur.fetchall()
            for r in rows:
                allowed_users.append({
                    "id": str(r[0]),
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })
        
        # 3. Sempre incluir super_users e ceos (independente de setor)
        cur.execute("""
            SELECT id, name, sector, role
            FROM users
            WHERE is_active = TRUE AND role IN ('super_user', 'ceo')
            ORDER BY name
        """)
        for r in cur.fetchall():
            user_id = str(r[0])
            if not any(u['id'] == user_id for u in allowed_users):
                allowed_users.append({
                    "id": user_id,
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })

        cur.close()
        conn.close()

        return {
            "allowed_sectors": sorted(allowed_sectors),
            "allowed_users": sorted(allowed_users, key=lambda u: u['name'])
        }

    except Exception as e:
        logger.error(f"Error in get_strategic_sectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/implementation-sectors")
def get_implementation_sectors(user_id: Optional[str] = None):
    """
    Retorna os setores permitidos para módulos de implementação (impl_kanban, impl_dashboard,
    impl_timeline, impl_action_plan) e os usuários desses setores, buscando da tabela role_permissions.
    Independente do /strategic-sectors — cada módulo tem sua própria configuração de setores.
    Quando user_id é fornecido, inclui também os setores gerenciados pelo usuário (sector + managed_sectors).
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Buscar allowed_sectors da role_permissions para módulos de implementação
        # Prioridade: impl_kanban > impl_dashboard > impl_action_plan da role 'admin'
        cur.execute("SELECT permissions FROM role_permissions WHERE role = 'admin'")
        row = cur.fetchone()

        allowed_sectors = []
        if row:
            perms = row[0]
            if isinstance(perms, str):
                try:
                    perms = json.loads(perms)
                except:
                    perms = {}

            # Tentar impl_kanban primeiro, depois impl_dashboard, depois impl_action_plan
            impl_perms = (
                perms.get('impl_kanban') or
                perms.get('impl_dashboard') or
                perms.get('impl_action_plan') or
                {}
            )
            allowed_sectors = impl_perms.get('allowed_sectors', [])

        # Se user_id fornecido, incluir os setores específicos do usuário (sector + managed_sectors)
        if user_id:
            cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s AND is_active = TRUE", (user_id,))
            user_row = cur.fetchone()
            if user_row:
                u_role, u_sector, u_managed = user_row
                user_sectors = []
                if u_sector:
                    user_sectors.append(u_sector)
                if u_managed:
                    user_sectors.extend([s.strip() for s in u_managed.split(';') if s.strip()])
                # Merge: adicionar setores do usuário que não estão na lista global
                existing_lower = [s.lower() for s in allowed_sectors]
                for s in user_sectors:
                    if s.lower() not in existing_lower:
                        allowed_sectors.append(s)
                        existing_lower.append(s.lower())

        # Buscar usuários que pertencem aos setores permitidos (excluindo role 'user')
        allowed_users = []
        if allowed_sectors:
            sector_conditions = " OR ".join(["sector ILIKE %s" for _ in allowed_sectors])
            query = f"""
                SELECT id, name, sector, role
                FROM users
                WHERE is_active = TRUE
                AND role IN ('admin', 'super_user', 'ceo')
                AND ({sector_conditions})
                ORDER BY name
            """
            cur.execute(query, [s for s in allowed_sectors])
            rows = cur.fetchall()
            for r in rows:
                allowed_users.append({
                    "id": str(r[0]),
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })

        # Sempre incluir super_users e ceos (independente de setor)
        cur.execute("""
            SELECT id, name, sector, role
            FROM users
            WHERE is_active = TRUE AND role IN ('super_user', 'ceo')
            ORDER BY name
        """)
        for r in cur.fetchall():
            user_id = str(r[0])
            if not any(u['id'] == user_id for u in allowed_users):
                allowed_users.append({
                    "id": user_id,
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })

        cur.close()
        conn.close()

        return {
            "allowed_sectors": sorted(allowed_sectors),
            "allowed_users": sorted(allowed_users, key=lambda u: u['name'])
        }

    except Exception as e:
        logger.error(f"Error in get_implementation_sectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inter-sector-sectors")
def get_inter_sector_sectors():
    """
    Retorna os setores e usuários permitidos para o módulo Chamados Entre Setores,
    lendo diretamente da tabela role_permissions.
    Usado pelo frontend para montar os filtros de Setor e Usuário.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Buscar allowed_sectors da role_permissions — unir setores de todos os roles
        allowed_sectors = []
        for role_name in ['user', 'admin']:
            cur.execute("SELECT permissions FROM role_permissions WHERE role = %s", (role_name,))
            row = cur.fetchone()
            if row:
                perms = row[0]
                if isinstance(perms, str):
                    try:
                        perms = json.loads(perms)
                    except:
                        perms = {}
                # Verificar cada módulo inter-setor na ordem de prioridade
                inter_perms = (
                    perms.get('inter_sector_tickets') or
                    perms.get('inter_sector_kanban') or
                    perms.get('inter_sector_schedule') or
                    {}
                )
                sectors = inter_perms.get('allowed_sectors', [])
                for s in sectors:
                    if s not in allowed_sectors:
                        allowed_sectors.append(s)

        # Filtrar apenas setores que têm categorias ativas cadastradas
        if allowed_sectors:
            placeholders = ", ".join(["%s"] * len(allowed_sectors))
            cur.execute(f"""
                SELECT DISTINCT sector FROM sector_ticket_categories
                WHERE is_active = TRUE AND sector IN ({placeholders})
            """, allowed_sectors)
            sectors_with_cats = [r[0] for r in cur.fetchall()]
            allowed_sectors = [s for s in allowed_sectors if s in sectors_with_cats]

        # Buscar todos os usuários ativos dos setores permitidos
        allowed_users = []
        if allowed_sectors:
            sector_conditions = " OR ".join(["u.sector ILIKE %s" for _ in allowed_sectors])
            query = f"""
                SELECT u.id, u.name, u.sector, u.role
                FROM users u
                WHERE u.is_active = TRUE
                AND ({sector_conditions})
                ORDER BY u.name
            """
            cur.execute(query, allowed_sectors)
            rows = cur.fetchall()
            for r in rows:
                allowed_users.append({
                    "id": str(r[0]),
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })

        # Sempre incluir super_users (independente de setor)
        cur.execute("""
            SELECT id, name, sector, role
            FROM users
            WHERE is_active = TRUE AND role IN ('super_user', 'ceo')
            ORDER BY name
        """)
        for r in cur.fetchall():
            uid = str(r[0])
            if not any(u['id'] == uid for u in allowed_users):
                allowed_users.append({
                    "id": uid,
                    "name": r[1],
                    "sector": r[2],
                    "role": r[3]
                })

        cur.close()
        conn.close()

        return {
            "allowed_sectors": sorted(allowed_sectors),
            "allowed_users": sorted(allowed_users, key=lambda u: u['name'])
        }

    except Exception as e:
        logger.error(f"Error in get_inter_sector_sectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def ensure_sectors_table():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sectors (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        
        # Seed with default sectors if table is empty
        cur.execute("SELECT COUNT(*) FROM sectors")
        count = cur.fetchone()[0]
        if count == 0:
            default_sectors = [
                'Administrativo', 'Comercial', 'Compras', 'Custos', 'Diretoria',
                'Ecommerce', 'Financeiro', 'Fabrica', 'Logistica', 'Marketing',
                'Qualidade', 'RH', 'T.I', 'Regional Norte', 'Regional Acessibilidade',
                'Regional Sao Paulo - Interior', 'Regional Sudeste (MG/ES/RJ)',
                'Regional Sul', 'Regional Nordeste', 'Regional Sao Paulo - Capital',
                'Regional Centro-Oeste', 'Regional Televendas', 'Regional Leroy', 'Regional B2B',
                'Gestão de Informação'
            ]
            for s in default_sectors:
                cur.execute("INSERT INTO sectors (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (s,))
            conn.commit()
            print(f"Seeded {len(default_sectors)} default sectors.")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error ensuring sectors table: {e}")

@router.get("/sectors")
def list_sectors(include_inactive: bool = False):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if include_inactive:
            cur.execute("SELECT id, name, is_active, created_at FROM sectors ORDER BY name")
        else:
            cur.execute("SELECT id, name, is_active, created_at FROM sectors WHERE is_active = TRUE ORDER BY name")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [{"id": r[0], "name": r[1], "is_active": r[2], "created_at": str(r[3])} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

class SectorCreate(BaseModel):
    name: str

@router.post("/sectors")
def create_sector(sector: SectorCreate):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO sectors (name) VALUES (%s) RETURNING id, name, is_active, created_at", (sector.name.strip(),))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        return {"id": row[0], "name": row[1], "is_active": row[2], "created_at": str(row[3])}
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Setor já existe.")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

class SectorUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

@router.put("/sectors/{sector_id}")
def update_sector(sector_id: int, sector: SectorUpdate):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Build dynamic update
        updates = []
        params = []
        if sector.name is not None:
            updates.append("name = %s")
            params.append(sector.name.strip())
        if sector.is_active is not None:
            updates.append("is_active = %s")
            params.append(sector.is_active)
        
        if not updates:
            raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")
        
        params.append(sector_id)
        query = f"UPDATE sectors SET {', '.join(updates)} WHERE id = %s RETURNING id, name, is_active, created_at"
        cur.execute(query, params)
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Setor não encontrado.")
        conn.commit()
        cur.close()
        conn.close()
        return {"id": row[0], "name": row[1], "is_active": row[2], "created_at": str(row[3])}
    except HTTPException:
        raise
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Já existe um setor com este nome.")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.delete("/sectors/{sector_id}")
def delete_sector(sector_id: int):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Soft delete - deactivate instead of removing
        cur.execute("UPDATE sectors SET is_active = FALSE WHERE id = %s RETURNING id", (sector_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Setor não encontrado.")
        conn.commit()
        cur.close()
        conn.close()
        return {"message": "Setor desativado com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

# ============================================================
# MÓDULO: CHAMADOS ENTRE SETORES
# ============================================================

class InterSectorTicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: str
    target_sector: str
    requester_id: str
    delivery_forecast: Optional[str] = None

class InterSectorTicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    delivery_forecast: Optional[str] = None

class SectorCategoryCreate(BaseModel):
    sector: str
    name: str
    min_chars: Optional[int] = 0
    require_attachment: Optional[bool] = False


def notify_inter_sector_users(target_sector: str, title: str, message: str, link: str, email_html: Optional[str] = None, exclude_user_id: Optional[str] = None):
    """Notifica todos os usuários ativos do setor de destino com permissão ao módulo inter_sector_tickets."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id FROM users
            WHERE is_active = TRUE
              AND (
                  sector ILIKE %s
                  OR managed_sectors ILIKE %s
              )
        """, (target_sector, f"%{target_sector}%"))
        rows = cur.fetchall()
        for row in rows:
            # Pula o proprio autor para evitar notificacao duplicada
            if exclude_user_id and str(row[0]) == str(exclude_user_id):
                continue
            notify_user(row[0], title, message, link, conn, email_html)
        cur.close()
        conn.close()
    except Exception as e:
        print(f"notify_inter_sector_users error: {e}")


# --- Gestão de Categorias de Tickets ---


@router.get("/sector-categories")
def list_sector_categories(sector: Optional[str] = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    has_access = (
        check_module_permission(user_id or '', 'sector_categories') or
        check_module_permission(user_id or '', 'inter_sector_tickets')
    )
    if not has_access:
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if sector:
            cur.execute("""
                SELECT c.id, c.sector, c.name, c.created_by, c.created_at, COALESCE(c.min_chars, 0), u.name
                FROM sector_ticket_categories c
                LEFT JOIN users u ON c.created_by = u.id
                WHERE c.sector ILIKE %s AND c.is_active = TRUE
                ORDER BY c.name
            """, (sector,))
        else:
            cur.execute("""
                SELECT c.id, c.sector, c.name, c.created_by, c.created_at, COALESCE(c.min_chars, 0), u.name
                FROM sector_ticket_categories c
                LEFT JOIN users u ON c.created_by = u.id
                WHERE c.is_active = TRUE
                ORDER BY c.sector, c.name
            """)
        rows = cur.fetchall()
        return [{"id": str(r[0]), "sector": r[1], "name": r[2], "created_by": str(r[3]) if r[3] else None, "created_at": str(r[4]), "min_chars": r[5], "created_by_name": r[6] or "—"} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/sector-categories")
def create_sector_category(data: SectorCategoryCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'sector_categories'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        min_chars = getattr(data, 'min_chars', 0) or 0
        cur.execute("""
            INSERT INTO sector_ticket_categories (sector, name, created_by, min_chars)
            VALUES (%s, %s, %s, %s)
            RETURNING id, sector, name, created_at, min_chars
        """, (data.sector.strip(), data.name.strip(), user_id, min_chars))
        row = cur.fetchone()
        conn.commit()
        return {"id": str(row[0]), "sector": row[1], "name": row[2], "created_at": str(row[3]), "min_chars": row[4] or 0}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma categoria com este nome para este setor.")
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.put("/sector-categories/{cat_id}")
def update_sector_category(cat_id: UUID, data: SectorCategoryCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'sector_categories'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT sector FROM sector_ticket_categories WHERE id = %s", (str(cat_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Categoria não encontrada.")
        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed = u
        if role != 'super_user':
            managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
            allowed = [u_sector] + managed
            if row[0] not in allowed:
                raise HTTPException(status_code=403, detail="Sem permissão para editar categoria deste setor.")
        min_chars = getattr(data, 'min_chars', 0) or 0
        cur.execute("""
            UPDATE sector_ticket_categories SET name = %s, min_chars = %s WHERE id = %s
            RETURNING id, sector, name, created_at, min_chars
        """, (data.name.strip(), min_chars, str(cat_id)))
        updated = cur.fetchone()
        conn.commit()
        return {"id": str(updated[0]), "sector": updated[1], "name": updated[2], "created_at": str(updated[3]), "min_chars": updated[4] or 0}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma categoria com este nome para este setor.")
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.delete("/sector-categories/{cat_id}")
def delete_sector_category(cat_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'sector_categories'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT sector FROM sector_ticket_categories WHERE id = %s", (str(cat_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Categoria não encontrada.")
        # Verifica se é admin do setor ou super_user
        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed = u
        cat_sector = row[0]
        if role != 'super_user':
            managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
            allowed = [u_sector] + managed
            if cat_sector not in allowed:
                raise HTTPException(status_code=403, detail="Sem permissão para excluir categoria deste setor.")
        cur.execute("UPDATE sector_ticket_categories SET is_active = FALSE WHERE id = %s", (str(cat_id),))
        # Desativa subcategorias vinculadas também
        cur.execute("UPDATE sector_ticket_subcategories SET is_active = FALSE WHERE category_id = %s", (str(cat_id),))
        conn.commit()
        return {"message": "Categoria desativada."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/sector-categories/{cat_id}/subcategories")
def list_sector_subcategories(cat_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    has_access = (
        check_module_permission(user_id or '', 'sector_categories') or
        check_module_permission(user_id or '', 'inter_sector_tickets')
    )
    if not has_access:
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, category_id, name, created_at, COALESCE(min_chars, 0), COALESCE(require_attachment, FALSE)
            FROM sector_ticket_subcategories
            WHERE category_id = %s AND is_active = TRUE
            ORDER BY name
        """, (str(cat_id),))
        rows = cur.fetchall()
        return [{"id": str(r[0]), "category_id": str(r[1]), "name": r[2], "created_at": str(r[3]), "min_chars": r[4], "require_attachment": r[5]} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/sector-categories/{cat_id}/subcategories")
def create_sector_subcategory(cat_id: UUID, data: SectorCategoryCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'sector_categories'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM sector_ticket_categories WHERE id = %s", (str(cat_id),))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Categoria não encontrada.")
        min_chars = getattr(data, 'min_chars', 0) or 0
        require_attachment = getattr(data, 'require_attachment', False) or False
        cur.execute("""
            INSERT INTO sector_ticket_subcategories (category_id, name, min_chars, require_attachment)
            VALUES (%s, %s, %s, %s)
            RETURNING id, category_id, name, created_at, min_chars, require_attachment
        """, (str(cat_id), data.name.strip(), min_chars, require_attachment))
        row = cur.fetchone()
        conn.commit()
        return {"id": str(row[0]), "category_id": str(row[1]), "name": row[2], "created_at": str(row[3]), "min_chars": row[4], "require_attachment": row[5]}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma subcategoria com este nome para esta categoria.")
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.delete("/sector-subcategories/{sub_id}")
def delete_sector_subcategory(sub_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'sector_categories'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT sc.id, c.sector FROM sector_ticket_subcategories sc
            JOIN sector_ticket_categories c ON sc.category_id = c.id
            WHERE sc.id = %s
        """, (str(sub_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Subcategoria não encontrada.")
        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed = u
        if role != 'super_user':
            managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
            allowed = [u_sector] + managed
            if row[1] not in allowed:
                raise HTTPException(status_code=403, detail="Sem permissão para excluir subcategoria deste setor.")
        cur.execute("UPDATE sector_ticket_subcategories SET is_active = FALSE WHERE id = %s", (str(sub_id),))
        conn.commit()
        return {"message": "Subcategoria desativada."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


# --- Chamados Entre Setores ---

