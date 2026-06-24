"""
Eventos — Álbum de fotos "Seleção EMPRESA" com armazenamento em Postgres (BYTEA).

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


# ─────────────────────────────────────────────
#  SEED de dados dummy (2026)
# ─────────────────────────────────────────────
# PNG 1x1 transparente mínimo — a coluna `foto` é BYTEA NOT NULL, então usamos
# este placeholder em vez de binário real (sem imagens externas).
_PLACEHOLDER_PNG = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
])


def seed_dummy_eventos(admin_id: str) -> dict:
    """Popula `eventos_album_fotos` com figurinhas dummy distribuídas em TODOS
    os 12 meses de 2026 (via core.dummy). Idempotente: não duplica se já houver
    figurinhas dummy. Conexão/commit/rollback próprios."""
    from core import dummy

    # Pools fictícios para os metadados das figurinhas (estilo "Seleção").
    nomes = [
        "Atleta Alfa", "Atleta Beta", "Atleta Gama", "Atleta Delta",
        "Atleta Epsilon", "Atleta Zeta", "Atleta Eta", "Atleta Theta",
        "Atleta Iota", "Atleta Kappa", "Atleta Lambda", "Atleta Mu",
        "Atleta Nu", "Atleta Xi", "Atleta Omicron", "Atleta Pi",
        "Atleta Rho", "Atleta Sigma", "Atleta Tau", "Atleta Upsilon",
        "Atleta Phi", "Atleta Chi", "Atleta Psi", "Atleta Omega",
    ]
    posicoes = ["Goleiro", "Zagueiro", "Lateral", "Volante",
                "Meia", "Atacante", "Ponta", "Técnico"]

    r = dummy.rng("eventos_album", dummy.ANO_BASE)
    # 2 figurinhas por mês → garante cobertura dos 12 meses de 2026.
    datas = dummy.datas_no_ano(24, ano=dummy.ANO_BASE, chave="eventos_album")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _ensure_cols(cur)
        conn.commit()

        # Idempotência: se já existem figurinhas dummy (marcadas pelo nome do
        # pool fictício), não insere de novo.
        cur.execute(
            "SELECT COUNT(*) FROM eventos_album_fotos WHERE nome = ANY(%s)",
            (nomes,),
        )
        ja_existe = (cur.fetchone()[0] or 0) > 0
        if ja_existe:
            return {"ok": True, "ja_existia": True, "inseridos": 0}

        cur.execute("SELECT COALESCE(MAX(ordem), 0) FROM eventos_album_fotos")
        ordem_atual = cur.fetchone()[0] or 0

        inseridos = 0
        for i, data in enumerate(datas):
            ordem_atual += 1
            nome = nomes[i % len(nomes)]
            posicao = posicoes[i % len(posicoes)]
            numero = str(i + 1)
            craque = (i % 8 == 0)  # ~1 craque a cada 8 figurinhas
            cur.execute(
                """INSERT INTO eventos_album_fotos
                       (foto, mime_type, ordem, criado_em, criado_por,
                        nome, posicao, numero, craque, obj_position)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    _PLACEHOLDER_PNG,
                    "image/png",
                    ordem_atual,
                    data,
                    admin_id,
                    nome,
                    posicao,
                    numero,
                    craque,
                    "center 30%",
                ),
            )
            inseridos += 1

        conn.commit()
        return {"ok": True, "ja_existia": False, "inseridos": inseridos}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
