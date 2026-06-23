from fastapi import APIRouter, HTTPException, Response, Cookie
from auth_utils import create_session, delete_session, set_session_cookie, clear_session_cookie, SESSION_COOKIE_NAME
from typing import Optional, List, Dict, Any, cast
from uuid import UUID
import copy
import secrets
import json
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

from db_utils import get_db_connection
from permission_utils import check_module_permission, load_role_permissions
from core.config import FRONTEND_URL
from core.email import send_email
from schemas.user import User, UserPasswordUpdate, LoginRequest, ForgotPasswordRequest, ResetPasswordRequest
from schemas.common import Notification, NotificationPreferences, RolePermissionsUpdate
from core.config import verify_password, get_password_hash

router = APIRouter()

@router.get("/users/by-sector")
def get_users_by_sector(sector: str):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Query both primary sector and managed_sectors (semicolon-separated string)
        # DISTINCT evita duplicação quando usuário tem setor primário E managed_sectors com o mesmo setor
        query = """
            SELECT DISTINCT id, name, sector, role, permissions, managed_sectors
            FROM users
            WHERE (
                LOWER(TRIM(sector)) = LOWER(TRIM(%s))
                OR LOWER(TRIM(%s)) = ANY(SELECT LOWER(TRIM(s)) FROM unnest(string_to_array(managed_sectors, ';')) s)
                OR LOWER(TRIM(%s)) = ANY(SELECT LOWER(TRIM(s)) FROM unnest(string_to_array(managed_sectors, ',')) s)
            )
            AND is_active = TRUE
        """
        cur.execute(query, (sector, sector, sector))
        rows = cur.fetchall()
        
        # Load role defaults
        role_perms_list = load_role_permissions()
        
        results = []
        for r in rows:
            user_id = str(r[0])
            name = r[1]
            user_sector = r[2]
            role = r[3]
            user_override_perms = r[4] or {}
            managed_sectors = r[5]
            
            # Resolve Permissions
            role_defaults = next((item['permissions'] for item in role_perms_list if item['role'] == role), {})
            
            # Merge (Simple top-level merge is usually enough, but let's do shallow copy)
            final_perms: Dict[str, Any] = cast(Dict[str, Any], role_defaults.copy() if isinstance(role_defaults, dict) else {})
            # If overrides exist, merge them (assuming per-module granularity)
            if isinstance(user_override_perms, dict):
                for k, v in user_override_perms.items():
                    ks = str(k)
                    if ks in final_perms and isinstance(final_perms[ks], dict) and isinstance(v, dict):
                        target_dict = cast(Dict[str, Any], final_perms[ks])
                        final_perms[ks] = {**target_dict, **v}
                    else:
                        final_perms[ks] = v
                    
            results.append({
                "id": user_id, 
                "name": name, 
                "sector": user_sector, 
                "role": role,
                "permissions": final_perms,
                "managed_sectors": managed_sectors
            })
            
        return results
    finally:
        cur.close()
        conn.close()
        
@router.get("/users/list-all")
def get_all_users_simple():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = "SELECT id, name, sector, role, permissions, managed_sectors FROM users WHERE is_active = TRUE ORDER BY name"
        cur.execute(query)
        rows = cur.fetchall()
        
        # Load role defaults
        role_perms_list = load_role_permissions()
        
        results = []
        for r in rows:
            role = r[3]
            user_override_perms = r[4] or {}
            
            # Resolve Permissions (Duplicate logic - ideally helper, but inline is fine for now)
            role_defaults_raw = next((item['permissions'] for item in role_perms_list if item['role'] == role), {})
            role_defaults: Dict[str, Any] = cast(Dict[str, Any], role_defaults_raw if isinstance(role_defaults_raw, dict) else {})
            final_perms: Dict[str, Any] = role_defaults.copy()
            if isinstance(user_override_perms, dict):
                for k, v in user_override_perms.items():
                    ks = str(k)
                    if ks in final_perms and isinstance(final_perms[ks], dict) and isinstance(v, dict):
                        target_dict = cast(Dict[str, Any], final_perms[ks])
                        final_perms[ks] = {**target_dict, **v}
                    else:
                        final_perms[ks] = v

            results.append({
                "id": str(r[0]), 
                "name": r[1], 
                "sector": r[2], 
                "role": role,
                "permissions": final_perms,
                "managed_sectors": r[5]
            })
        return results
    finally:
        cur.close()
        conn.close()

@router.get("/users/{user_id}")
def get_user_details(user_id: UUID):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, email, role, sector, avatar, permissions, notification_preferences, managed_sectors FROM users WHERE id = %s", (str(user_id),))
        user = cur.fetchone()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
        # Merge Permissions Logic (Shared with Login)
        role_name = user[3]
        role_perms_list = load_role_permissions()
        role_defaults = next((r['permissions'] for r in role_perms_list if r['role'] == role_name), {})
        
        user_overrides = user[6] if user[6] else {}
        final_perms: Dict[str, Any] = cast(Dict[str, Any], copy.deepcopy(role_defaults))
        
        for module, perms in user_overrides.items():
            if not isinstance(perms, dict): continue
            m = str(module)
            if m not in final_perms or not isinstance(final_perms[m], dict):
                final_perms[m] = {}
            target_node = cast(Dict[str, Any], final_perms[m])
            target_node.update(perms)

        return {
            "id": user[0],
            "name": user[1],
            "email": user[2],
            "role": user[3],
            "sector": user[4],
            "avatar": user[5],
            "permissions": final_perms,
            "managed_sectors": user[8],
            "notification_preferences": user[7] if isinstance(user[7], dict) else {"email": True, "sound": True, "desktop": True}
        }
    finally:
        cur.close()
        conn.close()


@router.post("/login")
def login(req: LoginRequest, response: Response):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, email, role, password_hash, sector, avatar, permissions, notification_preferences, managed_sectors FROM users WHERE LOWER(email) = LOWER(%s) AND is_active = TRUE", (req.email,))
        user = cur.fetchone()

        if not user or not verify_password(req.password, user[4]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Cria sessao e seta cookie HttpOnly
        try:
            session_id = create_session(str(user[0]))
            set_session_cookie(response, session_id)
        except Exception as se:
            print(f"Session create error: {se}")
        
        # Update Last Login
        cur.execute("UPDATE users SET last_login = NOW() WHERE id = %s", (str(user[0]),))
        conn.commit()

        # Merge Permissions
        role_name = user[3] # role column
        role_perms_list = load_role_permissions()
        role_defaults = next((r['permissions'] for r in role_perms_list if r['role'] == role_name), {})
        
        user_overrides = user[7] if user[7] else {}
        
        # Deep merge
        final_perms: Dict[str, Any] = cast(Dict[str, Any], copy.deepcopy(role_defaults))
        
        for module, perms in user_overrides.items():
            if not isinstance(perms, dict): continue
            m = str(module)
            if m not in final_perms or not isinstance(final_perms[m], dict):
                final_perms[m] = {}
            target_node = cast(Dict[str, Any], final_perms[m])
            target_node.update(perms)

        return {
            "id": user[0],
            "name": user[1],
            "email": user[2],
            "role": user[3],
            "sector": user[5],
            "avatar": user[6],
            "permissions": final_perms,
            "managed_sectors": user[9],
            "notification_preferences": user[8] if isinstance(user[8], dict) else {"email": True, "sound": True, "desktop": True}
        }


    finally:
        cur.close()
        conn.close()

@router.post("/logout")
def logout(response: Response, portal_session: Optional[str] = Cookie(None)):
    """Deleta a sessao atual e limpa o cookie."""
    if portal_session:
        try:
            delete_session(portal_session)
        except Exception as e:
            print(f"Logout session delete error: {e}")
    clear_session_cookie(response)
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name FROM users WHERE email = %s AND is_active = TRUE", (req.email,))
        user = cur.fetchone()
        if not user:
            # Don't reveal if user exists or not for security, but for internal app it's fine to be helpful or generic.
            # Returning generic message.
            return {"message": "If email exists, reset link sent"}
        
        user_id, name = user
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(hours=1)
        
        # Cleanup old tokens for this user
        cur.execute("DELETE FROM password_resets WHERE user_id = %s", (str(user_id),))
        
        cur.execute("INSERT INTO password_resets (token, user_id, expires_at) VALUES (%s, %s, %s)", 
                    (token, str(user_id), expires_at))
        conn.commit()
        
        # Send Email
        # Ensure we point to the HashRouter path
        reset_link = f"{FRONTEND_URL.rstrip('/')}/#/reset-password?token={token}"
        
        body = f"""
        <html>
          <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #dc2626;">Redefinição de Senha</h2>
                <p>Olá, {name}.</p>
                <p>Recebemos uma solicitação para redefinir sua senha.</p>
                <p>Clique no botão abaixo para criar uma nova senha:</p>
                <p>
                    <a href="{reset_link}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Redefinir Senha</a>
                </p>
                <p style="font-size: 12px; color: #666;">Este link expira em 1 hora.</p>
            </div>
          </body>
        </html>
        """
        send_email(req.email, "Redefinição de Senha - Portal de Chamados", body)
        
        return {"message": "Reset link sent"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT user_id, expires_at FROM password_resets WHERE token = %s", (req.token,))
        row = cur.fetchone()
        
        if not row:
             raise HTTPException(status_code=400, detail="Invalid token")
        
        user_id, expires_at = row
        if datetime.now() > expires_at:
             cur.execute("DELETE FROM password_resets WHERE token = %s", (req.token,))
             conn.commit()
             raise HTTPException(status_code=400, detail="Token expired")
        
        # Update Password
        hashed_pw = get_password_hash(req.new_password)
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hashed_pw, str(user_id)))
        
        # Delete token
        cur.execute("DELETE FROM password_resets WHERE token = %s", (req.token,))
        conn.commit()
        
        return {"message": "Password updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.get("/users", response_model=List[User])
def get_users():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, email, role, avatar, sector, last_login, managed_sectors, permissions FROM users WHERE is_active = TRUE")
        rows = cur.fetchall()
        users = []
        for row in rows:
            # Row mapping: 0:id, 1:name, 2:email, 3:role, 4:avatar, 5:sector, 6:last_login, 7:managed_sectors, 8:permissions
            l_login = row[6].isoformat() if row[6] else None
            raw_perms = row[8]
            if isinstance(raw_perms, str):
                try:
                    raw_perms = json.loads(raw_perms)
                except:
                    raw_perms = {}
            
            users.append(User(
                id=row[0], name=row[1], email=row[2], role=row[3], avatar=row[4], sector=row[5], last_login=l_login, managed_sectors=row[7], permissions=raw_perms or {}
            ))
        return users
    finally:
        cur.close()
        conn.close()


@router.put("/users/{user_id}")
def update_user(user_id: UUID, user_update: UserPasswordUpdate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check if updating password
        if user_update.password and user_update.password.strip():
             hashed_pw = get_password_hash(user_update.password)
             perms_json = json.dumps(user_update.permissions) if user_update.permissions else '{}'
             cur.execute(
                """
                UPDATE users 
                SET name = %s, email = %s, role = %s, sector = %s, password_hash = %s, managed_sectors = %s, permissions = %s
                WHERE id = %s
                """,
                (user_update.name, user_update.email, user_update.role, user_update.sector, hashed_pw, user_update.managed_sectors, perms_json, str(user_id))
            )
        else:
             perms_json = json.dumps(user_update.permissions) if user_update.permissions else '{}'
             cur.execute(
                """
                UPDATE users 
                SET name = %s, email = %s, role = %s, sector = %s, managed_sectors = %s, permissions = %s
                WHERE id = %s
                """,
                (user_update.name, user_update.email, user_update.role, user_update.sector, user_update.managed_sectors, perms_json, str(user_id))
            )
        
        conn.commit()
        return {"message": "User updated"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.delete("/users/{user_id}")
def delete_user(user_id: UUID):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Try Hard Delete First
        try:
            cur.execute("DELETE FROM users WHERE id = %s", (str(user_id),))
            conn.commit()
            cur.close()
            conn.close()
            return {"message": "User permanently deleted"}
        except Exception as e:
            # Check for Foreign Key Violation (Postgres code 23503)
            # code 42P01 is undefined_table, but we shouldn't hit that if DELETE worked
            is_fk_violation = getattr(e, 'pgcode', None) == '23503'
            
            if is_fk_violation:
                # If FK violation, fallback to soft delete but rename email to allow re-registration
                conn.rollback()
                cur.close()
                conn.close() # Close current connection and get a fresh one to be absolutely sure about search_path
                
                # Soft delete work in a fresh connection
                conn_soft = get_db_connection()
                cur_soft = conn_soft.cursor()
                try:
                    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
                    cur_soft.execute("SELECT email FROM users WHERE id = %s", (str(user_id),))
                    row = cur_soft.fetchone()
                    if row:
                        old_email = row[0]
                        new_email = f"{old_email}_deleted_{timestamp}"
                        cur_soft.execute(
                            "UPDATE users SET is_active = FALSE, email = %s WHERE id = %s", 
                            (new_email, str(user_id))
                        )
                        conn_soft.commit()
                    return {"message": "User deactivated (associated data preserved)"}
                finally:
                    cur_soft.close()
                    conn_soft.close()
            else:
                # Re-raise if it's not a FK violation
                raise e
                
    except Exception as e:
        if 'conn' in locals() and conn:
            try:
                conn.rollback()
            except:
                pass
            finally:
                try: cur.close()
                except: pass
                try: conn.close()
                except: pass
        logger.error(f"Error deleting user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")


# Email Utility


# Action Plan Email Helper


# Users Endpoints (Modified Create)
@router.post("/users", response_model=User)
def create_user(user: UserPasswordUpdate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check if email exists (active or inactive)
        cur.execute("SELECT id, is_active FROM users WHERE email = %s", (user.email,))
        existing = cur.fetchone()

        if existing:
            user_id, is_active = existing
            if is_active:
                raise HTTPException(status_code=400, detail="User with this email already exists")
            
            # Reactivate and Update
            hashed_pw = get_password_hash(user.password) if user.password else None
            perms_json = json.dumps(user.permissions) if user.permissions else '{}'
            
            if hashed_pw:
                cur.execute("""
                    UPDATE users 
                    SET name=%s, role=%s, avatar=%s, sector=%s, password_hash=%s, permissions=%s, managed_sectors=%s, is_active=TRUE
                    WHERE id=%s
                    RETURNING id
                """, (user.name, user.role, user.avatar, user.sector, hashed_pw, perms_json, user.managed_sectors, str(user_id)))
            else:
                 cur.execute("""
                    UPDATE users 
                    SET name=%s, role=%s, avatar=%s, sector=%s, permissions=%s, managed_sectors=%s, is_active=TRUE
                    WHERE id=%s
                    RETURNING id
                """, (user.name, user.role, user.avatar, user.sector, perms_json, user.managed_sectors, str(user_id)))
            
            conn.commit()
            new_id = user_id
            
            # Send Welcome Email (Re-welcome)
            try:
                portal_link = FRONTEND_URL.rstrip('/')
                body = f"""
                <html>
                  <body>
                    <h2>Bem-vindo(a) de volta ao Portal 3LACKD, {user.name}!</h2>
                    <p>Sua conta foi reativada com sucesso.</p>
                    <p>Você já pode acessar o sistema utilizando seu email ({user.email}).</p>
                    <p><a href="{portal_link}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Acessar Portal</a></p>
                  </body>
                </html>
                """
                send_email(user.email, "Conta Reativada - Portal de Chamados", body)
            except Exception as e:
                print(f"Failed to send welcome email: {e}")

            return User(id=new_id, name=user.name, email=user.email, role=user.role, avatar=user.avatar, sector=user.sector, permissions=user.permissions, managed_sectors=user.managed_sectors)

        # Standard Creation
        if not user.password:
             raise HTTPException(status_code=400, detail="Password required for new users")

        hashed_pw = get_password_hash(user.password)
        perms_json = json.dumps(user.permissions) if user.permissions else '{}'

        cur.execute(
            """
            INSERT INTO users (name, email, role, avatar, sector, password_hash, permissions, managed_sectors)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (user.name, user.email, user.role, user.avatar, user.sector, hashed_pw, perms_json, user.managed_sectors)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        
        # Send Welcome Email
        try:
            portal_link = FRONTEND_URL.rstrip('/')
            body = f"""
            <html>
              <body>
                <h2>Bem-vindo(a) ao Portal 3LACKD, {user.name}!</h2>
                <p>Seu cadastro foi realizado com sucesso.</p>
                <p>Você já pode acessar o sistema utilizando seu email ({user.email}).</p>
                <p><a href="{portal_link}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Acessar Portal</a></p>
              </body>
            </html>
            """
            send_email(user.email, "Bem-vindo ao Portal de Chamados", body)
        except Exception as e:
            print(f"Failed to send welcome email: {e}")
        
        return User(id=new_id, name=user.name, email=user.email, role=user.role, avatar=user.avatar, sector=user.sector, permissions=user.permissions, managed_sectors=user.managed_sectors)
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        logger.error(f"Error creating user: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()



# Role Permissions Logic

@router.get("/role-permissions")
def get_role_permissions():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT role, permissions FROM role_permissions")
        rows = cur.fetchall()
        
        if not rows:
            return [
                 {"role": "admin", "permissions": {}},
                 {"role": "user", "permissions": {}}
            ]
            
        result = []
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
        logger.error(f"Error fetching role permissions: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.post("/role-permissions")
def update_role_permissions(data_in: RolePermissionsUpdate):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO role_permissions (role, permissions) VALUES (%s, %s::jsonb) ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions",
            (data_in.role, json.dumps(data_in.permissions))
        )
        conn.commit()
        return {"message": "Permissions updated successfully"}
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating role permissions: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

# Notification Endpoints
@router.get("/notifications")
def get_notifications(user_id: str): # Passed as query param for now, ideally from Token but using simpler auth
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, user_id, title, message, link, is_read, created_at 
            FROM notifications 
            WHERE user_id = %s 
            ORDER BY created_at DESC LIMIT 50
        """, (str(user_id),))
        rows = cur.fetchall()
        result = []
        for row in rows:
            result.append(Notification(
                id=row[0], user_id=row[1], title=row[2], message=row[3], link=row[4], is_read=row[5], created_at=row[6]
            ))
        return result
    finally:
        cur.close()
        conn.close()

@router.put("/notifications/{notif_id}/read")
def mark_notification_read(notif_id: UUID):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE notifications SET is_read = TRUE WHERE id = %s", (str(notif_id),))
        conn.commit()
        return {"message": "Marked read"}
    finally:
        cur.close()
        conn.close()

@router.post("/users/{user_id}/preferences")
def update_preferences(user_id: UUID, prefs: NotificationPreferences):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE users SET notification_preferences = %s WHERE id = %s", (json.dumps(prefs.dict()), str(user_id)))
        conn.commit()
        return {"message": "Preferences updated"}
    finally:
        cur.close()
        conn.close()

