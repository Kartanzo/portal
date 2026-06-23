"""Módulo RH/DP — Controle de Equipamentos (T.I)."""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime
import json
import os
import logging

from psycopg2.extras import Json
from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from modulo.rh_audit import audit

# --- Criptografia de credenciais sensíveis (senhas AD/Windows/Microsoft/PIN) ---
# Chave Fernet em EQUIP_CRYPTO_KEY. Sem a chave, credenciais NÃO são persistidas
# (segurança: nunca gravar senha em texto puro).
def _fernet():
    key = os.environ.get("EQUIP_CRYPTO_KEY")
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        logger.warning(f"EQUIP_CRYPTO_KEY inválida: {e}")
        return None


def _enc_cred(d):
    """Criptografa um dict de credenciais -> string. Retorna None se vazio/sem chave."""
    d = {k: v for k, v in (d or {}).items() if v not in (None, "", "nan")}
    if not d:
        return None
    f = _fernet()
    if not f:
        logger.warning("EQUIP_CRYPTO_KEY ausente — credenciais não persistidas.")
        return None
    return f.encrypt(json.dumps(d, ensure_ascii=False).encode()).decode()


def _dec_cred(blob):
    if not blob:
        return {}
    f = _fernet()
    if not f:
        return {}
    try:
        return json.loads(f.decrypt(blob.encode()).decode())
    except Exception:
        return {}

router = APIRouter(prefix="/rh/equipamentos", tags=["rh-equipamentos"])
logger = logging.getLogger(__name__)


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_equipamentos (
            id SERIAL PRIMARY KEY,
            tipo TEXT NOT NULL,
            modelo TEXT,
            marca TEXT,
            patrimonio TEXT,
            serial_number TEXT,
            status TEXT DEFAULT 'estoque',
            colaborador_id INTEGER REFERENCES rh_colaboradores(id) ON DELETE SET NULL,
            localizacao TEXT,
            descricao TEXT,
            data_aquisicao DATE,
            valor NUMERIC(12,2),
            nota_fiscal TEXT,
            data_atribuicao DATE,
            data_devolucao DATE,
            observacoes TEXT,
            movimentacao_origem_id INTEGER REFERENCES rh_movimentacoes(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    # ALTER IF NOT EXISTS pra schemas existentes
    for ddl in [
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS localizacao TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS descricao TEXT",
        # Campos comuns filtráveis (modelo híbrido)
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS setor TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS usuario_nome TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS numero_linha TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS ramal TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS ip TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS nome_estacao TEXT",
        # Campos específicos por tipo (long tail) em JSONB
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS atributos JSONB DEFAULT '{}'::jsonb",
        # Credenciais sensíveis criptografadas (Fernet)
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS credenciais_enc TEXT",
    ]:
        try: cur.execute(ddl); conn.commit()
        except Exception as e: conn.rollback(); logger.warning(f"ALTER falhou: {e}")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_equipamentos_historico (
            id SERIAL PRIMARY KEY,
            equipamento_id INTEGER NOT NULL REFERENCES rh_equipamentos(id) ON DELETE CASCADE,
            colaborador_id INTEGER REFERENCES rh_colaboradores(id) ON DELETE SET NULL,
            colaborador_nome TEXT,
            acao TEXT NOT NULL,
            data TIMESTAMP DEFAULT NOW(),
            observacoes TEXT,
            user_id TEXT
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_hist_equip ON rh_equipamentos_historico(equipamento_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_hist_colab ON rh_equipamentos_historico(colaborador_id)")
    conn.commit()
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_equip_status ON rh_equipamentos(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_equip_colab ON rh_equipamentos(colaborador_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_equip_tipo ON rh_equipamentos(tipo)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_rh_equip_patrimonio ON rh_equipamentos(patrimonio) WHERE patrimonio IS NOT NULL AND patrimonio <> ''")
    conn.commit()
    cur.close()
    conn.close()


class EquipamentoIn(BaseModel):
    tipo: str  # notebook | computador | celular | telefone | monitor | impressora | headset | token | outro
    modelo: Optional[str] = None
    marca: Optional[str] = None
    patrimonio: Optional[str] = None
    serial_number: Optional[str] = None
    status: Optional[str] = 'estoque'  # estoque | ativo | manutencao | descartado | perdido
    colaborador_id: Optional[int] = None
    localizacao: Optional[str] = None
    descricao: Optional[str] = None
    data_aquisicao: Optional[date] = None
    valor: Optional[float] = None
    nota_fiscal: Optional[str] = None
    data_atribuicao: Optional[date] = None
    data_devolucao: Optional[date] = None
    observacoes: Optional[str] = None
    movimentacao_origem_id: Optional[int] = None
    # Campos comuns filtráveis
    setor: Optional[str] = None
    usuario_nome: Optional[str] = None
    numero_linha: Optional[str] = None
    ramal: Optional[str] = None
    ip: Optional[str] = None
    nome_estacao: Optional[str] = None
    # Campos específicos por tipo (livre)
    atributos: Optional[dict] = None
    # Credenciais sensíveis (write-only; nunca retornadas no GET de listagem)
    credenciais: Optional[dict] = None


# Colunas seguras retornadas na listagem (NÃO inclui credenciais_enc)
COLS = ['id', 'tipo', 'modelo', 'marca', 'patrimonio', 'serial_number', 'status', 'colaborador_id',
        'localizacao', 'descricao',
        'data_aquisicao', 'valor', 'nota_fiscal', 'data_atribuicao', 'data_devolucao', 'observacoes',
        'setor', 'usuario_nome', 'numero_linha', 'ramal', 'ip', 'nome_estacao', 'atributos',
        'movimentacao_origem_id', 'created_at', 'updated_at']


def _prepare_write(data: dict) -> dict:
    """Normaliza payload p/ INSERT/UPDATE: JSONB em atributos e cripto em credenciais."""
    data = dict(data)
    # credenciais (write-only) -> coluna criptografada
    cred = data.pop('credenciais', None)
    if cred is not None:
        enc = _enc_cred(cred)
        if enc is not None:
            data['credenciais_enc'] = enc
    # atributos dict -> JSONB
    if 'atributos' in data:
        if data['atributos'] is None:
            data.pop('atributos')
        else:
            data['atributos'] = Json(data['atributos'])
    return data


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        elif hasattr(v, '__float__') and not isinstance(v, (int, bool)):
            d[k] = float(v)
        else:
            d[k] = v
    return d


# Setores autorizados a acessar o módulo de Equipamentos (T.I)
_SETORES_TI = ("T.I", "Gestão de Informação")


def _ensure_setor_ti(user_id):
    """Restringe o módulo aos setores de T.I; super_user/ceo têm acesso total."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT role, sector FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()
    if not row:
        raise HTTPException(status_code=403, detail="Usuário não encontrado")
    role, sector = row[0], (row[1] or "")
    if role in ("super_user", "ceo"):
        return
    if sector.strip().lower() not in [s.lower() for s in _SETORES_TI]:
        raise HTTPException(status_code=403, detail="Acesso restrito ao setor de T.I")


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_equipamentos", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Equipamentos")
    _ensure_setor_ti(user_id)
    return user_id


@router.get("/_meta/tipos")
def listar_tipos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Tipos já cadastrados (para autocomplete no formulário)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT tipo FROM rh_equipamentos WHERE tipo IS NOT NULL AND tipo <> '' ORDER BY tipo")
    tipos = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"tipos": tipos}


@router.get("/por-colaborador")
def por_colaborador(
    search: Optional[str] = Query(None, description="Busca por nome do colaborador OU modelo/patrimônio/serial do equipamento"),
    tipo: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    """Lista colaboradores com seus equipamentos vinculados (resumo + detalhe completo)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()

    # Subquery: equipamentos por colaborador
    where_eq, params_eq = [], []
    if tipo:
        where_eq.append("tipo = %s"); params_eq.append(tipo)
    eq_clause = (" WHERE " + " AND ".join(where_eq)) if where_eq else ""

    # Busca textual: pode bater no colaborador OU no equipamento
    join_search = ""
    where_main = ["c.status <> 'demitido' OR c.id IN (SELECT colaborador_id FROM rh_equipamentos WHERE colaborador_id IS NOT NULL)"]
    params_main = []
    if search:
        like = f"%{search}%"
        where_main.append("""(c.nome ILIKE %s OR c.matricula ILIKE %s OR c.cargo ILIKE %s OR c.setor ILIKE %s OR c.id IN (
            SELECT colaborador_id FROM rh_equipamentos
             WHERE colaborador_id IS NOT NULL
               AND (modelo ILIKE %s OR marca ILIKE %s OR patrimonio ILIKE %s OR serial_number ILIKE %s)
        ))""")
        params_main += [like] * 8

    cur.execute(
        f"""SELECT c.id, c.nome, c.cargo, c.setor, c.matricula, c.status, c.data_admissao, c.data_demissao, c.foto_url
              FROM rh_colaboradores c
             WHERE {' AND '.join(where_main)}
             ORDER BY c.nome""",
        params_main,
    )
    colabs = cur.fetchall()
    out = []
    for cid, nome, cargo, setor, matricula, status, data_adm, data_dem, foto in colabs:
        cur.execute(
            f"""SELECT id, tipo, modelo, marca, patrimonio, serial_number, status, data_atribuicao, data_aquisicao, valor
                  FROM rh_equipamentos
                 WHERE colaborador_id = %s {(' AND ' + ' AND '.join(where_eq)) if where_eq else ''}
                 ORDER BY tipo, modelo""",
            tuple([cid] + params_eq),
        )
        equipamentos = []
        for r in cur.fetchall():
            equipamentos.append({
                "id": r[0], "tipo": r[1], "modelo": r[2], "marca": r[3],
                "patrimonio": r[4], "serial_number": r[5], "status": r[6],
                "data_atribuicao": r[7].isoformat() if r[7] else None,
                "data_aquisicao": r[8].isoformat() if r[8] else None,
                "valor": float(r[9]) if r[9] is not None else None,
            })
        # Filtro: se pesquisou e tipo definido, e o colaborador não tem nenhum equipamento que casa, pula
        if (tipo or search) and not equipamentos and not (search and any(s and search.lower() in s.lower() for s in [nome or '', cargo or '', setor or '', matricula or ''])):
            continue

        out.append({
            "id": cid, "nome": nome, "cargo": cargo, "setor": setor,
            "matricula": matricula, "status": status, "foto_url": foto,
            "data_admissao": data_adm.isoformat() if data_adm else None,
            "data_demissao": data_dem.isoformat() if data_dem else None,
            "n_equipamentos": len(equipamentos),
            "equipamentos": equipamentos,
        })

    cur.close()
    conn.close()
    return {"colaboradores": out, "total": len(out)}


@router.get("/colaborador/{cid}/detalhe")
def detalhe_colaborador(cid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Retorna tudo o que está vinculado ao colaborador: dados, equipamentos, admissão e desligamento (acessos/sistemas)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, nome, cpf, email, telefone, matricula, cargo, setor, salario, tipo,
                  data_admissao, data_demissao, status, foto_url, acessos_extras
             FROM rh_colaboradores WHERE id = %s""",
        (cid,),
    )
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    acessos_extras = r[14]
    if isinstance(acessos_extras, str):
        try: acessos_extras = json.loads(acessos_extras)
        except: acessos_extras = {}
    colab = {
        "id": r[0], "nome": r[1], "cpf": r[2], "email": r[3], "telefone": r[4],
        "matricula": r[5], "cargo": r[6], "setor": r[7],
        "salario": float(r[8]) if r[8] is not None else None,
        "tipo": r[9],
        "data_admissao": r[10].isoformat() if r[10] else None,
        "data_demissao": r[11].isoformat() if r[11] else None,
        "status": r[12], "foto_url": r[13],
        "acessos_extras": acessos_extras or {},
    }
    # Equipamentos
    cur.execute(
        f"""SELECT {', '.join(COLS)} FROM rh_equipamentos WHERE colaborador_id = %s ORDER BY tipo, modelo""",
        (cid,),
    )
    equipamentos = [_row(rr, COLS) for rr in cur.fetchall()]
    # Movimentações de admissão (mais recente aprovada)
    cur.execute(
        """SELECT id, titulo, cargo, setor, motivo, urgencia, data_prevista, status, aprovado_em, dados, ticket_id
             FROM rh_movimentacoes
            WHERE tipo='admissao'
              AND (colaborador_id = %s OR titulo ILIKE (SELECT nome FROM rh_colaboradores WHERE id = %s))
            ORDER BY COALESCE(aprovado_em, created_at) DESC LIMIT 1""",
        (cid, cid),
    )
    a = cur.fetchone()
    admissao = None
    if a:
        import json as _j
        dados_adm = a[9]
        if isinstance(dados_adm, str):
            try: dados_adm = _j.loads(dados_adm)
            except: dados_adm = {}
        admissao = {
            "id": a[0], "titulo": a[1], "cargo": a[2], "setor": a[3],
            "motivo": a[4], "urgencia": a[5],
            "data_prevista": a[6].isoformat() if a[6] else None,
            "status": a[7], "aprovado_em": a[8].isoformat() if a[8] else None,
            "ticket_id": a[10], "dados": dados_adm or {},
        }
    # Movimentações de desligamento (mais recente)
    cur.execute(
        """SELECT id, titulo, motivo, data_prevista, status, aprovado_em, dados, ticket_id
             FROM rh_movimentacoes
            WHERE tipo='desligamento' AND colaborador_id = %s
            ORDER BY COALESCE(aprovado_em, created_at) DESC LIMIT 1""",
        (cid,),
    )
    d = cur.fetchone()
    desligamento = None
    if d:
        import json as _j
        dados_des = d[6]
        if isinstance(dados_des, str):
            try: dados_des = _j.loads(dados_des)
            except: dados_des = {}
        desligamento = {
            "id": d[0], "titulo": d[1], "motivo": d[2],
            "data_prevista": d[3].isoformat() if d[3] else None,
            "status": d[4], "aprovado_em": d[5].isoformat() if d[5] else None,
            "ticket_id": d[7], "dados": dados_des or {},
        }
    cur.close()
    conn.close()
    return {"colaborador": colab, "equipamentos": equipamentos, "admissao": admissao, "desligamento": desligamento}


@router.get("")
def listar(
    tipo: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    colaborador_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    where, params = [], []
    if tipo:
        where.append("e.tipo = %s"); params.append(tipo)
    if status:
        where.append("e.status = %s"); params.append(status)
    if colaborador_id:
        where.append("e.colaborador_id = %s"); params.append(colaborador_id)
    if search:
        where.append("(e.modelo ILIKE %s OR e.marca ILIKE %s OR e.patrimonio ILIKE %s OR e.serial_number ILIKE %s "
                     "OR e.usuario_nome ILIKE %s OR e.numero_linha ILIKE %s OR e.ramal ILIKE %s "
                     "OR e.ip ILIKE %s OR e.nome_estacao ILIKE %s OR e.setor ILIKE %s)")
        like = f"%{search}%"
        params += [like] * 10
    sql = f"""
        SELECT e.{', e.'.join(COLS)}, (e.credenciais_enc IS NOT NULL) AS tem_cred, c.nome AS colaborador_nome
          FROM rh_equipamentos e
          LEFT JOIN rh_colaboradores c ON c.id = e.colaborador_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY e.tipo, e.modelo"
    cur.execute(sql, params)
    out = []
    n = len(COLS)
    for r in cur.fetchall():
        d = _row(r[:n], COLS)
        d['tem_credenciais'] = bool(r[n])
        d['colaborador_nome'] = r[-1]
        out.append(d)
    cur.close()
    conn.close()
    return {"equipamentos": out, "total": len(out)}


@router.get("/{eid}/credenciais")
def revelar_credenciais(eid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Revela credenciais descriptografadas. Exige permissão de edição + setor T.I (via _uid)."""
    uid = _uid(user_id, edit=True)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT credenciais_enc FROM rh_equipamentos WHERE id = %s", (eid,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    audit('equipamento', eid, 'revelou_credenciais', uid, {})
    return {"credenciais": _dec_cred(row[0])}


@router.post("")
def criar(payload: EquipamentoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if data.get('colaborador_id') and data.get('status') == 'estoque':
        data['status'] = 'ativo'
        if not data.get('data_atribuicao'):
            data['data_atribuicao'] = date.today()
    data = _prepare_write(data)
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_equipamentos ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    if data.get('colaborador_id'):
        _log_historico(cur, new_id, data['colaborador_id'], 'atribuicao', uid, observacoes='Cadastro inicial')
    conn.commit()
    cur.close()
    conn.close()
    audit('equipamento', new_id, 'criou', uid, {'tipo': data.get('tipo'), 'modelo': data.get('modelo')})
    return {"id": new_id, "ok": True}


@router.put("/{eid}")
def atualizar(eid: int, payload: EquipamentoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = _prepare_write(payload.dict())
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_equipamentos SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, eid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


def _log_historico(cur, equipamento_id, colaborador_id, acao, user_id, observacoes=None):
    """Adiciona linha no histórico. colaborador_nome é capturado para sobreviver a deletes."""
    nome = None
    if colaborador_id:
        cur.execute("SELECT nome FROM rh_colaboradores WHERE id = %s", (colaborador_id,))
        r = cur.fetchone()
        nome = r[0] if r else None
    cur.execute(
        """INSERT INTO rh_equipamentos_historico (equipamento_id, colaborador_id, colaborador_nome, acao, observacoes, user_id)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        (equipamento_id, colaborador_id, nome, acao, observacoes, str(user_id) if user_id else None),
    )


@router.post("/{eid}/atribuir/{colaborador_id}")
def atribuir(eid: int, colaborador_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    # Se já estava com outro colab, registra a devolução desse anterior antes
    cur.execute("SELECT colaborador_id FROM rh_equipamentos WHERE id = %s", (eid,))
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    anterior = r[0]
    if anterior and anterior != colaborador_id:
        _log_historico(cur, eid, anterior, 'devolucao_automatica', uid, observacoes=f"Substituído pela atribuição para colaborador {colaborador_id}")
    cur.execute(
        """UPDATE rh_equipamentos SET colaborador_id=%s, status='ativo',
              data_atribuicao=CURRENT_DATE, data_devolucao=NULL,
              updated_at=NOW(), updated_by=%s WHERE id=%s""",
        (colaborador_id, uid, eid),
    )
    _log_historico(cur, eid, colaborador_id, 'atribuicao', uid)
    conn.commit()
    cur.close()
    conn.close()
    audit('equipamento', eid, 'atribuiu', uid, {'colaborador_id': colaborador_id})
    return {"ok": True}


@router.post("/{eid}/devolver")
def devolver(eid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Devolve o equipamento ao estoque. NÃO apaga o vínculo — registra no histórico
    qual colaborador devolveu e quando."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT colaborador_id FROM rh_equipamentos WHERE id = %s", (eid,))
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    colab_anterior = r[0]
    if colab_anterior:
        _log_historico(cur, eid, colab_anterior, 'devolucao', uid)
    cur.execute(
        """UPDATE rh_equipamentos SET colaborador_id=NULL, status='estoque',
              data_devolucao=CURRENT_DATE, updated_at=NOW(), updated_by=%s WHERE id=%s""",
        (uid, eid),
    )
    conn.commit()
    cur.close()
    conn.close()
    audit('equipamento', eid, 'devolveu_estoque', uid, {'colaborador_anterior': colab_anterior})
    return {"ok": True, "colaborador_devolvido": colab_anterior}


@router.get("/{eid}/historico")
def historico(eid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, colaborador_id, colaborador_nome, acao, data, observacoes
             FROM rh_equipamentos_historico
            WHERE equipamento_id = %s
            ORDER BY data DESC""",
        (eid,),
    )
    rows = []
    for r in cur.fetchall():
        rows.append({
            "id": r[0], "colaborador_id": r[1], "colaborador_nome": r[2],
            "acao": r[3],
            "data": r[4].isoformat() if r[4] else None,
            "observacoes": r[5],
        })
    cur.close()
    conn.close()
    return {"historico": rows}


@router.delete("/{eid}")
def remover(eid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_equipamentos WHERE id = %s", (eid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Equipamento não encontrado")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}
