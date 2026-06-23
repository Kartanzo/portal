"""
Eventos — Álbum de fotos "Seleção 3LACKD" com armazenamento em Postgres (BYTEA).

Endpoints:
- GET    /eventos/fotos              → lista fotos (apenas IDs/ordem; thumbnails inline base64 opcional)
- GET    /eventos/fotos/{id}         → retorna a imagem binária (Response com Content-Type)
- POST   /eventos/fotos              → upload multi (admin/marketing)
- PATCH  /eventos/fotos/{id}         → atualiza metadados da figurinha (admin/marketing)
- DELETE /eventos/fotos/{id}         → remove foto (admin/marketing)
- PATCH  /eventos/fotos/ordem        → reordena (admin/marketing)
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Response, Depends
from typing import List, Optional
from pydantic import BaseModel

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session


router = APIRouter(prefix="/eventos", tags=["Eventos"])


# ─────────────────────────────────────────────
#  Permissões
# ─────────────────────────────────────────────
MODULE_VIEW = "eventos_album"
MODULE_ADMIN = "eventos_admin"


def _require_view(user_id: str):
    if not check_module_permission(user_id, MODULE_VIEW, "can_view"):
        raise HTTPException(status_code=403, detail="Acesso negado ao álbum de eventos")


def _require_admin(user_id: str):
    if not check_module_permission(user_id, MODULE_ADMIN, "can_view"):
        raise HTTPException(status_code=403, detail="Sem permissão para gerenciar fotos")


# ─────────────────────────────────────────────
#  Garantia defensiva de colunas (metadados Panini)
# ─────────────────────────────────────────────
def _ensure_cols(cur):
    """Adiciona colunas de metadados das figurinhas se ainda não existirem."""
    cur.execute(
        """
        ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS nome         VARCHAR(80);
        ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS posicao      VARCHAR(60);
        ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS numero       VARCHAR(10);
        ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS craque       BOOLEAN DEFAULT FALSE;
        ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS obj_position VARCHAR(30) DEFAULT 'center 30%';
        """
    )


# ─────────────────────────────────────────────
#  Modelos
# ─────────────────────────────────────────────
class ReordenarPayload(BaseModel):
    ordem: List[str]  # lista de IDs na nova ordem


class MetadadosPayload(BaseModel):
    nome: Optional[str] = None
    posicao: Optional[str] = None
    numero: Optional[str] = None
    craque: Optional[bool] = None
    obj_position: Optional[str] = None


# ─────────────────────────────────────────────
#  Endpoints
# ─────────────────────────────────────────────
@router.get("/fotos")
def listar_fotos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    # Álbum de eventos é visível a todos os usuários logados (sem exigir eventos_album)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _ensure_cols(cur)
        conn.commit()
        cur.execute(
            """SELECT id::text, mime_type, ordem, criado_em,
                      nome, posicao, numero,
                      COALESCE(craque, FALSE),
                      COALESCE(obj_position, 'center 30%')
               FROM eventos_album_fotos
               ORDER BY ordem ASC, criado_em ASC"""
        )
        rows = cur.fetchall()
        return {
            "fotos": [
                {
                    "id": r[0],
                    "mime": r[1],
                    "ordem": r[2],
                    "criado_em": r[3].isoformat() if r[3] else None,
                    "nome": r[4],
                    "posicao": r[5],
                    "numero": r[6],
                    "craque": bool(r[7]),
                    "obj_position": r[8],
                }
                for r in rows
            ]
        }
    finally:
        cur.close()
        conn.close()


@router.get("/fotos/{foto_id}")
def baixar_foto(
    foto_id: str,
    _uid: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    # Fallback de auth p/ <img src="..."> que não envia header user-id:
    # aceita ?_uid=<id> da query (mesma confiabilidade do legacy header user-id)
    effective_uid = user_id or _uid
    if not effective_uid:
        raise HTTPException(status_code=401, detail="Não autenticado")
    # Álbum de eventos é visível a todos os usuários logados (sem exigir eventos_album)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT foto, mime_type FROM eventos_album_fotos WHERE id = %s",
            (foto_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Foto não encontrada")
        return Response(content=bytes(row[0]), media_type=row[1])
    finally:
        cur.close()
        conn.close()


@router.post("/fotos")
async def upload_fotos(
    files: List[UploadFile] = File(...),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    _require_admin(user_id)

    conn = get_db_connection()
    cur = conn.cursor()
    inseridos = []
    try:
        _ensure_cols(cur)
        cur.execute("SELECT COALESCE(MAX(ordem), 0) FROM eventos_album_fotos")
        ordem_atual = cur.fetchone()[0] or 0

        for f in files:
            content = await f.read()
            mime = f.content_type or "image/jpeg"
            ordem_atual += 1
            cur.execute(
                """INSERT INTO eventos_album_fotos (foto, mime_type, ordem, criado_por)
                   VALUES (%s, %s, %s, %s) RETURNING id::text""",
                (content, mime, ordem_atual, user_id),
            )
            inseridos.append(cur.fetchone()[0])
        conn.commit()
        return {"ok": True, "ids": inseridos, "total": len(inseridos)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/fotos/{foto_id}")
def atualizar_metadados(
    foto_id: str,
    payload: MetadadosPayload,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    _require_admin(user_id)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _ensure_cols(cur)
        campos = []
        valores = []
        data = payload.dict(exclude_unset=True)
        for col in ("nome", "posicao", "numero", "craque", "obj_position"):
            if col in data:
                campos.append(f"{col} = %s")
                valores.append(data[col])
        if not campos:
            return {"ok": True, "atualizado": False}
        valores.append(foto_id)
        cur.execute(
            f"UPDATE eventos_album_fotos SET {', '.join(campos)} WHERE id = %s",
            valores,
        )
        conn.commit()
        return {"ok": True, "atualizado": cur.rowcount > 0}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.delete("/fotos/{foto_id}")
def remover_foto(foto_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    _require_admin(user_id)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM eventos_album_fotos WHERE id = %s", (foto_id,))
        conn.commit()
        return {"ok": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.post("/fotos/ordem")
def reordenar(payload: ReordenarPayload, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    _require_admin(user_id)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for idx, foto_id in enumerate(payload.ordem, start=1):
            cur.execute(
                "UPDATE eventos_album_fotos SET ordem = %s WHERE id = %s",
                (idx, foto_id),
            )
        conn.commit()
        return {"ok": True, "total": len(payload.ordem)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()
