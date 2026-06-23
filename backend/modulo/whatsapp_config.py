"""
Configuracao de envio WhatsApp via WAHA.

- Tabela `whatsapp_numeros_autorizados` (allowlist gerenciada pela tela de Configuracoes).
- Endpoints CRUD restritos ao modulo `whatsapp_numeros_autorizados` (can_edit).
- Helper `enviar_arquivo_whatsapp()` consumido por outros modulos (ex: plano_producao).

Seguranca:
- Chave WAHA (X-Api-Key) NUNCA exposta ao frontend — lida de env var WAHA_API_KEY.
- Allowlist persistida em banco (numeros so de digitos, len 10-11).
- Rate-limit simples em memoria por usuario (5 envios / 60s).
"""
import os
import re
import time
import json
import logging
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional, List, Tuple

import requests
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter()
logger = logging.getLogger(__name__)

MODULE_ID = 'whatsapp_numeros_autorizados'
_RE_NUMERO = re.compile(r'^\d{10,11}$')

# Rate-limit simples por user_id (in-memory; reseta no restart)
_RL_WINDOW_SEC = 60
_RL_MAX = 5
_rate_buckets: "defaultdict[str, deque]" = defaultdict(deque)


# =============================================================================
# DDL
# =============================================================================
def ensure_whatsapp_tables():
    """Cria tabelas de allowlist e auditoria (idempotente)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_numeros_autorizados (
                id SERIAL PRIMARY KEY,
                numero VARCHAR(11) UNIQUE NOT NULL,
                descricao VARCHAR(120),
                ativo BOOLEAN NOT NULL DEFAULT TRUE,
                criado_por UUID,
                criado_em TIMESTAMPTZ DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_envios_log (
                id SERIAL PRIMARY KEY,
                user_id UUID,
                numero VARCHAR(11) NOT NULL,
                origem VARCHAR(40) NOT NULL,
                referencia_id TEXT,
                status VARCHAR(20) NOT NULL,
                message_id TEXT,
                erro TEXT,
                criado_em TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_wpp_envios_criado_em
                ON whatsapp_envios_log(criado_em DESC)
        """)
        conn.commit()
        logger.info("whatsapp_numeros_autorizados / whatsapp_envios_log OK")
    except Exception as e:
        conn.rollback()
        logger.error(f"Falha criando tabelas WhatsApp: {e}")
    finally:
        cur.close()
        conn.close()


# =============================================================================
# Helpers compartilhados
# =============================================================================
def sanitize_numero(numero: str) -> str:
    """So digitos. Aceita 10 ou 11 (com 9 no movel)."""
    if numero is None:
        raise HTTPException(status_code=400, detail="Numero obrigatorio.")
    digits = re.sub(r'\D', '', str(numero))
    if not _RE_NUMERO.match(digits):
        raise HTTPException(
            status_code=400,
            detail="Numero invalido. Use DDD + numero (10 ou 11 digitos, so numeros)."
        )
    return digits


def numero_esta_autorizado(numero: str) -> Tuple[bool, Optional[str]]:
    """Consulta allowlist. Retorna (autorizado, descricao_opcional)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT descricao FROM whatsapp_numeros_autorizados
            WHERE numero = %s AND ativo = TRUE
            LIMIT 1
        """, (numero,))
        row = cur.fetchone()
        if not row:
            return False, None
        return True, row[0]
    finally:
        cur.close()
        conn.close()


def _check_rate_limit(user_id: Optional[str]):
    key = str(user_id or 'anon')
    now = time.time()
    bucket = _rate_buckets[key]
    while bucket and (now - bucket[0]) > _RL_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= _RL_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Muitos envios em sequencia. Aguarde alguns segundos."
        )
    bucket.append(now)


def _registrar_log(user_id: Optional[str], numero: str, origem: str,
                   referencia_id: Optional[str], status: str,
                   message_id: Optional[str] = None, erro: Optional[str] = None):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO whatsapp_envios_log
                (user_id, numero, origem, referencia_id, status, message_id, erro)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (str(user_id) if user_id else None, numero, origem,
              referencia_id, status, message_id, erro))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"Falha registrando log WhatsApp: {e}")


def enviar_arquivo_whatsapp(
    *,
    user_id: Optional[str],
    numero: str,
    origem: str,
    referencia_id: Optional[str],
    caption: str,
    filename: str,
    mimetype: str,
    data_base64: str,
) -> dict:
    """
    Envia um arquivo via WAHA (rota /api/sendFile).
    Faz allowlist + rate-limit + sanitizacao + auditoria.
    Conteudo (caption + arquivo) deve vir ja preparado pelo chamador
    (recomendado: gerar no backend, nao receber do front).
    """
    numero = sanitize_numero(numero)
    ok, _desc = numero_esta_autorizado(numero)
    if not ok:
        _registrar_log(user_id, numero, origem, referencia_id, 'rejeitado_allowlist')
        raise HTTPException(
            status_code=403,
            detail="Numero nao esta autorizado a receber mensagens. "
                   "Cadastre em Configuracoes > Numeros WhatsApp."
        )

    _check_rate_limit(user_id)

    base_url = os.environ.get('WAHA_API_URL', '').rstrip('/')
    api_key = os.environ.get('WAHA_API_KEY', '')
    session = os.environ.get('WAHA_SESSION', 'mia')
    country = os.environ.get('WAHA_COUNTRY_CODE', '55')
    timeout = int(os.environ.get('WAHA_TIMEOUT_SECONDS', '15'))

    if not base_url or not api_key:
        logger.error("WAHA_API_URL ou WAHA_API_KEY nao configurados")
        _registrar_log(user_id, numero, origem, referencia_id,
                       'falha_config', erro='env vars WAHA ausentes')
        raise HTTPException(status_code=500, detail="Integracao WhatsApp nao configurada.")

    payload = {
        "chatId": f"{country}{numero}@c.us",
        "session": session,
        "caption": caption,
        "file": {
            "mimetype": mimetype,
            "filename": filename,
            "data": data_base64,
        },
    }

    try:
        r = requests.post(
            f"{base_url}/api/sendFile",
            headers={
                "X-Api-Key": api_key,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except requests.RequestException as e:
        logger.error(f"Erro HTTP WAHA: {e}")
        _registrar_log(user_id, numero, origem, referencia_id,
                       'falha_http', erro=str(e)[:500])
        raise HTTPException(status_code=502, detail="Falha de comunicacao com servidor WhatsApp.")

    if r.status_code >= 400:
        logger.error(f"WAHA respondeu {r.status_code}: {r.text[:500]}")
        _registrar_log(user_id, numero, origem, referencia_id,
                       'falha_remota', erro=f"{r.status_code}: {r.text[:300]}")
        raise HTTPException(
            status_code=502,
            detail=f"Servidor WhatsApp recusou o envio ({r.status_code})."
        )

    try:
        body = r.json()
    except ValueError:
        body = {}
    message_id = body.get('id') or (body.get('_data') or {}).get('id', {}).get('id') if isinstance(body, dict) else None

    _registrar_log(user_id, numero, origem, referencia_id, 'ok',
                   message_id=str(message_id) if message_id else None)

    return {
        "sucesso": True,
        "message_id": message_id,
        "enviado_em": datetime.now(timezone.utc).isoformat(),
    }


# =============================================================================
# CRUD endpoints (Configuracoes > Numeros WhatsApp)
# =============================================================================
class NumeroBody(BaseModel):
    numero: str
    descricao: Optional[str] = None
    ativo: Optional[bool] = True


@router.get("/admin/whatsapp/numeros/ativos")
def listar_numeros_ativos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista numeros ativos para uso em modais de envio (qualquer usuario autenticado).
    Retorna campos minimos (sem auditoria)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Sessao expirada.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, numero, descricao
            FROM whatsapp_numeros_autorizados
            WHERE ativo = TRUE
            ORDER BY descricao NULLS LAST, numero
        """)
        return [{"id": r[0], "numero": r[1], "descricao": r[2]} for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


@router.get("/admin/whatsapp/numeros")
def listar_numeros(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID, 'can_view'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, numero, descricao, ativo, criado_em, atualizado_em
            FROM whatsapp_numeros_autorizados
            ORDER BY ativo DESC, numero ASC
        """)
        rows = cur.fetchall()
        return [
            {
                "id": r[0],
                "numero": r[1],
                "descricao": r[2],
                "ativo": r[3],
                "criado_em": r[4].isoformat() if r[4] else None,
                "atualizado_em": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]
    finally:
        cur.close()
        conn.close()


@router.post("/admin/whatsapp/numeros")
def criar_numero(body: NumeroBody,
                 user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID, 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    numero = sanitize_numero(body.numero)
    descricao = (body.descricao or '').strip()[:120] or None
    ativo = True if body.ativo is None else bool(body.ativo)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO whatsapp_numeros_autorizados (numero, descricao, ativo, criado_por)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (numero)
              DO UPDATE SET descricao = EXCLUDED.descricao,
                            ativo = EXCLUDED.ativo,
                            atualizado_em = NOW()
            RETURNING id
        """, (numero, descricao, ativo, str(user_id) if user_id else None))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": new_id, "numero": numero, "descricao": descricao, "ativo": ativo}
    except Exception as e:
        conn.rollback()
        logger.error(f"Erro criar numero: {e}")
        raise HTTPException(status_code=500, detail="Erro ao salvar numero.")
    finally:
        cur.close()
        conn.close()


class NumeroPatch(BaseModel):
    descricao: Optional[str] = None
    ativo: Optional[bool] = None


@router.patch("/admin/whatsapp/numeros/{numero_id}")
def atualizar_numero(numero_id: int, body: NumeroPatch,
                     user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID, 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    sets = []
    vals = []
    if body.descricao is not None:
        sets.append("descricao = %s")
        vals.append(body.descricao.strip()[:120] or None)
    if body.ativo is not None:
        sets.append("ativo = %s")
        vals.append(bool(body.ativo))
    if not sets:
        raise HTTPException(status_code=400, detail="Nada para atualizar.")
    sets.append("atualizado_em = NOW()")
    vals.append(numero_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            f"UPDATE whatsapp_numeros_autorizados SET {', '.join(sets)} WHERE id = %s",
            tuple(vals)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Numero nao encontrado.")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close()
        conn.close()


@router.delete("/admin/whatsapp/numeros/{numero_id}")
def remover_numero(numero_id: int,
                   user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID, 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM whatsapp_numeros_autorizados WHERE id = %s", (numero_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Numero nao encontrado.")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close()
        conn.close()
