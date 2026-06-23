"""Módulo RH/DP — Movimentações (Admissão / Desligamento) com integração TI."""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, Any, Dict
from pydantic import BaseModel
from datetime import date, datetime
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session
from modulo.rh_audit import audit

router = APIRouter(prefix="/rh/movimentacoes", tags=["rh-movimentacoes"])
logger = logging.getLogger(__name__)


def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rh_movimentacoes (
            id SERIAL PRIMARY KEY,
            tipo TEXT NOT NULL,
            colaborador_id INTEGER REFERENCES rh_colaboradores(id) ON DELETE SET NULL,
            titulo TEXT NOT NULL,
            setor TEXT,
            cargo TEXT,
            motivo TEXT,
            urgencia TEXT DEFAULT 'normal',
            data_prevista DATE,
            data_efetivacao DATE,
            status TEXT DEFAULT 'pendente',
            solicitante_id INTEGER,
            aprovado_por INTEGER,
            aprovado_em TIMESTAMP,
            ticket_id TEXT,
            dados JSONB DEFAULT '{}'::jsonb,
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER,
            updated_by INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_mov_tipo ON rh_movimentacoes(tipo)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_mov_status ON rh_movimentacoes(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rh_mov_colab ON rh_movimentacoes(colaborador_id)")
    conn.commit()
    for ddl in [
        "ALTER TABLE rh_movimentacoes ALTER COLUMN solicitante_id TYPE TEXT USING solicitante_id::TEXT",
        "ALTER TABLE rh_movimentacoes ALTER COLUMN aprovado_por TYPE TEXT USING aprovado_por::TEXT",
        "ALTER TABLE rh_movimentacoes ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT",
        "ALTER TABLE rh_movimentacoes ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT",
    ]:
        try:
            cur.execute(ddl); conn.commit()
        except Exception as e:
            conn.rollback(); logger.warning(f"ALTER falhou: {e}")
    cur.close()
    conn.close()


class MovIn(BaseModel):
    tipo: str  # 'admissao' | 'desligamento'
    colaborador_id: Optional[int] = None
    titulo: str
    setor: Optional[str] = None
    cargo: Optional[str] = None
    motivo: Optional[str] = None
    urgencia: Optional[str] = 'normal'
    data_prevista: Optional[date] = None
    data_efetivacao: Optional[date] = None
    status: Optional[str] = 'pendente'
    solicitante_id: Optional[int] = None
    dados: Optional[Dict[str, Any]] = None
    observacoes: Optional[str] = None


MOV_COLS = ['id', 'tipo', 'colaborador_id', 'titulo', 'setor', 'cargo', 'motivo', 'urgencia',
            'data_prevista', 'data_efetivacao', 'status', 'solicitante_id', 'aprovado_por',
            'aprovado_em', 'ticket_id', 'dados', 'observacoes', 'created_at', 'updated_at']


def _row(row, cols):
    d = {}
    for k, v in zip(cols, row):
        if isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        elif k == 'dados':
            if isinstance(v, str):
                try: d[k] = json.loads(v)
                except: d[k] = {}
            else:
                d[k] = v or {}
        else:
            d[k] = v
    return d


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, "rh_movimentacoes", lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para RH · Movimentações")
    return user_id


def _criar_ticket_ti(cur, mov: dict, requester_uid: str) -> Optional[str]:
    """Cria ticket na tabela tickets com base nos dados de TI da movimentação."""
    tipo = mov.get('tipo')
    titulo = mov.get('titulo') or ''
    dados = mov.get('dados') or {}
    if isinstance(dados, str):
        try: dados = json.loads(dados)
        except: dados = {}

    if tipo == 'admissao':
        ti_title = f"Provisionamento — Nova contratação: {titulo}"
        equip = dados.get('equipamentos', []) or []
        acessos = dados.get('acessos', []) or []
        permissoes = dados.get('permissoes', []) or []
        fisicos = dados.get('fisicos', []) or []
        obs_ti = dados.get('observacoes_ti', '') or ''
        equip_lines = [f"  • {e}" for e in equip] if equip else ["  (nenhum)"]
        acesso_lines = [f"  • {a}" for a in acessos] if acessos else ["  (nenhum)"]
        body = [
            f"Cargo: {mov.get('cargo') or '—'}",
            f"Setor: {mov.get('setor') or '—'}",
            f"Data prevista de início: {mov.get('data_prevista') or '—'}",
            f"Urgência: {mov.get('urgencia') or 'normal'}",
            "",
            "EQUIPAMENTOS:",
            *equip_lines,
            "",
            "ACESSOS E SISTEMAS:",
            *acesso_lines,
        ]
        if permissoes:
            body += ["", "PERMISSÕES ESPECIAIS:", *[f"  • {p}" for p in permissoes]]
        if fisicos:
            body += ["", "ACESSOS FÍSICOS:", *[f"  • {f}" for f in fisicos]]
        if obs_ti:
            body += ["", "OBSERVAÇÕES:", obs_ti]
        description = "\n".join(body)
        category = "Provisionamento — Nova contratação"
    else:  # desligamento
        ti_title = f"Bloqueio de acessos — Desligamento: {titulo}"
        dev_equip = dados.get('devolucao_equipamentos', []) or []
        bloqueios = dados.get('bloqueios', []) or []
        obs_ti = dados.get('observacoes_ti', '') or ''
        bloq_lines = [f"  • {b}" for b in bloqueios] if bloqueios else ["  (nenhum)"]
        dev_lines = [f"  • {e}" for e in dev_equip] if dev_equip else ["  (nenhum)"]
        body = [
            f"Colaborador: {titulo}",
            f"Cargo: {mov.get('cargo') or '—'}",
            f"Setor: {mov.get('setor') or '—'}",
            f"Data de desligamento: {mov.get('data_prevista') or '—'}",
            "",
            "BLOQUEIOS NECESSÁRIOS:",
            *bloq_lines,
            "",
            "EQUIPAMENTOS A DEVOLVER:",
            *dev_lines,
        ]
        if obs_ti:
            body += ["", "OBSERVAÇÕES:", obs_ti]
        description = "\n".join(body)
        category = "Bloqueio de acessos — Desligamento"

    priority = {'urgente': 'Alta', 'importante': 'Média', 'normal': 'Baixa'}.get(mov.get('urgencia') or 'normal', 'Média')

    try:
        cur.execute(
            """
            INSERT INTO tickets (title, description, status, priority, category, subcategory, requester_id, delivery_forecast)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (ti_title, description, 'Aberto', priority, category, None, requester_uid, mov.get('data_prevista')),
        )
        return str(cur.fetchone()[0])
    except Exception as e:
        logger.warning(f"Falha ao criar ticket TI: {e}")
        return None


@router.get("/equipamentos/{colaborador_id}")
def equipamentos_do_colaborador(colaborador_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Retorna equipamentos/acessos da última admissão aprovada deste colaborador (pra reaproveitar no desligamento)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    # Procura a movimentação de admissão mais recente vinculada por colaborador_id OU pela tabela rh_colaboradores (pelo nome)
    cur.execute(
        """SELECT m.dados, m.titulo, m.cargo, m.setor, m.aprovado_em
             FROM rh_movimentacoes m
            WHERE m.tipo='admissao' AND m.status='aprovado'
              AND (m.colaborador_id = %s OR m.titulo ILIKE (SELECT nome FROM rh_colaboradores WHERE id = %s))
            ORDER BY COALESCE(m.aprovado_em, m.created_at) DESC
            LIMIT 1""",
        (colaborador_id, colaborador_id),
    )
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r:
        return {"encontrado": False, "equipamentos": [], "acessos": [], "permissoes": [], "fisicos": [], "sistemas_externos": [], "modulos_portal": [], "pastas_rede": [], "ti_equipamentos": {}}
    dados, titulo, cargo, setor, aprovado_em = r
    if isinstance(dados, str):
        try: dados = json.loads(dados)
        except: dados = {}
    return {
        "encontrado": True,
        "movimentacao_origem": {"titulo": titulo, "cargo": cargo, "setor": setor, "aprovado_em": str(aprovado_em) if aprovado_em else None},
        "equipamentos": dados.get('equipamentos', []),
        "acessos": dados.get('acessos', []),
        "permissoes": dados.get('permissoes', []),
        "fisicos": dados.get('fisicos', []),
        "sistemas_externos": dados.get('sistemas_externos', []),
        "modulos_portal": dados.get('modulos_portal', []),
        "pastas_rede": dados.get('pastas_rede', []),
        "ti_equipamentos": dados.get('ti_equipamentos', {}),
    }


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
        where.append("m.tipo = %s"); params.append(tipo)
    if status:
        where.append("m.status = %s"); params.append(status)
    if colaborador_id:
        where.append("m.colaborador_id = %s"); params.append(colaborador_id)
    if search:
        where.append("(m.titulo ILIKE %s OR m.setor ILIKE %s OR m.cargo ILIKE %s)")
        like = f"%{search}%"
        params += [like, like, like]
    sql = f"""
        SELECT m.{', m.'.join(MOV_COLS)}, c.nome AS colaborador_nome
          FROM rh_movimentacoes m
          LEFT JOIN rh_colaboradores c ON c.id = m.colaborador_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY m.created_at DESC"
    cur.execute(sql, params)
    out = []
    for r in cur.fetchall():
        d = _row(r[:len(MOV_COLS)], MOV_COLS)
        d['colaborador_nome'] = r[-1]
        out.append(d)
    cur.close()
    conn.close()
    return {"movimentacoes": out, "total": len(out)}


@router.get("/{mid}")
def obter(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        f"""SELECT m.{', m.'.join(MOV_COLS)}, c.nome AS colaborador_nome
              FROM rh_movimentacoes m LEFT JOIN rh_colaboradores c ON c.id = m.colaborador_id
             WHERE m.id = %s""",
        (mid,),
    )
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    d = _row(r[:len(MOV_COLS)], MOV_COLS)
    d['colaborador_nome'] = r[-1]
    return d


@router.post("")
def criar(payload: MovIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if not data.get('solicitante_id'):
        data['solicitante_id'] = uid
    if 'dados' in data and data['dados'] is not None:
        data['dados'] = json.dumps(data['dados'])
    cols = list(data.keys())
    sql = (
        f"INSERT INTO rh_movimentacoes ({', '.join(cols)}, created_by, updated_by) "
        f"VALUES ({', '.join(['%s'] * (len(cols) + 2))}) RETURNING id"
    )
    cur.execute(sql, list(data.values()) + [uid, uid])
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    audit('movimentacao', new_id, 'criou', uid, {'tipo': data.get('tipo'), 'titulo': data.get('titulo')})
    return {"id": new_id, "ok": True}


@router.put("/{mid}")
def atualizar(mid: int, payload: MovIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    data = payload.dict()
    if 'dados' in data and data['dados'] is not None:
        data['dados'] = json.dumps(data['dados'])
    sets = ", ".join([f"{k} = %s" for k in data.keys()])
    cur.execute(
        f"UPDATE rh_movimentacoes SET {sets}, updated_at = NOW(), updated_by = %s WHERE id = %s",
        list(data.values()) + [uid, mid],
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    audit('movimentacao', mid, 'editou', uid)
    return {"ok": True}


@router.post("/{mid}/aprovar")
def aprovar(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Aprova movimentação. Se ainda não tiver ticket TI vinculado, cria automaticamente."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        f"SELECT {', '.join(MOV_COLS)} FROM rh_movimentacoes WHERE id = %s",
        (mid,),
    )
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    mov = _row(r, MOV_COLS)

    ticket_id = mov.get('ticket_id')
    if not ticket_id:
        ticket_id = _criar_ticket_ti(cur, mov, str(uid))

    cur.execute(
        """UPDATE rh_movimentacoes
              SET status='aprovado', aprovado_por=%s, aprovado_em=NOW(),
                  ticket_id=COALESCE(ticket_id, %s), updated_at=NOW()
            WHERE id=%s""",
        (uid, ticket_id, mid),
    )
    conn.commit()
    cur.close()
    conn.close()
    audit('movimentacao', mid, 'aprovou', uid, {'ticket_id': ticket_id})
    return {"ok": True, "ticket_id": ticket_id}


@router.post("/{mid}/rejeitar")
def rejeitar(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE rh_movimentacoes SET status='rejeitado', aprovado_por=%s, aprovado_em=NOW(), updated_at=NOW() WHERE id=%s",
        (uid, mid),
    )
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    audit('movimentacao', mid, 'rejeitou', uid)
    return {"ok": True}


@router.delete("/{mid}")
def remover(mid: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM rh_movimentacoes WHERE id = %s", (mid,))
    if cur.rowcount == 0:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}
