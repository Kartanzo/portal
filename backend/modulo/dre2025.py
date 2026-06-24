# =========================================================================== #
# RELATÓRIO DE CONVERSÃO PARA DUMMY (sem fontes externas)
# ---------------------------------------------------------------------------
# (a) Externas substituídas: NENHUMA. Este módulo NÃO usava Google Sheets,
#     gspread, Drive, BigQuery nem requests. Os blobs dre_data/sheets_data
#     vinham de UPLOAD de planilha feito no front (Financeiro/DRE2025.tsx) e
#     eram apenas persistidos no Postgres do app (tabela dre2025_bases). O
#     Postgres do app foi mantido intacto.
# (b) Shape preservado (consumido por DRE2025.tsx):
#       - dre_data:    Record<str, number[12]>  (1 valor por mês; 130 linhas)
#       - sheets_data: { "Base Analítica": list[dict] } com chaves
#         'Código da Conta','CÓDIGO','DESCRIÇÃO','TIPO DE DESPESA','COMPETÊNCIA'
#         (mês por extenso minúsculo, p/ drilldown),'TÍTULO','EMISSÃO','V_LÍQUIDO_A'
#       - bases list: {id,name,created_at,created_by_name}
#       - get base:   {id,name,dre_data,sheets_data,created_at,observations}
#     Geração inline via core.dummy (rng/valor/inteiro/MESES_PT_LONGO/
#     dia_aleatorio/ANO_BASE); core/dummy.py NÃO foi editado.
# (c) Teste real executado (cd backend && /c/Python312/python, get_db_connection
#     mockado, banco vazio): list -> 1 base "DRE 2026 (dados dummy)"; get ->
#     130 linhas, todas com len==12; Base Analítica com 1044 linhas cobrindo as
#     12 competências (janeiro..dezembro) e EMISSÃO toda em 2026. Asserts OK.
# (d) Não confirmados: o componente RelatorioDRE.tsx usa OUTRA API
#     (/financeiro/* via api.getReportDre) — fora deste módulo, não alterado.
# =========================================================================== #
from fastapi import APIRouter, HTTPException, Header, Body, Depends
from typing import Optional
from uuid import UUID
from datetime import datetime
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

from core import dummy

router = APIRouter()
logger = logging.getLogger(__name__)

MODULE_ID = 'financeiro_dre2025'

# --------------------------------------------------------------------------- #
# Dados dummy determinísticos (sem fontes externas).
# O DRE não consome BigQuery/Sheets/Drive: os blobs dre_data/sheets_data antes
# vinham de upload de planilha pelo usuário. Para rodar SEM upload e exibir os
# 12 meses de 2026, geramos UMA base dummy quando o banco não tem nenhuma base.
# O shape é idêntico ao que o frontend (Financeiro/DRE2025.tsx) espera:
#   - dre_data:    Record<str, number[12]>  (um valor por mês)
#   - sheets_data: Record<str, list[dict]>  (aba 'Base Analítica' p/ drilldown)
# --------------------------------------------------------------------------- #
_DUMMY_BASE_ID = "00000000-0000-0000-0000-0000000d2e25"

# ids-folha (level 3 / item) que recebem array de 12 meses, espelhando
# DRE_STRUCTURE do frontend. Especiais (impostos/créditos/receita) + numéricos.
_DRE_SPECIAL = [
    "icms", "ipi", "icms_st", "pis", "cofins",
    "devolucao", "cancelamentos",
    "cpv", "outros_custos", "bonificacao",
    "cred_icms", "cred_ipi", "cred_pis", "cred_cofins",
]
_DRE_GROUPS = {"611": 11, "612": 14, "613": 12, "621": 20, "622": 24, "623": 6}
_DRE_624 = [f"624{n:03d}" for n in list(range(1, 28)) + [29]]  # 624001..027, 624029
_DRE_POSITIVOS = {"bonificacao", "cred_icms", "cred_ipi", "cred_pis", "cred_cofins"}


def _dre_leaf_ids():
    ids = list(_DRE_SPECIAL)
    for pref, n in _DRE_GROUPS.items():
        ids += [f"{pref}{i:03d}" for i in range(1, n + 1)]
    ids += _DRE_624
    return ids


def _dummy_dre_data() -> dict:
    out = {}
    for lid in _dre_leaf_ids():
        base = dummy.valor(dummy.rng("dre2025", lid), base=18000.0, var=0.5)
        sinal = 1 if lid in _DRE_POSITIVOS else -1
        out[lid] = [sinal * round(dummy.valor(dummy.rng("dre2025", lid, m), base=base, var=0.3))
                    for m in range(1, 13)]
    # Receita bruta positiva (origem 'Receita' no front; aqui valor direto).
    out["receita_bruta"] = [round(dummy.valor(dummy.rng("dre2025", "rb", m), base=1200000.0, var=0.2))
                            for m in range(1, 13)]
    return out


def _dummy_sheets_data() -> dict:
    """Aba 'Base Analítica' com lançamentos em TODOS os 12 meses de 2026."""
    leaf_codes = {}
    for pref, n in _DRE_GROUPS.items():
        for i in range(1, n + 1):
            code = f"{pref[0]}.{pref[1]}.{pref[2]}.{i:03d}"
            leaf_codes[code] = f"Despesa {pref}{i:03d}"
    rows = []
    for mi, mes_long in enumerate(dummy.MESES_PT_LONGO):
        comp = mes_long.lower()
        for code, label in list(leaf_codes.items()):
            r = dummy.rng("dre2025-ba", code, mi)
            rows.append({
                "Código da Conta": code,
                "CÓDIGO": code,
                "DESCRIÇÃO": label,
                "TIPO DE DESPESA": "Item",
                "COMPETÊNCIA": comp,
                "TÍTULO": f"NF-{dummy.inteiro(r, 1000, 9999)}",
                "EMISSÃO": dummy.dia_aleatorio(dummy.ANO_BASE, mi + 1, r).strftime("%d/%m/%Y"),
                "V_LÍQUIDO_A": round(dummy.valor(r, base=2500.0, var=0.6)),
            })
    return {"Base Analítica": rows}


def _dummy_base_full() -> dict:
    return {
        "id": _DUMMY_BASE_ID,
        "name": f"DRE {dummy.ANO_BASE} (dados dummy)",
        "dre_data": _dummy_dre_data(),
        "sheets_data": _dummy_sheets_data(),
        "created_at": datetime(dummy.ANO_BASE, 1, 31, 12, 0, 0).isoformat(),
        "observations": {},
        "created_by_name": "Sistema (dummy)",
    }


def seed_dummy_dre2025(admin_id: str) -> dict:
    """Insere 1 base \"DRE 2026 (dummy)\" em `dre2025_bases` com dre_data/sheets_data
    no mesmo formato consumido pelo frontend (linhas de conta x 12 meses).

    Reaproveita os geradores dummy já existentes (_dummy_dre_data/_dummy_sheets_data).
    Idempotente: se já existir uma base ativa com esse nome, não duplica (reativa se
    estiver inativa). Abre e fecha a própria conexão; não altera rotas/permissões.
    """
    nome = f"DRE {dummy.ANO_BASE} (dummy)"
    dre_data = _dummy_dre_data()
    sheets_data = _dummy_sheets_data()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Idempotência: procura base com o mesmo nome (ativa ou não).
        cur.execute("SELECT id, is_active FROM dre2025_bases WHERE name = %s ORDER BY created_at LIMIT 1", (nome,))
        existente = cur.fetchone()
        if existente:
            base_id, ativa = existente
            if not ativa:
                cur.execute("UPDATE dre2025_bases SET is_active = TRUE WHERE id = %s", (base_id,))
                conn.commit()
            return {"ok": True, "criado": False, "id": str(base_id), "name": nome}

        cur.execute(
            """
            INSERT INTO dre2025_bases (name, dre_data, sheets_data, created_by, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
            RETURNING id, created_at
            """,
            (nome, json.dumps(dre_data), json.dumps(sheets_data), admin_id),
        )
        row = cur.fetchone()
        conn.commit()
        return {"ok": True, "criado": True, "id": str(row[0]), "name": nome,
                "linhas_dre": len(dre_data), "linhas_base_analitica": len(sheets_data.get("Base Analítica", []))}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


@router.get("/dre2025/bases")
def list_dre2025_bases(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT b.id, b.name, b.created_at, u.name as created_by_name
            FROM dre2025_bases b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE b.is_active = TRUE
            ORDER BY b.created_at DESC
        """)
        rows = cur.fetchall()
        result = [{"id": str(r[0]), "name": r[1], "created_at": r[2].isoformat() if r[2] else None, "created_by_name": r[3] or "—"} for r in rows]
        if not result:
            # Sem fontes externas / banco vazio: expõe a base dummy de 2026.
            b = _dummy_base_full()
            result = [{"id": b["id"], "name": b["name"], "created_at": b["created_at"], "created_by_name": b["created_by_name"]}]
        return result
    finally:
        cur.close()
        conn.close()


@router.post("/dre2025/bases")
def create_dre2025_base(
    data: dict = Body(...),
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    name = data.get('name', '')
    dre_data = data.get('dre_data', {})
    sheets_data = data.get('sheets_data', {})

    if not name or not dre_data:
        raise HTTPException(status_code=400, detail="Nome e dados DRE são obrigatórios.")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO dre2025_bases (name, dre_data, sheets_data, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
        """, (name.strip(), json.dumps(dre_data), json.dumps(sheets_data), user_id))
        row = cur.fetchone()
        conn.commit()
        return {"id": str(row[0]), "name": name, "created_at": row[1].isoformat()}
    except Exception as e:
        conn.rollback()
        logger.error(f"create_dre2025_base error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/dre2025/bases/{base_id}")
def get_dre2025_base(base_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    # Base dummy de 2026 (sem fontes externas): não está no banco.
    if str(base_id) == _DUMMY_BASE_ID:
        b = _dummy_base_full()
        return {
            "id": b["id"],
            "name": b["name"],
            "dre_data": b["dre_data"],
            "sheets_data": b["sheets_data"],
            "created_at": b["created_at"],
            "observations": b["observations"],
        }
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, name, dre_data, sheets_data, created_at, COALESCE(observations, '{}')
            FROM dre2025_bases
            WHERE id = %s AND is_active = TRUE
        """, (str(base_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        return {
            "id": str(row[0]),
            "name": row[1],
            "dre_data": row[2],
            "sheets_data": row[3],
            "created_at": row[4].isoformat() if row[4] else None,
            "observations": row[5] if isinstance(row[5], dict) else {}
        }
    finally:
        cur.close()
        conn.close()


@router.delete("/dre2025/bases/{base_id}")
def delete_dre2025_base(base_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE dre2025_bases SET is_active = FALSE WHERE id = %s RETURNING id", (str(base_id),))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        conn.commit()
        return {"message": "Base removida."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.put("/dre2025/bases/{base_id}/observations")
def update_dre2025_observations(
    base_id: UUID,
    data: dict = Body(...),
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', MODULE_ID):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        obs = data.get('observations', {})
        cur.execute("UPDATE dre2025_bases SET observations = %s WHERE id = %s AND is_active = TRUE RETURNING id",
                    (json.dumps(obs), str(base_id)))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Base não encontrada.")
        conn.commit()
        return {"message": "Observações salvas."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()
