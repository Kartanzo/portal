"""
Comissão (Financeiro) — controle de comissões dos vendedores.

Fonte dos dados: planilha Google `CONTROLE_COMISSAO` (somente-leitura via service account).
A planilha é sincronizada para o nosso banco (tabela `comissao_registro`), e a partir daí:
- a validação financeira (aprovado/reprovado) é guardada NO NOSSO BANCO (a planilha é read-only);
- os PDFs antigos são buscados do Google Drive (coluna PDF aponta para o arquivo no AppSheet);
- os PDFs novos são enviados pelo portal (upload individual ou em lote, vinculando por código+nome).

Separação: por MES_COMISSAO e por REFERENCIA.
"""
import io
import os
import re
import json
import unicodedata
from typing import List, Optional

import requests
from fastapi import APIRouter, HTTPException, UploadFile, File, Response, Depends
from pydantic import BaseModel

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from core import dummy

router = APIRouter(prefix="/financeiro/comissao", tags=["Comissão"])

MODULE_ID = "financeiro_comissao"
SHEET_ID = "1xHjxgS70Kb6F-tsux0ABKbWCUMhWlYj19iL5UgW-SKY"
EMAIL_SHEET_ID = "18fTwrgl0lehyAmJWazl7YrS24R-lQBH0sHAuWVD8E2E"

# Credenciais Google (mesmo mecanismo de importation.py).
_HERE = os.path.dirname(os.path.abspath(__file__))
_CRED_CANDIDATES = [
    os.path.join(_HERE, "..", "..", "credentials", "google_credentials.json"),
    os.path.join(_HERE, "..", "credentials", "google_credentials.json"),
    "credentials/google_credentials.json",
]
_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


# ─────────────────────────────────────────────
#  Permissões
# ─────────────────────────────────────────────
def _uid(user_id: Optional[str]) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    return user_id


def _require_view(user_id: Optional[str]):
    _uid(user_id)
    if not check_module_permission(user_id, MODULE_ID, "can_view"):
        raise HTTPException(status_code=403, detail="Acesso negado à Comissão")


def _require_edit(user_id: Optional[str]):
    _uid(user_id)
    if not check_module_permission(user_id, MODULE_ID, "can_edit"):
        raise HTTPException(status_code=403, detail="Sem permissão para alterar a Comissão")


# ─────────────────────────────────────────────
#  Normalização (matching de código e nome)
# ─────────────────────────────────────────────
def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm_nome(s: str) -> str:
    """minúsculo, sem acento, só letras e números (remove espaço, hífen, etc.)."""
    s = _strip_accents(s or "").lower()
    return re.sub(r"[^a-z0-9]", "", s)


def norm_cod(s: str) -> str:
    """só dígitos, sem zeros à esquerda (024 -> 24)."""
    d = re.sub(r"\D", "", str(s or ""))
    d = d.lstrip("0")
    return d or ("0" if re.sub(r"\D", "", str(s or "")) else "")


def _chave_sync(mes: str, ref: str, cod: str) -> str:
    return f"{norm_nome(mes)}|{norm_nome(ref)}|{norm_cod(cod)}"


# ─────────────────────────────────────────────
#  Google (Sheets via gspread; Drive via REST + token google-auth)
# ─────────────────────────────────────────────
def _google_creds():
    # DUMMY: sem fontes externas — não há credenciais Google a carregar.
    # Mantido como no-op para preservar a assinatura usada pelas funções abaixo.
    return None


def _ler_planilha() -> List[dict]:
    # DUMMY: gera linhas fictícias da planilha CONTROLE_COMISSAO (sem gspread).
    # Para cada representante, 12 meses de 2026 e uma referência por mês.
    # Mantém o mesmo shape (dict por linha com as chaves que /sync espera).
    out: List[dict] = []
    for cod, nome in dummy.REPRESENTANTES:
        r = dummy.rng("comissao_planilha", cod)
        for i, mes_longo in enumerate(dummy.MESES_PT_LONGO):
            mm = f"{i + 1:02d}"
            mes_comissao = f"{mes_longo}/{dummy.ANO_BASE}"
            referencia = f"{mm}/{dummy.ANO_BASE} - {nome}"
            comissao = f"{dummy.valor(r, base=3000.0, var=0.5):.2f}".replace(".", ",")
            premio = f"{dummy.valor(r, base=800.0, var=0.6):.2f}".replace(".", ",")
            total = f"{dummy.valor(r, base=3800.0, var=0.5):.2f}".replace(".", ",")
            validacao = dummy.escolher(r, ["VALIDADO", "REPROVADO", ""])
            out.append({
                "CÓDIGO_DO_VENDEDOR": cod,
                "NOME_FANTASIA": nome,
                "MES_COMISSAO": mes_comissao,
                "REFERENCIA": referencia,
                "COMISSÃO": comissao,
                "total_a_receber": total,
                "PDF": f"CONTROLE_COMISSAO_Files_/{cod}-{nome}_{dummy.inteiro(r, 10**12, 10**13)}.PDF.pdf",
                "VALIDACAO_FINANCEIRO": validacao,
                "EMAIL": f"{norm_cod(cod) or cod}@dummy.local",
                "premio": premio,
                "PREMIAÇÃO": premio,
                "TOTAL": total,
                "realizado": f"{dummy.valor(r, base=50000.0):.2f}".replace(".", ","),
                "meta": f"{dummy.valor(r, base=45000.0):.2f}".replace(".", ","),
                "percentual": f"{dummy.inteiro(r, 1, 12)}%",
                "chave_vendedor": cod,
                "CHAVE": f"{cod}-{mm}",
            })
    return out


def _ler_emails() -> dict:
    """Mapa codigo_norm -> (email_primario, email_secundario). DUMMY: e-mails fictícios por código de representante."""
    out = {}
    for cod, _nome in dummy.REPRESENTANTES:
        cn = norm_cod(cod)
        if not cn:
            continue
        out[cn] = (f"{cn}@dummy.local", f"{cn}.cc@dummy.local")
    return out


def _drive_token() -> str:
    # DUMMY: sem Drive — token fictício (não usado em chamada de rede).
    return "dummy-token"


def _drive_buscar_baixar(pdf_ref: str, token: Optional[str] = None):
    """DUMMY: NÃO acessa o Drive. Gera um PDF mínimo válido em memória e retorna
    (bytes, mime_type, nome) — mesmo shape do original. Retorna None se pdf_ref vazio."""
    nome = (pdf_ref or "").split("/")[-1].strip()
    if not nome:
        return None
    # PDF mínimo válido (%PDF ... %%EOF) com uma página em branco, gerado em memória.
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"
    )
    nome_pdf = nome if nome.lower().endswith(".pdf") else f"{nome}.pdf"
    return pdf_bytes, "application/pdf", nome_pdf


# ─────────────────────────────────────────────
#  Tabelas
# ─────────────────────────────────────────────
def ensure_comissao_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS comissao_documento (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                documento    BYTEA NOT NULL,
                mime_type    VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
                nome_arquivo VARCHAR(300),
                criado_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                criado_por   UUID
            );

            CREATE TABLE IF NOT EXISTS comissao_registro (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                chave_sync       TEXT UNIQUE NOT NULL,
                codigo_vendedor  TEXT,
                codigo_norm      TEXT,
                nome_fantasia    TEXT,
                nome_norm        TEXT,
                comissao         TEXT,
                total_a_receber  TEXT,
                mes_comissao     TEXT,
                referencia       TEXT,
                pdf_ref          TEXT,
                validacao_sheet  TEXT,
                email            TEXT,
                dados_extra      JSONB DEFAULT '{}'::jsonb,
                status_validacao TEXT NOT NULL DEFAULT 'pendente',
                documento_id     UUID REFERENCES comissao_documento(id) ON DELETE SET NULL,
                origem_pdf       TEXT,
                validado_por     UUID,
                validado_em      TIMESTAMP,
                criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                atualizado_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_comissao_mes ON comissao_registro (mes_comissao);
            CREATE INDEX IF NOT EXISTS ix_comissao_cod ON comissao_registro (codigo_norm);
            """
        )
        cur.execute("ALTER TABLE comissao_registro ADD COLUMN IF NOT EXISTS email_primario TEXT")
        cur.execute("ALTER TABLE comissao_registro ADD COLUMN IF NOT EXISTS email_secundario TEXT")
        cur.execute("ALTER TABLE comissao_registro ADD COLUMN IF NOT EXISTS email_enviado_em TIMESTAMP")
        cur.execute("CREATE TABLE IF NOT EXISTS comissao_sync (id INT PRIMARY KEY, sincronizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.commit()
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Sincronização com a planilha
# ─────────────────────────────────────────────
@router.post("/sync")
def sincronizar(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lê a planilha e faz upsert na tabela. Preserva nossos campos (status/documento/origem)."""
    _require_edit(user_id)
    linhas = _ler_planilha()
    conn = get_db_connection()
    cur = conn.cursor()
    inseridos = atualizados = ignorados = 0
    try:
        for row in linhas:
            cod = (row.get("CÓDIGO_DO_VENDEDOR") or row.get("CODIGO_DO_VENDEDOR") or "").strip()
            mes = (row.get("MES_COMISSAO") or "").strip()
            ref = (row.get("REFERENCIA") or "").strip()
            if not (cod and mes and ref):
                ignorados += 1
                continue
            chave = _chave_sync(mes, ref, cod)
            extra = {k: row.get(k) for k in ("percentual", "premio", "PREMIAÇÃO", "TOTAL", "realizado", "meta", "chave_vendedor", "CHAVE")}
            cur.execute(
                """
                INSERT INTO comissao_registro
                    (chave_sync, codigo_vendedor, codigo_norm, nome_fantasia, nome_norm, comissao,
                     total_a_receber, mes_comissao, referencia, pdf_ref, validacao_sheet, email, dados_extra)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (chave_sync) DO UPDATE SET
                    codigo_vendedor = EXCLUDED.codigo_vendedor,
                    codigo_norm     = EXCLUDED.codigo_norm,
                    nome_fantasia   = EXCLUDED.nome_fantasia,
                    nome_norm       = EXCLUDED.nome_norm,
                    comissao        = EXCLUDED.comissao,
                    total_a_receber = EXCLUDED.total_a_receber,
                    mes_comissao    = EXCLUDED.mes_comissao,
                    referencia      = EXCLUDED.referencia,
                    pdf_ref         = EXCLUDED.pdf_ref,
                    validacao_sheet = EXCLUDED.validacao_sheet,
                    email           = EXCLUDED.email,
                    dados_extra     = EXCLUDED.dados_extra,
                    atualizado_em   = CURRENT_TIMESTAMP
                RETURNING (xmax = 0) AS inserido
                """,
                (
                    chave, cod, norm_cod(cod), row.get("NOME_FANTASIA", ""), norm_nome(row.get("NOME_FANTASIA", "")),
                    row.get("COMISSÃO") or row.get("COMISSAO") or "", row.get("total_a_receber", ""),
                    mes, ref, row.get("PDF", ""), row.get("VALIDACAO_FINANCEIRO", ""), row.get("EMAIL", ""),
                    json.dumps(extra, ensure_ascii=False),
                ),
            )
            if cur.fetchone()[0]:
                inseridos += 1
            else:
                atualizados += 1
        # Reflete a validação da planilha (VALIDADO->aprovado) SOMENTE onde ninguém validou no portal
        # (validado_por IS NULL); decisões feitas aqui no portal são preservadas.
        cur.execute(
            """
            UPDATE comissao_registro SET status_validacao = CASE
                WHEN upper(coalesce(validacao_sheet,'')) LIKE '%REPROV%' THEN 'reprovado'
                WHEN upper(coalesce(validacao_sheet,'')) LIKE '%VALID%'  THEN 'aprovado'
                ELSE 'pendente' END
            WHERE validado_por IS NULL
            """
        )
        conn.commit()
        # E-mails (complementar): mapa por código vindo de outra planilha. Best-effort.
        try:
            emails = _ler_emails()
            for cod, (prim, sec) in emails.items():
                cur.execute("UPDATE comissao_registro SET email_primario = %s, email_secundario = %s WHERE codigo_norm = %s", (prim, sec, cod))
            conn.commit()
        except Exception:
            conn.rollback()
        try:
            cur.execute("INSERT INTO comissao_sync (id, sincronizado_em) VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET sincronizado_em = CURRENT_TIMESTAMP")
            conn.commit()
        except Exception:
            conn.rollback()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao sincronizar: {e}")
    finally:
        cur.close()
        conn.close()
    return {"ok": True, "inseridos": inseridos, "atualizados": atualizados, "ignorados": ignorados, "total": len(linhas)}


# ─────────────────────────────────────────────
#  Leitura
# ─────────────────────────────────────────────
@router.get("/meses")
def listar_meses(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT mes_comissao,
                   COUNT(*) AS total,
                   COUNT(documento_id) AS com_pdf,
                   COUNT(*) FILTER (WHERE status_validacao = 'aprovado') AS aprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'reprovado') AS reprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'pendente') AS pendentes
            FROM comissao_registro
            GROUP BY mes_comissao
            ORDER BY mes_comissao
            """
        )
        meses = [{
            "mes": r[0], "total": r[1], "com_pdf": r[2],
            "aprovados": r[3], "reprovados": r[4], "pendentes": r[5],
        } for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"meses": meses}


@router.get("/referencias")
def listar_referencias(mes: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT referencia, COUNT(*) AS total, COUNT(documento_id) AS com_pdf,
                   COUNT(*) FILTER (WHERE status_validacao = 'aprovado') AS aprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'reprovado') AS reprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'pendente') AS pendentes,
                   COUNT(*) FILTER (WHERE documento_id IS NULL AND COALESCE(pdf_ref,'') <> '') AS pdf_no_drive
            FROM comissao_registro WHERE mes_comissao = %s
            GROUP BY referencia ORDER BY referencia
            """,
            (mes,),
        )
        refs = [{"referencia": r[0], "total": r[1], "com_pdf": r[2], "aprovados": r[3],
                 "reprovados": r[4], "pendentes": r[5], "pdf_no_drive": r[6]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()
    return {"referencias": refs}


@router.get("/arvore")
def arvore(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Todas as referências (com contagens) para montar a árvore Ano -> Mês -> Empresa no front."""
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT referencia, COUNT(*) AS total, COUNT(documento_id) AS com_pdf,
                   COUNT(*) FILTER (WHERE status_validacao = 'aprovado') AS aprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'reprovado') AS reprovados,
                   COUNT(*) FILTER (WHERE status_validacao = 'pendente') AS pendentes,
                   COUNT(*) FILTER (WHERE documento_id IS NULL AND COALESCE(pdf_ref,'') <> '') AS pdf_no_drive
            FROM comissao_registro
            GROUP BY referencia ORDER BY referencia
            """
        )
        refs = [{"referencia": r[0], "total": r[1], "com_pdf": r[2], "aprovados": r[3],
                 "reprovados": r[4], "pendentes": r[5], "pdf_no_drive": r[6]} for r in cur.fetchall()]
        cur.execute("SELECT sincronizado_em FROM comissao_sync WHERE id = 1")
        _sr = cur.fetchone()
        ultima_sync = _sr[0].isoformat() if _sr and _sr[0] else None
    finally:
        cur.close(); conn.close()
    return {"referencias": refs, "ultima_sync": ultima_sync}


@router.get("/registros")
def listar_registros(referencia: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id::text, codigo_vendedor, nome_fantasia, comissao, total_a_receber,
                   referencia, status_validacao, validacao_sheet,
                   (documento_id IS NOT NULL) AS tem_pdf, documento_id::text, origem_pdf,
                   pdf_ref, email, dados_extra, email_primario, email_secundario, email_enviado_em
            FROM comissao_registro
            WHERE referencia = %s
            ORDER BY codigo_norm
            """,
            (referencia,),
        )
        regs = []
        for r in cur.fetchall():
            ex = r[13] or {}
            regs.append({
                "id": r[0], "codigo_vendedor": r[1], "nome_fantasia": r[2], "comissao": r[3],
                "total_a_receber": r[4], "referencia": r[5], "status_validacao": r[6],
                "validacao_sheet": r[7], "tem_pdf": r[8], "documento_id": r[9], "origem_pdf": r[10],
                "pdf_ref": r[11], "tem_pdf_origem": bool((r[11] or "").strip()), "email": r[12],
                "realizado": ex.get("realizado"), "meta": ex.get("meta"),
                "percentual": ex.get("percentual"), "premio": ex.get("premio"),
                "premiacao": ex.get("PREMIAÇÃO"), "total": ex.get("TOTAL"),
                "email_primario": r[14], "email_secundario": r[15],
                "email_enviado_em": r[16].isoformat() if r[16] else None,
            })
    finally:
        cur.close()
        conn.close()
    return {"registros": regs}


# ─────────────────────────────────────────────
#  Validação (individual e em lote)
# ─────────────────────────────────────────────
class ValidarBody(BaseModel):
    ids: List[str]
    status: str  # aprovado | reprovado | pendente


@router.post("/validar")
def validar(body: ValidarBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_edit(user_id)
    if body.status not in ("aprovado", "reprovado", "pendente"):
        raise HTTPException(status_code=400, detail="status inválido")
    if not body.ids:
        return {"ok": True, "atualizados": 0}
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE comissao_registro
            SET status_validacao = %s, validado_por = %s, validado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ANY(%s::uuid[])
            """,
            (body.status, user_id, body.ids),
        )
        n = cur.rowcount
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()
    return {"ok": True, "atualizados": n}


# ─────────────────────────────────────────────
#  PDF — servir, upload individual, upload em lote, buscar do Drive
# ─────────────────────────────────────────────
def _salvar_documento(cur, conteudo: bytes, mime: str, nome: str, user_id: str) -> str:
    cur.execute(
        "INSERT INTO comissao_documento (documento, mime_type, nome_arquivo, criado_por) VALUES (%s,%s,%s,%s) RETURNING id::text",
        (conteudo, mime or "application/pdf", (nome or "")[:300], user_id),
    )
    return cur.fetchone()[0]


@router.get("/documento/{doc_id}")
def obter_documento(doc_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT documento, mime_type, nome_arquivo FROM comissao_documento WHERE id = %s", (doc_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Documento não encontrado")
        headers = {"Content-Disposition": f'inline; filename="{(row[2] or "comissao.pdf")}"'}
        return Response(content=bytes(row[0]), media_type=row[1] or "application/pdf", headers=headers)
    finally:
        cur.close()
        conn.close()


@router.post("/{reg_id}/documento")
async def upload_documento(reg_id: str, file: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_edit(user_id)
    conteudo = await file.read()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM comissao_registro WHERE id = %s", (reg_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Registro não encontrado")
        doc_id = _salvar_documento(cur, conteudo, file.content_type, file.filename, user_id)
        cur.execute(
            "UPDATE comissao_registro SET documento_id = %s, origem_pdf = 'upload', atualizado_em = CURRENT_TIMESTAMP WHERE id = %s",
            (doc_id, reg_id),
        )
        conn.commit()
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback(); raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
    return {"ok": True, "documento_id": doc_id}


@router.post("/documentos-lote")
async def upload_lote(referencia: str, files: List[UploadFile] = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Recebe vários PDFs e vincula a cada registro do mês pelo CÓDIGO (com fallback 024<->24) + nome.
    O nome do arquivo deve começar pelo código do vendedor (ex.: '024-ANDREIA-AL.pdf')."""
    _require_edit(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    vinculados, nao_encontrados, ambiguos = [], [], []
    try:
        # registros do mês indexados por código normalizado
        cur.execute("SELECT id::text, codigo_norm, nome_norm FROM comissao_registro WHERE referencia = %s", (referencia,))
        por_cod = {}
        for rid, cnorm, nnorm in cur.fetchall():
            por_cod.setdefault(cnorm, []).append((rid, nnorm))

        for f in files:
            nome_arq = f.filename or ""
            mcod = re.match(r"\s*0*(\d+)", nome_arq)
            cnorm = norm_cod(mcod.group(1)) if mcod else ""
            nnorm_arq = norm_nome(re.sub(r"\.[a-zA-Z0-9]+$", "", nome_arq))
            cands = por_cod.get(cnorm, [])
            alvo = None
            if len(cands) == 1:
                alvo = cands[0][0]
            elif len(cands) > 1:
                # desempata pelo nome normalizado contido no nome do arquivo
                match = [rid for rid, nnorm in cands if nnorm and nnorm in nnorm_arq]
                if len(match) == 1:
                    alvo = match[0]
                else:
                    ambiguos.append(nome_arq)
            if not alvo:
                if not cands:
                    nao_encontrados.append(nome_arq)
                continue
            conteudo = await f.read()
            doc_id = _salvar_documento(cur, conteudo, f.content_type, nome_arq, user_id)
            cur.execute(
                "UPDATE comissao_registro SET documento_id = %s, origem_pdf = 'upload', atualizado_em = CURRENT_TIMESTAMP WHERE id = %s",
                (doc_id, alvo),
            )
            vinculados.append(nome_arq)
        conn.commit()
        cur.execute(
            "SELECT codigo_vendedor, nome_fantasia FROM comissao_registro "
            "WHERE referencia = %s AND documento_id IS NULL ORDER BY codigo_norm",
            (referencia,),
        )
        sem_pdf = [{"codigo": r[0], "nome": r[1]} for r in cur.fetchall()]
    except Exception as e:
        conn.rollback(); raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
    return {"ok": True, "vinculados": vinculados, "nao_encontrados": nao_encontrados, "ambiguos": ambiguos, "vendedores_sem_pdf": sem_pdf}


class BuscarDriveBody(BaseModel):
    referencia: str
    limite: int = 200


@router.post("/buscar-drive")
def buscar_drive(body: BuscarDriveBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Baixa do Drive (AppSheet) os PDFs de origem ainda sem documento, do mês (e referência,
    se informada), em PARALELO. Escopar por referência + limite evita o timeout do nginx (504)."""
    _require_edit(user_id)
    import concurrent.futures
    conn = get_db_connection()
    cur = conn.cursor()
    baixados, falhas, restantes = 0, [], 0
    try:
        cur.execute(
            "SELECT id::text, pdf_ref FROM comissao_registro "
            "WHERE referencia = %s "
            "AND documento_id IS NULL AND COALESCE(pdf_ref,'') <> '' LIMIT %s",
            (body.referencia, max(1, min(body.limite, 500))),
        )
        pendentes = cur.fetchall()
        if pendentes:
            token = _drive_token()

            def _baixa(item):
                rid, pdf_ref = item
                try:
                    return rid, _drive_buscar_baixar(pdf_ref, token=token), None
                except Exception as e:
                    return rid, None, str(e)[:160]

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
                resultados = list(ex.map(_baixa, pendentes))

            for rid, res, err in resultados:
                if err:
                    falhas.append({"id": rid, "motivo": err}); continue
                if not res:
                    falhas.append({"id": rid, "motivo": "arquivo não encontrado no Drive"}); continue
                conteudo, mime, nome = res
                try:
                    doc_id = _salvar_documento(cur, conteudo, mime, nome, user_id)
                    cur.execute(
                        "UPDATE comissao_registro SET documento_id = %s, origem_pdf = 'drive', atualizado_em = CURRENT_TIMESTAMP WHERE id = %s",
                        (doc_id, rid),
                    )
                    conn.commit()
                    baixados += 1
                except Exception as e:
                    conn.rollback()
                    falhas.append({"id": rid, "motivo": str(e)[:160]})

        cur.execute(
            "SELECT COUNT(*) FROM comissao_registro "
            "WHERE referencia = %s "
            "AND documento_id IS NULL AND COALESCE(pdf_ref,'') <> ''",
            (body.referencia,),
        )
        restantes = cur.fetchone()[0]
    finally:
        cur.close(); conn.close()
    return {"ok": True, "baixados": baixados, "total_pendentes": len(pendentes), "falhas": falhas, "restantes": restantes}


# ─────────────────────────────────────────────
#  Envio de e-mails de comissão (1 por vendedor aprovado, com PDF anexo)
# ─────────────────────────────────────────────
CC_FIXOS = ["comissao@empresa.com.br", "vendas@empresa.com.br"]


def _gmail_creds():
    # DUMMY: sem envio externo — credenciais fictícias. O login SMTP real falhará
    # e cada e-mail é registrado como falha (nenhuma mensagem sai), comportamento esperado sem fontes externas.
    return "dummy@dummy.local", "dummy-password"


def _parse_ref_py(ref: str):
    semext = re.sub(r"\.(xls|xlsx|csv)\s*$", "", ref or "", flags=re.I)
    m = re.search(r"(\d{1,2})[.\/](\d{4})", semext)
    mm = m.group(1).zfill(2) if m else ""
    ano = m.group(2) if m else ""
    partes = [x.strip() for x in semext.split(" - ")]
    empresa = partes[-1] if len(partes) > 1 else ref
    return ano, mm, empresa


def _valor_br(x):
    x = (str(x or "")).strip()
    return x if x and x.lower() not in ("nan", "inf") else "0,00"


def _corpo_email(nome, comissao, premio, total):
    return (
        f"Olá {nome},\n"
        f"Segue relatório de Comissão,\n"
        f"Comissão: R$ {_valor_br(comissao)}\n"
        f"Premiação: R$ {_valor_br(premio)}\n"
        f"TOTAL A RECEBER: R$ {_valor_br(total)}\n\n"
        f"****** FAVOR ENVIAR NOTA Usuário 30 PARA: comissao@empresa.com.br***********"
    )


class EnviarEmailsBody(BaseModel):
    referencia: str
    ids: Optional[List[str]] = None
    limite: int = 80
    cc_fixos: bool = True   # incluir comissao@ e vendas@ em copia (desligar p/ teste)
    reenviar: bool = False  # se False, pula quem ja recebeu (email_enviado_em preenchido)


@router.post("/enviar-emails")
def enviar_emails(body: EnviarEmailsBody, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Envia 1 e-mail por vendedor APROVADO que tenha PDF e e-mail, com o PDF anexo.
    TO = e-mail primário; CC = secundário + comissao@ + vendas@. Nunca junta vendedores."""
    _require_edit(user_id)
    import smtplib
    import threading
    import concurrent.futures
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.application import MIMEApplication

    ano, mm, empresa = _parse_ref_py(body.referencia)
    assunto = f"Relatório de Comissão - {ano}-{mm} - {empresa}".strip()

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id::text, codigo_vendedor, nome_fantasia, comissao, total_a_receber,
                   dados_extra->>'premio', email_primario, email_secundario, documento_id::text, status_validacao,
                   email_enviado_em
            FROM comissao_registro
            WHERE referencia = %s AND (%s IS NULL OR id = ANY(%s::uuid[]))
            ORDER BY codigo_norm
            """,
            (body.referencia, body.ids, body.ids),
        )
        linhas = cur.fetchall()
        elegiveis, pulados = [], []
        for r in linhas:
            (rid, cod, nome, comissao, total, premio, ep, es, doc_id, status, env_em) = r
            ep = (ep or "").strip(); es = (es or "").strip()
            if status != "aprovado":
                pulados.append({"codigo": cod, "nome": nome, "motivo": "não aprovado"}); continue
            if not doc_id:
                pulados.append({"codigo": cod, "nome": nome, "motivo": "sem PDF"}); continue
            to_addr = ep or es
            if not to_addr:
                pulados.append({"codigo": cod, "nome": nome, "motivo": "sem e-mail"}); continue
            if env_em and not body.reenviar:
                pulados.append({"codigo": cod, "nome": nome, "motivo": "já enviado"}); continue
            cc = []
            if es and es.lower() != to_addr.lower():
                cc.append(es)
            if body.cc_fixos:
                for c in CC_FIXOS:
                    if c.lower() != to_addr.lower() and c.lower() not in [x.lower() for x in cc]:
                        cc.append(c)
            elegiveis.append({"id": rid, "codigo": cod, "nome": nome, "to": to_addr, "cc": cc,
                              "comissao": comissao, "premio": premio, "total": total, "doc_id": doc_id})

        restantes = max(0, len(elegiveis) - max(1, min(body.limite, 200)))
        elegiveis = elegiveis[:max(1, min(body.limite, 200))]

        # carrega os PDFs (no banco) antes do envio paralelo
        for e in elegiveis:
            cur.execute("SELECT documento, nome_arquivo FROM comissao_documento WHERE id = %s", (e["doc_id"],))
            row = cur.fetchone()
            e["pdf"] = bytes(row[0]) if row else None
            e["pdf_nome"] = (row[1] if row and row[1] else f"comissao_{e['codigo']}.pdf")
    finally:
        cur.close(); conn.close()

    if not elegiveis:
        return {"ok": True, "enviados": [], "falhas": [], "pulados": pulados, "restantes": 0, "limite_atingido": False, "assunto": assunto}

    gmail_user, gmail_pw = _gmail_creds()
    stop = threading.Event()

    def _eh_limite(msg: str) -> bool:
        m = (msg or "").lower()
        return "5.4.5" in m or "sending limit" in m or "limit exceeded" in m

    def _worker(chunk):
        out = []
        try:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
            server.starttls(); server.login(gmail_user, gmail_pw)
        except Exception as ex:
            if _eh_limite(str(ex)):
                stop.set()
            return [{"id": e["id"], "codigo": e["codigo"], "nome": e["nome"], "erro": f"SMTP: {str(ex)[:140]}"} for e in chunk]
        for e in chunk:
            if stop.is_set():
                out.append({"id": e["id"], "codigo": e["codigo"], "nome": e["nome"], "to": e["to"], "erro": "limite diário do Gmail atingido — não enviado"})
                continue
            try:
                msg = MIMEMultipart()
                msg["From"] = str(gmail_user)
                msg["To"] = e["to"]
                if e["cc"]:
                    msg["Cc"] = ", ".join(e["cc"])
                msg["Subject"] = assunto
                msg.attach(MIMEText(_corpo_email(e["nome"], e["comissao"], e["premio"], e["total"]), "plain", "utf-8"))
                if e["pdf"]:
                    part = MIMEApplication(e["pdf"], _subtype="pdf")
                    part.add_header("Content-Disposition", "attachment", filename=e["pdf_nome"])
                    msg.attach(part)
                server.sendmail(str(gmail_user), [e["to"]] + e["cc"], msg.as_string())
                out.append({"ok": True, "id": e["id"], "codigo": e["codigo"], "nome": e["nome"], "to": e["to"]})
            except Exception as ex:
                if _eh_limite(str(ex)):
                    stop.set()
                out.append({"id": e["id"], "codigo": e["codigo"], "nome": e["nome"], "to": e["to"], "erro": str(ex)[:160]})
        try:
            server.quit()
        except Exception:
            pass
        return out

    # divide em ate 4 conexoes SMTP paralelas
    n_work = min(4, len(elegiveis))
    chunks = [elegiveis[i::n_work] for i in range(n_work)]
    enviados, falhas = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=n_work) as ex:
        for res in ex.map(_worker, chunks):
            for item in res:
                (enviados if item.get("ok") else falhas).append(item)

    # marca os que foram enviados com sucesso (evita reenvio na proxima vez)
    enviado_ids = [it["id"] for it in enviados if it.get("id")]
    if enviado_ids:
        conn2 = get_db_connection(); cur2 = conn2.cursor()
        try:
            cur2.execute("UPDATE comissao_registro SET email_enviado_em = CURRENT_TIMESTAMP WHERE id = ANY(%s::uuid[])", (enviado_ids,))
            conn2.commit()
        except Exception:
            conn2.rollback()
        finally:
            cur2.close(); conn2.close()

    return {"ok": True, "enviados": enviados, "falhas": falhas, "pulados": pulados, "restantes": restantes,
            "assunto": assunto, "limite_atingido": stop.is_set()}


# ─────────────────────────────────────────────────────────────────────────────
#  RELATÓRIO — Conversão para dados dummy (sem fontes externas)
# ─────────────────────────────────────────────────────────────────────────────
# (a) FONTES EXTERNAS SUBSTITUÍDAS:
#     - _google_creds()      -> no-op, retorna None (nenhuma credencial Google é carregada).
#     - _ler_planilha()      -> gera 144 linhas fictícias (12 representantes x 12 meses de 2026)
#                               via dummy.REPRESENTANTES/MESES_PT_LONGO/rng/valor; sem gspread.
#     - _ler_emails()        -> mapa codigo_norm -> (primario, secundario) fictícios
#                               ("<cod>@dummy.local" / "<cod>.cc@dummy.local"); sem gspread.
#     - _drive_token()       -> retorna "dummy-token" (não usado em rede).
#     - _drive_buscar_baixar -> NÃO acessa o Drive; gera um PDF mínimo válido em memória
#                               (%PDF-1.4 ... %%EOF, 1 página em branco) e devolve os bytes.
#     - _gmail_creds()       -> credenciais fictícias; o login SMTP real falha e cada e-mail
#                               é registrado como "falha" (nenhuma mensagem externa sai).
#
# (b) SHAPE/RETORNO PRESERVADO (idêntico ao original):
#     - _ler_planilha  -> List[dict] (chaves CÓDIGO_DO_VENDEDOR/MES_COMISSAO/REFERENCIA/PDF/etc.).
#     - _ler_emails    -> dict { codigo_norm: (str, str) }.
#     - _drive_buscar_baixar -> tuple (bytes, mime_type, nome) ou None se pdf_ref vazio.
#     - _drive_token/_gmail_creds -> mesmos tipos (str / (str,str)).
#     Toda a lógica de Postgres (comissao_registro/comissao_documento/upload/validação/sync)
#     permanece INTACTA — nenhuma assinatura, rota, permissão ou query foi alterada.
#
# (c) TESTE REAL (cd backend && /c/Python312/python -c ...), get_db_connection mockado:
#     EMAILS count: 12  | sample 101 -> ('101@dummy.local', '101.cc@dummy.local')
#     DRIVE tuple len: 3 | mime: application/pdf | bytes head: %PDF-1.4 | valid PDF: True | size: 329
#     DRIVE empty ref -> None
#     PLANILHA rows: 144 | distinct meses (ano 2026): 12 | sample REF: '01/2026 - Representante 01'
#     GMAIL creds: ('dummy@dummy.local','dummy-password') | DRIVE token: dummy-token | GOOGLE creds: None
#
# (d) NÃO CONFIRMADOS (não exercitados end-to-end, dependem de Postgres real):
#     - Rotas /sync, /buscar-drive, /enviar-emails só foram validadas no nível das funções
#       dummy que elas chamam; o caminho completo com banco não foi executado.
#     - O envio SMTP em /enviar-emails resultará em "falhas" (sem rede), como esperado.
