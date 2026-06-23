"""
Marketing — Ficha Técnica (Catálogo de PDFs)

Página 1 (Marketing / gestão): upload e gerenciamento de PDFs — registra nome do
arquivo, data/hora, quem subiu e permite ativar (publicar) ou desativar.

Página 2 (Galeria / Catálogo): lista apenas os PDFs ATIVOS para o usuário baixar
ou copiar o link de acesso externo.

Link de acesso externo: GET /marketing/ficha-tecnica/p/{token} — PÚBLICO (sem login),
exibe somente aquele PDF (inline) enquanto estiver ativo.
"""
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Response, Depends, Body

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/marketing/ficha-tecnica", tags=["Marketing · Ficha Técnica"])

MODULE_ADMIN = "marketing_ficha_tecnica"   # gerenciar (upload / ativar / excluir)
MODULE_VIEW = "ficha_tecnica_catalogo"     # visualizar a galeria / catálogo


# ─────────────────────────────────────────────
#  Permissões
# ─────────────────────────────────────────────
def _uid(user_id: Optional[str]) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    return user_id


def _require_admin_view(user_id: Optional[str]):
    _uid(user_id)
    if not check_module_permission(user_id, MODULE_ADMIN, "can_view"):
        raise HTTPException(status_code=403, detail="Acesso negado à gestão da Ficha Técnica")


def _require_admin_edit(user_id: Optional[str]):
    _uid(user_id)
    if not check_module_permission(user_id, MODULE_ADMIN, "can_edit"):
        raise HTTPException(status_code=403, detail="Sem permissão para alterar a Ficha Técnica")


def _require_galeria(user_id: Optional[str]):
    # Catálogo de Fichas Técnicas é visível a todos os usuários logados (sem exigir ficha_tecnica_catalogo)
    _uid(user_id)


# ─────────────────────────────────────────────
#  Tabela
# ─────────────────────────────────────────────
def ensure_ficha_tecnica_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ficha_tecnica_pdf (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                nome_arquivo    VARCHAR(300) NOT NULL,
                documento       BYTEA NOT NULL,
                mime_type       VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
                tamanho_bytes   BIGINT,
                ativo           BOOLEAN NOT NULL DEFAULT FALSE,
                token_publico   TEXT UNIQUE NOT NULL,
                criado_por      UUID,
                criado_por_nome TEXT,
                criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                atualizado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_ficha_tecnica_ativo ON ficha_tecnica_pdf (ativo);
            """
        )
        cur.execute("ALTER TABLE ficha_tecnica_pdf ADD COLUMN IF NOT EXISTS capa BYTEA")
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _gerar_capa(conteudo: bytes) -> Optional[bytes]:
    """Renderiza a 1ª página do PDF como PNG (capa). Retorna None em caso de falha."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=conteudo, filetype="pdf")
        if doc.page_count == 0:
            doc.close()
            return None
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        png = pix.tobytes("png")
        doc.close()
        return png
    except Exception as e:
        print(f"[ficha_tecnica] falha ao gerar capa: {e}")
        return None


def _num_paginas(conteudo: bytes) -> int:
    """Quantidade de páginas do PDF. Retorna 0 em caso de falha."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=conteudo, filetype="pdf")
        n = doc.page_count
        doc.close()
        return n
    except Exception as e:
        print(f"[ficha_tecnica] falha ao contar páginas: {e}")
        return 0


def _gerar_pagina(conteudo: bytes, n: int) -> Optional[bytes]:
    """Renderiza a página n (base 0) do PDF como PNG. Retorna None em caso de falha."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=conteudo, filetype="pdf")
        if n < 0 or n >= doc.page_count:
            doc.close()
            return None
        page = doc.load_page(n)
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
        png = pix.tobytes("png")
        doc.close()
        return png
    except Exception as e:
        print(f"[ficha_tecnica] falha ao gerar página {n}: {e}")
        return None


def _nome_usuario(cur, user_id: str) -> str:
    try:
        cur.execute("SELECT name FROM users WHERE id = %s", (str(user_id),))
        row = cur.fetchone()
        return (row[0] or "") if row else ""
    except Exception:
        return ""


def _serializa(row) -> dict:
    # row: id, nome_arquivo, mime_type, tamanho_bytes, ativo, token_publico,
    #      criado_por, criado_por_nome, criado_em, atualizado_em
    return {
        "id": str(row[0]),
        "nome_arquivo": row[1],
        "mime_type": row[2],
        "tamanho_bytes": int(row[3]) if row[3] is not None else None,
        "ativo": bool(row[4]),
        "token_publico": row[5],
        "criado_por": str(row[6]) if row[6] else None,
        "criado_por_nome": row[7] or "",
        "criado_em": row[8].isoformat() if row[8] else None,
        "atualizado_em": row[9].isoformat() if row[9] else None,
    }


_COLS = ("id, nome_arquivo, mime_type, tamanho_bytes, ativo, token_publico, "
         "criado_por, criado_por_nome, criado_em, atualizado_em")


# ─────────────────────────────────────────────
#  Gestão (Marketing)
# ─────────────────────────────────────────────
@router.get("/listar")
def listar(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista TODOS os PDFs (ativos e inativos) — tela de gestão do Marketing."""
    _require_admin_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT {_COLS} FROM ficha_tecnica_pdf ORDER BY criado_em DESC")
        itens = [_serializa(r) for r in cur.fetchall()]
        return {"itens": itens}
    finally:
        cur.close()
        conn.close()


@router.post("/upload")
async def upload(file: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Carrega um novo PDF (inicia desativado)."""
    _require_admin_edit(user_id)
    if (file.content_type or "").lower() not in ("application/pdf", "application/x-pdf", "application/octet-stream"):
        # Aceita pelo content-type ou pela extensão .pdf
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Apenas arquivos PDF são aceitos")
    conteudo = await file.read()
    if not conteudo:
        raise HTTPException(status_code=400, detail="Arquivo vazio")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        nome_user = _nome_usuario(cur, user_id)
        token = secrets.token_urlsafe(24)
        capa = _gerar_capa(conteudo)
        cur.execute(
            """
            INSERT INTO ficha_tecnica_pdf
                (nome_arquivo, documento, mime_type, tamanho_bytes, ativo,
                 token_publico, criado_por, criado_por_nome, capa)
            VALUES (%s, %s, %s, %s, FALSE, %s, %s, %s, %s)
            RETURNING """ + _COLS,
            ((file.filename or "ficha-tecnica.pdf")[:300], conteudo,
             "application/pdf", len(conteudo), token, user_id, nome_user, capa),
        )
        item = _serializa(cur.fetchone())
        conn.commit()
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback(); raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
    return {"ok": True, "item": item}


@router.put("/{pdf_id}")
def atualizar_status(pdf_id: str, ativo: bool = Body(..., embed=True),
                     user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Ativa (publica) ou desativa um PDF."""
    _require_admin_edit(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE ficha_tecnica_pdf SET ativo = %s, atualizado_em = CURRENT_TIMESTAMP WHERE id = %s",
            (bool(ativo), pdf_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="PDF não encontrado")
        conn.commit()
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback(); raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
    return {"ok": True, "ativo": bool(ativo)}


@router.delete("/{pdf_id}")
def excluir(pdf_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin_edit(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM ficha_tecnica_pdf WHERE id = %s", (pdf_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="PDF não encontrado")
        conn.commit()
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback(); raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ─────────────────────────────────────────────
#  Galeria / Catálogo (usuários do portal)
# ─────────────────────────────────────────────
@router.get("/galeria")
def galeria(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista somente os PDFs ATIVOS (publicados) — página de catálogo do portal."""
    _require_galeria(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT {_COLS} FROM ficha_tecnica_pdf WHERE ativo = TRUE ORDER BY criado_em DESC")
        itens = [_serializa(r) for r in cur.fetchall()]
        return {"itens": itens}
    finally:
        cur.close()
        conn.close()


@router.get("/capa/{pdf_id}")
def capa(pdf_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Retorna a capa (PNG da 1ª página). Gera e armazena sob demanda se ainda não existir."""
    _require_galeria(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT capa, documento FROM ficha_tecnica_pdf WHERE id = %s", (pdf_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="PDF não encontrado")
        capa_bytes = bytes(row[0]) if row[0] is not None else None
        if capa_bytes is None and row[1] is not None:
            capa_bytes = _gerar_capa(bytes(row[1]))
            if capa_bytes:
                cur.execute("UPDATE ficha_tecnica_pdf SET capa = %s WHERE id = %s", (capa_bytes, pdf_id))
                conn.commit()
        if not capa_bytes:
            raise HTTPException(status_code=404, detail="Capa indisponível")
        return Response(content=capa_bytes, media_type="image/png",
                        headers={"Cache-Control": "private, max-age=3600"})
    finally:
        cur.close()
        conn.close()


@router.get("/download/{pdf_id}")
def download(pdf_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Baixa o PDF (anexo) — exige permissão de visualização do catálogo."""
    _require_galeria(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT documento, mime_type, nome_arquivo, ativo FROM ficha_tecnica_pdf WHERE id = %s", (pdf_id,))
        row = cur.fetchone()
        if not row or not row[3]:
            raise HTTPException(status_code=404, detail="PDF não encontrado")
        nome = row[2] or "ficha-tecnica.pdf"
        headers = {"Content-Disposition": f'attachment; filename="{nome}"'}
        return Response(content=bytes(row[0]), media_type=row[1] or "application/pdf", headers=headers)
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Link público (acesso externo, sem login)
# ─────────────────────────────────────────────
_VIEWER_HTML = r"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="robots" content="noindex, nofollow" />
<title>{{TITULO}}</title>
<script src="https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js"></script>
<style>
  :root { --brand:#2563eb; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1e293b 0%, #0f172a 55%, #0b1220 100%);
    color: #e2e8f0; display: flex; flex-direction: column; min-height: 100%;
  }
  header.topbar {
    display: flex; align-items: center; gap: 12px; padding: 14px 20px;
    border-bottom: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(6px);
  }
  header.topbar h1 { font-size: 15px; font-weight: 600; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .counter { font-size: 13px; color: #94a3b8; white-space: nowrap; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
    color: #e2e8f0; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
    border-radius: 999px; padding: 8px 14px; cursor: pointer; text-decoration: none;
    white-space: nowrap; transition: background .15s;
  }
  .btn:hover { background: rgba(255,255,255,.16); }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center;
    position: relative; padding: 36px 96px; min-height: 0; }
  @media (max-width: 640px) { .stage { padding: 20px 64px; } }
  #book { box-shadow: 0 30px 60px rgba(0,0,0,.55); border-radius: 4px; }
  #book img { width: 100%; height: 100%; display: block; }
  .nav {
    position: absolute; top: 50%; transform: translateY(-50%); z-index: 20;
    width: 48px; height: 48px; border-radius: 999px; border: none; cursor: pointer;
    background: rgba(255,255,255,.92); color: #1e293b; font-size: 24px; line-height: 1;
    display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(0,0,0,.4);
  }
  .nav:hover { background: #fff; }
  .nav.prev { left: 14px; } .nav.next { right: 14px; }
  .nav:disabled { opacity: .35; cursor: default; }
  .loading { color: #94a3b8; font-size: 14px; display: flex; flex-direction: column;
    align-items: center; gap: 14px; }
  .spinner { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,.2);
    border-top-color: var(--brand); border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { text-align: center; font-size: 12px; color: #64748b; padding: 6px 0 16px; }
  @media (max-width: 640px) {
    header.topbar h1 { font-size: 13px; }
    .label { display: none; }
    .btn { padding: 8px; }
  }
</style>
</head>
<body>
  <header class="topbar">
    <h1>{{TITULO}}</h1>
    <span class="counter" id="counter"></span>
    <button class="btn" id="fs"><span class="label">Tela cheia</span>⛶</button>
    <a class="btn" id="dl" href="#" target="_blank" rel="noopener"><span class="label">Baixar PDF</span>⭳</a>
  </header>

  <div class="stage" id="stage">
    <button class="nav prev" id="prev" aria-label="Anterior">‹</button>
    <div id="book"></div>
    <div class="loading" id="loading"><div class="spinner"></div><span>Carregando revista…</span></div>
    <button class="nav next" id="next" aria-label="Próxima">›</button>
  </div>
  <div class="hint">Arraste as bordas ou use as setas para folhear</div>

<script>
(function () {
  var base = location.pathname.replace(/\/+$/, '');
  document.getElementById('dl').href = base + '/pdf';

  var stage = document.getElementById('stage');
  var bookEl = document.getElementById('book');
  var loading = document.getElementById('loading');
  var counter = document.getElementById('counter');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var fsBtn = document.getElementById('fs');

  function dims() {
    var portrait = window.innerWidth < 820;
    var pages = portrait ? 1 : 2;
    var availW = Math.max(240, stage.clientWidth - 24);   // padding do palco já reserva as setas/margens
    var availH = Math.max(320, stage.clientHeight - 24);
    var w = availW / pages;
    var h = w / 0.707;                 // proporção A4 retrato
    if (h > availH) { h = availH; w = h * 0.707; }
    // teto: evita a página ficar gigante em monitores grandes
    var maxW = portrait ? 460 : 540;
    if (w > maxW) { w = maxW; h = w / 0.707; }
    return { w: Math.floor(w), h: Math.floor(h), portrait: portrait };
  }

  fetch(base + '/info').then(function (r) {
    if (!r.ok) throw new Error('info');
    return r.json();
  }).then(function (info) {
    var total = info.paginas || 0;
    if (!total) { loading.innerHTML = '<span>Não foi possível carregar o documento.</span>'; return; }

    var urls = [];
    for (var i = 0; i < total; i++) urls.push(base + '/pagina/' + i);

    var pageFlip = null;
    var current = 0;

    function refresh() {
      current = pageFlip.getCurrentPageIndex();
      counter.textContent = (current + 1) + ' / ' + total;
      prevBtn.disabled = current <= 0;
      nextBtn.disabled = current >= total - 1;
    }

    function build() {
      var keep = current;
      if (pageFlip) { try { pageFlip.destroy(); } catch (e) {} bookEl.innerHTML = ''; }
      var d = dims();
      pageFlip = new St.PageFlip(bookEl, {
        width: d.w, height: d.h, size: 'fixed',
        showCover: true, usePortrait: d.portrait, mobileScrollSupport: false,
        maxShadowOpacity: 0.5, drawShadow: true, flippingTime: 800
      });
      pageFlip.on('flip', refresh);
      pageFlip.on('init', function () {
        loading.style.display = 'none';
        if (keep > 0) { try { pageFlip.turnToPage(keep); } catch (e) {} }
        refresh();
      });
      pageFlip.loadFromImages(urls);
    }

    build();

    prevBtn.addEventListener('click', function () { pageFlip.flipPrev(); });
    nextBtn.addEventListener('click', function () { pageFlip.flipNext(); });

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(build, 200);
    });
  }).catch(function () {
    loading.innerHTML = '<span>Não foi possível carregar o documento.</span>';
  });

  fsBtn.addEventListener('click', function () {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || function(){})();
    } else {
      document.exitFullscreen();
    }
  });
})();
</script>
</body>
</html>"""


def _busca_documento_publico(token: str):
    """Retorna (documento_bytes, mime_type, nome_arquivo) se ativo, senão 404."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT documento, mime_type, nome_arquivo, ativo FROM ficha_tecnica_pdf WHERE token_publico = %s",
            (token,),
        )
        row = cur.fetchone()
        if not row or not row[3]:
            raise HTTPException(status_code=404, detail="Documento indisponível")
        return bytes(row[0]), (row[1] or "application/pdf"), (row[2] or "ficha-tecnica.pdf")
    finally:
        cur.close()
        conn.close()


@router.get("/p/{token}")
def visualizar_publico(token: str):
    """PÚBLICO: exibe o PDF como revista folheável (flipbook). Sem autenticação."""
    _doc, _mime, nome = _busca_documento_publico(token)
    titulo = nome[:-4] if nome.lower().endswith(".pdf") else nome
    html = _VIEWER_HTML.replace("{{TOKEN}}", token).replace("{{TITULO}}", titulo)
    return Response(content=html, media_type="text/html; charset=utf-8",
                    headers={"X-Robots-Tag": "noindex, nofollow"})


@router.get("/p/{token}/info")
def visualizar_publico_info(token: str):
    """PÚBLICO: metadados do documento (nome e total de páginas) para o flipbook."""
    doc, _mime, nome = _busca_documento_publico(token)
    return {"nome": nome, "paginas": _num_paginas(doc)}


@router.get("/p/{token}/pagina/{n}")
def visualizar_publico_pagina(token: str, n: int):
    """PÚBLICO: página n (base 0) do PDF renderizada como PNG."""
    doc, _mime, _nome = _busca_documento_publico(token)
    png = _gerar_pagina(doc, n)
    if not png:
        raise HTTPException(status_code=404, detail="Página indisponível")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex, nofollow"})


@router.get("/p/{token}/pdf")
def visualizar_publico_pdf(token: str):
    """PÚBLICO: o PDF original inline (usado pelo botão de baixar/abrir no flipbook)."""
    doc, mime, nome = _busca_documento_publico(token)
    return Response(content=doc, media_type=mime,
                    headers={"Content-Disposition": f'inline; filename="{nome}"',
                             "X-Robots-Tag": "noindex, nofollow"})
