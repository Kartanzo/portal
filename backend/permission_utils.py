import json
import os
from db_utils import get_db_connection

def load_role_permissions():
    """Internal helper to load role permissions from the database, falling back to JSON file."""
    result = []
    
    # Try Database First
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT role, permissions FROM role_permissions")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        
        if rows:
            for row in rows:
                role_name = row[0]
                perms = row[1]
                if isinstance(perms, str):
                    try:
                        perms = json.loads(perms)
                    except:
                        perms = {}
                result.append({"role": role_name, "permissions": perms or {}})
            return result
    except Exception as e:
        print(f"Error loading role permissions from DB: {e}")

    # Fallback to role_permissions.json if DB empty or failed
    try:
        if os.path.exists('role_permissions.json'):
            with open('role_permissions.json', 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading role permissions from JSON fallback: {e}")
        
    return [] # Truly restrictive: no permissions found anywhere

def check_module_permission(user_id, module_id, min_permission='can_view'):
    """
    Generic modular permission checker.
    Mirrors the frontend hasAccess logic:
    1. Super_user / CEO → always allowed
    2. User-level permission override → check first
    3. Role-level permission → check can_view + allowed_sectors
    
    For allowed_sectors: checks user's primary sector AND managed_sectors.
    If can_view is not explicitly set but the module entry exists with
    allowed_sectors, access is granted if any user sector matches.
    """
    if not user_id:
        return False

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT role, permissions, sector, managed_sectors FROM users WHERE id = %s",
            (str(user_id),)
        )
        user_data = cur.fetchone()
        cur.close()
        conn.close()

        if not user_data:
            return False

        user_role, user_custom_permissions, user_sector, user_managed_sectors = user_data
        
        # Super Users and CEO always have access
        if user_role in ['super_user', 'ceo']:
            return True

        # Build complete set of user sectors (primary + managed)
        user_sectors = set()
        if user_sector:
            for s in str(user_sector).replace(',', ';').split(';'):
                s = s.strip()
                if s:
                    user_sectors.add(s)
        if user_managed_sectors:
            for s in str(user_managed_sectors).replace(',', ';').split(';'):
                s = s.strip()
                if s:
                    user_sectors.add(s)

        # 1. Check User-specific Overrides
        if user_custom_permissions and module_id in user_custom_permissions:
            module_perms = user_custom_permissions[module_id]
            if _evaluate_module_perms(module_perms, min_permission, user_sectors):
                return True
        
        # 2. Check Global Role Permissions
        all_role_perms = load_role_permissions()
        role_record = next((r for r in all_role_perms if r['role'] == user_role), None)
        
        if role_record and module_id in role_record.get('permissions', {}):
            module_perms = role_record['permissions'][module_id]
            if _evaluate_module_perms(module_perms, min_permission, user_sectors):
                return True

        return False
    except Exception as e:
        print(f"Permission check error for {user_id} on {module_id}: {e}")
        return False


def _evaluate_module_perms(module_perms, min_permission, user_sectors):
    """
    Evaluate a single module permission entry.
    - If can_view is explicitly False → deny
    - If allowed_sectors exists → user must have at least one matching sector
    - If module entry exists (even without explicit can_view) → allow if sectors match
    """
    if not module_perms or not isinstance(module_perms, dict):
        return False
    
    # Explicit denial
    if module_perms.get(min_permission) is False:
        return False
    
    # Sector filtering
    allowed_sectors = module_perms.get('allowed_sectors', [])
    if allowed_sectors and isinstance(allowed_sectors, list) and len(allowed_sectors) > 0:
        # User must belong to at least one allowed sector
        if not user_sectors or not user_sectors.intersection(set(allowed_sectors)):
            return False
    
    # If we reach here:
    # - can_view is either True or not set (module entry exists = intentional config)
    # - sector check passed (or no sector restriction)
    return True


def check_sector_permission(user_id, allowed_sector):
    """True se o usuário pertence ao setor permitido (via sector OU managed_sectors),
    ou é super_user/ceo. Comparação sem acento e case-insensitive (ex.: 'Logística' == 'Logistica')."""
    if not user_id:
        return False
    import unicodedata

    def _norm(s):
        return unicodedata.normalize('NFKD', (s or '')).encode('ascii', 'ignore').decode('ascii').strip().lower()

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (str(user_id),))
        row = cur.fetchone()
        cur.close()
        conn.close()
    except Exception:
        return False
    if not row:
        return False
    role, sector, managed = row
    if role in ('super_user', 'ceo'):
        return True
    alvo = _norm(allowed_sector)
    setores = [sector] + [p for p in (managed or '').replace(',', ';').split(';') if p.strip()]
    return any(_norm(s) == alvo for s in setores)
