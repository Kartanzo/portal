from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Query, Depends
from typing import Optional, List, Dict, Any, cast
from uuid import UUID
from pydantic import BaseModel
from datetime import datetime
import os
import io
import math
import json
import hashlib
import logging

from psycopg2.extras import RealDictCursor

import pandas as pd
import numpy as np
from openpyxl import Workbook

from db_utils import get_db_connection
from permission_utils import check_module_permission
from core.config import UPLOAD_DIR, DRE_STRUCTURE
from schemas.financeiro import FinanceiroJustificativaCreate
from auth_utils import get_user_id_from_session

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/financeiro/upload/{type}")
async def upload_finance_base(
    type: str,
    file: UploadFile = File(...),
    user_id: str = Header(..., alias="user-id"),
    version_name: str = Form(...),
    competencia: Optional[str] = Form(None)
):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    if type not in ['orcado', 'realizado']:
        raise HTTPException(status_code=400, detail="Invalid type. Must be 'orcado' or 'realizado'.")

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Check if user exists
        cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
        if not cur.fetchone():
             cur.close()
             conn.close()
             raise HTTPException(status_code=404, detail="User not found")

        # Read Excel
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents), dtype=str)
        
        # Validar colunas conforme Manual
        # Colunas esperadas (baseado no index 0-10 mapeado no create_finance_tables)
        # O cabeçalho na planilha Base Orçamento está na linha 2 (index 1 do pandas se header=1, mas vamos assumir header na leitura padrão ou ajustar)
        
        # Row 0 of the Excel file contains the actual column headers
        df = pd.read_excel(io.BytesIO(contents), header=0, dtype=str)
        
        # Mapping columns based on manual names to DB columns
        # Manual:
        # B: Competência -> "Competência"
        # C: EBTIDA -> "EBTIDA"
        # D: Margem de Contribuição -> "Margem de Contribuição" or similar
        # ...
        
        # Let's normalize column names logic
        expected_cols = {
            "Competência": "competencia",
            "EBTIDA": "ebtida", 
            "Margem de Contribuição": "margem_contribuicao", # Check exact name in manual/df
            "Tipo": "tipo",
            "Setor": "setor",
            "Departamento": "departamento",
            "Conta": "conta_contabil",
            "Grupo": "grupo",
            "Descrição da conta": "descricao_conta",
            "Valor": "valor"
        }
        
        # Insert Metadata
        cur.execute("""
            INSERT INTO financeiro_bases (type, filename, version_name, uploaded_by, competencia)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (type, file.filename, version_name, user_id, competencia))
        base_id = cur.fetchone()[0]
        
        # Prepare data for batch insert
        data_table = "financeiro_data_orcado" if type == "orcado" else "financeiro_data_realizado"
        
        values_to_insert = []
        for index, row in df.iterrows():
            # Extract values safely
            try:
                # Cleaning and mapping
                val_competencia = row.get("Competência")
                val_ebtida = row.get("EBTIDA")
                # Handle inconsistent column names if needed (e.g. strict match)
                # Manual says "2. Margem de Contribuição" in example data but header "Margem de Contribuição"?
                # Manual Table: Col D -> Margem de Contribuição. Example data: "3. Despesas fixas", "2. Margem de Contribuição".
                # The header is likely just "Margem de Contribuição".
                val_margem = row.get("Margem de Contribuição")
                val_tipo = row.get("Tipo")
                val_setor = row.get("Setor")
                val_depto = row.get("Departamento")
                val_conta = row.get("Conta")
                val_grupo = row.get("Grupo")
                val_descricao = row.get("Descrição da conta")
                
                # Valor handling (replace comma with dot if string, handle NaN)
                raw_valor = row.get("Valor")
                if pd.isna(raw_valor):
                    val_valor = 0.0
                else:
                    try:
                        val_valor = float(str(raw_valor).replace(',', '.'))
                    except:
                        val_valor = 0.0

                values_to_insert.append((
                    str(base_id),
                    str(val_competencia) if not pd.isna(val_competencia) else None,
                    str(val_ebtida) if not pd.isna(val_ebtida) else None,
                    str(val_margem) if not pd.isna(val_margem) else None,
                    str(val_tipo) if not pd.isna(val_tipo) else None,
                    str(val_setor) if not pd.isna(val_setor) else None,
                    str(val_depto) if not pd.isna(val_depto) else None,
                    str(val_conta) if not pd.isna(val_conta) else None,
                    str(val_grupo) if not pd.isna(val_grupo) else None,
                    str(val_descricao) if not pd.isna(val_descricao) else None,
                    val_valor,
                    index
                ))
            except Exception as e:
                logger.error(f"Error parsing row {index}: {e}")
                continue
                
        # Batch insert
        args_str = ','.join(cur.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", x).decode('utf-8') for x in values_to_insert)
        cur.execute(f"""
            INSERT INTO {data_table} 
            (base_id, competencia, ebtida, margem_contribuicao, tipo, setor, departamento, conta_contabil, grupo, descricao_conta, valor, row_index)
            VALUES {args_str}
        """)
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {"message": "Upload successful", "base_id": base_id, "rows_inserted": len(values_to_insert)}

    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/bases/{type}")
def get_finance_bases(type: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT b.*, u.name as uploaded_by_name 
            FROM financeiro_bases b
            LEFT JOIN users u ON b.uploaded_by = u.id
            WHERE b.type = %s AND b.is_active = TRUE 
            ORDER BY b.uploaded_at DESC
        """, (type,))
        return cur.fetchall()
    except Exception as e:
        logger.error(f"Error getting finance bases: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.delete("/financeiro/bases/{base_id}")
def delete_finance_base(base_id: UUID, user_id: str = Header(..., alias="user-id")):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Security: Check if user is super_user or ceo
        cur.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row or (row[0].lower() not in ['super_user', 'ceo']):
             raise HTTPException(status_code=403, detail="Apenas Super Admin ou CEO pode excluir bases.")
             
        # Determine base type
        cur.execute("SELECT type FROM financeiro_bases WHERE id = %s", (str(base_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Base não encontrada")
        base_type = row[0]
        
        data_table = "financeiro_data_orcado" if base_type == 'orcado' else "financeiro_data_realizado"
        
        # Soft Delete Base
        cur.execute("UPDATE financeiro_bases SET is_active = FALSE WHERE id = %s", (str(base_id),))
        
        # Delete data from data table
        cur.execute(f"DELETE FROM {data_table} WHERE base_id = %s", (str(base_id),))
        
        conn.commit()
        return {"message": "Base e dados excluídos com sucesso"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Delete error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@router.get("/financeiro/departamentos")
def get_departamentos(base_id: str = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if base_id:
            cur.execute("SELECT DISTINCT departamento FROM financeiro_data_orcado WHERE base_id = %s AND departamento IS NOT NULL ORDER BY departamento", (base_id,))
        else:
            cur.execute("""
                SELECT DISTINCT departamento FROM financeiro_data_orcado 
                WHERE base_id = (SELECT id FROM financeiro_bases WHERE type='orcado' ORDER BY uploaded_at DESC LIMIT 1) 
                AND departamento IS NOT NULL ORDER BY departamento
            """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [r[0] for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

# DRE Structure Definition

class JustificativaCreate(BaseModel):
    base_id: UUID
    competencia: str
    conta_contabil: str
    departamento: Optional[str] = None
    grupo: Optional[str] = None
    justificativa: str
    created_by: Optional[UUID] = None

@router.post("/financeiro/justificativa")
def save_justificativa(just: JustificativaCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # If justification is empty/whitespace only, delete the record instead of UPSERT
        if not just.justificativa or not just.justificativa.strip():
            query = """
                DELETE FROM financeiro_justificativas 
                WHERE base_id = %s AND competencia = %s AND conta_contabil = %s 
                AND COALESCE(departamento, 'N/A') = %s
            """
            dept = just.departamento if just.departamento else 'N/A'
            cur.execute(query, (str(just.base_id), just.competencia, just.conta_contabil, dept))
            conn.commit()
            cur.close()
            conn.close()
            return {"message": "Justificativa excluída com sucesso"}

        # UPSERT logic using the unique constraint
        query = """
            INSERT INTO financeiro_justificativas 
            (base_id, competencia, conta_contabil, departamento, grupo, justificativa, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (base_id, competencia, conta_contabil, COALESCE(departamento, 'N/A'))
            DO UPDATE SET justificativa = EXCLUDED.justificativa, grupo = EXCLUDED.grupo, created_at = NOW()
        """
        # Handle COALESCE for the constraint match
        dept = just.departamento if just.departamento else 'N/A'
        
        cur.execute(query, (
            str(just.base_id), just.competencia, just.conta_contabil, 
            just.departamento, just.grupo, just.justificativa, str(just.created_by) if just.created_by else None
        ))
        
        conn.commit()
        cur.close()
        conn.close()
        return {"message": "Justificativa salva com sucesso"}
    except Exception as e:
        print(f"Error saving justificativa: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/justificativas")
def get_justificativas(base_id: UUID, month: str = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        query = "SELECT competencia, conta_contabil, departamento, grupo, justificativa FROM financeiro_justificativas WHERE base_id = %s"
        params = [str(base_id)]
        
        if month:
            query += " AND competencia = %s"
            params.append(month)
            
        cur.execute(query, params)
        rows = cur.fetchall()
        
        res = []
        for r in rows:
            res.append({
                "competencia": r[0],
                "conta_contabil": r[1],
                "departamento": r[2],
                "grupo": r[3],
                "justificativa": r[4]
            })
            
        cur.close()
        conn.close()
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/drilldown")
def get_financeiro_drilldown(row_id: str, month: str, departamento: str = "Total", base_id: str = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        
        # Determine base and table type
        params = []
        if base_id:
            base_query_part = "b.id = %s"
            params.append(base_id)
            with conn.cursor() as cur:
                cur.execute("SELECT type FROM financeiro_bases WHERE id = %s", (base_id,))
                row_b = cur.fetchone()
                b_type = row_b[0] if row_b else 'orcado'
        else:
            base_query_part = "b.id = (SELECT id FROM financeiro_bases WHERE type='orcado' AND is_active=TRUE ORDER BY uploaded_at DESC LIMIT 1)"
            b_type = 'orcado'

        table_name = "financeiro_data_orcado" if b_type == 'orcado' else "financeiro_data_realizado"

        # Build query scope based on DRE_STRUCTURE
        row_def = next((r for r in DRE_STRUCTURE if r.get("id") == row_id), None)
        
        if not row_def:
            # First handle account detail pattern: detail_ACCOUNTCODE
            if row_id.startswith("detail_"):
                account_code = row_id.replace("detail_", "")
                query = f"""
                    SELECT d.competencia, d.setor, d.departamento, d.grupo, d.conta_contabil, d.descricao_conta, d.valor
                    FROM {table_name} d
                    JOIN financeiro_bases b ON d.base_id = b.id
                    WHERE {base_query_part} AND LOWER(d.competencia) = LOWER(%s) AND d.conta_contabil = %s
                """
                params.extend([month, account_code])
                if departamento and departamento != "Total":
                    query += " AND d.departamento = %s"
                    params.append(departamento)
                
                df = pd.read_sql(query, conn, params=params)
                conn.close()
                return df.to_dict(orient="records")

            # Fallback: Treat row_id as a generic value to match against group or description
            query = f"""
                SELECT d.competencia, d.setor, d.departamento, d.grupo, d.conta_contabil, d.descricao_conta, d.valor
                FROM {table_name} d
                JOIN financeiro_bases b ON d.base_id = b.id
                WHERE {base_query_part} AND d.competencia = %s AND (d.grupo = %s OR d.descricao_conta = %s OR d.conta_contabil = %s)
            """
            params.extend([month, row_id, row_id, row_id])
            if departamento and departamento != "Total":
                query += " AND d.departamento = %s"
                params.append(departamento)
            
            df = pd.read_sql(query, conn, params=params)
            
            # Fetch justifications if base exists
            records = df.to_dict(orient="records")
            with conn.cursor() as cur:
                bid = base_id
                if not bid:
                    cur.execute("SELECT id FROM financeiro_bases WHERE type=%s ORDER BY uploaded_at DESC LIMIT 1", (b_type,))
                    row_b = cur.fetchone()
                    bid = str(row_b[0]) if row_b else None
                
                if bid:
                    cur.execute("SELECT conta_contabil, departamento, JUSTIFICATIVA FROM financeiro_justificativas WHERE base_id = %s AND competencia = %s", (bid, month))
                    just_rows = cur.fetchall()
                    just_map = {(r[0], r[1] if r[1] else 'N/A'): r[2] for r in just_rows}
                    for rec in records:
                        dept_key = rec["departamento"] if rec["departamento"] else 'N/A'
                        rec["justificativa"] = just_map.get((rec["conta_contabil"], dept_key))
            
            conn.close()
            return records

        # It's a calculated row or group
        all_accounts = []
        all_groups = []
        
        def collect_sources(rd):
            accounts = rd.get("source_accounts", [])
            groups = rd.get("source_groups", [])
            all_accounts.extend(accounts)
            all_groups.extend(groups)
            
            children = [r for r in DRE_STRUCTURE if r.get("parent_id") == rd["id"]]
            for child in children:
                collect_sources(child)

            if rd["id"] == "despesas_operacionais":
                com_total = next((r for r in DRE_STRUCTURE if r["id"] == "despesas_comerciais_total"), None)
                adm_total = next((r for r in DRE_STRUCTURE if r["id"] == "despesas_administrativas"), None)
                if com_total: collect_sources(com_total)
                if adm_total: collect_sources(adm_total)
            elif rd["id"] == "resultado_bruto":
                rl = next((r for r in DRE_STRUCTURE if r["id"] == "receita_liquida"), None)
                cpv = next((r for r in DRE_STRUCTURE if r["id"] == "cpv"), None)
                if rl: collect_sources(rl)
                if cpv: collect_sources(cpv)
            elif rd["id"] == "resultado_operacional":
                res_b = next((r for r in DRE_STRUCTURE if r["id"] == "resultado_bruto"), None)
                desp_op = next((r for r in DRE_STRUCTURE if r["id"] == "despesas_operacionais"), None)
                if res_b: collect_sources(res_b)
                if desp_op: collect_sources(desp_op)
            elif rd["id"] == "receita_liquida":
                rb = next((r for r in DRE_STRUCTURE if r["id"] == "receita_bruta"), None)
                ded = next((r for r in DRE_STRUCTURE if r["id"] == "deducoes"), None)
                if rb: collect_sources(rb)
                if ded: collect_sources(ded)
            elif rd["id"] == "receita_bruta":
                all_accounts.append("4.1.1.001")
            elif rd["id"] == "margem_contribuicao":
                res_b = next((r for r in DRE_STRUCTURE if r["id"] == "resultado_bruto"), None)
                com_total = next((r for r in DRE_STRUCTURE if r["id"] == "despesas_comerciais_total"), None)
                pess_cpv = next((r for r in DRE_STRUCTURE if r["id"] == "pessoal_cpv"), None)
                if res_b: collect_sources(res_b)
                if com_total: collect_sources(com_total)
                if pess_cpv: collect_sources(pess_cpv)

        collect_sources(row_def)
        
        if not all_accounts and not all_groups:
            conn.close()
            return []

        all_accounts = list(set(all_accounts))
        all_groups = list(set(all_groups))

        query = f"""
            SELECT d.competencia, d.setor, d.departamento, d.grupo, d.conta_contabil, d.descricao_conta, d.valor
            FROM {table_name} d
            JOIN financeiro_bases b ON d.base_id = b.id
            WHERE {base_query_part} AND LOWER(d.competencia) = LOWER(%s)
        """
        final_params = params + [month]
        
        conditions = []
        if all_accounts:
            conditions.append("d.conta_contabil IN (" + ",".join(["%s"] * len(all_accounts)) + ")")
            final_params.extend(all_accounts)
        if all_groups:
            conditions.append("d.grupo IN (" + ",".join(["%s"] * len(all_groups)) + ")")
            final_params.extend(all_groups)
            
        if conditions:
            query += " AND (" + " OR ".join(conditions) + ")"
        if departamento and departamento != "Total":
            query += " AND d.departamento = %s"
            final_params.append(departamento)
            
        df = pd.read_sql(query, conn, params=final_params)
        
        # Also fetch justifications for this scope
        cur = conn.cursor()
        bid = base_id
        if not bid:
            cur.execute("SELECT id FROM financeiro_bases WHERE type='orcado' AND is_active=TRUE ORDER BY uploaded_at DESC LIMIT 1")
            row = cur.fetchone()
            bid = str(row[0]) if row else None
            
        if bid:
            just_query = "SELECT conta_contabil, departamento, grupo, justificativa FROM financeiro_justificativas WHERE base_id = %s AND competencia = %s"
            cur.execute(just_query, (bid, month))
            just_rows = cur.fetchall()
            
            # Map with COALESCE handling for departamento
            just_map = {(r[0], r[1] if r[1] else 'N/A'): r[3] for r in just_rows}
            
            records = df.to_dict(orient="records")
            for rec in records:
                dept_key = rec["departamento"] if rec["departamento"] else 'N/A'
                rec["justificativa"] = just_map.get((rec["conta_contabil"], dept_key))
            
            cur.close()
            conn.close()
            return records
            
        conn.close()
        return df.to_dict(orient="records")
        
    except Exception as e:
        print(f"Error in drilldown: {e}")
        return []

@router.get("/financeiro/report/orcado")
def get_report_orcado(base_id: str = None, departamento: str = "Total", user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        
        # 1. Fetch Request
        params = []
        base_query_part = ""
        if base_id:
            base_query_part = "b.id = %s"
            params.append(base_id)
        else:
            base_query_part = "b.id = (SELECT id FROM financeiro_bases WHERE type='orcado' AND is_active=TRUE ORDER BY uploaded_at DESC LIMIT 1)"

        dept_val = None
        if departamento and departamento != "Total":
            dept_val = departamento

        # NEW QUERY: Fetch departamento, conta, and competencia
        query = f"""
            SELECT d.grupo, d.conta_contabil, d.descricao_conta, d.competencia, d.departamento, SUM(d.valor) as valor
            FROM financeiro_data_orcado d
            JOIN financeiro_bases b ON d.base_id = b.id
            WHERE {base_query_part}
            GROUP BY d.grupo, d.conta_contabil, d.descricao_conta, d.competencia, d.departamento
        """
        
        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            return []

        # Normalization
        df['descricao_conta'] = df['descricao_conta'].astype(str).str.strip().replace({
            'Despesas com cesta básica': 'Despesa com cesta básica',
            'Despesas com Licenças e Alvarás': 'Despesa com Licenças e Alvarás'
        })

        months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
        
        # Build Result
        report_data = []
        row_values_cache = {} # {row_id: {Month: value}}

        # Internal helper to get values for a row def
        def get_row_values(row_def, filter_dept=None):
            row_id = row_def["id"]
            row_type = row_def["type"]
            
            vals = {m: 0.0 for m in months}
            children = []

            if row_id == "receita_bruta":
                # Special Case: 4.1.1.001 + abs(4.2.2.007)
                for m in months:
                    venda = df[(df['conta_contabil'] == '4.1.1.001') & (df['competencia'] == m)]['valor'].sum()
                    icms_st = df[(df['conta_contabil'] == '4.2.2.007') & (df['competencia'] == m)]['valor'].sum()
                    vals[m] = float(venda + abs(icms_st))
            
            elif row_id == "receita_liquida":
                for m in months:
                    rb = row_values_cache.get("receita_bruta", {}).get(m, 0.0)
                    ded = row_values_cache.get("deducoes", {}).get(m, 0.0)
                    vals[m] = rb + ded # ded is negative
            
            elif row_id == "resultado_bruto":
                for m in months:
                    rl = row_values_cache.get("receita_liquida", {}).get(m, 0.0)
                    cpv = row_values_cache.get("cpv", {}).get(m, 0.0)
                    vals[m] = rl + cpv # cpv is negative
            
            elif row_id == "resultado_operacional":
                for m in months:
                    res_bruto = row_values_cache.get("resultado_bruto", {}).get(m, 0.0)
                    com = row_values_cache.get("despesas_comerciais_total", {}).get(m, 0.0)
                    adm = row_values_cache.get("despesas_administrativas", {}).get(m, 0.0)
                    vals[m] = res_bruto + com + adm
            
            elif row_type == "percentage":
                ref_id = row_def["formula_ref"]
                denom_id = row_def["denom"]
                for m in months:
                    num = row_values_cache.get(ref_id, {}).get(m, 0.0)
                    den = row_values_cache.get(denom_id, {}).get(m, 0.0)
                    vals[m] = ((num / den) * 100) if den != 0 else 0.0

            elif "formula" in row_def:
                # Custom formula - only allow simple arithmetic expressions with known variable names
                formula = row_def["formula"]
                # Validate formula contains only safe characters
                import re as _re
                if _re.match(r'^[a-zA-Z0-9_\s\+\-\*\/\(\)\.]+$', formula):
                    for m in months:
                        eval_context = {rid: row_values_cache.get(rid, {}).get(m, 0.0) for rid in row_values_cache}
                        try:
                            vals[m] = eval(formula, {"__builtins__": {}}, eval_context)
                        except:
                            vals[m] = 0.0
                else:
                    logger.warning(f"Blocked unsafe formula: {formula}")

            elif row_type == "total" and "source_groups" not in row_def:
                # Simple sum of specific child rows if needed (handled by individual logic above usually)
                pass

            else:
                # Standard Data Row
                groups = row_def.get("source_groups", [])
                accounts = row_def.get("source_accounts", [])
                s_depts = row_def.get("source_depts", [])
                e_depts = row_def.get("exclude_depts", [])

                mask = pd.Series(True, index=df.index)
                if groups: mask &= df['grupo'].isin(groups)
                if accounts: mask &= df['conta_contabil'].isin(accounts)
                if s_depts: mask &= df['departamento'].isin(s_depts)
                if e_depts: mask &= ~df['departamento'].isin(e_depts)
                
                # Global Filter (from UI)
                if filter_dept: mask &= (df['departamento'] == filter_dept)

                match = df[mask]
                if not match.empty:
                    # Totals
                    for m in months:
                        vals[m] = float(match[match['competencia'] == m]['valor'].sum())
                    
                    # Children (Aggregated by account)
                    child_agg = match.groupby(['conta_contabil', 'descricao_conta', 'competencia'])['valor'].sum().reset_index()
                    child_pivot = child_agg.pivot(index=['conta_contabil', 'descricao_conta'], columns='competencia', values='valor').fillna(0)
                    for m in months:
                        if m not in child_pivot.columns: child_pivot[m] = 0.0
                    
                    for (c_code, c_desc), c_data in child_pivot.iterrows():
                        # Fix Duplicate IDs: Append hash of description if multiple descriptions exist for same code
                        # Actually, just always append hash to be safe and consistent.
                        # Clean description to avoid invisible char issues
                        clean_desc = str(c_desc).strip()
                        desc_hash = hashlib.md5(clean_desc.encode('utf-8')).hexdigest()[:6]
                        
                        child_obj = {
                            "id": f"{row_id}_{c_code}_{desc_hash}",
                            "type": "detail",
                            "conta_contabil": c_code,
                            "descricao_conta": c_desc,
                            "parent_id": row_id,
                            "level": row_def.get("level", 0) + 1,
                            "style": {"indent": True}
                        }
                        c_total = 0.0
                        for m in months:
                            val = float(c_data[m])
                            child_obj[m] = val
                            c_total += val
                        child_obj["Total"] = c_total
                        children.append(child_obj)
            
            return vals, children

        # Iterate Structure
        for row_def in DRE_STRUCTURE:
            row_id = row_def["id"]
            
            # 1. Get Values
            vals, children = get_row_values(row_def, filter_dept=dept_val)
            
            # Update cache
            cast(Dict[str, Any], row_values_cache)[row_id] = vals

            # Prepare Row Obj
            row_obj = {
                "id": row_id,
                "type": row_def["type"],
                "descricao_conta": row_def["label"],
                "parent_id": row_def.get("parent_id"),
                "level": row_def.get("level", 0),
                "style": {
                    "bg": row_def.get("bg", ""),
                    "color": row_def.get("color", ""),
                    "bold": row_def.get("bold", False),
                    "italic": row_def.get("italic", False),
                    "indent": row_def.get("indent", False)
                },
                "formula_ref": row_def.get("formula_ref"),
                "denom": row_def.get("denom")
            }
            
            total_val = 0.0
            for m in months:
                val = vals[m]
                row_obj[m] = val
                total_val += val
            
            row_obj["Total"] = total_val
            
            # Header handling
            report_data.append(row_obj)
            report_data.extend(children)

        # Second pass for nested totals that depend on detail rows
        for row_raw in report_data:
            if not isinstance(row_raw, dict): continue
            row: Dict[str, Any] = cast(Dict[str, Any], row_raw)
            rid = str(row.get("id", ""))
            if rid == "cpv":
                for m in months:
                    v1 = cast(float, row_values_cache.get("materia_prima", {}).get(m, 0.0))
                    v2 = cast(float, row_values_cache.get("pessoal_cpv", {}).get(m, 0.0))
                    v3 = cast(float, row_values_cache.get("ocupacao_cpv", {}).get(m, 0.0))
                    v4 = cast(float, row_values_cache.get("cif", {}).get(m, 0.0))
                    row[m] = v1 + v2 + v3 + v4
                    if "cpv" not in row_values_cache: row_values_cache["cpv"] = {}
                    cast(Dict[str, Any], row_values_cache["cpv"])[m] = row[m]
                row["Total"] = sum(float(row[m]) for m in months)
            elif rid == "resultado_bruto":
                for m in months:
                    rl = cast(float, row_values_cache.get("receita_liquida", {}).get(m, 0.0))
                    cp = cast(float, row_values_cache.get("cpv", {}).get(m, 0.0))
                    row[m] = rl + cp
                    if "resultado_bruto" not in row_values_cache: row_values_cache["resultado_bruto"] = {}
                    cast(Dict[str, Any], row_values_cache["resultado_bruto"])[m] = row[m]
                row["Total"] = sum(float(row[m]) for m in months)
            elif rid == "despesas_comerciais_total":
                for m in months:
                    v1 = cast(float, row_values_cache.get("despesas_comerciais", {}).get(m, 0.0))
                    v2 = cast(float, row_values_cache.get("marketing", {}).get(m, 0.0))
                    v3 = cast(float, row_values_cache.get("negocios_digitais", {}).get(m, 0.0))
                    row[m] = v1 + v2 + v3
                    if "despesas_comerciais_total" not in row_values_cache: row_values_cache["despesas_comerciais_total"] = {}
                    cast(Dict[str, Any], row_values_cache["despesas_comerciais_total"])[m] = row[m]
                row["Total"] = sum(float(row[m]) for m in months)
            elif rid == "despesas_administrativas":
                for m in months:
                    v1 = cast(float, row_values_cache.get("pessoal_adm", {}).get(m, 0.0))
                    v2 = cast(float, row_values_cache.get("servicos_terceiros", {}).get(m, 0.0))
                    v3 = cast(float, row_values_cache.get("despesas_gerais", {}).get(m, 0.0))
                    row[m] = v1 + v2 + v3
                    if "despesas_administrativas" not in row_values_cache: row_values_cache["despesas_administrativas"] = {}
                    cast(Dict[str, Any], row_values_cache["despesas_administrativas"])[m] = row[m]
                row["Total"] = sum(float(row[m]) for m in months)
            elif rid == "despesas_operacionais":
                for m in months:
                    com = cast(float, row_values_cache.get("despesas_comerciais_total", {}).get(m, 0.0))
                    adm = cast(float, row_values_cache.get("despesas_administrativas", {}).get(m, 0.0))
                    row[m] = com + adm
                    if "despesas_operacionais" not in row_values_cache: row_values_cache["despesas_operacionais"] = {}
                    cast(Dict[str, Any], row_values_cache["despesas_operacionais"])[m] = row[m]
                row["Total"] = sum(float(row[m]) for m in months)
        
        # Third pass for rows that depend on the final opex totals
        for row in report_data:
            if row["id"] == "margem_contribuicao":
                for m in months:
                    # Formula per spreadsheet logic
                    # Margem = RESULTADO BRUTO + DESPESAS COMERCIAIS TOTAL - INDUSTRIAL PERSONNEL (added back)
                    rb = row_values_cache.get("resultado_bruto", {}).get(m, 0.0)
                    com = row_values_cache.get("despesas_comerciais_total", {}).get(m, 0.0)
                    pers_cpv = row_values_cache.get("pessoal_cpv", {}).get(m, 0.0) 
                    row[m] = rb + com - pers_cpv # pers_cpv is negative, so minus adds it back
                    row_values_cache["margem_contribuicao"][m] = row[m]
                row["Total"] = sum(row[m] for m in months)
            elif rid == "resultado_operacional":
                for m in months:
                    res_bruto = cast(float, row_values_cache.get("resultado_bruto", {}).get(m, 0.0))
                    com = cast(float, row_values_cache.get("despesas_comerciais_total", {}).get(m, 0.0))
                    adm = cast(float, row_values_cache.get("despesas_administrativas", {}).get(m, 0.0))
                    cast(Any, row)[m] = res_bruto + com + adm
                    if "resultado_operacional" not in row_values_cache: row_values_cache["resultado_operacional"] = {}
                    cast(Any, row_values_cache["resultado_operacional"])[m] = row[m]
                cast(Any, row)["Total"] = sum(float(row[m]) for m in months)
            elif rid == "margem_bruta_pct":
                for m in months:
                    num = cast(float, row_values_cache.get("resultado_bruto", {}).get(m, 0.0))
                    den = cast(float, row_values_cache.get("receita_liquida", {}).get(m, 0.0))
                    cast(Any, row)[m] = ((num / den) * 100) if den != 0 else 0.0
                num_tot = sum(cast(float, row_values_cache.get("resultado_bruto", {}).get(mon, 0.0)) for mon in months)
                den_tot = sum(cast(float, row_values_cache.get("receita_liquida", {}).get(mon, 0.0)) for mon in months)
                cast(Any, row)["Total"] = (num_tot / den_tot * 100) if den_tot != 0 else 0.0
            elif rid == "margem_contribuicao_pct":
                for m in months:
                    num = cast(float, row_values_cache.get("margem_contribuicao", {}).get(m, 0.0))
                    den = cast(float, row_values_cache.get("receita_liquida", {}).get(m, 0.0))
                    cast(Any, row)[m] = ((num / den) * 100) if den != 0 else 0.0
                num_tot = sum(cast(float, row_values_cache.get("margem_contribuicao", {}).get(mon, 0.0)) for mon in months)
                den_tot = sum(cast(float, row_values_cache.get("receita_liquida", {}).get(mon, 0.0)) for mon in months)
                cast(Any, row)["Total"] = (num_tot / den_tot * 100) if den_tot != 0 else 0.0
            elif rid == "margem_operacional_pct":
                for m in months:
                    num = cast(float, row_values_cache.get("resultado_operacional", {}).get(m, 0.0))
                    den = cast(float, row_values_cache.get("receita_liquida", {}).get(m, 0.0))
                    cast(Any, row)[m] = ((num / den) * 100) if den != 0 else 0.0
                num_tot = sum(cast(float, row_values_cache.get("resultado_operacional", {}).get(mon, 0.0)) for mon in months)
                den_tot = sum(cast(float, row_values_cache.get("receita_liquida", {}).get(mon, 0.0)) for mon in months)
                cast(Any, row)["Total"] = (num_tot / den_tot * 100) if den_tot != 0 else 0.0

        return report_data

    except Exception as e:
        logger.error(f"Error in get_report_orcado: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/report/orcado-realizado")
def get_report_orcado_realizado(base_id_orcado: str = None, base_id_realizado: str = None, departamento: str = "Total", user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    try:
        conn = get_db_connection()
        
        def get_latest_base(btype):
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM financeiro_bases WHERE type=%s AND is_active = TRUE ORDER BY uploaded_at DESC LIMIT 1", (btype,))
                row = cur.fetchone()
                return str(row[0]) if row else None

        def get_best_bases_realizado():
            """Busca a base mais recente para cada mês."""
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT ON (competencia) id, competencia
                    FROM financeiro_bases
                    WHERE type = 'realizado' AND is_active = TRUE AND competencia IS NOT NULL
                    ORDER BY competencia, uploaded_at DESC
                """)
                return cur.fetchall()

        bid_orc = base_id_orcado or get_latest_base('orcado')
        
        # Se base_id_realizado for fornecido, usa apenas ela. 
        # Caso contrário, tenta consolidar bases mensais.
        bases_real = []
        if base_id_realizado:
            bases_real = [{"id": base_id_realizado}]
        else:
            bases_real = get_best_bases_realizado()
            if not bases_real:
                latest = get_latest_base('realizado')
                if latest: bases_real = [{"id": latest}]
        
        # Para fins de log
        bid_real_log = base_id_realizado or (bases_real[0]['id'] if bases_real else None)
        logger.info(f"Report base selection: ORC={bid_orc}, REAL_LOG={bid_real_log}, BASES_COUNT={len(bases_real)}")

        # Load Orcado
        if bid_orc:
            df_orc = pd.read_sql("SELECT grupo, conta_contabil, descricao_conta, competencia, departamento, SUM(valor) as valor FROM financeiro_data_orcado WHERE base_id = %s GROUP BY grupo, conta_contabil, descricao_conta, competencia, departamento", conn, params=[bid_orc])
        else:
            df_orc = pd.DataFrame(columns=['grupo', 'conta_contabil', 'descricao_conta', 'competencia', 'departamento', 'valor'])
        
        # Load Realizado (Consolidated)
        if bases_real:
            ids = [str(b['id']) for b in bases_real]
            placeholders = ', '.join(['%s'] * len(ids))
            query = f"""
                SELECT grupo, conta_contabil, descricao_conta, competencia, departamento, SUM(valor) as valor 
                FROM financeiro_data_realizado 
                WHERE base_id IN ({placeholders}) 
                GROUP BY grupo, conta_contabil, descricao_conta, competencia, departamento
            """
            df_real = pd.read_sql(query, conn, params=ids)
        else:
            df_real = pd.DataFrame(columns=['grupo', 'conta_contabil', 'descricao_conta', 'competencia', 'departamento', 'valor'])

        conn.close()
        logger.info(f"Loaded DataFrames: DF_ORC={len(df_orc)}, DF_REAL={len(df_real)}")

        months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
        dept_val = departamento if departamento and departamento != "Total" else None

        # Data normalization
        for df in [df_orc, df_real]:
            if not df.empty:
                df['descricao_conta'] = df['descricao_conta'].astype(str).str.strip().replace({
                    'Despesas com cesta básica': 'Despesa com cesta básica',
                    'Despesas com Licenças e Alvarás': 'Despesa com Licenças e Alvarás'
                })

        report_data = []
        cache_orc = {}
        cache_real = {}

        def get_vals(df, r_def, filter_dept=None):
            row_id = r_def["id"]
            row_type = r_def["type"]
            vals = {m: 0.0 for m in months}
            children = []

            if row_id == "receita_bruta":
                for m in months:
                    venda = df[(df['conta_contabil'] == '4.1.1.001') & (df['competencia'] == m)]['valor'].sum()
                    icms_st = df[(df['conta_contabil'] == '4.2.2.007') & (df['competencia'] == m)]['valor'].sum()
                    vals[m] = float(venda + abs(icms_st))
            
            elif row_type == "percentage":
                # Handled later in pass 2/3 if needed, or by formula
                pass

            elif "formula" in r_def:
                # Handled later
                pass

            else:
                # Standard data row
                groups = r_def.get("source_groups", [])
                accounts = r_def.get("source_accounts", [])
                s_depts = r_def.get("source_depts", [])
                e_depts = r_def.get("exclude_depts", [])

                mask = pd.Series(True, index=df.index)
                if groups: mask &= df['grupo'].isin(groups)
                if accounts: mask &= df['conta_contabil'].isin(accounts)
                if s_depts: mask &= df['departamento'].isin(s_depts)
                if e_depts: mask &= ~df['departamento'].isin(e_depts)
                if filter_dept: mask &= (df['departamento'] == filter_dept)

                match = df[mask]
                if not match.empty:
                    for m in months:
                        vals[m] = float(match[match['competencia'] == m]['valor'].sum())
                    
                    # Compute accounts for children (only for bid_orc scope usually, but let's do generic)
                    child_agg = match.groupby(['conta_contabil', 'descricao_conta', 'competencia'])['valor'].sum().reset_index()
                    if not child_agg.empty:
                        pivot = child_agg.pivot(index=['conta_contabil', 'descricao_conta'], columns='competencia', values='valor').fillna(0)
                        for m in months:
                            if m not in pivot.columns: pivot[m] = 0.0
                        for (c_code, c_desc), c_data in pivot.iterrows():
                            # We'll merge children later based on account code
                            pass

            return vals

        # 1. First Pass: Infrastructure and Data Rows
        logger.info(f"Processing {len(DRE_STRUCTURE)} rows from DRE_STRUCTURE")
        for i, row_def in enumerate(DRE_STRUCTURE):
            row_id = row_def["id"]
            if i == 0: logger.info(f"First row: {row_id}, label: {row_def['label']}")
            
            v_orc = get_vals(df_orc, row_def, dept_val)
            v_real = get_vals(df_real, row_def, dept_val)
            
            cache_orc[row_id] = v_orc
            cache_real[row_id] = v_real

            row_obj = {
                "id": row_id,
                "type": row_def["type"],
                "descricao_conta": row_def["label"],
                "parent_id": row_def.get("parent_id"),
                "level": row_def.get("level", 0),
                "style": {
                    "bg": row_def.get("bg", ""),
                    "color": row_def.get("color", ""),
                    "bold": row_def.get("bold", False),
                    "italic": row_def.get("italic", False),
                    "indent": row_def.get("indent", False)
                }
            }
            
            for m in months:
                row_obj[f"{m}_orc"] = v_orc[m]
                row_obj[f"{m}_real"] = v_real[m]
            
            row_obj["Total_orc"] = sum(v_orc.values())
            row_obj["Total_real"] = sum(v_real.values())
            
            report_data.append(row_obj)

            # 1b. Handle detail children for this row
            # We want unique accounts from BOTH bases for this category
            groups = row_def.get("source_groups", [])
            accounts = row_def.get("source_accounts", [])
            if groups or accounts:
                mask_orc = pd.Series(True, index=df_orc.index)
                if groups: mask_orc &= df_orc['grupo'].isin(groups)
                if accounts: mask_orc &= df_orc['conta_contabil'].isin(accounts)
                if dept_val: mask_orc &= (df_orc['departamento'] == dept_val)
                
                mask_real = pd.Series(True, index=df_real.index)
                if groups: mask_real &= df_real['grupo'].isin(groups)
                if accounts: mask_real &= df_real['conta_contabil'].isin(accounts)
                if dept_val: mask_real &= (df_real['departamento'] == dept_val)
                
                match_orc = df_orc[mask_orc]
                match_real = df_real[mask_real]
                
                # Get unique accounts
                acc_orc = match_orc[['conta_contabil', 'descricao_conta']].drop_duplicates()
                acc_real = match_real[['conta_contabil', 'descricao_conta']].drop_duplicates()
                all_accs = pd.concat([acc_orc, acc_real]).drop_duplicates(subset=['conta_contabil'])
                
                for _, acc_row in all_accs.iterrows():
                    c_code = acc_row['conta_contabil']
                    c_desc = acc_row['descricao_conta']
                    clean_desc = str(c_desc).strip()
                    desc_hash = hashlib.md5(clean_desc.encode('utf-8')).hexdigest()[:6]
                    
                    child_obj = {
                        "id": f"{row_id}_{c_code}_{desc_hash}",
                        "type": "detail",
                        "conta_contabil": c_code,
                        "descricao_conta": c_desc,
                        "parent_id": row_id,
                        "level": row_def.get("level", 0) + 1,
                        "style": {"indent": True}
                    }
                    
                    c_orc_total = 0.0
                    c_real_total = 0.0
                    for m in months:
                        val_o = float(match_orc[(match_orc['conta_contabil'] == c_code) & (match_orc['competencia'] == m)]['valor'].sum())
                        val_r = float(match_real[(match_real['conta_contabil'] == c_code) & (match_real['competencia'] == m)]['valor'].sum())
                        child_obj[f"{m}_orc"] = val_o
                        child_obj[f"{m}_real"] = val_r
                        c_orc_total += val_o
                        c_real_total += val_r
                    
                    child_obj["Total_orc"] = c_orc_total
                    child_obj["Total_real"] = c_real_total
                    report_data.append(child_obj)

        # 2. Sequential calculation for Calculated Totals (CPV, Gross Profit, etc.)
        def calc_derived_row(row_id, cache_o, cache_r, formula_fn):
            r_obj = next((r for r in report_data if r["id"] == row_id), None)
            if not r_obj: return
            for m in months:
                vo = formula_fn(cache_o, m)
                vr = formula_fn(cache_r, m)
                r_obj[f"{m}_orc"] = vo
                r_obj[f"{m}_real"] = vr
                cache_o[row_id][m] = vo
                cache_r[row_id][m] = vr
            r_obj["Total_orc"] = sum(cache_o[row_id].values())
            r_obj["Total_real"] = sum(cache_r[row_id].values())

        # Formula logic
        calc_derived_row("receita_liquida", cache_orc, cache_real, lambda c, m: c["receita_bruta"][m] + c["deducoes"][m])
        calc_derived_row("cpv", cache_orc, cache_real, lambda c, m: c["materia_prima"][m] + c["pessoal_cpv"][m] + c["ocupacao_cpv"][m] + c["cif"][m])
        calc_derived_row("resultado_bruto", cache_orc, cache_real, lambda c, m: c["receita_liquida"][m] + c["cpv"][m])
        calc_derived_row("despesas_comerciais_total", cache_orc, cache_real, lambda c, m: c["despesas_comerciais"][m] + c["marketing"][m] + c["negocios_digitais"][m])
        calc_derived_row("despesas_administrativas", cache_orc, cache_real, lambda c, m: c["pessoal_adm"][m] + c["servicos_terceiros"][m] + c["despesas_gerais"][m])
        calc_derived_row("despesas_operacionais", cache_orc, cache_real, lambda c, m: c["despesas_comerciais_total"][m] + c["despesas_administrativas"][m])
        calc_derived_row("margem_contribuicao", cache_orc, cache_real, lambda c, m: c["resultado_bruto"][m] + c["despesas_comerciais_total"][m] - c["pessoal_cpv"][m])
        calc_derived_row("resultado_operacional", cache_orc, cache_real, lambda c, m: c["resultado_bruto"][m] + c["despesas_operacionais"][m])

        # 3. Percentages
        for row in report_data:
            if row["type"] == "percentage":
                rid = row["id"]
                ref = next(r for r in DRE_STRUCTURE if r["id"] == rid)
                num_id = ref["formula_ref"]
                den_id = ref["denom"]
                
                for m in months:
                    # Orcado
                    num_o = cache_orc[num_id][m]
                    den_o = cache_orc[den_id][m]
                    row[f"{m}_orc"] = (num_o / den_o * 100) if den_o != 0 else 0
                    # Realizado
                    num_r = cache_real[num_id][m]
                    den_r = cache_real[den_id][m]
                    row[f"{m}_real"] = (num_r / den_r * 100) if den_r != 0 else 0
                
                # Totals for percentages
                t_num_o = sum(cache_orc[num_id].values())
                t_den_o = sum(cache_orc[den_id].values())
                row["Total_orc"] = (t_num_o / t_den_o * 100) if t_den_o != 0 else 0
                
                t_num_r = sum(cache_real[num_id].values())
                t_den_r = sum(cache_real[den_id].values())
                row["Total_real"] = (t_num_r / t_den_r * 100) if t_den_r != 0 else 0

        return {
            "data": report_data,
            "base_id_orcado": bid_orc,
            "base_id_realizado": base_id_realizado or "consolidated"
        }

    except Exception as e:
        logger.error(f"Error in orcado-realizado: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/report/dre")
def get_report_dre(base_id_orcado: str = None, base_id_realizado: str = None, departamento: str = "Total", user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    # DRE typically aggregates by Grupo/Subgrupo.
    # We will return data grouped by 'Grupo' and 'Conta' with comparative columns.
    # For simplicity, we reuse logic similar to Orcado/Realizado but return extra metadata fields like 'Grupo'.
    try:
        conn = get_db_connection()
        # ... (Similar logic to get IDs)
        def get_best_bases_realizado():
            """Busca a base mais recente para cada mês para o Realizado."""
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT ON (competencia) id, competencia
                    FROM financeiro_bases
                    WHERE type = 'realizado' AND is_active = TRUE AND competencia IS NOT NULL
                    ORDER BY competencia, uploaded_at DESC
                """)
                return cur.fetchall()

        bid_orc = base_id_orcado or get_latest_base('orcado')
        
        bases_real = []
        if base_id_realizado:
            bases_real = [{"id": base_id_realizado}]
        else:
            bases_real = get_best_bases_realizado()
            if not bases_real:
                latest = get_latest_base('realizado')
                if latest: bases_real = [{"id": latest}]
        
        # Query extracting Grupo/Descricao
        q = """
           SELECT 'orcado' as source, conta_contabil, grupo, descricao_conta, competencia, valor 
           FROM financeiro_data_orcado WHERE base_id = %s
           UNION ALL
           SELECT 'realizado' as source, conta_contabil, grupo, descricao_conta, competencia, valor 
           FROM financeiro_data_realizado WHERE base_id = %s
        """
        
        # Note: Department filtering needs to be injected into the sub-selects or wrapper.
        # Let's do simple injection.
        # No longer using bid_real directly here
        filter_clause = ""
        
        if departamento and departamento != "Todos" and departamento != "Total":
             filter_clause = " AND departamento = %s"
             # Need to append params twice
             # Actually, better to run separate queries to avoid mess with params index in union
             pass 

        # Let's stick to separate reads for safety
        df_orc = pd.read_sql(f"SELECT conta_contabil, grupo, descricao_conta, competencia, valor FROM financeiro_data_orcado WHERE base_id = %s {filter_clause}", conn, params=[bid_orc] + ([departamento] if filter_clause else []))
        # Load Realizado (Consolidated if needed)
        if bases_real:
            ids_r = [str(b['id']) for b in bases_real]
            placeholders_r = ', '.join(['%s'] * len(ids_r))
            query_r = f"SELECT conta_contabil, grupo, descricao_conta, competencia, valor FROM financeiro_data_realizado WHERE base_id IN ({placeholders_r}) {filter_clause}"
            df_real = pd.read_sql(query_r, conn, params=ids_r + ([departamento] if filter_clause else []))
        else:
            df_real = pd.DataFrame(columns=['conta_contabil', 'grupo', 'descricao_conta', 'competencia', 'valor'])
        conn.close()
        
        df_orc['source'] = 'orcado'
        df_real['source'] = 'realizado'
        
        df_full = pd.concat([df_orc, df_real])
        
        # Group by Grupo, Conta, Source, Competencia
        df_grp = df_full.groupby(['grupo', 'conta_contabil', 'descricao_conta', 'source', 'competencia'])['valor'].sum().reset_index()
        
        return df_grp.to_dict(orient='records')
        
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

@router.get("/financeiro/plano-contas")
def get_plano_contas(user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'financeiro'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    # Return unique accounts from latest Orcado base
    try:
        conn = get_db_connection()
        query = """
            SELECT DISTINCT conta_contabil, descricao_conta, grupo, tipo
            FROM financeiro_data_orcado d
            JOIN financeiro_bases b ON d.base_id = b.id
            WHERE b.type = 'orcado' AND b.id = (SELECT id FROM financeiro_bases WHERE type='orcado' ORDER BY uploaded_at DESC LIMIT 1)
            ORDER BY conta_contabil
        """
        df = pd.read_sql(query, conn)
        conn.close()
        return df.to_dict(orient='records')
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")

# ==========================================
# === SECTORS MANAGEMENT ===
# ==========================================

# Auto-create sectors table and seed with default data on first run


# ==========================================
# === SEED DUMMY FINANCEIRO (2026) ===
# ==========================================

def _ensure_finance_tables(cur):
    """Garante a existência das tabelas do financeiro (idempotente).

    Usa os MESMOS nomes de tabela/coluna referenciados no restante do módulo:
      - financeiro_bases (id, type, filename, version_name, uploaded_by,
        competencia, is_active, uploaded_at)
      - financeiro_data_orcado / financeiro_data_realizado (base_id, competencia,
        ebtida, margem_contribuicao, tipo, setor, departamento, conta_contabil,
        grupo, descricao_conta, valor, row_index)
      - financeiro_justificativas (base_id, competencia, conta_contabil,
        departamento, grupo, justificativa, created_by, created_at)
    """
    cur.execute("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\"")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_bases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type VARCHAR(20) NOT NULL,
            filename TEXT,
            version_name TEXT,
            uploaded_by UUID,
            competencia TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            uploaded_at TIMESTAMP DEFAULT NOW()
        )
    """)

    for _tbl in ("financeiro_data_orcado", "financeiro_data_realizado"):
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {_tbl} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                base_id UUID,
                competencia TEXT,
                ebtida TEXT,
                margem_contribuicao TEXT,
                tipo TEXT,
                setor TEXT,
                departamento TEXT,
                conta_contabil TEXT,
                grupo TEXT,
                descricao_conta TEXT,
                valor DOUBLE PRECISION,
                row_index INTEGER
            )
        """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_justificativas (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            base_id UUID,
            competencia TEXT,
            conta_contabil TEXT,
            departamento TEXT,
            grupo TEXT,
            justificativa TEXT,
            created_by UUID,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    # Índice único usado pelo UPSERT de save_justificativa (ON CONFLICT ... COALESCE)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_just
        ON financeiro_justificativas
        (base_id, competencia, conta_contabil, COALESCE(departamento, 'N/A'))
    """)


# Plano de contas dummy alinhado ao DRE_STRUCTURE (core/config.py).
# (conta_contabil, grupo, descricao_conta, base_mensal_R$, sinal)
# sinal: +1 receita; -1 despesa/dedução (valores negativos como no upload real).
_SEED_PLANO_CONTAS = [
    ("4.1.1.001", "Receita Bruta", "Venda de produtos", 1200000.0, 1),
    ("4.2.2.003", "Deduções", "ICMS sobre vendas", 95000.0, -1),
    ("4.2.2.004", "Deduções", "PIS sobre vendas", 19800.0, -1),
    ("4.2.2.005", "Deduções", "COFINS sobre vendas", 91200.0, -1),
    ("4.2.2.006", "Deduções", "ISS sobre vendas", 6000.0, -1),
    ("4.2.2.007", "Deduções", "ICMS-ST sobre vendas", 14000.0, -1),
    ("5.1.1.001", "Matéria-Prima Consumida", "Matéria-prima consumida", 360000.0, -1),
    ("5.1.2.001", "Pessoal Industrial", "Salários produção", 88000.0, -1),
    ("5.1.2.003", "Pessoal Industrial", "Encargos sociais produção", 26000.0, -1),
    ("5.1.2.007", "Pessoal Industrial", "Férias produção", 9000.0, -1),
    ("5.1.2.008", "Pessoal Industrial", "13º salário produção", 8000.0, -1),
    ("5.1.3.001", "Ocupação Industrial", "Aluguel fábrica", 22000.0, -1),
    ("5.1.3.002", "Ocupação Industrial", "Energia elétrica fábrica", 18000.0, -1),
    ("5.1.3.003", "Custos Indiretos", "Custos indiretos de fabricação", 15000.0, -1),
    ("6.1.1.001", "Despesas Comerciais", "Comissões sobre vendas", 36000.0, -1),
    ("6.1.1.002", "Despesas Comerciais", "Fretes sobre vendas", 21000.0, -1),
    ("6.1.1.004", "Despesas Comerciais", "Despesa com cesta básica", 5400.0, -1),
    ("6.1.2.001", "Marketing", "Publicidade e propaganda", 28000.0, -1),
    ("6.1.2.002", "Marketing", "Material promocional", 9000.0, -1),
    ("6.1.3.001", "Negócios Digitais", "Mídia paga online", 17000.0, -1),
    ("6.1.3.004", "Negócios Digitais", "Marketplaces e comissões", 12000.0, -1),
    ("6.2.1.001", "Pessoal Administrativo", "Salários administrativos", 72000.0, -1),
    ("6.2.1.005", "Pessoal Administrativo", "Encargos administrativos", 21000.0, -1),
    ("6.2.1.006", "Pessoal Administrativo", "Vale-transporte", 4800.0, -1),
    ("6.2.2.002", "Serviços de Terceiros", "Honorários contábeis", 9000.0, -1),
    ("6.2.2.003", "Serviços de Terceiros", "Assessoria jurídica", 7000.0, -1),
    ("6.2.2.004", "Serviços de Terceiros", "Consultoria de TI", 6500.0, -1),
    ("6.2.4.001", "Despesas Gerais", "Despesa com Licenças e Alvarás", 3200.0, -1),
    ("6.2.4.002", "Despesas Gerais", "Material de escritório", 2100.0, -1),
    ("6.2.4.006", "Despesas Gerais", "Telefonia e internet", 3800.0, -1),
]

# Departamentos dummy (subconjunto de dummy.SETORES, mapeados ao DRE).
_SEED_DEPARTAMENTOS = ["Comercial", "Financeiro", "Fabrica", "Marketing", "T.I"]


def seed_dummy_financeiro(admin_id: str) -> dict:
    """Popula dados dummy de 2026 para o módulo financeiro (DRE / Orçado x Realizado).

    - Idempotente: se já houver base ativa, NÃO duplica (retorna {'skipped': True}).
    - Garante as tabelas via _ensure_finance_tables (CREATE TABLE IF NOT EXISTS).
    - Cria 1 base 'orcado' e 1 base 'realizado' (uploaded_by = admin_id).
    - Popula TODOS os 12 meses de 2026 (Janeiro..Dezembro) por conta contábil
      e departamento, usando core.dummy (rng, serie_mensal, MESES_PT_LONGO, SETORES).
    - Inclui algumas justificativas de exemplo.
    """
    from core import dummy

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        # Garante as tabelas (idempotente).
        _ensure_finance_tables(cur)

        # Idempotência (corrigida): em vez de pular se existir QUALQUER base ativa
        # (o que deixava o relatório vazio quando havia bases parciais/antigas ou
        # bases reais de usuário), verificamos especificamente as bases DUMMY de 2026
        # e se elas REALMENTE têm linhas nas duas tabelas de dados.
        #   - Se as duas bases dummy (orcado + realizado) existem e estão populadas,
        #     não refaz nada (não duplica a cada start).
        #   - Se estão ausentes/incompletas, removemos os resquícios dummy e
        #     repopulamos corretamente, sem tocar em bases reais de usuário.
        _DUMMY_FILES = ("dummy_orcado_2026.xlsx", "dummy_realizado_2026.xlsx")
        cur.execute(
            """
            SELECT b.type, COALESCE(d.cnt, 0) AS cnt
            FROM financeiro_bases b
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM financeiro_data_orcado o
                WHERE o.base_id = b.id AND b.type = 'orcado'
                UNION ALL
                SELECT COUNT(*) AS cnt
                FROM financeiro_data_realizado r
                WHERE r.base_id = b.id AND b.type = 'realizado'
            ) d ON TRUE
            WHERE b.is_active = TRUE AND b.filename = ANY(%s)
            """,
            (list(_DUMMY_FILES),),
        )
        dummy_status = {row[0]: int(row[1]) for row in cur.fetchall()}
        orcado_ok = dummy_status.get("orcado", 0) > 0
        realizado_ok = dummy_status.get("realizado", 0) > 0
        if orcado_ok and realizado_ok:
            conn.rollback()
            cur.close()
            return {
                "skipped": True,
                "reason": "Bases dummy 2026 já populadas",
                "orcado_rows": dummy_status.get("orcado", 0),
                "realizado_rows": dummy_status.get("realizado", 0),
            }

        # Limpa resquícios dummy (bases dummy vazias/incompletas e seus dados),
        # preservando quaisquer bases reais enviadas por usuários.
        cur.execute(
            "SELECT id, type FROM financeiro_bases WHERE filename = ANY(%s)",
            (list(_DUMMY_FILES),),
        )
        for _bid, _btype in cur.fetchall():
            _tbl = "financeiro_data_orcado" if _btype == "orcado" else "financeiro_data_realizado"
            cur.execute(f"DELETE FROM {_tbl} WHERE base_id = %s", (str(_bid),))
            cur.execute("DELETE FROM financeiro_justificativas WHERE base_id = %s", (str(_bid),))
            cur.execute("DELETE FROM financeiro_bases WHERE id = %s", (str(_bid),))

        meses = dummy.MESES_PT_LONGO  # ['Janeiro', ..., 'Dezembro']
        # Sanity: garante alinhamento com os departamentos dummy disponíveis.
        departamentos = [d for d in _SEED_DEPARTAMENTOS if d in dummy.SETORES] or _SEED_DEPARTAMENTOS

        resultado = {}

        # base_factor por tipo: realizado oscila em torno do orçado.
        for tipo_base in ("orcado", "realizado"):
            cur.execute(
                """
                INSERT INTO financeiro_bases (type, filename, version_name, uploaded_by, competencia, is_active)
                VALUES (%s, %s, %s, %s, %s, TRUE)
                RETURNING id
                """,
                (
                    tipo_base,
                    f"dummy_{tipo_base}_2026.xlsx",
                    f"Dummy {tipo_base.capitalize()} 2026",
                    admin_id,
                    None,
                ),
            )
            base_id = cur.fetchone()[0]

            data_table = "financeiro_data_orcado" if tipo_base == "orcado" else "financeiro_data_realizado"

            linhas = []
            row_index = 0
            n_dep = len(departamentos)
            for conta, grupo, descricao, base_mensal, sinal in _SEED_PLANO_CONTAS:
                # Correção do "Detalhamento não condiz": geramos PRIMEIRO o total
                # mensal da conta (o mesmo número que a linha pai do DRE soma) e só
                # então DISTRIBUÍMOS esse total entre os departamentos com alocação
                # exata em centavos. Assim a soma das linhas de detalhe (por
                # departamento) é SEMPRE idêntica ao total da conta no mês, sem
                # depender de arredondamentos independentes por departamento.
                serie = dummy.serie_mensal(
                    f"financeiro|{tipo_base}|{conta}",
                    base=base_mensal,
                    var=0.18,
                    tendencia=0.015,
                )
                r_tot = dummy.rng("financeiro_real_adj", conta)
                # Pesos determinísticos por departamento (constantes no ano), usados
                # apenas para repartir o total — a soma dos pesos é normalizada.
                r_w = dummy.rng("financeiro_dep_weights", conta)
                pesos = [0.6 + r_w.uniform(0.0, 0.8) for _ in departamentos]
                soma_pesos = sum(pesos) or 1.0
                for i, mes in enumerate(meses):
                    total = serie[i]["valor"]
                    # Realizado desvia levemente do orçado (ruído determinístico),
                    # aplicado ao TOTAL da conta (não por departamento).
                    if tipo_base == "realizado":
                        total = round(total * (1 + r_tot.uniform(-0.12, 0.12)), 2)
                    # Distribui o total em centavos: arredonda cada parcela e joga o
                    # residual no último departamento, garantindo soma exata.
                    total_cents = int(round(total * 100))
                    parciais = []
                    acumulado = 0
                    for k in range(n_dep):
                        if k == n_dep - 1:
                            cents = total_cents - acumulado
                        else:
                            cents = int(round(total_cents * pesos[k] / soma_pesos))
                            acumulado += cents
                        parciais.append(cents)
                    for k, dep in enumerate(departamentos):
                        valor_final = round((parciais[k] / 100.0) * sinal, 2)
                        linhas.append((
                            str(base_id),
                            mes,
                            None,            # ebtida
                            None,            # margem_contribuicao
                            "Receita" if sinal > 0 else "Despesa",  # tipo
                            "Industria",    # setor
                            dep,             # departamento
                            conta,           # conta_contabil
                            grupo,           # grupo
                            descricao,       # descricao_conta
                            valor_final,     # valor
                            row_index,       # row_index
                        ))
                        row_index += 1

            args_str = ",".join(
                cur.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", x).decode("utf-8")
                for x in linhas
            )
            cur.execute(f"""
                INSERT INTO {data_table}
                (base_id, competencia, ebtida, margem_contribuicao, tipo, setor, departamento, conta_contabil, grupo, descricao_conta, valor, row_index)
                VALUES {args_str}
            """)

            resultado[tipo_base] = {"base_id": str(base_id), "rows": len(linhas)}

            # Algumas justificativas de exemplo (apenas para a base orçado).
            if tipo_base == "orcado":
                just_samples = [
                    ("Janeiro", "6.1.2.001", "Marketing", "Marketing",
                     "Investimento extra em campanha de lançamento."),
                    ("Março", "6.1.1.002", "Comercial", "Despesas Comerciais",
                     "Aumento de fretes por reajuste de transportadoras."),
                    ("Junho", "5.1.1.001", "Fabrica", "Matéria-Prima Consumida",
                     "Compra antecipada de matéria-prima para o 2º semestre."),
                    ("Setembro", "6.2.2.004", "T.I", "Serviços de Terceiros",
                     "Projeto pontual de consultoria de TI."),
                ]
                for comp, conta, dep, grupo, txt in just_samples:
                    cur.execute(
                        """
                        INSERT INTO financeiro_justificativas
                        (base_id, competencia, conta_contabil, departamento, grupo, justificativa, created_by)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (base_id, competencia, conta_contabil, COALESCE(departamento, 'N/A'))
                        DO NOTHING
                        """,
                        (str(base_id), comp, conta, dep, grupo, txt, admin_id),
                    )
                resultado["justificativas"] = len(just_samples)

        conn.commit()
        cur.close()
        return {
            "skipped": False,
            "ano": dummy.ANO_BASE,
            "meses": len(meses),
            "departamentos": departamentos,
            "contas": len(_SEED_PLANO_CONTAS),
            **resultado,
        }
    except Exception as e:
        conn.rollback()
        logger.error(f"Erro no seed_dummy_financeiro: {e}")
        raise
    finally:
        conn.close()
