"""Módulo RH/DP — Documentos (Modelos + Documentos emitidos)."""
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime
import os
import re
import shutil
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from core.config import UPLOAD_DIR

router = APIRouter(prefix="/rh/documentos", tags=["rh-documentos"])
logger = logging.getLogger(__name__)


MODELOS_SEED = [
    ("F 008.01", "Solicitação de Abertura de Vaga", "Recrutamento", "01"),
    ("F 091.00", "Parecer de Entrevista RH", "Recrutamento", "00"),
    ("F 093.00", "Ficha Cadastral (CLT)", "Admissão", "00"),
    ("F 093.PJ", "Ficha Cadastral (PJ)", "Admissão", "00"),
    ("F 092.00", "Declaração de Opção de Vale Transporte", "Admissão", "00"),
    ("F 089.00", "Avaliação de Experiência", "Avaliação", "00"),
    ("F 090.00", "Feedback / Orientação", "Avaliação", "00"),
    ("F 101.00", "Autorização para Banco de Horas / Hora Extra", "Jornada", "00"),
    ("F 102.00", "Autorização de Saída", "Jornada", "00"),
    ("SOL.FER", "Solicitação de Férias", "Jornada", "00"),
    ("F 103.00", "Alteração Funcional", "Movimentação", "00"),
    ("F 094.00", "Requisição de Desligamento", "Desligamento", "00"),
    ("F 095.00", "Entrevista de Desligamento", "Desligamento", "00"),
    ("COM.COMP", "Comunicado de Comparecimento (Rescisão)", "Desligamento", "00"),
    ("COM.HOM", "Comunicado de Homologação", "Desligamento", "00"),
    ("AUT.SIND", "Autorização de Desconto Sindical", "Sindical", "00"),
]


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_modelos_documento (
            id SERIAL PRIMARY KEY,
            codigo TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            categoria TEXT,
            versao TEXT,
            file_url TEXT,
            descricao TEXT,
            ativo BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_documentos (
            id SERIAL PRIMARY KEY,
            colaborador_id INTEGER REFERENCES rh_colaboradores(id) ON DELETE CASCADE,
            modelo_id INTEGER REFERENCES rh_modelos_documento(id) ON DELETE SET NULL,
            titulo TEXT,
            file_url TEXT,
            data_emissao DATE,
            data_validade DATE,
            status TEXT DEFAULT 'vigente',
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_documentos_colab ON rh_documentos(colaborador_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_documentos_modelo ON rh_documentos(modelo_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_documentos_status ON rh_documentos(status)")

    # Seed inicial dos modelos
    for cod, nome, cat, ver in MODELOS_SEED:
        cur.execute(
            "INSERT INTO rh_modelos_documento (codigo, nome, categoria, versao) VALUES (%s, %s, %s, %s) ON CONFLICT (codigo) DO NOTHING",
            (cod, nome, cat, ver),
        )
    conn.commit()
    for ddl in [
        "ALTER TABLE rh_modelos_documento ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_modelos_documento ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
        "ALTER TABLE rh_documentos ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_documentos ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
    ]:
        try:
            cur.execute(ddl); conn.commit()
        except Exception as e:
            conn.rollback(); logger.warning(f"ALTER falhou: {e}")
    cur.close()
    conn.close()


class ModeloIn(BaseModel):
    codigo: str
    nome: str
    categoria: Optional[str] = None
    versao: Optional[str] = '00'
    file_url: Optional[str] = None
    descricao: Optional[str] = None
    ativo: Optional[bool] = True


class DocumentoIn(BaseModel):
    colaborador_id: int
    modelo_id: Optional[int] = None
    titulo: Optional[str] = None
    file_url: Optional[str] = None
    data_emissao: Optional[date] = None
    data_validade: Optional[date] = None
    status: Optional[str] = 'vigente'
    observacoes: Optional[str] = None


MOD_COLS = ['id', 'codigo', 'nome', 'categoria', 'versao', 'file_url', 'descricao', 'ativo', 'created_at', 'updated_at']
DOC_COLS = ['id', 'colaborador_id', 'modelo_id', 'titulo', 'file_url', 'data_emissao', 'data_validade', 'status', 'observacoes', 'created_at', 'updated_at']


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_documentos", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Documentos")
    return user_id


# ====== MODELOS ======

@router.get("/modelos")
def listar_modelos(
    search: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    ativo: Optional[bool] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if search:
        where.append("(codigo ILIKE %s OR nome ILIKE %s OR descricao ILIKE %s)")
        like = f"%{search}%"
        params += [like, like, like]
    if categoria:
        where.append("categoria = %s"); params.append(categoria)
    if ativo is not None:
        where.append("ativo = %s"); params.append(ativo)
    sql = f"SELECT {', '.join(MOD_COLS)} FROM rh_modelos_documento"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY categoria, codigo"
    cur.execute(sql, params)
    rows = [_row(r, MOD_COLS) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"modelos": rows, "total": len(rows)}


@router.post("/modelos")
def criar_modelo(payload: ModeloIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_modelos_documento ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    try:
        cur.execute(sql, list(data.values()) + [uid, uid])
    except Exception as e:
        conn.rollback()
        cur.close(); conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/modelos/{mid}")
def atualizar_modelo(mid: int, payload: ModeloIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_modelos_documento SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, mid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/modelos/{mid}")
def remover_modelo(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE rh_modelos_documento SET ativo = FALSE, updated_at = NOW() WHERE id = %s", (mid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.get("/_debug/uploads-info")
def debug_uploads_info(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Diagnóstico: mostra onde estão sendo salvos os arquivos, lista o que tem na pasta."""
    _uid(user_id)
    rh_dir = os.path.join(UPLOAD_DIR, "rh_modelos")
    info: dict = {
        "cwd": os.getcwd(),
        "UPLOAD_DIR": UPLOAD_DIR,
        "rh_modelos_dir": rh_dir,
        "upload_dir_existe": os.path.isdir(UPLOAD_DIR),
        "rh_modelos_existe": os.path.isdir(rh_dir),
        "arquivos_na_pasta": [],
    }
    try:
        info["upload_dir_writable"] = os.access(UPLOAD_DIR, os.W_OK)
    except Exception:
        info["upload_dir_writable"] = None
    try:
        if os.path.isdir(rh_dir):
            arqs = []
            for f in sorted(os.listdir(rh_dir)):
                full = os.path.join(rh_dir, f)
                if os.path.isfile(full):
                    arqs.append({"nome": f, "size": os.path.getsize(full)})
            info["arquivos_na_pasta"] = arqs[:50]
            info["total_arquivos"] = len(arqs)
    except Exception as e:
        info["erro_listagem"] = str(e)
    # Lista também os modelos que têm file_url no banco
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, codigo, nome, file_url FROM rh_modelos_documento WHERE file_url IS NOT NULL ORDER BY id")
    info["modelos_com_url_no_banco"] = [
        {"id": r[0], "codigo": r[1], "nome": r[2], "file_url": r[3]} for r in cur.fetchall()
    ]
    cur.close()
    conn.close()
    return info


@router.post("/modelos/upload-lote")
def upload_lote(arquivos: list[UploadFile] = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Recebe múltiplos arquivos e mapeia automaticamente pelo nome para o código do modelo.

    Reconhece prefixos como 'F 008.01', 'F 091.00', etc.
    Mapeamentos especiais para nomes da 3LACKD: 'FICHA CADASTRAL PJ' → F 093.PJ etc.
    """
    uid = _uid(user_id, edit=True)
    ensure_tables()
    rh_dir = os.path.join(UPLOAD_DIR, "rh_modelos")
    os.makedirs(rh_dir, exist_ok=True)

    # Mapeamentos especiais (nome do arquivo contém X → código)
    SPECIAL_MAP = [
        ("PJ", "F 093.PJ"),
        ("FERIAS", "SOL.FER"),
        ("FÉRIAS", "SOL.FER"),
        ("HOMOLOGAÇÃO", "COM.HOM"),
        ("HOMOLOGACAO", "COM.HOM"),
        ("COMPARECIMENTO", "COM.COMP"),
        ("SINDICAL", "AUT.SIND"),
        ("DECONTO", "AUT.SIND"),
        ("PROCESSO SELETIVO", "PROC.SEL"),
        ("NOTIFICAÇÃO", "NOTIF"),
        ("NOTIFICACAO", "NOTIF"),
    ]

    conn = get_db_connection()
    cur = conn.cursor()
    resultados = []

    for arq in arquivos:
        nome = arq.filename or "arquivo"
        nome_upper = nome.upper()
        codigo = None

        # 1. Tenta detectar 'F XXX.YY'
        m = re.search(r'F\s*(\d{3})\.(\d{2})', nome_upper)
        if m:
            codigo = f"F {m.group(1)}.{m.group(2)}"

        # 2. Se não, tenta mapeamentos especiais
        if not codigo:
            for kw, cod in SPECIAL_MAP:
                if kw in nome_upper:
                    codigo = cod
                    break

        if not codigo:
            resultados.append({"arquivo": nome, "ok": False, "erro": "Não foi possível identificar o código do modelo pelo nome"})
            continue

        # Garante que o modelo existe — se não existe cria com nome do arquivo limpo
        cur.execute("SELECT id, nome FROM rh_modelos_documento WHERE codigo = %s", (codigo,))
        row = cur.fetchone()
        if row:
            modelo_id = row[0]
        else:
            nome_limpo = re.sub(r'F\s*\d{3}\.\d{2}\s*[-—–]?\s*', '', nome, flags=re.IGNORECASE)
            nome_limpo = re.sub(r'\.(docx?|pdf)$', '', nome_limpo, flags=re.IGNORECASE).strip(' -_')
            if not nome_limpo:
                nome_limpo = codigo
            cur.execute(
                "INSERT INTO rh_modelos_documento (codigo, nome, categoria, versao, created_by, updated_by) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (codigo, nome_limpo, "Outros", "00", uid, uid),
            )
            modelo_id = cur.fetchone()[0]

        # Salva o arquivo
        clean = re.sub(r'[^\w\-.]', '_', nome)
        safe = f"modelo_{modelo_id}_{int(datetime.now().timestamp())}_{clean}"
        full_path = os.path.join(rh_dir, safe)
        logger.info(f"[RH_DOCUMENTOS LOTE] Salvando '{nome}' (modelo {modelo_id}) cwd={os.getcwd()} UPLOAD_DIR={UPLOAD_DIR} dest={full_path}")
        try:
            with open(full_path, 'wb') as buf:
                shutil.copyfileobj(arq.file, buf)
            if os.path.exists(full_path):
                sz = os.path.getsize(full_path)
                logger.info(f"[RH_DOCUMENTOS LOTE] OK '{nome}' → {full_path} ({sz} bytes)")
            else:
                logger.error(f"[RH_DOCUMENTOS LOTE] '{nome}' NÃO EXISTE após write: {full_path}")
            url = f"/uploads/rh_modelos/{safe}"
            cur.execute(
                "UPDATE rh_modelos_documento SET file_url = %s, updated_at = NOW(), updated_by = %s WHERE id = %s",
                (url, uid, modelo_id),
            )
            resultados.append({"arquivo": nome, "ok": True, "codigo": codigo, "modelo_id": modelo_id})
        except Exception as e:
            logger.error(f"[RH_DOCUMENTOS LOTE] Falha em '{nome}': {e}")
            resultados.append({"arquivo": nome, "ok": False, "erro": str(e)})

    conn.commit()
    cur.close()
    conn.close()
    sucesso = sum(1 for r in resultados if r["ok"])
    return {"ok": True, "total": len(resultados), "sucesso": sucesso, "resultados": resultados}


@router.post("/modelos/{mid}/upload")
def upload_arquivo_modelo(mid: int, arquivo: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Faz upload do arquivo .docx/.pdf do modelo. Substitui anterior se houver."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    rh_dir = os.path.join(UPLOAD_DIR, "rh_modelos")
    os.makedirs(rh_dir, exist_ok=True)
    clean = re.sub(r'[^\w\-.]', '_', arquivo.filename or 'modelo')
    safe = f"modelo_{mid}_{int(datetime.now().timestamp())}_{clean}"
    full_path = os.path.join(rh_dir, safe)
    logger.info(f"[RH_DOCUMENTOS] Salvando arquivo do modelo {mid}: cwd={os.getcwd()} UPLOAD_DIR={UPLOAD_DIR} dest={full_path}")
    try:
        with open(full_path, 'wb') as buf:
            shutil.copyfileobj(arquivo.file, buf)
        if os.path.exists(full_path):
            sz = os.path.getsize(full_path)
            logger.info(f"[RH_DOCUMENTOS] OK arquivo salvo {full_path} ({sz} bytes)")
        else:
            logger.error(f"[RH_DOCUMENTOS] Arquivo NÃO existe após write: {full_path}")
    except Exception as e:
        logger.error(f"[RH_DOCUMENTOS] Falha ao salvar {full_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao salvar: {e}")
    url = f"/uploads/rh_modelos/{safe}"
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE rh_modelos_documento SET file_url = %s, updated_at = NOW(), updated_by = %s WHERE id = %s", (url, uid, mid))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "file_url": url}


@router.get("/modelos/{mid}/download")
def download_modelo(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT codigo, nome, file_url FROM rh_modelos_documento WHERE id = %s", (mid,))
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    codigo, nome, file_url = r
    if not file_url:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Modelo ainda não tem arquivo carregado")
    rel = file_url.replace("/uploads/", "", 1)
    full = os.path.join(UPLOAD_DIR, rel)
    logger.info(f"[RH_DOCUMENTOS] Download modelo {mid}: file_url={file_url} UPLOAD_DIR={UPLOAD_DIR} full={full} exists={os.path.exists(full)}")
    if not os.path.exists(full):
        # Auto-heal: o arquivo sumiu (provavelmente um redeploy sem volume persistente).
        # Limpa o file_url para que a UI peça novo upload.
        try:
            cur.execute("UPDATE rh_modelos_documento SET file_url = NULL, updated_at = NOW() WHERE id = %s", (mid,))
            conn.commit()
        except Exception:
            pass
        cur.close(); conn.close()
        raise HTTPException(status_code=410, detail="Arquivo do modelo não está mais disponível no servidor. Faça upload novamente.")
    cur.close()
    conn.close()
    ext = os.path.splitext(full)[1] or '.docx'
    download_name = f"{codigo} - {nome}{ext}"
    return FileResponse(full, filename=download_name)


# ====== DOCUMENTOS ======

@router.get("")
def listar_documentos(
    colaborador_id: Optional[int] = Query(None),
    modelo_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if colaborador_id:
        where.append("d.colaborador_id = %s"); params.append(colaborador_id)
    if modelo_id:
        where.append("d.modelo_id = %s"); params.append(modelo_id)
    if status:
        where.append("d.status = %s"); params.append(status)
    sql = f"""
        SELECT d.{', d.'.join(DOC_COLS)},
               c.nome AS colaborador_nome,
               m.codigo AS modelo_codigo,
               m.nome AS modelo_nome,
               m.categoria AS modelo_categoria
          FROM rh_documentos d
          LEFT JOIN rh_colaboradores c ON c.id = d.colaborador_id
          LEFT JOIN rh_modelos_documento m ON m.id = d.modelo_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY d.created_at DESC"
    cur.execute(sql, params)
    rows = cur.fetchall()
    out = []
    for r in rows:
        d = _row(r[:len(DOC_COLS)], DOC_COLS)
        d['colaborador_nome'] = r[len(DOC_COLS)]
        d['modelo_codigo'] = r[len(DOC_COLS) + 1]
        d['modelo_nome'] = r[len(DOC_COLS) + 2]
        d['modelo_categoria'] = r[len(DOC_COLS) + 3]
        out.append(d)
    cur.close()
    conn.close()
    return {"documentos": out, "total": len(out)}


@router.post("")
def criar_documento(payload: DocumentoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_documentos ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/{did}")
def atualizar_documento(did: int, payload: DocumentoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_documentos SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, did],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/{did}")
def remover_documento(did: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_documentos WHERE id = %s", (did,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.get("/_meta/categorias")
def categorias(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT categoria FROM rh_modelos_documento WHERE categoria IS NOT NULL ORDER BY categoria")
    cats = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"categorias": cats}
