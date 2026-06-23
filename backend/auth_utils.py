"""
Sistema de autenticacao por sessao com cookie HttpOnly.

Substitui o padrao anterior de `Header('user-id')` que era falsificavel.
"""
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Cookie, Request, Response, HTTPException
from db_utils import get_db_connection

# Nome do cookie e tempo de vida da sessao
SESSION_COOKIE_NAME = "portal_session"
SESSION_LIFETIME_DAYS = 30  # duracao maxima da sessao


def ensure_session_table():
    """Cria a tabela de sessoes se nao existir (chamado no startup)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id VARCHAR(128) PRIMARY KEY,
                user_id UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)")
        conn.commit()
        print("user_sessions table OK.")
    except Exception as e:
        conn.rollback()
        print(f"user_sessions table setup error: {e}")
    finally:
        cur.close()
        conn.close()


def create_session(user_id: str) -> str:
    """Cria uma nova sessao para o usuario e retorna o session_id."""
    session_id = secrets.token_urlsafe(64)
    expires = datetime.utcnow() + timedelta(days=SESSION_LIFETIME_DAYS)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO user_sessions (session_id, user_id, expires_at) VALUES (%s, %s, %s)",
            (session_id, str(user_id), expires)
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return session_id


def delete_session(session_id: str) -> None:
    if not session_id:
        return
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM user_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
    finally:
        cur.close()
        conn.close()


def get_user_id_from_session(
    request: Request,
    portal_session: Optional[str] = Cookie(None),
) -> Optional[str]:
    """
    Dependency do FastAPI que retorna o user_id a partir do cookie de sessao.

    Retorna None se nao houver sessao valida (para endpoints que tratam
    permissao/403 no proprio corpo, como faz check_module_permission).

    Transicao/fallback: se nao houver cookie mas houver header 'user-id'
    (legado), aceita — isso permite migracao sem quebrar sessoes abertas.
    Remover esse fallback quando todos os usuarios tiverem relogado.
    """
    # 1. Tenta o cookie (caminho novo e seguro)
    if portal_session:
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT user_id, expires_at FROM user_sessions WHERE session_id = %s",
                (portal_session,)
            )
            row = cur.fetchone()
            if row:
                user_id, expires_at = row
                if expires_at and expires_at > datetime.utcnow().replace(tzinfo=expires_at.tzinfo):
                    # atualiza last_seen
                    cur.execute(
                        "UPDATE user_sessions SET last_seen_at = NOW() WHERE session_id = %s",
                        (portal_session,)
                    )
                    conn.commit()
                    return str(user_id)
        finally:
            cur.close()
            conn.close()

    # 2. Fallback legado: header user-id (remover apos migracao completa)
    legacy = request.headers.get('user-id') or request.headers.get('User-Id')
    if legacy:
        return legacy

    return None


def set_session_cookie(response: Response, session_id: str) -> None:
    """Seta o cookie de sessao no response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        max_age=SESSION_LIFETIME_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,      # so envia via HTTPS em producao
        samesite="lax",   # permite navegacao normal mas bloqueia CSRF cross-site
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
