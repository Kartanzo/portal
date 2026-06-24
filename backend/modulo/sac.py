"""
SAC — Módulo de Atendimento ao Cliente
Endpoints para gestão de chamados externos e internos.

─────────────────────────────────────────────────────────────────────────────
 RELATÓRIO — Conversão para modo DUMMY (sem fontes externas)
─────────────────────────────────────────────────────────────────────────────
(a) Externas substituídas (todas eram BigQuery; nenhum gspread/Drive/StarSoft/requests aqui):
    1. _refresh_produtos_cache()  — antes: BigQuery `VENDAS.view_info_ie` (codigo/descricao).
       Agora: gera produtos de dummy.PRODUTOS. Mantém cache em disco + agendamento 24h intactos.
    2. _bq_client()               — antes: monta credenciais SA + cliente BigQuery.
       Agora: no-op lazy (raise) — os únicos chamadores foram reescritos para dummy.
    3. buscar_nota_fiscal (GET /sac/nota/{numero_nf}) — antes: BigQuery
       `VENDAS.Controle_de_logistica_carteira`. Agora: _dummy_doc determinístico.
    4. buscar_por_pedido  (GET /sac/pedido/{numero_pedido}) — idem item 3.
    OBS: TODO o Postgres (sac_tickets/comentarios/anexos/clientes_externos, CRUD,
    dashboards /sac/dashboard/*) foi mantido INTACTO — não é fonte externa.

(b) Shape exato preservado:
    - /sac/produto       -> [{ "codigo": str, "descricao": str }]   (SacProdutoLookup.tsx)
    - /sac/nota, /sac/pedido (via _fmt_rows / _dummy_doc), consumido por SacNewTicket.tsx:
      { found: true, pedido, numero_nf, cnpj_cpf, razao_social, emissao, entrega,
        nota_fiscal_emissao, desc_tipodocumento, descricao_segmento,
        produtos: [{ codigo_produto, descricao_produto, quantidade }] }
      ou { found: false } quando entrada inválida (mantém UX "notfound").

(c) Teste real (cd backend && /c/Python312/python ...), get_db_connection não usado pelas
    funções trocadas (BQ era stateless). Saída comprovada:
      SAC cache: 12 produtos carregados (dummy)
      /produto q=BENGALA -> [{'codigo':'10401085','descricao':'BENGALA DOBRAVEL COM REGULAGEM'}]
      /nota 15542  -> found True, emissao 2026-04-09, entrega 2026-04-23, 1 produto
      /nota 15542/4 normaliza p/ 15542 (mesmo doc)
      /nota 77001  -> emissao 2026-09-27 (Bonificacao)
      meses de emissao cobertos (amostra NF):  2026-01,03,04,05,07,09,10
      meses cobertos (amostra pedidos):        2026-01,02,03,04,07,08,09,12
      /nota 'abc' -> {'found': False};  determinístico: True

(d) Não confirmados / observações:
    - Cobertura mensal de 2026 nos DASHBOARDS (/sac/dashboard/*) depende do SEED do
      Postgres (tabela sac_tickets), NÃO deste arquivo. Estes endpoints continuam lendo o
      banco real do app — não foram tocados (não são fontes externas).
    - _dummy_doc espalha emissão por 2026 via hash do número; uma única NF cai em um mês,
      mas o conjunto de NFs/pedidos cobre jan–dez.
─────────────────────────────────────────────────────────────────────────────
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from typing import Optional, List
from datetime import datetime, timedelta
import os
import re
import shutil
import json

from db_utils import get_db_connection
from permission_utils import check_module_permission
from core import dummy
from pathlib import Path
from core.config import UPLOAD_DIR, FRONTEND_URL, get_password_hash
from core.email import send_email, notify_user
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/sac", tags=["SAC"])

# ─────────────────────────────────────────────
#  Constantes
# ─────────────────────────────────────────────
CANAIS = ["WhatsApp", "E-mail", "Telefone", "Portal"]
TIPOS_PROBLEMA = ["Entrega", "Produto", "NF", "Financeiro", "Outros"]
PRIORIDADES = ["Baixa", "Média", "Alta", "Urgente"]
SETORES = ["SAC", "Logística", "Financeiro", "Comercial", "Qualidade"]

STATUS_VALIDOS = ["Aberto", "Em Análise", "Aguardando Retorno", "Em Resolução", "Concluído", "Cancelado"]

# Status visíveis para usuários externos (label exibido para externo)
STATUS_EXTERNO_MAP = {
    "Aberto": "Aberto",
    "Em Análise": "Em processamento",
    "Aguardando Retorno": "Aguardando seu retorno",
    "Em Resolução": "Em processamento",
    "Concluído": "Concluído",
    "Cancelado": "Cancelado",
}

# SLA em horas úteis por prioridade
SLA_HORAS = {"Baixa": 40, "Média": 24, "Alta": 8, "Urgente": 4}

SAC_UPLOAD_DIR = Path(UPLOAD_DIR) / "sac"
SAC_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def get_user_context_sac(user_id: str, conn=None):
    should_close = conn is None
    if should_close:
        conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT role, sector, name, email FROM users WHERE id = %s AND is_active = TRUE",
            (str(user_id),)
        )
        row = cur.fetchone()
        if not row:
            return None
        role, sector, name, email = row
        return {"role": role, "sector": sector, "name": name, "email": email}
    finally:
        if should_close:
            cur.close()
            conn.close()


def is_externo(user_ctx: dict) -> bool:
    return user_ctx.get("role") == "externo"


def is_sac_internal(user_ctx: dict) -> bool:
    role = user_ctx.get("role", "")
    sector = user_ctx.get("sector", "")
    if role in ("super_user", "ceo"):
        return True
    if role == "admin":
        return True
    # user com setor SAC
    if role == "user" and sector == "SAC":
        return True
    return False


def gerar_protocolo(conn) -> str:
    """Gera protocolo único: SAC-YYYY-NNNN"""
    year = datetime.now().year
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM sac_tickets WHERE EXTRACT(YEAR FROM criado_em) = %s",
        (year,)
    )
    count = (cur.fetchone()[0] or 0) + 1
    cur.close()
    return f"SAC-{year}-{count:04d}"


def notify_sac_team(title: str, message: str, ticket_id: int, conn):
    """Notifica todos usuários do setor SAC."""
    cur = conn.cursor()
    cur.execute(
        "SELECT id, email FROM users WHERE sector = 'SAC' AND is_active = TRUE AND role != 'externo'"
    )
    rows = cur.fetchall()
    cur.close()
    link = f"{FRONTEND_URL}/#/sac/{ticket_id}"
    for uid, email in rows:
        try:
            notify_user(str(uid), title, message, link, conn=conn)
        except Exception as e:
            print(f"notify_sac_team error uid={uid}: {e}")


def notify_setor(setor: str, title: str, message: str, ticket_id: int, conn):
    """Notifica usuários de um setor interno específico."""
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM users WHERE sector = %s AND is_active = TRUE AND role != 'externo'",
        (setor,)
    )
    rows = cur.fetchall()
    cur.close()
    link = f"{FRONTEND_URL}/#/sac/{ticket_id}"
    for (uid,) in rows:
        try:
            notify_user(str(uid), title, message, link, conn=conn)
        except Exception as e:
            print(f"notify_setor error uid={uid}: {e}")


def send_email_externo(email_contato: str, protocolo: str, status: str, mensagem_extra: str = ""):
    """Envia e-mail HTML para o contato externo."""
    status_display = STATUS_EXTERNO_MAP.get(status, status)
    subject = f"[SAC EMPRESA] Atualização do chamado {protocolo}"
    body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 20px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Portal EMPRESA — SAC</h1>
      </div>
      <div style="padding: 30px; background: #f8f9fa;">
        <h2 style="color: #333; font-size: 18px;">Atualização do seu chamado</h2>
        {f'<p style="color:#555;">{mensagem_extra}</p>' if mensagem_extra else ''}
        <div style="background: #fff; border-left: 4px solid #4f46e5; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong style="color:#333;">Protocolo: {protocolo}</strong><br>
          <span style="color:#666;">Status: <b>{status_display}</b></span>
        </div>
        <p style="color:#888; font-size:13px;">Este é um e-mail automático. Para dúvidas, responda a este chamado pelo portal.</p>
      </div>
      <div style="padding: 15px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #e0e0e0;">
        Portal de Chamados — EMPRESA
      </div>
    </div>
    """
    try:
        send_email(email_contato, subject, body)
    except Exception as e:
        print(f"send_email_externo error: {e}")


# ─────────────────────────────────────────────
#  SQL Server — Produto Cache (carrega 1x por dia)
# ─────────────────────────────────────────────

import threading
_produtos_cache: list = []
_cache_lock = threading.Lock()
_SAC_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "sac_produtos_cache.json")


_BQ_KEY_FILE = os.path.join(os.path.dirname(__file__), "..", "projeto-rpa-empresa-2023-16b15891f73c.json")
_BQ_TABLE = "projeto-rpa-empresa-2023.VENDAS.view_info_ie"


def _refresh_produtos_cache():
    """Carrega produtos do BigQuery e salva em cache JSON."""
    global _produtos_cache
    try:
        # DUMMY: sem BigQuery — produtos determinísticos a partir do pool fictício.
        rows = [{"codigo": cod, "descricao": desc} for (cod, desc, _un, _cat) in dummy.PRODUTOS]
        with _cache_lock:
            _produtos_cache = rows
        cache_path = os.path.normpath(_SAC_CACHE_FILE)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"updated_at": datetime.now().isoformat(), "produtos": rows}, f, ensure_ascii=False)
        print(f"SAC cache: {len(rows)} produtos carregados (dummy).")
    except Exception as e:
        print(f"SAC cache dummy error: {e}")
    _schedule_next_refresh()


def _schedule_next_refresh():
    """Agenda próxima atualização em 24h."""
    t = threading.Timer(86400, _refresh_produtos_cache)
    t.daemon = True
    t.start()


def _load_cache_from_disk():
    """Na inicialização, tenta carregar o cache do disco."""
    global _produtos_cache
    cache_path = os.path.normpath(_SAC_CACHE_FILE)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            with _cache_lock:
                _produtos_cache = data.get("produtos", [])
            print(f"SAC cache: {len(_produtos_cache)} produtos carregados do disco.")
        except Exception as e:
            print(f"SAC cache disk load error: {e}")


# Inicializa: carrega do disco imediatamente, depois agenda refresh do SQL Server
_load_cache_from_disk()
threading.Thread(target=_refresh_produtos_cache, daemon=True).start()


@router.get("/produto/refresh")
def refresh_produto_cache(user_id: str = Header(...)):
    """Força atualização do cache de produtos via BigQuery."""
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    threading.Thread(target=_refresh_produtos_cache, daemon=True).start()
    return {"message": "Atualização iniciada em background"}


# ─── Tipos de Problema (CRUD) ───────────────────────────────────────
@router.get("/tipos-problema")
def listar_tipos_problema(categoria: Optional[str] = None, setor: Optional[str] = None):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        clauses = []; params = []
        if categoria:
            clauses.append("categoria=%s"); params.append(categoria)
        if setor:
            clauses.append("setor=%s"); params.append(setor)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        cur.execute(f"SELECT id, nome, ativo, categoria, setor FROM sac_tipos_problema{where} ORDER BY categoria, setor NULLS FIRST, nome", tuple(params))
        return [{"id": r[0], "nome": r[1], "ativo": r[2], "categoria": r[3], "setor": r[4]} for r in cur.fetchall()]
    finally: cur.close(); conn.close()

@router.post("/tipos-problema")
def criar_tipo_problema(user_id: str = Header(...), nome: str = Form(...), categoria: str = Form("tipo_problema"), setor: Optional[str] = Form(None)):
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    setor_val = (setor or "").strip() or None
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO sac_tipos_problema (nome, categoria, setor) "
            "SELECT %s,%s,%s WHERE NOT EXISTS ("
            "  SELECT 1 FROM sac_tipos_problema WHERE categoria=%s AND COALESCE(setor,'')=COALESCE(%s,'') AND nome=%s"
            ") RETURNING id, nome, ativo, categoria, setor",
            (nome.strip(), categoria, setor_val, categoria, setor_val, nome.strip())
        )
        row = cur.fetchone()
        if not row: raise HTTPException(status_code=409, detail="Opção já existe")
        conn.commit()
        return {"id": row[0], "nome": row[1], "ativo": row[2], "categoria": row[3], "setor": row[4]}
    finally: cur.close(); conn.close()

@router.patch("/tipos-problema/{tipo_id}")
def atualizar_tipo_problema(tipo_id: int, user_id: str = Header(...), nome: Optional[str] = Form(None), ativo: Optional[str] = Form(None)):
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection(); cur = conn.cursor()
    try:
        if nome is not None:
            cur.execute("UPDATE sac_tipos_problema SET nome=%s WHERE id=%s", (nome.strip(), tipo_id))
        if ativo is not None:
            cur.execute("UPDATE sac_tipos_problema SET ativo=%s WHERE id=%s", (ativo.lower() == 'true', tipo_id))
        conn.commit()
        return {"ok": True}
    finally: cur.close(); conn.close()

@router.delete("/tipos-problema/{tipo_id}")
def deletar_tipo_problema(tipo_id: int, user_id: str = Header(...)):
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM sac_tipos_problema WHERE id=%s", (tipo_id,))
        conn.commit()
        return {"ok": True}
    finally: cur.close(); conn.close()


def _bq_client():
    # DUMMY: cliente BigQuery desativado (lazy/no-op). Os endpoints que dependiam
    # do BigQuery (buscar_nota_fiscal / buscar_por_pedido) agora geram dados dummy.
    raise RuntimeError("BigQuery desativado no modo dummy")

def _fmt_rows(rows):
    def fmt_date(v): return v.isoformat() if v else None
    first = rows[0]
    produtos = [{"codigo_produto": r.CODIGO_PRODUTO or "", "descricao_produto": r.DESCRICAO_PRODUTO or "", "quantidade": r.QUANTIDADE or 1} for r in rows]
    return {
        "found": True,
        "pedido": first.PEDIDO,
        "numero_nf": str(first.NOTA_FISCAL) if first.NOTA_FISCAL else None,
        "cnpj_cpf": first.COD_ORIGEM,
        "razao_social": first.RAZAO,
        "emissao": fmt_date(first.EMISSAO),
        "entrega": fmt_date(first.ENTREGA),
        "nota_fiscal_emissao": fmt_date(first.NOTA_FISCAL_EMISSAO),
        "desc_tipodocumento": first.DESC_TIPODOCUMENTO,
        "descricao_segmento": first.DESCRICAO_SEGMENTO,
        "produtos": produtos,
    }

_BQ_SELECT = """
    SELECT PEDIDO, COD_ORIGEM, RAZAO,
           CODIGO_PRODUTO, DESCRICAO_PRODUTO, QUANTIDADE,
           EMISSAO, ENTREGA, NOTA_FISCAL_EMISSAO,
           DESC_TIPODOCUMENTO, DESCRICAO_SEGMENTO,
           NOTA_FISCAL
    FROM `projeto-rpa-empresa-2023.VENDAS.Controle_de_logistica_carteira`
    WHERE NOTA_FISCAL IS NOT NULL AND NOTA_FISCAL != ''
"""


def _dummy_doc(chave: str, numero_nf=None, pedido=None) -> dict:
    """
    DUMMY: monta um documento (NF/pedido) determinístico no MESMO shape de _fmt_rows.
    Datas de emissão/entrega caem dentro de 2026 (cobertura anual via dummy).
    """
    r = dummy.rng("sac_doc", chave)
    # Mês distribuído ao longo de 2026 para garantir cobertura de jan–dez.
    mes = (abs(hash(str(chave))) % 12) + 1
    emissao = dummy.dia_aleatorio(dummy.ANO_BASE, mes, r)
    entrega = emissao + timedelta(days=r.randint(2, 15))
    cli = dummy.escolher(r, dummy.CLIENTES)
    cnpj = f"{r.randint(10,99)}.{r.randint(100,999)}.{r.randint(100,999)}/0001-{r.randint(10,99)}"
    nf_num = numero_nf if numero_nf else str(r.randint(10000, 99999))
    ped = pedido if pedido else f"MBK-{r.randint(100,999):04d}"
    n_prod = r.randint(1, 3)
    prods = r.sample(dummy.PRODUTOS, min(n_prod, len(dummy.PRODUTOS)))
    produtos = [
        {"codigo_produto": cod, "descricao_produto": desc, "quantidade": r.randint(1, 10)}
        for (cod, desc, _un, _cat) in prods
    ]
    return {
        "found": True,
        "pedido": ped,
        "numero_nf": str(nf_num),
        "cnpj_cpf": cnpj,
        "razao_social": cli,
        "emissao": emissao.isoformat(),
        "entrega": entrega.isoformat(),
        "nota_fiscal_emissao": emissao.isoformat(),
        "desc_tipodocumento": dummy.escolher(r, ["Venda", "Bonificacao", "Remessa"]),
        "descricao_segmento": dummy.escolher(r, ["Atacado", "Varejo", "Hospitalar", "Distribuidor"]),
        "produtos": produtos,
    }


@router.get("/nota/{numero_nf}")
def buscar_nota_fiscal(numero_nf: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Busca NF no BigQuery — suporta formatos: 123456, 15542/4, 15542 4."""
    if not user_id or not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    try:
        nf = numero_nf.strip()
        # Normaliza: "15542/4" → tenta com barra, sem barra e só a parte numérica
        nf_base = nf.split('/')[0].split(' ')[0].strip()
        # DUMMY: sem BigQuery — só a parte numérica define o documento.
        if not nf_base or not nf_base.isdigit():
            return {"found": False}
        return _dummy_doc(f"nf:{nf_base}", numero_nf=nf_base)
    except Exception as e:
        print(f"buscar_nota_fiscal error: {e}")
        return {"found": False, "error": str(e)}


@router.get("/pedido/{numero_pedido}")
def buscar_por_pedido(numero_pedido: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Busca por número de pedido no BigQuery (ex: MBK-0156, PVM-152)."""
    if not user_id or not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    try:
        ped = numero_pedido.strip().upper()
        # DUMMY: sem BigQuery — qualquer pedido não-vazio gera um documento determinístico.
        if not ped:
            return {"found": False}
        return _dummy_doc(f"pedido:{ped}", pedido=ped)
    except Exception as e:
        print(f"buscar_por_pedido error: {e}")
        return {"found": False, "error": str(e)}


@router.get("/produto/status")
def status_produto_cache():
    """Debug: mostra quantos produtos estão no cache e variáveis disponíveis."""
    with _cache_lock:
        total = len(_produtos_cache)
        sample = _produtos_cache[:3] if _produtos_cache else []
    has_sa = bool(os.environ.get("GOOGLE_SA_JSON") or os.environ.get("GOOGLE_CREDENTIALS_JSON"))
    cache_file = os.path.exists(os.path.normpath(_SAC_CACHE_FILE))
    return {"cache_total": total, "sample": sample, "has_credentials": has_sa, "cache_file_exists": cache_file}


@router.get("/produto")
def buscar_produto(q: str = "", limit: int = 20):
    if not q or len(q.strip()) < 2:
        return []
    q_lower = q.strip().lower()
    with _cache_lock:
        cache = _produtos_cache
    results = [
        p for p in cache
        if q_lower in (p.get("codigo") or "").lower()
        or q_lower in (p.get("descricao") or "").lower()
    ]
    return results[:limit]




# ─────────────────────────────────────────────
#  Tickets — CRUD
# ─────────────────────────────────────────────

@router.get("/tickets")
def listar_tickets(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    status: Optional[str] = None,
    setor: Optional[str] = None,
    prioridade: Optional[str] = None,
    de: Optional[str] = None,
    ate: Optional[str] = None,
    q: Optional[str] = None,
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    if not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ctx = get_user_context_sac(user_id, conn)
        if not ctx:
            raise HTTPException(status_code=403, detail="Usuário não encontrado")

        conditions = []
        params = []

        # Externo só vê seus próprios tickets
        if is_externo(ctx):
            conditions.append("t.aberto_por = %s")
            params.append(user_id)

        if status:
            conditions.append("t.status = %s")
            params.append(status)
        if setor:
            conditions.append("t.setor_destino = %s")
            params.append(setor)
        if prioridade:
            conditions.append("t.prioridade = %s")
            params.append(prioridade)
        if de:
            conditions.append("t.criado_em >= %s")
            params.append(de)
        if ate:
            conditions.append("t.criado_em <= %s")
            params.append(ate + " 23:59:59")
        if q:
            conditions.append("(t.protocolo ILIKE %s OR t.razao_social ILIKE %s OR t.cnpj_cpf ILIKE %s)")
            params += [f"%{q}%", f"%{q}%", f"%{q}%"]

        # Esconde tickets desativados (soft-delete via is_active=FALSE)
        try:
            cur.execute("ALTER TABLE sac_tickets ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE")
            conn.commit()
        except Exception:
            conn.rollback()
        conditions.append("COALESCE(t.is_active, TRUE) = TRUE")
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        cur.execute(f"""
            SELECT
                t.id, t.protocolo, t.canal, t.cnpj_cpf, t.razao_social,
                t.email_contato, t.tipo_problema, t.numero_nf,
                t.codigo_produto, t.descricao_produto, t.detalhamento,
                t.prioridade, t.status, t.setor_destino,
                t.aberto_por, u.name as aberto_por_nome,
                t.criado_em, t.atualizado_em,
                (SELECT COALESCE(uu.name, t.razao_social)
                   FROM sac_comentarios c
                   LEFT JOIN users uu ON c.autor_id::text = uu.id::text
                   WHERE c.ticket_id = t.id
                   ORDER BY c.criado_em DESC
                   LIMIT 1) AS ultima_interacao_nome
            FROM sac_tickets t
            LEFT JOIN users u ON t.aberto_por::text = u.id::text
            {where}
            ORDER BY t.criado_em DESC
        """, params)

        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        tickets = []
        for row in rows:
            t = dict(zip(cols, row))
            # Para externo: substituir status real pelo label público
            if is_externo(ctx):
                t["status_display"] = STATUS_EXTERNO_MAP.get(t["status"], t["status"])
            else:
                t["status_display"] = t["status"]
                # Indica se o externo vê o status real
                t["invisivel_externo"] = t["status"] in ("Em Análise", "Em Resolução")
            # Serializar datetimes
            for f in ("criado_em", "atualizado_em"):
                if t[f]:
                    t[f] = t[f].isoformat()
            tickets.append(t)
        return tickets
    finally:
        cur.close()
        conn.close()


@router.post("/tickets")
async def criar_ticket(
    background_tasks: BackgroundTasks,
    user_id: str = Form(...),
    canal: str = Form(...),
    cnpj_cpf: str = Form(...),
    razao_social: str = Form(...),
    email_contato: str = Form(...),
    tipo_problema: str = Form(...),
    detalhamento: str = Form(...),
    numero_nf: Optional[str] = Form(None),
    codigo_produto: Optional[str] = Form(None),
    descricao_produto: Optional[str] = Form(None),
    origem_dados: Optional[str] = Form(None),
    canal_compra: Optional[str] = Form(None),
    pedido: Optional[str] = Form(None),
    emissao: Optional[str] = Form(None),
    entrega: Optional[str] = Form(None),
    nota_fiscal_emissao: Optional[str] = Form(None),
    desc_tipodocumento: Optional[str] = Form(None),
    descricao_segmento: Optional[str] = Form(None),
    publico: Optional[str] = Form('cliente'),
    produtos_json: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
):
    if not check_module_permission(str(user_id), "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        protocolo = gerar_protocolo(conn)
        cur.execute("""
            INSERT INTO sac_tickets
                (protocolo, canal, cnpj_cpf, razao_social, email_contato,
                 tipo_problema, numero_nf, codigo_produto, descricao_produto,
                 detalhamento, aberto_por,
                 origem_dados, canal_compra, pedido, emissao, entrega, nota_fiscal_emissao, desc_tipodocumento, descricao_segmento, publico)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            protocolo, canal, cnpj_cpf, razao_social, email_contato,
            tipo_problema, numero_nf, codigo_produto, descricao_produto,
            detalhamento, str(user_id),
            origem_dados or 'manual', canal_compra, pedido, emissao or None, entrega or None,
            nota_fiscal_emissao or None, desc_tipodocumento, descricao_segmento,
            publico if publico in ('cliente', 'consumidor_final') else 'cliente'
        ))
        ticket_id = cur.fetchone()[0]

        produto_ids = []
        if produtos_json:
            import json as _json
            try:
                for p in _json.loads(produtos_json):
                    cur.execute(
                        "INSERT INTO sac_ticket_produtos (ticket_id, codigo_produto, descricao_produto, quantidade, quantidade_defeito, tipo_problema) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                        (ticket_id, p.get("codigo_produto"), p.get("descricao_produto"), p.get("quantidade", 1), p.get("quantidade_defeito"), p.get("tipo_problema"))
                    )
                    produto_ids.append(cur.fetchone()[0])
            except Exception:
                pass

        # Upload de anexos (gerais e por produto: nome pode ser "p{idx}_{filename}")
        for f in files:
            if f and f.filename:
                fname = f.filename
                prod_idx = None
                # Detecta prefixo de produto: "p0_", "p1_", etc.
                import re as _re
                m = _re.match(r'^p(\d+)_(.+)$', fname)
                if m:
                    prod_idx = int(m.group(1))
                    fname = m.group(2)
                safe_name = re.sub(r"[^\w\-.]", "_", fname)
                dest = SAC_UPLOAD_DIR / f"{ticket_id}_{safe_name}"
                with open(dest, "wb") as out:
                    shutil.copyfileobj(f.file, out)
                cur.execute("""
                    INSERT INTO sac_anexos (ticket_id, nome_arquivo, caminho, mime_type, tamanho_bytes, enviado_por, produto_idx)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (ticket_id, fname, str(dest), f.content_type, os.path.getsize(dest), str(user_id), prod_idx))

        conn.commit()

        # Notificações em background
        def _notify():
            c2 = get_db_connection()
            try:
                notify_sac_team(
                    f"Novo chamado SAC: {protocolo}",
                    f"Chamado aberto por {razao_social} — {tipo_problema}",
                    ticket_id, c2
                )
                c2.commit()
            finally:
                c2.close()
            # E-mail para o contato externo
            send_email_externo(email_contato, protocolo, "Aberto", "Seu chamado foi recebido e está sendo analisado pela nossa equipe.")

        background_tasks.add_task(_notify)
        return {"id": ticket_id, "protocolo": protocolo}
    except Exception as e:
        conn.rollback()
        print(f"criar_ticket error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/tickets/{ticket_id}")
def detalhar_ticket(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not user_id or not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ctx = get_user_context_sac(user_id, conn)
        cur.execute("""
            SELECT t.*, u.name as aberto_por_nome, u.email as aberto_por_email
            FROM sac_tickets t
            LEFT JOIN users u ON t.aberto_por::text = u.id::text
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Chamado não encontrado")

        cols = [d[0] for d in cur.description]
        ticket = dict(zip(cols, row))

        # Externo só vê seu próprio ticket
        if is_externo(ctx) and str(ticket.get("aberto_por")) != str(user_id):
            raise HTTPException(status_code=403, detail="Acesso negado")

        if is_externo(ctx):
            ticket["status_display"] = STATUS_EXTERNO_MAP.get(ticket["status"], ticket["status"])
        else:
            ticket["status_display"] = ticket["status"]
            ticket["invisivel_externo"] = ticket["status"] in ("Em Análise", "Em Resolução")

        for f in ("criado_em", "atualizado_em", "emissao", "entrega", "nota_fiscal_emissao"):
            if ticket.get(f):
                ticket[f] = ticket[f].isoformat()

        if ticket.get("valor_frete") is not None:
            ticket["valor_frete"] = float(ticket["valor_frete"])

        cur.execute(
            "SELECT id, codigo_produto, descricao_produto, quantidade, quantidade_defeito, tipo_problema FROM sac_ticket_produtos WHERE ticket_id=%s",
            (ticket_id,)
        )
        ticket["produtos"] = [
            {"id": r[0], "codigo_produto": r[1], "descricao_produto": r[2], "quantidade": r[3], "quantidade_defeito": r[4], "tipo_problema": r[5]}
            for r in cur.fetchall()
        ]

        # Status interno por setor envolvido (sempre SAC + setor destino atual)
        setores_envolvidos = ["SAC"]
        if ticket.get("setor_destino") and ticket["setor_destino"] not in setores_envolvidos:
            setores_envolvidos.append(ticket["setor_destino"])
        cur.execute("SELECT setor, status FROM sac_status_interno WHERE ticket_id=%s", (ticket_id,))
        si_map = {r[0]: r[1] for r in cur.fetchall()}
        ticket["setores_envolvidos"] = setores_envolvidos
        ticket["status_interno"] = {s: si_map.get(s) for s in setores_envolvidos}

        return ticket
    finally:
        cur.close()
        conn.close()


@router.patch("/tickets/{ticket_id}/status")
def atualizar_status(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    status: str = Form(...),
):
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado — apenas SAC interno")
    if status not in STATUS_VALIDOS:
        raise HTTPException(status_code=400, detail="Status inválido")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE sac_tickets SET status=%s, atualizado_em=NOW() WHERE id=%s RETURNING protocolo, email_contato",
            (status, ticket_id)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        protocolo, email_contato = row

        # Adiciona nota de sistema na timeline
        cur.execute("""
            INSERT INTO sac_comentarios (ticket_id, autor_id, texto, visivel_externo, is_system)
            VALUES (%s, %s, %s, %s, TRUE)
        """, (ticket_id, user_id, f"Status alterado para: {status}", status in ("Aguardando Retorno", "Concluído", "Cancelado")))

        conn.commit()

        def _notify():
            if status in ("Aguardando Retorno", "Concluído", "Cancelado"):
                send_email_externo(email_contato, protocolo, status)

        background_tasks.add_task(_notify)
        return {"ok": True, "status": status}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/tickets/{ticket_id}/prioridade")
def atualizar_prioridade(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    prioridade: str = Form(...),
):
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    if prioridade not in PRIORIDADES:
        raise HTTPException(status_code=400, detail="Prioridade inválida")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE sac_tickets SET prioridade=%s, atualizado_em=NOW() WHERE id=%s RETURNING id",
            (prioridade, ticket_id)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404)
        conn.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/tickets/{ticket_id}/setor")
def atualizar_setor(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    setor_destino: str = Form(...),
):
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    if setor_destino not in SETORES:
        raise HTTPException(status_code=400, detail="Setor inválido")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE sac_tickets SET setor_destino=%s, atualizado_em=NOW() WHERE id=%s RETURNING protocolo",
            (setor_destino, ticket_id)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        protocolo = row[0]
        conn.commit()

        def _notify():
            c2 = get_db_connection()
            try:
                notify_setor(
                    setor_destino,
                    f"Chamado SAC atribuído: {protocolo}",
                    f"Chamado {protocolo} foi direcionado para o setor {setor_destino}",
                    ticket_id, c2
                )
                c2.commit()
            finally:
                c2.close()

        background_tasks.add_task(_notify)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/tickets/{ticket_id}/frete")
def atualizar_frete(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    valor_frete: str = Form(...),
):
    """Valor do frete do envio da peça de reposição (usado pela Logística)."""
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    try:
        valor = float(valor_frete) if valor_frete not in (None, "") else None
    except Exception:
        raise HTTPException(status_code=400, detail="Valor de frete inválido")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE sac_tickets SET valor_frete=%s, atualizado_em=NOW() WHERE id=%s RETURNING id",
            (valor, ticket_id)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404)
        conn.commit()
        return {"ok": True, "valor_frete": valor}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/tickets/{ticket_id}/status-interno")
def atualizar_status_interno(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    setor: str = Form(...),
    status: str = Form(...),
):
    """Status interno por setor. Notifica apenas internos dos setores envolvidos (SAC + destino)."""
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    if setor not in SETORES:
        raise HTTPException(status_code=400, detail="Setor inválido")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ctx = get_user_context_sac(user_id, conn)
        if not ctx:
            raise HTTPException(status_code=403, detail="Usuário inválido")
        # Cada setor edita só o seu; SAC/Qualidade e admins editam qualquer um
        pode = (
            ctx.get("role") in ("super_user", "ceo", "admin")
            or ctx.get("sector") in ("SAC", "Qualidade")
            or ctx.get("sector") == setor
        )
        if not pode:
            raise HTTPException(status_code=403, detail="Você só pode alterar o status interno do seu setor")

        cur.execute("SELECT protocolo, setor_destino FROM sac_tickets WHERE id=%s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        protocolo, setor_destino = row

        cur.execute("""
            INSERT INTO sac_status_interno (ticket_id, setor, status, atualizado_por, atualizado_em)
            VALUES (%s,%s,%s,%s,NOW())
            ON CONFLICT (ticket_id, setor)
            DO UPDATE SET status=EXCLUDED.status, atualizado_por=EXCLUDED.atualizado_por, atualizado_em=NOW()
        """, (ticket_id, setor, status, user_id))

        # Nota interna na timeline (nunca visível ao cliente externo)
        cur.execute("""
            INSERT INTO sac_comentarios (ticket_id, autor_id, texto, visivel_externo, is_system)
            VALUES (%s,%s,%s,FALSE,TRUE)
        """, (ticket_id, user_id, f"Status interno [{setor}] alterado para: {status}"))
        conn.commit()

        # Notifica SÓ internos dos setores envolvidos (SAC + setor destino) — nunca o cliente
        setores_notif = {"SAC", setor}
        if setor_destino:
            setores_notif.add(setor_destino)

        def _notify():
            c2 = get_db_connection()
            try:
                for s in setores_notif:
                    notify_setor(
                        s,
                        f"Status interno atualizado: {protocolo}",
                        f"[{setor}] status interno: {status}",
                        ticket_id, c2
                    )
                c2.commit()
            finally:
                c2.close()

        background_tasks.add_task(_notify)
        return {"ok": True, "setor": setor, "status": status}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.post("/tickets/{ticket_id}/retornar-sac")
def retornar_para_sac(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id_from_session),
    motivo: str = Form(...),
):
    """Retorna o chamado ao SAC (setor destino = SAC), registra o motivo e notifica a equipe SAC."""
    if not user_id or not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    if not motivo or not motivo.strip():
        raise HTTPException(status_code=400, detail="Informe o motivo do retorno ao SAC")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE sac_tickets SET setor_destino='SAC', atualizado_em=NOW() WHERE id=%s RETURNING protocolo",
            (ticket_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        protocolo = row[0]
        ctx = get_user_context_sac(user_id, conn) or {}
        autor_setor = ctx.get("sector") or "—"

        cur.execute("""
            INSERT INTO sac_comentarios (ticket_id, autor_id, texto, visivel_externo, is_system)
            VALUES (%s,%s,%s,FALSE,TRUE)
        """, (ticket_id, user_id, f"Retornado ao SAC por {autor_setor}. Motivo: {motivo.strip()}"))
        conn.commit()

        def _notify():
            c2 = get_db_connection()
            try:
                notify_sac_team(
                    f"Chamado retornado ao SAC: {protocolo}",
                    f"{autor_setor} retornou o chamado ao SAC. Motivo: {motivo.strip()}",
                    ticket_id, c2
                )
                c2.commit()
            finally:
                c2.close()

        background_tasks.add_task(_notify)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Comentários / Timeline
# ─────────────────────────────────────────────

@router.get("/tickets/{ticket_id}/comentarios")
def listar_comentarios(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not user_id or not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ctx = get_user_context_sac(user_id, conn)

        # Validar acesso ao ticket
        cur.execute("SELECT aberto_por FROM sac_tickets WHERE id=%s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        if is_externo(ctx) and str(row[0]) != str(user_id):
            raise HTTPException(status_code=403)

        # Externo: só comentários visíveis externamente
        if is_externo(ctx):
            cur.execute("""
                SELECT c.id, c.texto, c.visivel_externo, c.is_system, c.criado_em,
                       u.name as autor_nome, u.role as autor_role
                FROM sac_comentarios c
                LEFT JOIN users u ON c.autor_id::text = u.id::text
                WHERE c.ticket_id = %s AND c.visivel_externo = TRUE
                ORDER BY c.criado_em ASC
            """, (ticket_id,))
        else:
            cur.execute("""
                SELECT c.id, c.texto, c.visivel_externo, c.is_system, c.criado_em,
                       u.name as autor_nome, u.role as autor_role
                FROM sac_comentarios c
                LEFT JOIN users u ON c.autor_id::text = u.id::text
                WHERE c.ticket_id = %s
                ORDER BY c.criado_em ASC
            """, (ticket_id,))

        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(zip(cols, r))
            if d.get("criado_em"):
                d["criado_em"] = d["criado_em"].isoformat()
            result.append(d)
        return result
    finally:
        cur.close()
        conn.close()


@router.post("/tickets/{ticket_id}/comentarios")
async def adicionar_comentario(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    user_id: str = Form(...),
    texto: str = Form(...),
    visivel_externo: bool = Form(True),
    file: Optional[UploadFile] = File(None),
):
    if not check_module_permission(str(user_id), "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        ctx = get_user_context_sac(user_id, conn)

        # Externo sempre posta visível
        if is_externo(ctx):
            visivel_externo = True

        cur.execute("SELECT protocolo, email_contato, aberto_por FROM sac_tickets WHERE id=%s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        protocolo, email_contato, aberto_por = row

        if is_externo(ctx) and str(aberto_por) != str(user_id):
            raise HTTPException(status_code=403)

        cur.execute("""
            INSERT INTO sac_comentarios (ticket_id, autor_id, texto, visivel_externo)
            VALUES (%s,%s,%s,%s) RETURNING id
        """, (ticket_id, str(user_id), texto, visivel_externo))
        comment_id = cur.fetchone()[0]

        # Atualiza timestamp do ticket
        cur.execute("UPDATE sac_tickets SET atualizado_em=NOW() WHERE id=%s", (ticket_id,))

        # Anexo no comentário (opcional)
        if file and file.filename:
            safe_name = re.sub(r"[^\w\-.]", "_", file.filename)
            dest = SAC_UPLOAD_DIR / f"c_{comment_id}_{safe_name}"
            with open(dest, "wb") as out:
                shutil.copyfileobj(file.file, out)
            # Garante coluna comentario_id (migration idempotente)
            cur.execute("ALTER TABLE sac_anexos ADD COLUMN IF NOT EXISTS comentario_id INTEGER REFERENCES sac_comentarios(id) ON DELETE CASCADE")
            cur.execute("""
                INSERT INTO sac_anexos (ticket_id, nome_arquivo, caminho, mime_type, tamanho_bytes, enviado_por, comentario_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (ticket_id, file.filename, str(dest), file.content_type, os.path.getsize(dest), str(user_id), comment_id))

        conn.commit()

        # captura setor_destino para usar no notify (privado vai pra SAC + setor envolvido)
        cur2 = conn.cursor()
        cur2.execute("SELECT setor_destino FROM sac_tickets WHERE id=%s", (ticket_id,))
        _row_sd = cur2.fetchone()
        cur2.close()
        setor_destino_atual = _row_sd[0] if _row_sd else None

        def _notify():
            c2 = get_db_connection()
            try:
                if is_externo(ctx):
                    # Cliente respondeu → notifica equipe SAC (NAO envia email pro cliente que enviou)
                    notify_sac_team(
                        f"Nova resposta do cliente: {protocolo}",
                        f"O cliente respondeu o chamado {protocolo}",
                        ticket_id, c2
                    )
                elif visivel_externo:
                    # Comentario publico (interno -> externo): email para cliente
                    send_email_externo(email_contato, protocolo, "Em processamento", "A equipe adicionou uma resposta ao seu chamado.")
                else:
                    # Comentario interno (privado): notifica SAC + setor envolvido (sem email pro cliente)
                    notify_sac_team(
                        f"Comentario interno: {protocolo}",
                        f"Novo comentario interno no chamado {protocolo}",
                        ticket_id, c2
                    )
                    if setor_destino_atual and setor_destino_atual != 'SAC':
                        notify_setor(
                            setor_destino_atual,
                            f"Comentario interno: {protocolo}",
                            f"Novo comentario interno no chamado {protocolo}",
                            ticket_id, c2
                        )
                c2.commit()
            finally:
                c2.close()

        background_tasks.add_task(_notify)
        return {"id": comment_id}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Anexos
# ─────────────────────────────────────────────

@router.get("/tickets/{ticket_id}/anexos")
def listar_anexos(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    if not user_id or not check_module_permission(user_id, "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Garante coluna comentario_id
        cur.execute("ALTER TABLE sac_anexos ADD COLUMN IF NOT EXISTS comentario_id INTEGER REFERENCES sac_comentarios(id) ON DELETE CASCADE")
        conn.commit()
        ctx = get_user_context_sac(user_id, conn)
        if is_externo(ctx):
            # Externo nao ve anexos de comentarios internos
            cur.execute("""
                SELECT a.id, a.nome_arquivo, a.caminho, a.mime_type, a.tamanho_bytes, a.criado_em, u.name
                FROM sac_anexos a
                LEFT JOIN users u ON a.enviado_por::text = u.id::text
                LEFT JOIN sac_comentarios c ON a.comentario_id = c.id
                WHERE a.ticket_id = %s
                  AND (a.comentario_id IS NULL OR c.visivel_externo = TRUE)
                ORDER BY a.criado_em ASC
            """, (ticket_id,))
        else:
            cur.execute("""
                SELECT a.id, a.nome_arquivo, a.caminho, a.mime_type, a.tamanho_bytes, a.criado_em, u.name
                FROM sac_anexos a
                LEFT JOIN users u ON a.enviado_por::text = u.id::text
                WHERE a.ticket_id = %s
                ORDER BY a.criado_em ASC
            """, (ticket_id,))
        cols = ["id", "nome_arquivo", "caminho", "mime_type", "tamanho_bytes", "criado_em", "enviado_por_nome"]
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(zip(cols, r))
            if d.get("criado_em"):
                d["criado_em"] = d["criado_em"].isoformat()
            # URL relativa para o frontend
            d["url"] = "/" + d["caminho"].replace("\\", "/").split("/uploads/")[-1] if "uploads" in str(d["caminho"]) else ""
            result.append(d)
        return result
    finally:
        cur.close()
        conn.close()


@router.delete("/tickets/{ticket_id}")
def desativar_ticket(
    ticket_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Soft-delete: marca chamado como inativo (is_active=FALSE). So super_user."""
    if not user_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    ctx = get_user_context_sac(user_id)
    if not ctx or ctx.get("role") != "super_user":
        raise HTTPException(status_code=403, detail="Apenas super_user pode excluir chamados")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE sac_tickets ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE")
        conn.commit()
        cur.execute("SELECT id FROM sac_tickets WHERE id = %s", (ticket_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Chamado nao encontrado")
        cur.execute("UPDATE sac_tickets SET is_active = FALSE WHERE id = %s", (ticket_id,))
        conn.commit()
        return {"ok": True, "id": ticket_id}
    finally:
        cur.close()
        conn.close()


@router.delete("/anexos/{anexo_id}")
def deletar_anexo(
    anexo_id: int,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Apenas super_user pode deletar anexos (uso administrativo, ex: limpar testes)."""
    if not user_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    ctx = get_user_context_sac(user_id)
    if not ctx or ctx.get("role") != "super_user":
        raise HTTPException(status_code=403, detail="Apenas super_user pode deletar anexos")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT caminho FROM sac_anexos WHERE id = %s", (anexo_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Anexo nao encontrado")
        caminho = row[0]
        cur.execute("DELETE FROM sac_anexos WHERE id = %s", (anexo_id,))
        conn.commit()
        # Tenta remover do disco (best-effort)
        try:
            if caminho and os.path.exists(caminho):
                os.remove(caminho)
        except Exception as e:
            logger.warning(f"Anexo {anexo_id} deletado do DB mas falha ao remover do disco: {e}")
        return {"ok": True, "id": anexo_id}
    finally:
        cur.close()
        conn.close()


@router.post("/tickets/{ticket_id}/anexos")
async def upload_anexo(
    ticket_id: int,
    user_id: str = Form(...),
    file: UploadFile = File(...),
):
    if not check_module_permission(str(user_id), "sac"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo obrigatório")

    MAX_SIZE = 10 * 1024 * 1024  # 10 MB
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo excede 10MB")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        safe_name = re.sub(r"[^\w\-.]", "_", file.filename)
        dest = SAC_UPLOAD_DIR / f"{ticket_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{safe_name}"
        with open(dest, "wb") as out:
            out.write(content)

        cur.execute("""
            INSERT INTO sac_anexos (ticket_id, nome_arquivo, caminho, mime_type, tamanho_bytes, enviado_por)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING id
        """, (ticket_id, file.filename, str(dest), file.content_type, len(content), str(user_id)))
        cur.execute("UPDATE sac_tickets SET atualizado_em=NOW() WHERE id=%s", (ticket_id,))
        conn.commit()
        return {"ok": True, "id": cur.fetchone()}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Dashboard / Analytics
# ─────────────────────────────────────────────

def _periodo_filter(de: Optional[str], ate: Optional[str], field: str = "t.criado_em"):
    conditions = []
    params = []
    if de:
        conditions.append(f"{field} >= %s")
        params.append(de)
    if ate:
        conditions.append(f"{field} <= %s")
        params.append(ate + " 23:59:59")
    return conditions, params


@router.get("/dashboard/kpis")
def dashboard_kpis(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""

        cur.execute(f"SELECT COUNT(*) FROM sac_tickets t {where}", params)
        total = cur.fetchone()[0]

        cur.execute(f"SELECT COUNT(*) FROM sac_tickets t {where} AND t.status NOT IN ('Concluído','Cancelado')" if conds else
                    "SELECT COUNT(*) FROM sac_tickets WHERE status NOT IN ('Concluído','Cancelado')", params if conds else [])
        abertos = cur.fetchone()[0]

        cur.execute(f"SELECT COUNT(*) FROM sac_tickets t {where} AND t.status='Concluído'" if conds else
                    "SELECT COUNT(*) FROM sac_tickets WHERE status='Concluído'", params if conds else [])
        concluidos = cur.fetchone()[0]

        cur.execute(f"SELECT COUNT(*) FROM sac_tickets t {where} AND t.status='Cancelado'" if conds else
                    "SELECT COUNT(*) FROM sac_tickets WHERE status='Cancelado'", params if conds else [])
        cancelados = cur.fetchone()[0]

        # Tempo médio de conclusão (horas)
        cur.execute(f"""
            SELECT AVG(EXTRACT(EPOCH FROM (atualizado_em - criado_em))/3600)
            FROM sac_tickets t {where} {"AND" if conds else "WHERE"} status='Concluído'
        """, params)
        row = cur.fetchone()
        tempo_medio_conclusao = round(row[0], 1) if row and row[0] else None

        return {
            "total": total,
            "abertos": abertos,
            "concluidos": concluidos,
            "cancelados": cancelados,
            "tempo_medio_conclusao_h": tempo_medio_conclusao,
        }
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/por-status")
def dashboard_por_status(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"SELECT status, COUNT(*) FROM sac_tickets t {where} GROUP BY status ORDER BY COUNT(*) DESC", params)
        rows = cur.fetchall()
        total = sum(r[1] for r in rows) or 1
        return [{"status": r[0], "count": r[1], "pct": round(r[1] / total * 100, 1)} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/volume-tempo")
def dashboard_volume_tempo(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
    agrupamento: Optional[str] = "dia",  # dia | semana | mes
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        trunc = {"dia": "day", "semana": "week", "mes": "month"}.get(agrupamento, "day")
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"""
            SELECT DATE_TRUNC('{trunc}', criado_em)::date as periodo, COUNT(*)
            FROM sac_tickets t {where}
            GROUP BY periodo ORDER BY periodo
        """, params)
        abertos = [{"data": str(r[0]), "abertos": r[1]} for r in cur.fetchall()]

        conds2, params2 = _periodo_filter(de, ate, "t.atualizado_em")
        where2 = ("WHERE " + " AND ".join(conds2 + ["t.status='Concluído'"])) if conds2 else "WHERE t.status='Concluído'"
        cur.execute(f"""
            SELECT DATE_TRUNC('{trunc}', atualizado_em)::date as periodo, COUNT(*)
            FROM sac_tickets t {where2}
            GROUP BY periodo ORDER BY periodo
        """, params2)
        concluidos = {str(r[0]): r[1] for r in cur.fetchall()}

        for item in abertos:
            item["concluidos"] = concluidos.get(item["data"], 0)
        return abertos
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/por-tipo")
def dashboard_por_tipo(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"""
            SELECT tipo_problema, COUNT(*),
                   AVG(EXTRACT(EPOCH FROM (CASE WHEN status='Concluído' THEN atualizado_em ELSE NOW() END - criado_em))/3600)
            FROM sac_tickets t {where}
            GROUP BY tipo_problema ORDER BY COUNT(*) DESC
        """, params)
        rows = cur.fetchall()
        total = sum(r[1] for r in rows) or 1
        return [{"tipo": r[0], "count": r[1], "pct": round(r[1]/total*100,1), "tempo_medio_h": round(r[2],1) if r[2] else None} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/por-canal")
def dashboard_por_canal(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"SELECT canal, COUNT(*) FROM sac_tickets t {where} GROUP BY canal ORDER BY COUNT(*) DESC", params)
        rows = cur.fetchall()
        total = sum(r[1] for r in rows) or 1
        return [{"canal": r[0], "count": r[1], "pct": round(r[1]/total*100,1)} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/por-setor")
def dashboard_por_setor(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"""
            SELECT
                setor_destino,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status='Concluído') as concluidos,
                COUNT(*) FILTER (WHERE status NOT IN ('Concluído','Cancelado')) as abertos,
                AVG(EXTRACT(EPOCH FROM (CASE WHEN status='Concluído' THEN atualizado_em ELSE NOW() END - criado_em))/3600) as tempo_medio_h
            FROM sac_tickets t {where}
            GROUP BY setor_destino ORDER BY total DESC
        """, params)
        cols = ["setor", "total", "concluidos", "abertos", "tempo_medio_h"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/top-clientes")
def dashboard_top_clientes(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
    limit: int = 10,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"""
            SELECT
                cnpj_cpf, razao_social, COUNT(*) as total,
                COUNT(*) FILTER (WHERE status NOT IN ('Concluído','Cancelado')) as abertos,
                COUNT(*) FILTER (WHERE status='Concluído') as concluidos,
                COUNT(*) FILTER (WHERE status='Cancelado') as cancelados,
                MODE() WITHIN GROUP (ORDER BY tipo_problema) as tipo_frequente
            FROM sac_tickets t {where}
            GROUP BY cnpj_cpf, razao_social
            ORDER BY total DESC LIMIT %s
        """, params + [limit])
        cols = ["cnpj_cpf","razao_social","total","abertos","concluidos","cancelados","tipo_frequente"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/top-usuarios")
def dashboard_top_usuarios(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
    limit: int = 10,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        tj = "LEFT JOIN sac_tickets t ON t.aberto_por::text = u.id::text"
        conds_t = [c.replace("t.", "t.") for c in conds]
        where_t = ("WHERE " + " AND ".join(["u.role != 'externo'"] + conds_t)) if conds_t else "WHERE u.role != 'externo'"
        cur.execute(f"""
            SELECT u.id, u.name, u.sector,
                COUNT(t.id) as tickets_abertos,
                COUNT(*) FILTER (WHERE t.status='Concluído') as concluidos
            FROM users u {tj}
            {where_t}
            GROUP BY u.id, u.name, u.sector
            HAVING COUNT(t.id) > 0
            ORDER BY tickets_abertos DESC LIMIT %s
        """, params + [limit])
        cols = ["id","name","sector","tickets_abertos","concluidos"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/parados")
def dashboard_parados(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    dias: int = 3,
):
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        threshold = datetime.now() - timedelta(days=dias)
        cur.execute("""
            SELECT t.id, t.protocolo, t.razao_social, t.status, t.setor_destino, t.prioridade,
                   t.atualizado_em,
                   NOW() - t.atualizado_em as parado_ha
            FROM sac_tickets t
            WHERE t.status NOT IN ('Concluído','Cancelado')
              AND t.atualizado_em < %s
            ORDER BY t.atualizado_em ASC
        """, (threshold,))
        cols = ["id","protocolo","razao_social","status","setor_destino","prioridade","atualizado_em","parado_ha"]
        result = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["atualizado_em"] = d["atualizado_em"].isoformat() if d["atualizado_em"] else None
            d["parado_dias"] = round(d["parado_ha"].total_seconds() / 86400, 1) if d["parado_ha"] else 0
            del d["parado_ha"]
            result.append(d)
        return result
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/dataset")
def dashboard_dataset(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    de: Optional[str] = None,
    ate: Optional[str] = None,
):
    """Dataset bruto (1 linha por ticket + produtos) para o dashboard com cross-filter no front."""
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        conds, params = _periodo_filter(de, ate)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        # Cap de segurança: evita 502 quando o período é "Tudo" (sem filtro de data)
        CAP = 20000
        cur.execute(f"""
            SELECT t.id, t.protocolo, t.status, t.prioridade, t.canal, t.tipo_problema,
                   t.setor_destino, t.razao_social, t.cnpj_cpf, t.canal_compra,
                   t.criado_em, t.atualizado_em, COALESCE(t.publico, 'cliente') AS publico
            FROM sac_tickets t {where}
            ORDER BY t.criado_em DESC
            LIMIT %s
        """, params + [CAP])
        cols = ["id", "protocolo", "status", "prioridade", "canal", "tipo_problema",
                "setor_destino", "razao_social", "cnpj_cpf", "canal_compra", "criado_em", "atualizado_em", "publico"]
        tickets = [dict(zip(cols, r)) for r in cur.fetchall()]

        ids = [t["id"] for t in tickets]
        prod_map = {}
        if ids:
            cur.execute(
                "SELECT ticket_id, codigo_produto, descricao_produto, quantidade, quantidade_defeito "
                "FROM sac_ticket_produtos WHERE ticket_id = ANY(%s)", (ids,)
            )
            for tid, cod, desc, qtd, qdef in cur.fetchall():
                prod_map.setdefault(tid, []).append({
                    "codigo": cod, "descricao": desc,
                    "quantidade": qtd, "quantidade_defeito": qdef,
                })
        for t in tickets:
            t["produtos"] = prod_map.get(t["id"], [])
            for f in ("criado_em", "atualizado_em"):
                if t.get(f):
                    t[f] = t[f].isoformat()
        return tickets
    finally:
        cur.close()
        conn.close()


@router.get("/dashboard/series")
def dashboard_series(
    user_id: Optional[str] = Depends(get_user_id_from_session),
    mes: Optional[str] = None,
):
    """Séries temporais: 12 meses até 'mes' e dias do 'mes' (default mês atual) + % vs mês anterior."""
    if not user_id or not check_module_permission(user_id, "sac_dashboard"):
        raise HTTPException(status_code=403, detail="Acesso negado")

    now = datetime.now()
    try:
        if mes and len(mes) >= 7:
            ry, rm = int(mes[:4]), int(mes[5:7])
        else:
            ry, rm = now.year, now.month
    except Exception:
        ry, rm = now.year, now.month

    def add_months(year, month, n):
        idx = year * 12 + (month - 1) + n
        return idx // 12, idx % 12 + 1

    def first_of(year, month):
        return datetime(year, month, 1)

    ref = first_of(ry, rm)
    sy, sm = add_months(ry, rm, -11)
    start12 = first_of(sy, sm)
    ny, nm = add_months(ry, rm, 1)
    nextm = first_of(ny, nm)
    py, pm = add_months(ry, rm, -1)
    prev = first_of(py, pm)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT to_char(date_trunc('month', criado_em), 'YYYY-MM') AS mes, COUNT(*)
            FROM sac_tickets
            WHERE criado_em >= %s AND criado_em < %s
            GROUP BY 1
        """, (start12, nextm))
        mp = {r[0]: r[1] for r in cur.fetchall()}
        por_mes = []
        for i in range(12):
            yy, mm = add_months(sy, sm, i)
            key = f"{yy:04d}-{mm:02d}"
            por_mes.append({"mes": key, "count": mp.get(key, 0)})

        cur.execute("""
            SELECT EXTRACT(DAY FROM criado_em)::int AS dia, COUNT(*)
            FROM sac_tickets
            WHERE criado_em >= %s AND criado_em < %s
            GROUP BY 1
        """, (ref, nextm))
        dp = {int(r[0]): r[1] for r in cur.fetchall()}
        import calendar
        ndays = calendar.monthrange(ry, rm)[1]
        por_dia = [{"dia": d, "count": dp.get(d, 0)} for d in range(1, ndays + 1)]

        total_mes = sum(dp.values())
        cur.execute("SELECT COUNT(*) FROM sac_tickets WHERE criado_em >= %s AND criado_em < %s", (prev, ref))
        total_anterior = cur.fetchone()[0] or 0
        pct = round((total_mes - total_anterior) / total_anterior * 100, 1) if total_anterior else None

        return {
            "mes": f"{ry:04d}-{rm:02d}",
            "por_mes": por_mes,
            "por_dia": por_dia,
            "total_mes": total_mes,
            "total_anterior": total_anterior,
            "pct": pct,
        }
    finally:
        cur.close()
        conn.close()


@router.get("/metadata")
def get_metadata():
    """Retorna listas de valores válidos para formulários."""
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT nome, categoria FROM sac_tipos_problema WHERE ativo=TRUE ORDER BY nome")
        rows = cur.fetchall()
        tipos_db = [r[0] for r in rows if r[1] == 'tipo_problema']
        canais_db = [r[0] for r in rows if r[1] == 'canal_compra']
    except Exception:
        tipos_db, canais_db = TIPOS_PROBLEMA, []
    finally:
        cur.close(); conn.close()
    return {
        "canais": CANAIS,
        "tipos_problema": tipos_db if tipos_db else TIPOS_PROBLEMA,
        "canais_compra": canais_db,
        "prioridades": PRIORIDADES,
        "setores": SETORES,
        "status": STATUS_VALIDOS,
    }


# ─── Clientes Externos ────────────────────────────────────────────────────────

@router.get("/clientes-externos")
def listar_clientes_externos(user_id: str = Header(...)):
    """Lista todos os usuários com role=externo. Requer can_edit em sac."""
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, name, email, sector, is_active, last_login
            FROM users
            WHERE role = 'externo'
            ORDER BY name
        """)
        cols = ["id", "name", "email", "empresa", "is_active", "last_login"]
        result = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["id"] = str(d["id"])
            d["last_login"] = d["last_login"].isoformat() if d["last_login"] else None
            result.append(d)
        return result
    finally:
        cur.close()
        conn.close()


@router.post("/clientes-externos")
def criar_cliente_externo(
    nome: str = Form(...),
    email: str = Form(...),
    empresa: str = Form(""),
    senha: str = Form(...),
    user_id: str = Header(...),
):
    """Cria um novo usuário externo (role=externo). Requer can_edit em sac."""
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, is_active FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
        existing = cur.fetchone()
        if existing and existing[1]:
            raise HTTPException(status_code=400, detail="E-mail já cadastrado")

        hashed = get_password_hash(senha)
        if existing and not existing[1]:
            # Reativar
            cur.execute("""
                UPDATE users SET name=%s, email=%s, sector=%s, password_hash=%s,
                    role='externo', is_active=TRUE
                WHERE id=%s RETURNING id
            """, (nome, email, empresa, hashed, str(existing[0])))
            new_id = cur.fetchone()[0]
        else:
            cur.execute("""
                INSERT INTO users (name, email, role, sector, password_hash, permissions)
                VALUES (%s, %s, 'externo', %s, %s, '{}'::jsonb)
                RETURNING id
            """, (nome, email, empresa, hashed))
            new_id = cur.fetchone()[0]

        conn.commit()
        return {"id": str(new_id), "name": nome, "email": email, "empresa": empresa}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/clientes-externos/{cliente_id}")
def atualizar_cliente_externo(
    cliente_id: str,
    nome: str = Form(None),
    empresa: str = Form(None),
    nova_senha: str = Form(None),
    is_active: str = Form(None),
    user_id: str = Header(...),
):
    """Atualiza nome/empresa/senha ou ativa/desativa um cliente externo."""
    if not check_module_permission(user_id, "sac", "can_edit"):
        raise HTTPException(status_code=403, detail="Acesso negado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE id=%s AND role='externo'", (cliente_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Cliente não encontrado")

        sets, vals = [], []
        if nome is not None:
            sets.append("name=%s"); vals.append(nome)
        if empresa is not None:
            sets.append("sector=%s"); vals.append(empresa)
        if nova_senha:
            sets.append("password_hash=%s"); vals.append(get_password_hash(nova_senha))
        if is_active is not None:
            sets.append("is_active=%s"); vals.append(is_active.lower() == "true")

        if sets:
            vals.append(cliente_id)
            cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=%s", vals)
            conn.commit()

        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()
