"""
Análise de Crédito (Financeiro) — consultas de bureau de crédito por CNPJ.

Fonte dos dados: planilha Google `ANALISE_CRÉDITO` (somente-leitura via service account),
duas abas:
  - RESULTADO_MAXI      -> tipo "maxi"     (resumo, ~82 colunas)
  - RESULTADO_COMPLETO  -> tipo "completo" (completo, ~357 colunas)

A planilha é sincronizada para o nosso banco (tabela `analise_credito`). Cada linha vira
um registro com os campos básicos (data_consulta, cnpj, razao_social) + TODAS as colunas
preservadas em `dados` (JSONB), para a tela de detalhe mostrar tudo sem exceção.

Separação: por ANO e MÊS (derivados de data_consulta) e por TIPO (maxi/completo).
"""
import os
import re
import json
import hashlib
import unicodedata
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends

from core import dummy

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/financeiro/analise-credito", tags=["Análise de Crédito"])

MODULE_ID = "financeiro_analise_credito"

# Planilha compartilhada com a service account (Leitor).
SHEET_ID = "1cgrVpBSKAP9RMUktVPopKzrB5h5QJjy7wOIU9DhGAno"
# aba_da_planilha -> tipo interno
WORKSHEETS = {
    "RESULTADO_MAXI": "maxi",
    "RESULTADO_COMPLETO": "completo",
}

# Colunas de identidade (iguais nas duas abas)
COL_DATA = "data_consulta"
COL_CNPJ = "cnpj"
COL_RAZAO = "razao-social"

# Credenciais Google (mesmo mecanismo da Comissão / importation).
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
        raise HTTPException(status_code=403, detail="Acesso negado à Análise de Crédito")


def _require_edit(user_id: Optional[str]):
    _uid(user_id)
    if not check_module_permission(user_id, MODULE_ID, "can_edit"):
        raise HTTPException(status_code=403, detail="Sem permissão para sincronizar a Análise de Crédito")


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def _so_digitos(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _parse_data(s: str):
    """Retorna (ano:int|None, mes:int|None, iso:str|None) a partir de strings de data variadas."""
    s = (s or "").strip()
    if not s:
        return None, None, None
    # pega só a parte de data (antes de espaço/T), tolera dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy
    base = re.split(r"[ T]", s)[0]
    m = re.match(r"^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$", base)
    if not m:
        return None, None, None
    a, b, c = m.group(1), m.group(2), m.group(3)
    try:
        if len(a) == 4:          # yyyy-mm-dd
            ano, mes, dia = int(a), int(b), int(c)
        else:                    # dd/mm/yyyy
            dia, mes, ano = int(a), int(b), int(c)
            if ano < 100:
                ano += 2000
        if not (1 <= mes <= 12) or not (1900 <= ano <= 2100):
            return None, None, None
        return ano, mes, f"{ano:04d}-{mes:02d}-{min(max(dia,1),31):02d}"
    except (ValueError, TypeError):
        return None, None, None


def _row_hash(tipo: str, row: dict) -> str:
    """Chave estável por conteúdo: re-sync idêntico é idempotente; linhas distintas coexistem."""
    payload = tipo + "\x1f" + json.dumps(row, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


# ─────────────────────────────────────────────
#  Google Sheets
# ─────────────────────────────────────────────
def _google_creds():
    from google.oauth2 import service_account
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        return service_account.Credentials.from_service_account_info(json.loads(creds_json), scopes=_SCOPES)
    paths = [os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")] + _CRED_CANDIDATES
    for p in paths:
        if p and os.path.exists(p):
            return service_account.Credentials.from_service_account_file(p, scopes=_SCOPES)
    raise RuntimeError("Credenciais Google não encontradas")


def _cnpj_fake(r) -> str:
    """CNPJ claramente fictício: 00.000.000/00XX-NN (não corresponde a nenhum CNPJ real)."""
    seq = r.randint(1, 999)
    dv = r.randint(0, 99)
    return f"00.000.000/{seq:04d}-{dv:02d}"


def _colunas_dummy(tipo: str) -> List[str]:
    """Cabeçalhos fictícios estáveis para cada aba (maxi ~82 colunas, completo ~357)."""
    base = [COL_DATA, COL_CNPJ, COL_RAZAO]
    n = 79 if tipo == "maxi" else 354  # totaliza ~82 e ~357 com as 3 de identidade
    extras = [f"campo_{tipo}_{i:03d}" for i in range(1, n + 1)]
    return base + extras


def _ler_worksheet(ws_title: str) -> List[dict]:
    """Devolve lista de dicts {cabeçalho: valor} com dados dummy determinísticos.

    Substitui a leitura do Google Sheets (service account) por empresas fictícias
    com histórico em 2026 (12 meses). Cabeçalhos duplicados ganham sufixo __2, __3...
    """
    tipo = WORKSHEETS.get(ws_title, "maxi")
    hdr = _colunas_dummy(tipo)
    situacoes = ["ATIVA", "ATIVA", "ATIVA", "INAPTA", "SUSPENSA", "BAIXADA"]
    portes = ["ME", "EPP", "DEMAIS", "MEI"]
    out: List[dict] = []
    # Histórico em 2026, garantindo consultas em TODOS os 12 meses.
    for mes in range(1, 13):
        n_no_mes = 3 if tipo == "maxi" else 2
        for k in range(n_no_mes):
            r = dummy.rng("analise_credito", tipo, mes, k)
            dia = dummy.dia_aleatorio(dummy.ANO_BASE, mes, r)
            razao = dummy.escolher(r, dummy.CLIENTES)
            cnpj = _cnpj_fake(r)
            uf = dummy.escolher(r, dummy.ESTADOS)
            cidade = dummy.escolher(r, dummy.CIDADES)
            score = r.randint(0, 1000)
            row = {}
            for col in hdr:
                if col == COL_DATA:
                    row[col] = dia.strftime("%d/%m/%Y")
                elif col == COL_CNPJ:
                    row[col] = cnpj
                elif col == COL_RAZAO:
                    row[col] = razao
                else:
                    # preenche o restante das colunas com valores fictícios variados
                    idx = hdr.index(col)
                    bucket = idx % 6
                    if bucket == 0:
                        row[col] = str(score)
                    elif bucket == 1:
                        row[col] = dummy.escolher(r, situacoes)
                    elif bucket == 2:
                        row[col] = uf
                    elif bucket == 3:
                        row[col] = cidade
                    elif bucket == 4:
                        row[col] = f"R$ {dummy.valor(r, base=5000.0):.2f}"
                    else:
                        row[col] = dummy.escolher(r, portes)
            out.append(row)
    return out


# ─────────────────────────────────────────────
#  Tabela
# ─────────────────────────────────────────────
def ensure_analise_credito_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS analise_credito (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                chave_sync    TEXT UNIQUE NOT NULL,
                tipo          TEXT NOT NULL,            -- 'maxi' | 'completo'
                data_consulta TEXT,
                data_iso      DATE,
                ano           INT,
                mes           INT,
                cnpj          TEXT,
                cnpj_norm     TEXT,
                razao_social  TEXT,
                dados         JSONB NOT NULL DEFAULT '{}'::jsonb,
                criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_anlcred_tipo      ON analise_credito (tipo);
            CREATE INDEX IF NOT EXISTS ix_anlcred_ano_mes   ON analise_credito (ano, mes);
            CREATE INDEX IF NOT EXISTS ix_anlcred_cnpj_norm ON analise_credito (cnpj_norm);
            CREATE INDEX IF NOT EXISTS ix_anlcred_razao     ON analise_credito (razao_social);
            """
        )
        cur.execute("CREATE TABLE IF NOT EXISTS analise_credito_sync (id INT PRIMARY KEY, sincronizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.commit()
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Sincronização
# ─────────────────────────────────────────────
@router.post("/sync")
def sincronizar(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lê as duas abas da planilha e faz upsert na tabela. Idempotente por conteúdo da linha."""
    _require_edit(user_id)
    ensure_analise_credito_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    resumo = {}
    total = 0
    try:
        for ws_title, tipo in WORKSHEETS.items():
            linhas = _ler_worksheet(ws_title)
            ins = upd = 0
            for row in linhas:
                data = (row.get(COL_DATA) or "").strip()
                cnpj = (row.get(COL_CNPJ) or "").strip()
                razao = (row.get(COL_RAZAO) or "").strip()
                ano, mes, iso = _parse_data(data)
                chave = _row_hash(tipo, row)
                cur.execute(
                    """
                    INSERT INTO analise_credito
                        (chave_sync, tipo, data_consulta, data_iso, ano, mes, cnpj, cnpj_norm, razao_social, dados)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (chave_sync) DO UPDATE SET
                        data_consulta = EXCLUDED.data_consulta,
                        data_iso      = EXCLUDED.data_iso,
                        ano           = EXCLUDED.ano,
                        mes           = EXCLUDED.mes,
                        cnpj          = EXCLUDED.cnpj,
                        cnpj_norm     = EXCLUDED.cnpj_norm,
                        razao_social  = EXCLUDED.razao_social,
                        dados         = EXCLUDED.dados,
                        atualizado_em = CURRENT_TIMESTAMP
                    RETURNING (xmax = 0) AS inserido
                    """,
                    (
                        chave, tipo, data, iso, ano, mes, cnpj, _so_digitos(cnpj), razao,
                        json.dumps(row, ensure_ascii=False),
                    ),
                )
                if cur.fetchone()[0]:
                    ins += 1
                else:
                    upd += 1
            resumo[tipo] = {"lidos": len(linhas), "inseridos": ins, "atualizados": upd}
            total += len(linhas)
        conn.commit()
        try:
            cur.execute("INSERT INTO analise_credito_sync (id, sincronizado_em) VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET sincronizado_em = CURRENT_TIMESTAMP")
            conn.commit()
        except Exception:
            conn.rollback()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao sincronizar: {e}")
    finally:
        cur.close()
        conn.close()
    return {"ok": True, "total": total, "resumo": resumo}


# ─────────────────────────────────────────────
#  Leitura
# ─────────────────────────────────────────────
def _rows_to_dicts(cur) -> List[dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


@router.get("/filtros")
def filtros(tipo: str = "maxi", user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Anos e meses disponíveis para o tipo, para popular os selects."""
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT DISTINCT ano, mes
            FROM analise_credito
            WHERE tipo = %s AND ano IS NOT NULL
            ORDER BY ano DESC, mes DESC
            """,
            (tipo,),
        )
        pares = _rows_to_dicts(cur)
    finally:
        cur.close()
        conn.close()
    anos = sorted({p["ano"] for p in pares}, reverse=True)
    meses_por_ano = {}
    for p in pares:
        meses_por_ano.setdefault(p["ano"], []).append(p["mes"])
    return {"anos": anos, "meses_por_ano": meses_por_ano}


@router.get("/kpis")
def kpis(
    tipo: str = "maxi",
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _require_view(user_id)
    where = ["tipo = %s"]
    params: list = [tipo]
    if ano is not None:
        where.append("ano = %s"); params.append(ano)
    if mes is not None:
        where.append("mes = %s"); params.append(mes)
    w = " AND ".join(where)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            f"""
            SELECT COUNT(*)                              AS total_consultas,
                   COUNT(DISTINCT cnpj_norm)             AS cnpjs_distintos,
                   MAX(data_iso)                         AS ultima_consulta,
                   COUNT(*) FILTER (WHERE data_iso >= date_trunc('month', CURRENT_DATE)) AS no_mes_atual
            FROM analise_credito
            WHERE {w}
            """,
            tuple(params),
        )
        row = _rows_to_dicts(cur)[0]
        cur.execute("SELECT sincronizado_em FROM analise_credito_sync WHERE id = 1")
        _sr = cur.fetchone()
        ultima_sync = _sr[0].isoformat() if _sr and _sr[0] else None
    finally:
        cur.close()
        conn.close()
    return {
        "ultima_sync": ultima_sync,
        "total_consultas": row["total_consultas"] or 0,
        "cnpjs_distintos": row["cnpjs_distintos"] or 0,
        "ultima_consulta": str(row["ultima_consulta"]) if row["ultima_consulta"] else None,
        "no_mes_atual": row["no_mes_atual"] or 0,
    }


@router.get("/registros")
def listar_registros(
    tipo: str = "maxi",
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    busca: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Lista enxuta para a tabela: só campos básicos (data, cnpj, razão)."""
    _require_view(user_id)
    where = ["tipo = %s"]
    params: list = [tipo]
    if ano is not None:
        where.append("ano = %s"); params.append(ano)
    if mes is not None:
        where.append("mes = %s"); params.append(mes)
    if busca:
        where.append("(cnpj_norm LIKE %s OR razao_social ILIKE %s)")
        params.append(f"%{_so_digitos(busca)}%")
        params.append(f"%{busca}%")
    w = " AND ".join(where)
    limit = max(1, min(limit, 1000))
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM analise_credito WHERE {w}", tuple(params))
        total = cur.fetchone()[0]
        cur.execute(
            f"""
            SELECT id, data_consulta, data_iso, ano, mes, cnpj, razao_social
            FROM analise_credito
            WHERE {w}
            ORDER BY data_iso DESC NULLS LAST, razao_social ASC
            LIMIT %s OFFSET %s
            """,
            tuple(params) + (limit, offset),
        )
        registros = _rows_to_dicts(cur)
    finally:
        cur.close()
        conn.close()
    for r in registros:
        r["id"] = str(r["id"])
        r["data_iso"] = str(r["data_iso"]) if r["data_iso"] else None
    return {"total": total, "limit": limit, "offset": offset, "registros": registros}


@router.get("/registro/{registro_id}")
def detalhe(registro_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Detalhe com TODAS as colunas (JSONB `dados`) + identificação."""
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, tipo, data_consulta, data_iso, ano, mes, cnpj, razao_social, dados
            FROM analise_credito
            WHERE id = %s
            """,
            (registro_id,),
        )
        rows = _rows_to_dicts(cur)
    finally:
        cur.close()
        conn.close()
    if not rows:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    r = rows[0]
    r["id"] = str(r["id"])
    r["data_iso"] = str(r["data_iso"]) if r["data_iso"] else None
    # dados já vem como dict (JSONB). Garante dict.
    if isinstance(r["dados"], str):
        try:
            r["dados"] = json.loads(r["dados"])
        except (ValueError, TypeError):
            r["dados"] = {}
    return r
