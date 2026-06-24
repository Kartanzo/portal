import pandas as pd
import os
import datetime
from google.cloud import bigquery
from google.oauth2 import service_account
import gspread

import re
import sys

# Define paths
if getattr(sys, 'frozen', False):
    # Running as executable
    FOLDER_PATH = os.path.dirname(sys.executable)
else:
    # Running as script
    FOLDER_PATH = os.path.dirname(os.path.abspath(__file__))

CREDENTIALS_FILE = "projeto-rpa-empresa-2023-16b15891f73c.json"
# Credentials are now expected in the SAME folder as the executable/script
CREDENTIALS_PATH = os.path.join(FOLDER_PATH, CREDENTIALS_FILE)
CAMINHO_TXT_PATH = os.path.join(FOLDER_PATH, "caminho.txt")
OUTPUT_FILE = "vendashistoricodois_processed.xlsx"

def load_config():
    config = {}
    print(f"Reading configuration from {CAMINHO_TXT_PATH}...")
    try:
        with open(CAMINHO_TXT_PATH, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        raise FileNotFoundError(f"Could not read caminho.txt: {e}")

    for line in lines:
        line = line.strip()
        if not line: continue
        
        # Parse based on known prefixes
        if line.startswith("Base de faturamento"):
            # Format: Base de faturamento - ID: <id>
            match = re.search(r"ID:\s*(.+)", line)
            if match:
                config['bq_logistics'] = match.group(1).strip()
                
        elif line.startswith("Base de pedidos"):
            # Format: Base de pedidos - ID: <id>
            match = re.search(r"ID:\s*(.+)", line)
            if match:
                config['bq_sales'] = match.group(1).strip()
                
        elif line.lower().startswith("metas por regional"):
            # Format: Metas por regional - sheet: <url> aba - <tab>
            url_match = re.search(r"sheets?:\s*(https?://[^\s]+)", line, re.IGNORECASE)
            tab_match = re.search(r"aba\s*-\s*(.+)", line, re.IGNORECASE)
            
            if url_match and tab_match:
                url = url_match.group(1)
                config['sheet_url_metas_regional'] = url
                # Extract ID from URL
                id_match = re.search(r"/d/([a-zA-Z0-9-_]+)", url)
                if id_match:
                    config['sheet_id_metas_regional'] = id_match.group(1)
                    config['sheet_tab_metas_regional'] = tab_match.group(1).strip()
                    
        elif line.lower().startswith("metas por item"):
            # Format: Metas por item - sheets: <url> - aba - <tab> (handling extra dashes)
            url_match = re.search(r"sheets?:\s*(https?://[^\s]+)", line, re.IGNORECASE)
            # Find 'aba' robustly
            tab_match = re.search(r"aba\s*-\s*(.+)", line, re.IGNORECASE)
            
            if url_match and tab_match:
                url = url_match.group(1)
                config['sheet_url_metas_item'] = url
                # Extract ID from URL
                id_match = re.search(r"/d/([a-zA-Z0-9-_]+)", url)
                if id_match:
                    config['sheet_id_metas_item'] = id_match.group(1)
                    config['sheet_tab_metas_item'] = tab_match.group(1).strip()
                    
        elif line.lower().startswith("metas familia"):
            # Format: Metas familia - sheet: <url> - aba - <tab>
            url_match = re.search(r"sheets?:\s*(https?://[^\s]+)", line, re.IGNORECASE)
            tab_match = re.search(r"aba\s*-\s*(.+)", line, re.IGNORECASE)
            
            if url_match and tab_match:
                url = url_match.group(1)
                config['sheet_url_meta_familia'] = url
                # Extract ID from URL
                id_match = re.search(r"/d/([a-zA-Z0-9-_]+)", url)
                if id_match:
                    config['sheet_id_meta_familia'] = id_match.group(1)
                    config['sheet_tab_meta_familia'] = tab_match.group(1).strip()
    
    # Validation
    required_keys = ['bq_sales', 'bq_logistics', 'sheet_id_metas_regional', 'sheet_tab_metas_regional', 'sheet_id_metas_item', 'sheet_tab_metas_item']
    missing = [k for k in required_keys if k not in config]
    if missing:
        raise ValueError(f"Missing configuration for: {', '.join(missing)}")
        
    return config

def get_sheet_df(gc, url, tab_name):
    try:
        sh = gc.open_by_url(url)
        try:
            ws = sh.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            print(f"Warning: Tab '{tab_name}' not found in {url}. Attempting to open first tab.")
            ws = sh.get_worksheet(0)
        
        # Use UNFORMATTED_VALUE to retrieve raw numbers (floats) and serial dates
        # This fixes the issue where "17.710,88" is returned as "1771088" string
        try:
            # Try with argument (gspread > 5.0)
            rows = ws.get_all_values(value_render_option='UNFORMATTED_VALUE')
        except TypeError:
             # Fallback for older gspread: Manual fetch or default
             print("Warning: UNFORMATTED_VALUE not supported by installed gspread. Using default (FORMATTED).")
             data = ws.get_all_records()
             return pd.DataFrame(data)
             
        if not rows:
            return pd.DataFrame()
            
        headers = rows[0]
        data = rows[1:]
        
        # Create DataFrame
        df = pd.DataFrame(data, columns=headers)
        return df

    except Exception as e:
        raise Exception(f"Failed to read sheet {url} / {tab_name}: {e}")

def download_data(config):
    print("Authenticating...")
    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(f"Credentials not found at {CREDENTIALS_PATH}")

    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_PATH,
        scopes=[
            "https://www.googleapis.com/auth/cloud-platform",
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets"
        ]
    )
    
    # Calculate date filter (Current Year - 2)
    current_year = datetime.datetime.now().year
    start_year = current_year - 1
    start_date = f"{start_year}-01-01"
    print(f"Filtering data from {start_date} onwards...")

    # BigQuery Clients
    bq_client = bigquery.Client(credentials=creds, project=creds.project_id)
    
    print(f"Downloading Sales (Pedidos) from BigQuery: {config['bq_sales']}...")
    query_sales = f"SELECT * FROM `{config['bq_sales']}` WHERE EMISSAO >= '{start_date}'"
    sales_df = bq_client.query(query_sales).to_dataframe(create_bqstorage_client=False)
    
    print(f"Downloading Logistics (Faturamento) from BigQuery: {config['bq_logistics']}...")
    date_col_logistics = 'EMISSAO' # default
    try:
        table_logistics = bq_client.get_table(config['bq_logistics'])
        col_names = [schema.name for schema in table_logistics.schema]
        for candidate in ['EMISSAO_faturamento', 'DATA_FATURAMENTO', 'EMISSAO', 'DATA_EMISSAO']:
            if candidate in col_names:
                date_col_logistics = candidate
                break
    except Exception as e:
        print(f"Warning: Could not fetch schema to detect date column, defaulting to 'EMISSAO'. Error: {e}")

    query_logistics = f"SELECT * FROM `{config['bq_logistics']}` WHERE {date_col_logistics} >= '{start_date}'"
    print(f"Using date column '{date_col_logistics}' for Logistics filter.")
    logistics_df = bq_client.query(query_logistics).to_dataframe(create_bqstorage_client=False)

    print(f"Downloading Relatorio Logistica (link Pedidos-Notas) from BigQuery...")
    # Fetch explicit columns as requested
    query_rel_logistica = f"""
        SELECT NOTA_FISCAL, EMISSAO_NOTA_FISCAL, PEDIDO_VENDA 
        FROM `projeto-rpa-empresa-2023.VENDAS.RelatorioLogistica` 
        WHERE EMISSAO_NOTA_FISCAL >= '{start_date}'
    """
    relatorio_logistica_df = bq_client.query(query_rel_logistica).to_dataframe(create_bqstorage_client=False)
    
    # GSpread Client with User's preferred auth method
    print("Authenticating for Sheets...")
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    try:
        from oauth2client.service_account import ServiceAccountCredentials
        # Try-except block for import, but we know it's there or we fall back
        try:
             creds_gspread = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_PATH, scope)
             gc = gspread.authorize(creds_gspread)
        except Exception as e_auth:
             print(f"Error with ServiceAccountCredentials: {e_auth}. Falling back.")
             gc = gspread.authorize(creds)
    except ImportError:
        print("oauth2client not installed. Using standard service_account credentials.")
        gc = gspread.authorize(creds)

    print(f"Downloading Metas Regional from Sheets...")
    try:
        url = config.get('sheet_url_metas_regional')
        tab = config['sheet_tab_metas_regional']
        # Fallback to ID construction if URL missing (shouldn't be with new config logic)
        if not url and 'sheet_id_metas_regional' in config:
             url = f"https://docs.google.com/spreadsheets/d/{config['sheet_id_metas_regional']}"
             
        metas_regional_df = get_sheet_df(gc, url, tab)
        
        # DEBUG: Export raw metas for user inspection
        print("DEBUG: Exporting raw metas_regional_df to 'debug_metas_raw.xlsx'...")
        metas_regional_df.to_excel(os.path.join(FOLDER_PATH, "debug_metas_raw.xlsx"), index=False)
        
        # Filter Metas Regional
        if 'mes_referencia' in metas_regional_df.columns:
            # Helper to parse dates that might be Serial (float) or String
            def parse_gsheet_date(x):
                if pd.isna(x) or str(x).strip() == '': return pd.NaT
                if isinstance(x, (int, float)):
                    # Excel Serial Date (days since 1899-12-30)
                    return pd.to_datetime(x, unit='D', origin='1899-12-30')
                # String fallback
                return pd.to_datetime(x, dayfirst=True, errors='coerce')

            metas_regional_df['temp_date'] = metas_regional_df['mes_referencia'].apply(parse_gsheet_date)
            metas_regional_df = metas_regional_df[metas_regional_df['temp_date'] >= pd.to_datetime(start_date)].copy()
            metas_regional_df.drop(columns=['temp_date'], inplace=True)
            print(f"Filtered Metas Regional: {len(metas_regional_df)} rows remaining.")
            print(f"Filtered Metas Regional: {len(metas_regional_df)} rows remaining.")
            
    except Exception as e:
        print(f"Error downloading Metas Regional: {e}")
        raise

    print(f"Downloading Metas Família from Sheets...")
    try:
        url = config.get('sheet_url_meta_familia')
        tab = config.get('sheet_tab_meta_familia')

        # Fallback to ID if URL missing
        if not url and 'sheet_id_meta_familia' in config:
             url = f"https://docs.google.com/spreadsheets/d/{config['sheet_id_meta_familia']}"
        
        if url and tab:
             meta_familia_df = get_sheet_df(gc, url, tab)
             
             # Filter Metas Família (using same logic if col exists)
             if 'mes_referencia' in meta_familia_df.columns:
                def parse_gsheet_date_fam(x):
                    if pd.isna(x) or str(x).strip() == '': return pd.NaT
                    if isinstance(x, (int, float)):
                        return pd.to_datetime(x, unit='D', origin='1899-12-30')
                    return pd.to_datetime(x, dayfirst=True, errors='coerce')
                
                meta_familia_df['temp_date'] = meta_familia_df['mes_referencia'].apply(parse_gsheet_date_fam)
                meta_familia_df = meta_familia_df[meta_familia_df['temp_date'] >= pd.to_datetime(start_date)].copy()
                meta_familia_df.drop(columns=['temp_date'], inplace=True)
                print(f"Filtered Meta Família: {len(meta_familia_df)} rows remaining.")
        else:
             print("Warning: Meta Família config missing. Skipping.")
             meta_familia_df = pd.DataFrame()

    except Exception as e:
        print(f"Error downloading Meta Família: {e}")
        # Not raising, maybe optional? Assuming critical based on user.
        print("Providing empty DF for Meta Família.")
        meta_familia_df = pd.DataFrame()
    print(f"Downloading Metas Item (Forecast) from Sheets...")
    try:
        url = config.get('sheet_url_metas_item')
        tab = config['sheet_tab_metas_item']
        if not url and 'sheet_id_metas_item' in config:
             url = f"https://docs.google.com/spreadsheets/d/{config['sheet_id_metas_item']}"
             
        metas_item_df = get_sheet_df(gc, url, tab)
        
        # Filter Forecast
        if 'Ano' in metas_item_df.columns:
            metas_item_df['Ano'] = pd.to_numeric(metas_item_df['Ano'], errors='coerce')
            metas_item_df = metas_item_df[metas_item_df['Ano'] >= start_year].copy()
            print(f"Filtered Forecast by Year: {len(metas_item_df)} rows remaining.")
        
    except Exception as e:
        print(f"Error downloading Metas Item: {e}")
        raise

    print("Data download complete.")
    return sales_df, logistics_df, metas_regional_df, metas_item_df, relatorio_logistica_df, meta_familia_df

def process_financeiro(sales_df, logistics_df, rel_logistica_df):
    print("Processing Financial Value...")
    
    # helper
    def clean_key(x):
        return str(x).strip().upper()

    # 1. Prepare Relatorio Logistica (Link Metadata)
    # We need to bring PEDIDO_VENDA to logistics_df using NOTA_FISCAL
    print("Enriching Logistics with PEDIDO_VENDA from RelatorioLogistica...")
    
    # Normalize Keys in Relatorio Logistica
    rel_logistica_df['NOTA_FISCAL_KEY'] = rel_logistica_df['NOTA_FISCAL'].apply(clean_key)
    rel_logistica_df['PEDIDO_VENDA_CLEAN'] = rel_logistica_df['PEDIDO_VENDA'].apply(clean_key)
    
    # Deduplicate Relatorio Logistica (One Pedido per Nota preference? Or just unique map)
    # If multiple orders for one note, we might have issues. Assuming 1:1 or taking first.
    rel_dedup = rel_logistica_df[['NOTA_FISCAL_KEY', 'PEDIDO_VENDA_CLEAN']].drop_duplicates(subset=['NOTA_FISCAL_KEY'], keep='first')

    # 2. Prepare Logistics (Financial Base)
    # Find NOTA_FISCAL column in logistics
    col_nota_log = None
    for cand in ['NOTA_FISCAL', 'NOTA', 'NF', 'NUMERO_NOTA']:
        for col in logistics_df.columns:
            if col.upper() == cand.upper():
                col_nota_log = col
                break
        if col_nota_log: break
        
    if not col_nota_log:
        print("WARNING: Could not find NOTA_FISCAL column in Logistics. Cannot enrich with Pedido.")
        # Fallback to empty if critical? proceeding with risk
    else:
        logistics_df['NOTA_FISCAL_KEY'] = logistics_df[col_nota_log].apply(clean_key)
        
        # Merge Pedido into Logistics
        logistics_df = pd.merge(
            logistics_df,
            rel_dedup,
            on='NOTA_FISCAL_KEY',
            how='left'
        )
        print(f"Enriched Logistics with Pedido. Missing Pedidos: {logistics_df['PEDIDO_VENDA_CLEAN'].isna().sum()}")

    # 3. Check for VLR_FINANCEIRO
    col_vlr = None
    for col in logistics_df.columns:
        if col.upper() == 'VLR_FINANCEIRO':
            col_vlr = col
            break
            
    if not col_vlr:
         print("WARNING: VLR_FINANCEIRO column not found in Logistics data.")
         return sales_df
    
    # 4. Prepare Final Merge Keys
    # Sales: PEDIDO, NOTA_FISCAL, CODIGO_PRODUTO
    # Logistics: PEDIDO_VENDA_CLEAN, NOTA_FISCAL_KEY, CODIGO_PRODUTO
    
    # Check Sales Columns
    sales_cols = [c.upper() for c in sales_df.columns]
    
    # Identify Sales Keys
    # PEDIDO
    col_pedido_sales = 'PEDIDO' if 'PEDIDO' in sales_cols else None
    if not col_pedido_sales: print("WARNING: PEDIDO not found in Sales.")
    
    # NOTA_FISCAL
    col_nota_sales = None
    for cand in ['NOTA_FISCAL', 'NOTA', 'NF', 'DOC']:
         if cand in sales_cols:
             col_nota_sales = cand # This assumes exact match to upper list, need real col name
             break
    # Recover real column name
    if col_nota_sales:
        col_nota_sales = [c for c in sales_df.columns if c.upper() == col_nota_sales][0]
    else:
        print("WARNING: NOTA_FISCAL not found in Sales.")

    # CODIGO_PRODUTO
    col_prod_sales = 'CODIGO_PRODUTO' if 'CODIGO_PRODUTO' in sales_cols else None
    
    # Prepare Join Cols
    sales_df['PEDIDO_JOIN'] = sales_df['PEDIDO'].apply(clean_key) if col_pedido_sales else ''
    sales_df['NOTA_JOIN'] = sales_df[col_nota_sales].apply(clean_key) if col_nota_sales else ''
    sales_df['PROD_JOIN'] = sales_df['CODIGO_PRODUTO'].apply(clean_key) if col_prod_sales else ''
    
    logistics_df['PEDIDO_JOIN'] = logistics_df['PEDIDO_VENDA_CLEAN'].fillna('').apply(clean_key)
    # NOTA_FISCAL_KEY already exists in logistics
    if 'NOTA_FISCAL_KEY' not in logistics_df.columns:
         logistics_df['NOTA_FISCAL_KEY'] = logistics_df[col_nota_log].apply(clean_key) if col_nota_log else ''
    logistics_df['PROD_JOIN'] = logistics_df['CODIGO_PRODUTO'].apply(clean_key)

    # Rename Value Col
    if col_vlr != 'VLR_FINANCEIRO':
        logistics_df.rename(columns={col_vlr: 'VLR_FINANCEIRO'}, inplace=True)
    
    # Deduplicate Logistics for Join
    # Keys: PEDIDO_VENDA, NOTA_FISCAL, CODIGO_PRODUTO
    subset_cols = ['PEDIDO_JOIN', 'NOTA_FISCAL_KEY', 'PROD_JOIN', 'VLR_FINANCEIRO']
    # Check for emission?
    col_emissao = None
    for candidate in ['EMISSAO_faturamento', 'DATA_FATURAMENTO', 'EMISSAO', 'DATA_EMISSAO']:
        for col in logistics_df.columns:
             if col.upper() == candidate.upper():
                 col_emissao = col
                 break
        if col_emissao: break
    
    if col_emissao:
        subset_cols.append(col_emissao)
        
    logistics_subset = logistics_df[subset_cols].copy()
    if col_emissao:
        logistics_subset.rename(columns={col_emissao: 'EMISSAO_faturamento'}, inplace=True)
        
    # ICMSST Handling
    col_icmsst = next((c for c in logistics_df.columns if c.upper() == 'ICMSST'), None)
    if col_icmsst:
        logistics_subset['ICMSST'] = logistics_df[col_icmsst]
    else:
        logistics_subset['ICMSST'] = 0.0

    # AGGREGATION LOGIC (Refined User Request)
    # Goal: Unify notes if they are in the SAME Billing Month. Keep separate if different months.
    
    # 1. Derive Billing Month (YYYYMM)
    if 'EMISSAO_faturamento' in logistics_subset.columns:
        logistics_subset['mes_faturamento'] = pd.to_datetime(logistics_subset['EMISSAO_faturamento'], errors='coerce').dt.strftime('%Y%m')
    else:
        logistics_subset['mes_faturamento'] = '000000'
        
    # Ensure Numeric before Aggregation
    for col in ['VLR_FINANCEIRO', 'ICMSST']:
        logistics_subset[col] = pd.to_numeric(logistics_subset[col], errors='coerce').fillna(0.0)

    # 2. GroupBy [PEDIDO, PROD, MES]
    # Aggregations: Sum Values, Concat Notes, Keep Date
    logistics_agg = logistics_subset.groupby(['PEDIDO_JOIN', 'PROD_JOIN', 'mes_faturamento'], as_index=False).agg({
        'VLR_FINANCEIRO': 'sum',
        'ICMSST': 'sum',
        'NOTA_FISCAL_KEY': lambda x: ', '.join(sorted(set(str(v) for v in x if str(v).strip() != ''))),
        'EMISSAO_faturamento': 'first' # Take representative date from the group
    })

    # Calculate 'faturamento_semst' (User Request 2026-01-31)
    # Logic: VLR_FINANCEIRO - ICMSST. If ICMSST is null/0, it becomes VLR_FINANCEIRO.
    logistics_agg['ICMSST'] = logistics_agg['ICMSST'].fillna(0)
    logistics_agg['faturamento_semst'] = logistics_agg['VLR_FINANCEIRO'] - logistics_agg['ICMSST']

    # Rename aggregated notes column to be user-friendly and persist after merge
    logistics_agg.rename(columns={'NOTA_FISCAL_KEY': 'notas_vinculadas'}, inplace=True)
    
    # 3. Filter Zero Values (Optional but recommended)
    logistics_agg = logistics_agg[logistics_agg['VLR_FINANCEIRO'] != 0].copy()
    
    print(f"Logistics Aggregated (by Month): {len(logistics_agg)} rows.")

    # Merge
    # Left on: PEDIDO, PROD
    # Right on: PEDIDO, PROD
    # This acts as an expansion: One Sales Order -> Many Financial Invoices (if months differ)
    # Merge
    # Outer Join to capture Financial Records missing in Sales (User Request 2026-01-31)
    merged_df = pd.merge(
        sales_df,
        logistics_agg,
        left_on=['PEDIDO_JOIN', 'PROD_JOIN'],
        right_on=['PEDIDO_JOIN', 'PROD_JOIN'],
        how='outer',
        indicator=True
    )

    # Handle Financial Orphans (Right Only)
    mask_right = merged_df['_merge'] == 'right_only'
    count_orphans = mask_right.sum()
    if count_orphans > 0:
        print(f"Found {count_orphans} Financial Records missing in original Sales Base.")
        print("Integrating these records (Ghost Orders)...")
        
        # Backfill Keys
        if 'PEDIDO' in merged_df.columns:
            merged_df.loc[mask_right, 'PEDIDO'] = merged_df.loc[mask_right, 'PEDIDO_JOIN']
        if 'CODIGO_PRODUTO' in merged_df.columns:
            merged_df.loc[mask_right, 'CODIGO_PRODUTO'] = merged_df.loc[mask_right, 'PROD_JOIN']
            
        # Backfill Dates (Use Faturamento date as Emissao key)
        if 'EMISSAO' in merged_df.columns and 'EMISSAO_faturamento' in merged_df.columns:
            merged_df.loc[mask_right, 'EMISSAO'] = merged_df.loc[mask_right, 'EMISSAO_faturamento']
            
        # Backfill MES_ANO (Important for grouping)
        if 'MES_ANO' in merged_df.columns and 'mes_faturamento' in merged_df.columns:
            merged_df.loc[mask_right, 'MES_ANO'] = merged_df.loc[mask_right, 'mes_faturamento']
            
    merged_df.drop(columns=['_merge'], inplace=True)
    
    # Calculate faturamento_semst (Already numeric due to agg)
    if 'VLR_FINANCEIRO' in merged_df.columns and 'ICMSST' in merged_df.columns:
         merged_df['faturamento_semst'] = merged_df['VLR_FINANCEIRO'] - merged_df['ICMSST']
    else:
         merged_df['faturamento_semst'] = 0.0
    
    # Identify Expanded Rows (Duplicates of the Sales content)
    # We want to keep the FIRST occurrence (Sales Data + Base Financial Note)
    # And zero out the SALES DATA for subsequence occurrences (which only exist to hold extra Financial Notes)
    # Key for uniqueness of SALES DATA: PEDIDO_JOIN, PROD_JOIN
    
    # Ensure stable sort if possible? For now, trust merge order.
    merged_df['IS_EXPANDED'] = merged_df.duplicated(subset=['PEDIDO_JOIN', 'PROD_JOIN'], keep='first')
    
    # List of columns to ZERO on expanded rows
    # We typically want to zero Sales Value, Quantity, Taxes, etc.
    # We do NOT want to zero VLR_FINANCEIRO (that belongs to the specific note)
    # We auto-detect numeric columns in Sales
    
    print(f"Zeroing Sales values on {merged_df['IS_EXPANDED'].sum()} duplicate rows...")
    
    cols_to_zero = []
    # Heuristic: Numeric columns that are NOT VLR_FINANCEIRO or ID keys
    # And specifically columns present BEFORE the merge (from sales_df)
    # But sales_df is merged now.
    
    exclude_cols = ['VLR_FINANCEIRO', 'PEDIDO_JOIN', 'PROD_JOIN', 'NOTA_FISCAL_KEY', 'notas_vinculadas', 'EMISSAO_faturamento', 
                    'IS_EXPANDED', 'EMISSAO', 'PEDIDO', 'NOTA_FISCAL', 'CODIGO_PRODUTO', 'MES_ANO', 'MES_ANO_STR']
    
    for col in merged_df.columns:
        if col in exclude_cols: continue
        # Simple heuristic: "VALOR", "VLR", "QTDE", "QTD", "TOTAL", "IPI", "ICMS"
        if any(x in col.upper() for x in ['VALOR', 'VLR', 'QTDE', 'QTD', 'TOTAL', 'IPI', 'ICMS', 'CUSTO']):
            if pd.api.types.is_numeric_dtype(merged_df[col]):
                cols_to_zero.append(col)
                
    if cols_to_zero:
        print(f"Zeroing columns: {cols_to_zero}")
        merged_df.loc[merged_df['IS_EXPANDED'], cols_to_zero] = 0

    # Cleanup join keys
    merged_df.drop(columns=['PEDIDO_JOIN', 'NOTA_JOIN', 'PROD_JOIN', 'NOTA_FISCAL_KEY'], inplace=True, errors='ignore')
    
    return merged_df

def normalize_text(text):
    if pd.isna(text) or text == '':
        return ''
    # Robust normalization: collapse spaces, strip, upper
    s = " ".join(str(text).split()).upper()
    try:
        s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('ASCII')
    except:
        pass
    return s

def process_targets(sales_df, metas_df):
    print("Processing Targets...")
    
    # Debug Date Range in Sales
    if 'EMISSAO' in sales_df.columns:
        dts = pd.to_datetime(sales_df['EMISSAO'], errors='coerce')
        print(f"Sales Date Range: {dts.min()} to {dts.max()}")
    
    # Create valid 'mes_ano' column in Metas (YYYYMM)
    def format_mes_referencia(val):
        if pd.isna(val) or val == '': return None
        # If already datetime/date
        if isinstance(val, (datetime.datetime, datetime.date)):
            return val.strftime('%Y%m')
        
        # If integer/float = Excel Serial Date
        if isinstance(val, (int, float)):
            try:
                 # Convert serial to datetime
                 dt = pd.to_datetime(val, unit='D', origin='1899-12-30')
                 return dt.strftime('%Y%m')
            except:
                 pass

        s_val = str(val)
        for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%Y/%m/%d', '%d-%m-%Y']:
            try: return pd.to_datetime(s_val, format=fmt).strftime('%Y%m')
            except: pass
        try: return pd.to_datetime(s_val).strftime('%Y%m')
        except: pass
        return s_val

    # Parse Metas Date (Robust check: mes_ano > mes_referencia)
    if 'mes_ano' in metas_df.columns:
        # Check if it needs formatting (if it's not already YYYYMM string)
        # We apply format_mes_referencia just to be safe
        metas_df['mes_ano'] = metas_df['mes_ano'].apply(format_mes_referencia)
    elif 'mes_referencia' in metas_df.columns:
        metas_df['mes_ano'] = metas_df['mes_referencia'].apply(format_mes_referencia)
    else:
        print("WARNING: Neither 'mes_ano' nor 'mes_referencia' found in Metas.")
        metas_df['mes_ano'] = ''

    # Clean 'meta' column to ensure valid floats
    def clean_float_br(val):
        if pd.isna(val) or str(val).strip() == '': return 0.0
        # If val is already numeric (from UNFORMATTED_VALUE), return text
        if isinstance(val, (int, float)): return float(val)
        
        # Fallback for text values
        val_str = str(val).strip()
        val_str = val_str.replace('R$', '').strip() # Basic clean
        
        # Aggressive Cleaning: Remove everything except digits, comma, dot, minus
        s_val = re.sub(r'[^\d,.-]', '', val_str)
        
        # Check for specific user complaints for debugging
        is_debug = '100,57' in val_str or '64173' in val_str or '17710' in val_str
        if is_debug:
             print(f"DEBUG_CONV_FALLBACK: Raw='{val_str}' -> Cleaned='{s_val}'")
        
        # Logic: Matches 1.000,00 (BR) or 1000.00 (US) or 1000 (Int)
        if ',' in s_val:
            s_val = s_val.replace('.', '').replace(',', '.')
        else:
            if s_val.count('.') > 1:
                s_val = s_val.replace('.', '')
            else:
                if re.search(r'\.\d{3}$', s_val):
                     s_val = s_val.replace('.', '')
            pass
            
        try:
            f = float(s_val)
            if is_debug: print(f"DEBUG_CONV_FALLBACK: Final={f}")
            return f
        except:
            return 0.0

    if 'meta' in metas_df.columns:
        metas_df['meta'] = metas_df['meta'].apply(clean_float_br)
    
    # Prepare Sales keys
    # 1. MES_ANO (Format YYYYMM)
    if 'MES_ANO' in sales_df.columns:
         sales_df['MES_ANO_STR'] = sales_df['MES_ANO'].apply(lambda x: str(int(float(x))) if pd.notnull(x) and str(x).strip() != '' else '')
         mask = (sales_df['MES_ANO_STR'] == '') | (sales_df['MES_ANO_STR'].isna())
         if mask.any() and 'EMISSAO' in sales_df.columns:
             sales_df.loc[mask, 'MES_ANO_STR'] = pd.to_datetime(sales_df.loc[mask, 'EMISSAO']).dt.strftime('%Y%m')
    else:
        if 'EMISSAO' in sales_df.columns:
             sales_df['MES_ANO_STR'] = pd.to_datetime(sales_df['EMISSAO']).dt.strftime('%Y%m')
        else:
             sales_df['MES_ANO_STR'] = ''

    # OVERRIDE MES_ANO for 2026 using EMISSAO_ORIGINAL (User Request 2026-01-31)
    if 'EMISSAO_ORIGINAL' in sales_df.columns:
        print("Checking EMISSAO_ORIGINAL for 2026 overrides...")
        # Convert to datetime safely
        dt_orig = pd.to_datetime(sales_df['EMISSAO_ORIGINAL'], errors='coerce')
        # Filter for Year 2026
        mask_2026 = dt_orig.dt.year == 2026
        count_2026 = mask_2026.sum()
        
        if count_2026 > 0:
            print(f"Found {count_2026} rows with EMISSAO_ORIGINAL in 2026. Recalculating MES_ANO...")
            # Format as YYYYMM (e.g., 202601)
            # Update MES_ANO_STR (used for matching)
            sales_df.loc[mask_2026, 'MES_ANO_STR'] = dt_orig.loc[mask_2026].dt.strftime('%Y%m')
            # Update MES_ANO (numeric column)
            # Update MES_ANO (numeric column) - Ensuring INT
            sales_df.loc[mask_2026, 'MES_ANO'] = dt_orig.loc[mask_2026].dt.strftime('%Y%m').astype(int)


    # GENERAL FIX for MES_ANO: Ensure no .0 remnants in the main column
    if 'MES_ANO' in sales_df.columns:
        # Convert to numeric, fillna with 0, convert to int, then back to string if needed or keep as int
        # For display/upload, it's safer to have clean integers or strings
        sales_df['MES_ANO'] = pd.to_numeric(sales_df['MES_ANO'], errors='coerce').fillna(0).astype(int)
        # If 0, replace with NaN or keep? User wants valid dates.
        # But let's at least guarantee no ".0" string representation
    
    # Define the Key Date for Targets (User Request 2026-01-31: Use mes_faturamento)
    # mes_faturamento comes from process_financeiro.
    if 'mes_faturamento' in sales_df.columns:
        print("Using 'mes_faturamento' as the Date Key for Targets.")
        sales_df['TARGET_DATE_KEY'] = sales_df['mes_faturamento'].fillna('')
        # If mes_faturamento is missing (e.g. order not billed yet), target will likely be 0.
        # This aligns with "preenchidos apenas nos casos onde tem vlr_financeiro".
    else:
        print("WARNING: 'mes_faturamento' not found. Falling back to 'MES_ANO_STR'.")
        sales_df['TARGET_DATE_KEY'] = sales_df['MES_ANO_STR']

    # BACKFILL MISSING REGIONAL (User Request 2026-01-31)

    # BACKFILL MISSING REGIONAL (User Request 2026-01-31)
    # Logic: Look for empty/NaN GERENCIA_REGIONAL. Lookup Vendor in Metas -> Get Regional.
    print("Checking for missing GERENCIA_REGIONAL...")
    
    # 1. Create Robust Lookup Map from Metas
    col_meta_vend = 'nome_minusculo' if 'nome_minusculo' in metas_df.columns else 'vendedor'
    col_meta_reg = 'GERENCIA_REGIONAL'
    
    if col_meta_vend in metas_df.columns and col_meta_reg in metas_df.columns:
        # Create temp norm for mapping
        metas_df['__vend_norm'] = metas_df[col_meta_vend].apply(normalize_text)
        # Create dict: VendorNorm -> Regional (First occurrence is fine, drop useless keys)
        # Drop duplicates to ensure unique mapping
        vendor_map = metas_df.dropna(subset=['__vend_norm', col_meta_reg]).set_index('__vend_norm')[col_meta_reg].to_dict()
        
        # 2. Iterate Strategies to Backfill
        if 'GERENCIA_REGIONAL' not in sales_df.columns:
             sales_df['GERENCIA_REGIONAL'] = None
             
        # Normalize missing check
        mask_missing = (sales_df['GERENCIA_REGIONAL'].isna()) | (sales_df['GERENCIA_REGIONAL'].astype(str).str.strip() == '') | (sales_df['GERENCIA_REGIONAL'].astype(str).str.lower() == 'nan')
        count_missing = mask_missing.sum()
        
        if count_missing > 0:
            print(f"Found {count_missing} rows with missing GERENCIA_REGIONAL. Attempting robust backfill...")
            
            # Strategies: Try different vendor columns
            # FANTASIA_VENDEDOR_x is best, then PAD, then Vendedor
            strategies = ['FANTASIA_VENDEDOR_x', 'FANTASIA_PAD', 'Vendedor', 'vendedor']
            
            for strat_col in strategies:
                if strat_col in sales_df.columns:
                    # Update mask for currently missing
                    current_missing = (sales_df['GERENCIA_REGIONAL'].isna()) | (sales_df['GERENCIA_REGIONAL'].astype(str).str.strip() == '') | (sales_df['GERENCIA_REGIONAL'].astype(str).str.lower() == 'nan')
                    if current_missing.sum() == 0: break
                    
                    print(f"  -> Trying backfill using '{strat_col}'...")
                    # Normalize source column
                    sales_vends_norm = sales_df.loc[current_missing, strat_col].apply(normalize_text)
                    
                    # Map
                    filled_reg = sales_vends_norm.map(vendor_map)
                    
                    # Apply where found
                    mask_found = filled_reg.notna()
                    count_fixed = mask_found.sum()
                    if count_fixed > 0:
                        print(f"     filled {count_fixed} rows.")
                        # Use index alignment to fill
                        sales_df.loc[current_missing & (sales_df.index.isin(filled_reg[mask_found].index)), 'GERENCIA_REGIONAL'] = filled_reg[mask_found]
            
            # Final check
            final_missing = (sales_df['GERENCIA_REGIONAL'].isna()) | (sales_df['GERENCIA_REGIONAL'].astype(str).str.strip() == '')
            print(f"Backfill Complete. Remaining missing: {final_missing.sum()}")

    else:
        print("WARNING: Could not build Regional Map (Columns missing in Metas).")


    # 2. GERENCIA_REGIONAL
    if 'GERENCIA_REGIONAL' not in sales_df.columns:
        print("WARNING: 'GERENCIA_REGIONAL' missing in Sales. Creating empty.")
        sales_df['GERENCIA_REGIONAL'] = ''
        
    sales_df['GERENCIA_REGIONAL_NORM'] = sales_df['GERENCIA_REGIONAL'].apply(normalize_text)
    metas_df['GERENCIA_REGIONAL_NORM'] = metas_df['GERENCIA_REGIONAL'].apply(normalize_text)
    # MERGE 1: Meta Regional
    # FIXED: Deduplicate target per month (keep only one row with value)
    print(f"Merging Meta Regional... Keys: GERENCIA_REGIONAL, TARGET_DATE_KEY")
    
    col_meta = next((c for c in metas_df.columns if c.lower() == 'meta'), None)
    if not col_meta:
         # Try to find something that looks like value
         col_meta = next((c for c in metas_df.columns if 'meta' in c.lower() or 'valor' in c.lower()), None)
         
    cols_regional = ['GERENCIA_REGIONAL_NORM', 'mes_ano', col_meta] if col_meta else []
    
    if cols_regional:
        # GroupBy SUM to get total for the Region
        metas_regional_agg = metas_df[cols_regional].groupby(['GERENCIA_REGIONAL_NORM', 'mes_ano'], as_index=False)[col_meta].sum()
        metas_regional_agg.rename(columns={col_meta: 'Meta regional'}, inplace=True)
        
        sales_df = pd.merge(
            sales_df,
            metas_regional_agg,
            left_on=['GERENCIA_REGIONAL_NORM', 'TARGET_DATE_KEY'], 
            right_on=['GERENCIA_REGIONAL_NORM', 'mes_ano'],
            how='left'
        )
        if 'Meta regional' in sales_df.columns:
            print(f"Meta Regional matches: {sales_df['Meta regional'].notna().sum()} rows.")
            
            # DEDUPLICATION LOGIC
            print("Deduplicating Meta Regional (Prioritizing rows with Value)...")
            
            # Helper for value presence
            if 'VLR_FINANCEIRO' in sales_df.columns:
                sales_df['_has_val_reg'] = sales_df['VLR_FINANCEIRO'].fillna(0).abs() > 0
            else:
                sales_df['_has_val_reg'] = False

            # Sort: Region, Date, HasValue (True first)
            sales_df.sort_values(by=['GERENCIA_REGIONAL_NORM', 'TARGET_DATE_KEY', '_has_val_reg'], ascending=[True, True, False], inplace=True)
            
            # Identify duplicates on Scope (Region + Date)
            # Keep first (which has value if available)
            mask_dupes_reg = sales_df.duplicated(subset=['GERENCIA_REGIONAL_NORM', 'TARGET_DATE_KEY'], keep='first')
            
            count_dupes_reg = mask_dupes_reg.sum()
            if count_dupes_reg > 0:
                print(f"Zeroing {count_dupes_reg} duplicate Meta Regional entries.")
                sales_df.loc[mask_dupes_reg, 'Meta regional'] = 0
            
            sales_df.drop(columns=['_has_val_reg'], inplace=True)
        else:
            print("CRITICAL: 'Meta regional' column missing after merge.")
            sales_df['Meta regional'] = 0.0
    else:
        print("CRITICAL: Could not define columns for Meta Regional merge.")
        sales_df['Meta regional'] = 0.0


    # MERGE 2: Meta Vendedor
    # Keys: Sales(GERENCIA_REGIONAL, FANTASIA_PAD, TARGET_DATE_KEY) vs Metas(GERENCIA_REGIONAL, nome_minusculo, mes_ano)
    
    # REFINED MATCHING LOGIC (User Request 2026-01-31)
    # Sales: FANTASIA_PAD + MES_ANO_STR (derived from MES_ANO)
    # Metas: nome_minusculo + mes_ano (derived from mes_referencia)
    
    col_vend_key = 'FANTASIA_PAD'
    # Fallback to FANTASIA_VENDEDOR only if absolutely necessary, but User emphasized PAD.
    if col_vend_key not in sales_df.columns and 'FANTASIA_VENDEDOR' in sales_df.columns:
        col_vend_key = 'FANTASIA_VENDEDOR'
        
    print(f"Using '{col_vend_key}' for Vendor Key Normalization (Strict).")
    sales_df['Vendedor_KEY_NORM'] = sales_df[col_vend_key].apply(normalize_text)
    
    # Metas Key
    if 'nome_minusculo' in metas_df.columns:
        metas_df['Vendedor_KEY_NORM'] = metas_df['nome_minusculo'].apply(normalize_text)
    else:
        print("WARNING: 'nome_minusculo' not found in Metas. Using 'vendedor' column.")
        metas_df['Vendedor_KEY_NORM'] = metas_df['vendedor'].apply(normalize_text)

    # Use NOTA_FISCAL_EMISSAO for Date Match (User Request 2026-02-03)
    # Transform NOTA_FISCAL_EMISSAO to YYYYMM and use as TARGET_DATE_KEY
    if 'NOTA_FISCAL_EMISSAO' in sales_df.columns:
        print("Using 'NOTA_FISCAL_EMISSAO' for Vendor Target Date Key.")
        # Ensure it is datetime
        sales_df['__nf_date'] = pd.to_datetime(sales_df['NOTA_FISCAL_EMISSAO'], errors='coerce')
        # Format to YYYYMM
        sales_df['TARGET_DATE_KEY'] = sales_df['__nf_date'].dt.strftime('%Y%m')
        
        # Fallback if NF date missing? Use MES_ANO_STR as fallback
        mask_missing_nf = sales_df['TARGET_DATE_KEY'].isna() | (sales_df['TARGET_DATE_KEY'] == '')
        if mask_missing_nf.any():
            print(f"Warning: {mask_missing_nf.sum()} rows missing NOTA_FISCAL_EMISSAO. Fallback to MES_ANO_STR.")
            sales_df.loc[mask_missing_nf, 'TARGET_DATE_KEY'] = sales_df.loc[mask_missing_nf, 'MES_ANO_STR']
            
        sales_df.drop(columns=['__nf_date'], inplace=True, errors='ignore')
    else:
        print("WARNING: 'NOTA_FISCAL_EMISSAO' not found. Using 'MES_ANO_STR'.")
        sales_df['TARGET_DATE_KEY'] = sales_df['MES_ANO_STR']

    # For Vendor, we still want specific match, NO aggregation (as targets are per vendor)
    cols_vend = ['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'mes_ano', 'meta']
    metas_vend_dedup = metas_df[cols_vend].drop_duplicates(subset=['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'mes_ano'], keep='first').copy()
    metas_vend_dedup.rename(columns={'meta': 'Meta vendedor'}, inplace=True)
    
    print(f"Merging Meta Vendedor... Keys: GERENCIA_REGIONAL, FANTASIA_PAD (as nome_minusculo), TARGET_DATE_KEY")
    sales_df = pd.merge(
        sales_df,
        metas_vend_dedup,
        left_on=['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'TARGET_DATE_KEY'],
        right_on=['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'mes_ano'],
        how='left',
        suffixes=('', '_drop')
    )
    print(f"Meta Vendedor matches: {sales_df['Meta vendedor'].notna().sum()} rows.")

    # Deduplication Logic (User Request 2026-01-31)
    # Goal: Keep Meta Vendedor on ONE row per (Regional, Vendor, Month).
    # Condition: Prioritize the row that has VLR_FINANCEIRO > 0.
    
    print("Deduplicating Meta Vendedor (Prioritizing rows with Value)...")
    if 'VLR_FINANCEIRO' in sales_df.columns:
        sales_df['_has_val'] = sales_df['VLR_FINANCEIRO'].fillna(0).abs() > 0
    else:
        sales_df['_has_val'] = False

    # Sort keys: Scope + Has_Value (True=1 first)
    sort_cols = ['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'TARGET_DATE_KEY', '_has_val']
    sales_df.sort_values(by=sort_cols, ascending=[True, True, True, False], inplace=True)
    
    # Identify duplicates - Keep FIRST (which is the one with value due to sort)
    scope_cols = ['GERENCIA_REGIONAL_NORM', 'Vendedor_KEY_NORM', 'TARGET_DATE_KEY']
    mask_dupes = sales_df.duplicated(subset=scope_cols, keep='first')
    
    if 'Meta vendedor' in sales_df.columns:
        count_dupes = mask_dupes.sum()
        if count_dupes > 0:
            print(f"Zeroing {count_dupes} duplicate Meta Vendedor entries.")
            sales_df.loc[mask_dupes, 'Meta vendedor'] = 0
            
        mask_no_val_target = (sales_df['_has_val'] == False) & (sales_df['Meta vendedor'] != 0)
        count_cleaned = mask_no_val_target.sum()
        if count_cleaned > 0:
            print(f"Zeroing {count_cleaned} Meta Vendedor entries where VLR_FINANCEIRO is 0.")
            sales_df.loc[mask_no_val_target, 'Meta vendedor'] = 0

    sales_df.drop(columns=['_has_val'], inplace=True)

    # DEBUG: Check values
    if 'Meta vendedor' in sales_df.columns:
        valid_metas = sales_df.loc[sales_df['Meta vendedor'].notna() & (sales_df['Meta vendedor'] > 0), 'Meta vendedor']
        if not valid_metas.empty:
            print("Stats Meta Vendedor:")
            print(valid_metas.describe())
            
    # Clean up temp cols
    cols_to_drop = [c for c in sales_df.columns if c.endswith('_drop') or c.endswith('_NORM') or c in ['Vendedor_KEY_NORM']]
    sales_df.drop(columns=[c for c in cols_to_drop if c in sales_df.columns], inplace=True)
    
    # Zeroing Targets on Expanded Rows
    if 'Meta regional' in sales_df.columns:
         sales_df.loc[sales_df.get('IS_EXPANDED', False), 'Meta regional'] = 0
    if 'Meta vendedor' in sales_df.columns:
         sales_df.loc[sales_df.get('IS_EXPANDED', False), 'Meta vendedor'] = 0
         
    return sales_df


def process_meta_familia(sales_df, meta_familia_df):
    print("Processing Meta Família (4-Key Merge)...")
    if meta_familia_df.empty:
        print("Meta Família DF is empty. Skipping.")
        return sales_df

    # Clean currency
    def clean_curr(x):
        if pd.isna(x) or str(x).strip() == '': return 0.0
        if isinstance(x, (int, float)): return float(x)
        s_val = str(x).strip().replace('R$', '').strip()
        if ',' in s_val:
            s_val = s_val.replace('.', '').replace(',', '.')
        else:
            if s_val.count('.') > 1:
                s_val = s_val.replace('.', '')
            else:
                if re.search(r'\.\d{3}$', s_val):
                     s_val = s_val.replace('.', '')
        return pd.to_numeric(s_val, errors='coerce')
        
    if 'meta_familia' in meta_familia_df.columns:
         meta_familia_df['meta_familia'] = meta_familia_df['meta_familia'].apply(clean_curr)
    
    # Date Logic
    def format_mes_meta(val):
        if pd.isna(val) or val == '': return None
        if isinstance(val, (datetime.datetime, datetime.date)):
            return val.strftime('%Y%m')
        if isinstance(val, (int, float)):
             try: return pd.to_datetime(val, unit='D', origin='1899-12-30').strftime('%Y%m')
             except: pass
        s_val = str(val)
        for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%Y/%m/%d', '%d-%m-%Y']:
            try: return pd.to_datetime(s_val, format=fmt).strftime('%Y%m')
            except: pass
        try: return pd.to_datetime(s_val).strftime('%Y%m')
        except: pass
        return s_val

    if 'mes_referencia' in meta_familia_df.columns:
        meta_familia_df['mes_ano'] = meta_familia_df['mes_referencia'].apply(format_mes_meta)
    else:
        print("CRITICAL: 'mes_referencia' missing in Meta Família. Cannot generate keys.")
        return sales_df

    # Normalize Keys
    # Sales (already has NORM cols from previous steps, but ensure existence)
    if 'FAMILIA_NORM' not in sales_df.columns:
         sales_df['FAMILIA_NORM'] = sales_df['FAMILIA'].apply(normalize_text)
    if 'GERENCIA_REGIONAL_NORM' not in sales_df.columns:
        sales_df['GERENCIA_REGIONAL_NORM'] = sales_df['GERENCIA_REGIONAL'].apply(normalize_text)
    
    # Ensure Sales Vendor NORM
    if 'VENDEDOR_NORM' not in sales_df.columns:
        col_vend_sales = 'FANTASIA_VENDEDOR_x' if 'FANTASIA_VENDEDOR_x' in sales_df.columns else 'FANTASIA_VENDEDOR'
        if col_vend_sales in sales_df.columns:
            sales_df['VENDEDOR_NORM'] = sales_df[col_vend_sales].apply(normalize_text)
        else:
            sales_df['VENDEDOR_NORM'] = ''
            
    # Meta Família Keys
    # Dynamic column detection
    col_familia = next((c for c in meta_familia_df.columns if c.lower() == 'familia'), None)
    if col_familia:
        meta_familia_df['Familia_NORM'] = meta_familia_df[col_familia].apply(normalize_text)
    else:
        meta_familia_df['Familia_NORM'] = ''

    col_regional = next((c for c in meta_familia_df.columns if c.lower() in ['gerencia_regional', 'regional']), None)
    if col_regional:
         meta_familia_df['GERENCIA_REGIONAL_NORM'] = meta_familia_df[col_regional].apply(normalize_text)
    else:
         meta_familia_df['GERENCIA_REGIONAL_NORM'] = ''

    col_vendedor = next((c for c in meta_familia_df.columns if c.lower() in ['vendedor', 'consultor']), None)
    if col_vendedor:
        meta_familia_df['Vendedor_NORM'] = meta_familia_df[col_vendedor].apply(normalize_text)
    else:
        meta_familia_df['Vendedor_NORM'] = ''

    # Deduplicate on 4 Keys
    cols_merge_keys = ['GERENCIA_REGIONAL_NORM', 'mes_ano', 'Familia_NORM', 'Vendedor_NORM']
    cols_target = cols_merge_keys + ['meta_familia']
    
    # Check for target column existence
    target_col_source = next((c for c in meta_familia_df.columns if c.lower() in ['meta_familia', 'meta familia', 'meta']), None)
    if not target_col_source:
         print("CRITICAL: Target column 'meta_familia' not found in source.")
         return sales_df
         
    # Rename specifically to 'meta_familia' for consistency if needed, but keeping original name for extraction
    
    meta_dedup = meta_familia_df.drop_duplicates(subset=cols_merge_keys, keep='first')
    
    # Rename target col to 'meta familia' for merge
    meta_dedup = meta_dedup.rename(columns={target_col_source: 'meta familia'})
    cols_final_merge = cols_merge_keys + ['meta familia']
    meta_dedup = meta_dedup[cols_final_merge]

    print(f"Meta Família keys: {len(meta_dedup)}")

    merged_df = pd.merge(
        sales_df,
        meta_dedup,
        left_on=['GERENCIA_REGIONAL_NORM', 'MES_ANO_STR', 'FAMILIA_NORM', 'VENDEDOR_NORM'], 
        right_on=['GERENCIA_REGIONAL_NORM', 'mes_ano', 'Familia_NORM', 'Vendedor_NORM'],
        how='left'
    )
    
    cols_drop = ['Familia_NORM', 'mes_ano', 'Vendedor_NORM'] # Drop right-side keys that might duplicate
    merged_df.drop(columns=[c for c in cols_drop if c in merged_df.columns], inplace=True)
    
    # Zeroing on Expanded Rows
    if 'meta familia' in merged_df.columns:
         merged_df.loc[merged_df.get('IS_EXPANDED', False), 'meta familia'] = 0
         
    return merged_df

def process_prophet(sales_df, prophet_df):
    print("Processing Prophet (Forecast)...")
    
    # 1. Clean currency/value helper
    def clean_curr(x):
        if pd.isna(x) or str(x).strip() == '': return 0.0
        if isinstance(x, (int, float)): return float(x)
        s_val = str(x).strip().replace('R$', '').strip()
        if ',' in s_val:
            s_val = s_val.replace('.', '').replace(',', '.')
        else:
            if s_val.count('.') > 1:
                s_val = s_val.replace('.', '')
            else:
                if re.search(r'\.\d{3}$', s_val):
                     s_val = s_val.replace('.', '')
        return pd.to_numeric(s_val, errors='coerce')

    # 2. Select Value Column (Priority: Global_Prophet_Total > valor > Manual_Forecast)
    possible_cols = ['Global_Prophet_Total', 'valor', 'Manual_Forecast']
    target_col = None
    for col in possible_cols:
        if col in prophet_df.columns:
            target_col = col
            print(f"Using '{target_col}' for Prophet values.")
            break
            
    if not target_col:
        print(f"Warning: None of {possible_cols} found in Prophet. Checking columns: {prophet_df.columns}")
        target_col = 'Manual_Forecast' # Fallback
    
    if target_col in prophet_df.columns:
         prophet_df[target_col] = prophet_df[target_col].apply(clean_curr)
    
    # 3. Filter for 'tipo' == 'prophet'
    if 'tipo' in prophet_df.columns:
        prophet_df = prophet_df[prophet_df['tipo'].astype(str).str.contains('prophet', case=False, na=False)].copy()
        print(f"Filtered Prophet rows: {len(prophet_df)}")
    else:
        print("Warning: 'tipo' column not found for filtering Prophet.")

    # 4. Prepare Join Keys (Family, Regional, Date)
    
    # A. Date Key (mes_ano) from 'concat'
    # User instruction: "pegar a concat e transformar em mesano tipo 202601"
    # DEBUG FINDING: concat contains Excel Serial Dates (e.g., 46023)
    def parse_concat_date(val):
        if pd.isna(val) or val == '': return None
        # Check if it looks like an Excel serial date (integer approx > 40000)
        try:
             # If string, try conversion
             f_val = float(val)
             if f_val > 30000 and f_val < 60000: # Rough bounds for recent years
                  return pd.to_datetime(f_val, unit='D', origin='1899-12-30').strftime('%Y%m')
        except:
             pass
             
        # Fallback to string slicing if not a serial date
        s_val = str(val).replace('-', '').replace('/', '')
        return s_val[:6]

    if 'concat' in prophet_df.columns:
        prophet_df['mes_ano'] = prophet_df['concat'].apply(parse_concat_date)
    else:
        # Fallback if no concat, try existing logic
        if 'Ano' in prophet_df.columns and 'Mes' in prophet_df.columns:
             prophet_df['mes_ano'] = prophet_df.apply(lambda x: f"{int(x['Ano'])}{int(x['Mes']):02d}", axis=1)
        elif 'mes_referencia' in prophet_df.columns:
             prophet_df['mes_ano'] = pd.to_datetime(prophet_df['mes_referencia'], errors='coerce').dt.strftime('%Y%m')
        else:
             print("Warning: Could not Create mes_ano Key for Prophet.")
             prophet_df['mes_ano'] = '000000'

    # B. Normalize Family and Regional
    sales_df['FAMILIA_NORM'] = sales_df['FAMILIA'].apply(normalize_text)
    
    if 'GERENCIA_REGIONAL' in sales_df.columns:
        sales_df['REGIONAL_NORM'] = sales_df['GERENCIA_REGIONAL'].apply(normalize_text)
    else:
        sales_df['REGIONAL_NORM'] = ''

    # Prophet Normalization
    col_fam_p = next((c for c in prophet_df.columns if c.lower() == 'familia'), None)
    prophet_df['Familia_NORM'] = prophet_df[col_fam_p].apply(normalize_text) if col_fam_p else ''
    
    col_reg_p = next((c for c in prophet_df.columns if c.lower() in ['regional', 'gerencia_regional']), None)
    prophet_df['Regional_NORM'] = prophet_df[col_reg_p].apply(normalize_text) if col_reg_p else ''

    # C. Ensure Sales has MES_ANO_STR
    if 'MES_ANO_STR' not in sales_df.columns:
         if 'MES_ANO' in sales_df.columns:
            sales_df['MES_ANO_STR'] = sales_df['MES_ANO'].apply(lambda x: str(x).replace('.0', '') if pd.notnull(x) else x)
         elif 'EMISSAO' in sales_df.columns:
             sales_df['MES_ANO_STR'] = pd.to_datetime(sales_df['EMISSAO']).dt.strftime('%Y%m')

    # 5. Deduplicate Prophet Data
    join_keys_prophet = ['Familia_NORM', 'Regional_NORM', 'mes_ano']
    # Check if we have all keys
    if prophet_df['Familia_NORM'].eq('').all(): print("Warning: Prophet Family key empty.")
    if prophet_df['Regional_NORM'].eq('').all(): print("Warning: Prophet Regional key empty.")
    
    cols_needed = join_keys_prophet + [target_col]
    
    # Drop duplicates
    prophet_dedup = prophet_df[cols_needed].drop_duplicates(subset=join_keys_prophet, keep='first')
    print(f"Prophet Unique Rows (Family+Regional+Date): {len(prophet_dedup)}")

    # 6. Merge
    merged_df = pd.merge(
        sales_df,
        prophet_dedup,
        left_on=['FAMILIA_NORM', 'REGIONAL_NORM', 'MES_ANO_STR'], 
        right_on=['Familia_NORM', 'Regional_NORM', 'mes_ano'],
        how='left'
    )
    
    # 7. Rename and Cleanup
    merged_df.rename(columns={target_col: 'prophet'}, inplace=True)
    
    # Drop temp keys
    to_drop = ['Familia_NORM', 'Regional_NORM', 'mes_ano']
    merged_df.drop(columns=[c for c in to_drop if c in merged_df.columns], inplace=True)
    
    # Zeroing on Expanded Rows (Preliminary check)
    if 'prophet' in merged_df.columns:
         merged_df.loc[merged_df.get('IS_EXPANDED', False), 'prophet'] = 0
         # Fill NaNs with 0 here immediately or wait for final cleanup? 
         # Let's fill 0 now for safety in this column
         merged_df['prophet'] = merged_df['prophet'].fillna(0)
         
    return merged_df

import pandas_gbq

def finalize_and_upload(df):
    print("Finalizing data and uploading to BigQuery...")
    
    # 1. Zero out columns for expanded rows
    cols_to_zero = [
        'QUANTIDADE', 'VALOR_UNITARIO', 'TOTAL_ITEM', 
        'QUANTIDADE_UTILIZADA', 'ALIQUOTA', 'COMISSAO', 
        'QUANTIDADE_UTILIZADANANOTAFISCAL', 'meta_positivacao', 
        'Valor', 'Meta regional', 'Meta vendedor', 'meta familia', 
        'prophet'
    ]
    
    # Identify expanded rows
    if 'IS_EXPANDED' in df.columns:
        # Robust TRUE check
        mask_expanded = df['IS_EXPANDED'].astype(str).str.upper().isin(['TRUE', 'VERDADEIRO', '1'])
        count_expanded = mask_expanded.sum()
        print(f"Found {count_expanded} expanded rows to zero out.")
        
        for col in cols_to_zero:
            # Case-insensitive column finding
            exact_col = next((c for c in df.columns if c.lower() == col.lower()), None)
            if exact_col:
                df.loc[mask_expanded, exact_col] = 0
    else:
        print("Warning: IS_EXPANDED column not found.")

    # 2. Drop columns
    cols_to_drop = [
        'Classificacao', 'Status_Cadastral', 'Rede', 'Vendedor', 'Promotor', 
        'Atendente', 'Segmento', 'Zona', 'CEP', 'Municipio', 'Populacao', 
        'Bairro', 'Endereco', 'Telefone', 'Contato', 'Email', 'Frequencia'
    ]
    
    cols_to_drop_actual = []
    for target in cols_to_drop:
        found = next((c for c in df.columns if c.lower() == target.lower()), None)
        if found:
            cols_to_drop_actual.append(found)
            
    if cols_to_drop_actual:
        print(f"Dropping {len(cols_to_drop_actual)} columns.")
        df.drop(columns=cols_to_drop_actual, inplace=True)

    # 3. Formatting (Strict Types)
    
    # Sanitize Column Names for BigQuery (No spaces)
    print("Sanitizing column names for BigQuery...")
    df.columns = [c.replace(' ', '_').replace('.', '_') for c in df.columns]
    
    # Update cols_to_zero list to match new names
    cols_to_zero_sanitized = [c.replace(' ', '_').replace('.', '_') for c in cols_to_zero]
    
    # Numeric Columns: Ensure float and Fill NaNs with 0
    # Also include VLR_FINANCEIRO
    numeric_cols = cols_to_zero_sanitized + ['VLR_FINANCEIRO', 'ICMSST', 'faturamento_semst', 'Meta_regional', 'Meta_vendedor', 'meta_familia', 'prophet']
    for col in numeric_cols:
         # Find case-insensitive match
         exact_col = next((c for c in df.columns if c.lower() == col.lower()), None)
         if exact_col:
             # Force numeric, coerce errors to NaN, then fill header with 0, then round to 2 decimals
             df[exact_col] = pd.to_numeric(df[exact_col], errors='coerce').fillna(0.0).round(2)

    # Date Columns: Ensure datetime
    # User said EMISSAO_faturamento was correct. Use it as model if others fail?
    # Actually just ensure strict datetime type.
    date_cols = ['EMISSAO', 'EMISSAO_faturamento']
    for col in date_cols:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            
    # 4. Upload to BigQuery
    table_id = "projeto-rpa-empresa-2023.VENDAS.Metas_por_faturamento"
    project_id = "projeto-rpa-empresa-2023"
    
    print(f"Uploading {len(df)} rows to BigQuery table: {table_id}...")
    
    try:
        if not os.path.exists(CREDENTIALS_PATH):
             raise FileNotFoundError(f"Credentials not found at {CREDENTIALS_PATH}")

        creds = service_account.Credentials.from_service_account_file(
            CREDENTIALS_PATH,
            scopes=[
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/spreadsheets"
            ]
        )
        
        pandas_gbq.to_gbq(
            df, 
            table_id, 
            project_id=project_id, 
            if_exists='replace',
            credentials=creds
        )
        print("Upload successful!")
    except Exception as e:
        print(f"Error uploading to BigQuery: {e}")
        # Save to Excel as backup
        backup_path = os.path.join(FOLDER_PATH, "backup_upload_failed.xlsx")
        df.to_excel(backup_path, index=False)
        print(f"Saved backup to {backup_path}")



def main():
    config = load_config()
    print("Downloading data from sources (Cache disabled)...")
    sales, logistics, metas_regional, metas_item, rel_logistica, meta_familia = download_data(config)
            
    sales = process_financeiro(sales, logistics, rel_logistica)
    
    # FINAL ADJUSTMENT: E-COMMERCE NERUS (Moved to Fix Execution Order)
    # Ensure VLR_FINANCEIRO is populated BEFORE process_targets runs.
    print("Applying final adjustment for 'ecommercenerus' (Early Execution)...")

    # 1. Identify valid Nerus rows using any available Vendor column
    # Priority: FANTASIA_VENDEDOR_x > FANTASIA_PAD > 'vendedor'
    nerus_col = None
    for cand in ['FANTASIA_VENDEDOR_x', 'FANTASIA_PAD', 'vendedor', 'Vendedor']:
        if cand in sales.columns:
            nerus_col = cand
            break
            
    if nerus_col:
        # Check for "NERUS" (Robust check)
        mask_nerus = sales[nerus_col].apply(normalize_text).str.contains('NERUS|DIRETOECOMMERCE')
        count_nerus = mask_nerus.sum()
        
        if count_nerus > 0:
            print(f"Applying Special Logic for {count_nerus} Nerus rows (found in {nerus_col})...")
            
            # 2. Overwrite VLR_FINANCEIRO with TOTAL_ITEM
            total_item_col = next((c for c in sales.columns if c.lower() == 'total_item'), None)
            vlr_fin_col = next((c for c in sales.columns if c.lower() == 'vlr_financeiro'), None)
            
            if total_item_col and vlr_fin_col:
                print("  -> Overwriting VLR_FINANCEIRO with TOTAL_ITEM for Nerus.")
                sales.loc[mask_nerus, total_item_col] = pd.to_numeric(sales.loc[mask_nerus, total_item_col], errors='coerce').fillna(0)
                sales.loc[mask_nerus, vlr_fin_col] = sales.loc[mask_nerus, total_item_col]
                
                # Request: Set EMISSAO_faturamento = EMISSAO for ecommercenerus
                if 'EMISSAO' in sales.columns:
                    print(f"  -> Syncing EMISSAO_faturamento with EMISSAO for {count_nerus} rows.")
                    sales.loc[mask_nerus, 'EMISSAO_faturamento'] = sales.loc[mask_nerus, 'EMISSAO']
            else:
                print("  -> WARNING: TOTAL_ITEM or VLR_FINANCEIRO column missing. Skipping overwrite.")

            # 3. Recalculate Faturamento Sem ST using NEW VLR_FINANCEIRO
            icmsn_col = next((c for c in sales.columns if c.lower() == 'icmsst'), None)
            fat_sem_col = next((c for c in sales.columns if c.lower() == 'faturamento_semst'), None)
            
            if icmsn_col and vlr_fin_col:
                 sales.loc[mask_nerus, icmsn_col] = pd.to_numeric(sales.loc[mask_nerus, icmsn_col], errors='coerce').fillna(0)
                 if not fat_sem_col:
                      sales['faturamento_semst'] = 0.0
                      fat_sem_col = 'faturamento_semst'
                 print("  -> Recalculating faturamento_semst for Nerus.")
                 sales.loc[mask_nerus, fat_sem_col] = sales.loc[mask_nerus, vlr_fin_col] - sales.loc[mask_nerus, icmsn_col]
    else:
        print("WARNING: Could not identify Nerus rows (No Vendor column found).")

    # metas_regional corresponds to "Metas por regional" (process_targets)
    sales = process_targets(sales, metas_regional)
    
    # NEW: Merge Meta Família (4-Key Logic)
    sales = process_meta_familia(sales, meta_familia)

    # NEW: Merge Prophet (Forecast/Item - 2-Key Logic)
    # metas_item now corresponds to "Prophet" source
    sales = process_prophet(sales, metas_item)
    


    # EXCEL SAVE REMOVED (User Request 2026-01-31)
    # print(f"Saving to {OUTPUT_FILE}...")
    # output_path = os.path.join(FOLDER_PATH, OUTPUT_FILE)
    # try:
    #     sales.to_excel(output_path, index=False)
    # except PermissionError:
    #     print(f"PERMISSION ERROR: Could not save to {OUTPUT_FILE}. It might be open.")
    #     new_output = f"vendashistoricodois_processed_{datetime.datetime.now().strftime('%H%M%S')}.xlsx"
    #     print(f"Saving to fallback file: {new_output}")
    #     output_path = os.path.join(FOLDER_PATH, new_output)
    #     sales.to_excel(output_path, index=False)
    
    # Finalize and Upload (User Request)
    finalize_and_upload(sales)
    
    print("Processing complete.")

if __name__ == "__main__":
    main()
