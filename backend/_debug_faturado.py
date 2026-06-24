"""
Debug isolado do KPI "Faturado Real" do dashboard S&OP.

Roda a mesma query usada pelo backend (SQL_FATURAMENTO_ANO_ATUAL),
soma Qtd_Faturada do mês corrente e imprime breakdown por SKU.

Use para comparar com o valor mostrado no n8n e identificar onde
está a divergência.

Como rodar (na pasta backend):
    venv\Scripts\python.exe _debug_faturado.py
    venv\Scripts\python.exe _debug_faturado.py --top 30
    venv\Scripts\python.exe _debug_faturado.py --mes 5 --ano 2026
"""
import os
import sys
import json
import argparse
from datetime import datetime, timezone, timedelta

BR_TZ = timezone(timedelta(hours=-3))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.config import PROJECT_ID, CREDENTIALS_PATH

SQL_FATURAMENTO = """
SELECT CODIGO_PRODUTO AS Codigo,
  EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) AS Ano,
  EXTRACT(MONTH FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) AS Mes,
  SUM(SAFE_CAST(QUANTIDADE_UTILIZADANANOTAFISCAL AS FLOAT64)) AS Qtd_Faturada
FROM `projeto-rpa-empresa-2023.VENDAS.Controle_de_logistica_carteira`
WHERE EXTRACT(YEAR FROM SAFE_CAST(EMISSAO_faturamento AS DATETIME)) = EXTRACT(YEAR FROM CURRENT_DATE())
  AND status_descricao IN ('5 - Liberado', '5 - Liberado e Inutilizado', '6 - Parcial')
  AND UPPER(COALESCE(RAZAO, '')) NOT LIKE '%EMPRESA PEDIDOS INTERNOS%'
  AND DESC_TIPODOCUMENTO NOT IN ('TROCA', 'SAC', 'DISPLAY', 'BONIFICACAO', 'CAMPANHAS', 'RAPEL', 'MOSTRUARIO', 'None', 'CONTRATOS')
  AND CODIGO_PRODUTO LIKE '104%'
GROUP BY 1, 2, 3
ORDER BY 2, 3, 1
"""


def get_bq_client():
    from google.cloud import bigquery
    from google.oauth2 import service_account
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if creds_json:
        info = json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(info)
        return bigquery.Client(credentials=credentials, project=PROJECT_ID)
    # Tenta CREDENTIALS_PATH e arquivos comuns
    candidates = [
        CREDENTIALS_PATH,
        os.path.join(os.path.dirname(__file__), 'projeto-rpa-empresa-2023-16b15891f73c.json'),
        os.path.join(os.path.dirname(__file__), 'cred.json'),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                credentials = service_account.Credentials.from_service_account_file(path)
                print(f"  (usando credencial: {path})")
                return bigquery.Client(credentials=credentials, project=PROJECT_ID)
            except Exception as e:
                print(f"  (credencial {path} invalida: {str(e)[:80]})")
                continue
    return bigquery.Client(project=PROJECT_ID)


def main():
    parser = argparse.ArgumentParser()
    today = datetime.now(BR_TZ)
    parser.add_argument('--mes', type=int, default=today.month, help='Mês alvo (default: mês atual)')
    parser.add_argument('--ano', type=int, default=today.year, help='Ano alvo (default: ano atual)')
    parser.add_argument('--top', type=int, default=20, help='Quantos SKUs listar no breakdown')
    args = parser.parse_args()

    print(f"=== DEBUG Faturado Real — Alvo: {args.mes:02d}/{args.ano} ===")
    print(f"Hora servidor: {datetime.now(BR_TZ).isoformat()}")
    print()

    bq = get_bq_client()
    print(f"Executando query... (project={PROJECT_ID})")
    rows = list(bq.query(SQL_FATURAMENTO).result(timeout=120))
    print(f"Linhas retornadas pela query: {len(rows)}")
    print()

    # Totais por mês/ano
    by_period = {}
    for r in rows:
        key = (int(r['Ano']), int(r['Mes']))
        by_period[key] = by_period.get(key, 0) + float(r['Qtd_Faturada'] or 0)

    print("Totais por período (Ano/Mês):")
    for (a, m), v in sorted(by_period.items()):
        marker = "  <-- ALVO" if (a, m) == (args.ano, args.mes) else ""
        print(f"  {a}/{m:02d}: {v:>15,.2f}{marker}")
    print()

    # Breakdown SKU do mês alvo
    alvo = [r for r in rows if int(r['Ano']) == args.ano and int(r['Mes']) == args.mes]
    total_alvo = sum(float(r['Qtd_Faturada'] or 0) for r in alvo)
    print(f"=== Mês {args.mes:02d}/{args.ano}: {total_alvo:,.2f} ===")
    print(f"SKUs distintos: {len(alvo)}")
    print()

    alvo_sorted = sorted(alvo, key=lambda r: float(r['Qtd_Faturada'] or 0), reverse=True)
    print(f"Top {args.top} SKUs por Qtd_Faturada:")
    print(f"  {'Codigo':<12}  {'Qtd_Faturada':>15}  {'% do total':>10}")
    acc = 0.0
    for i, r in enumerate(alvo_sorted[:args.top], 1):
        v = float(r['Qtd_Faturada'] or 0)
        acc += v
        pct = (v / total_alvo * 100) if total_alvo else 0
        print(f"  {r['Codigo']:<12}  {v:>15,.2f}  {pct:>9.2f}%")
    if len(alvo_sorted) > args.top:
        resto = total_alvo - acc
        print(f"  ... ({len(alvo_sorted) - args.top} demais SKUs)  {resto:>15,.2f}")

    print()
    print("=== Compare este valor com o card 'Faturado Real' do n8n ===")
    print(f"   Valor bruto da query (mês alvo): {total_alvo:,.2f}")
    print()

    # ============================================================
    # Aplicar blacklist (ItensImportados, gid=0) e mostrar impacto
    # ============================================================
    print("=" * 70)
    print("APLICANDO BLACKLIST (aba ItensImportados, gid=0)")
    print("=" * 70)
    blacklist_codes = set()
    try:
        import gspread
        from google.oauth2 import service_account
        scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly',
                  'https://www.googleapis.com/auth/drive.readonly']
        creds_path = None
        for path in [CREDENTIALS_PATH,
                     os.path.join(os.path.dirname(__file__), 'projeto-rpa-empresa-2023-16b15891f73c.json'),
                     os.path.join(os.path.dirname(__file__), 'cred.json')]:
            if path and os.path.exists(path):
                creds_path = path
                break
        if not creds_path:
            print("  (sem credencial para Google Sheets local — pulando)")
            return
        credentials = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key("1FKRHFyzPpiifBKoPTN5D9JSd66i0frvJ282E7TpZSMk")
        print(f"  Worksheets na planilha:")
        for i, w in enumerate(sh.worksheets()):
            print(f"    index={i}  gid={w.id}  title={w.title!r}")
        # Localiza ItensImportados pelo gid=0
        ws = None
        for w in sh.worksheets():
            if w.id == 0:
                ws = w
                break
        if ws is None:
            ws = sh.get_worksheet(0)
        print(f"  Lendo aba: title={ws.title!r}  gid={ws.id}")
        rows_bl = ws.get_all_records()
        cand_keys = ('COD_PRODUTO', 'Cod_Produto', 'CODIGO', 'Codigo', 'codigo_produto', 'CODIGO_PRODUTO')
        for r in rows_bl:
            for k in cand_keys:
                v = r.get(k)
                if v not in (None, ''):
                    blacklist_codes.add(str(v).strip())
                    break
        print(f"  Total SKUs no blacklist: {len(blacklist_codes)}")
    except Exception as e:
        print(f"  ERRO ao ler blacklist: {e}")
        return

    # Recalcula com blacklist aplicado
    sem_blacklist = [r for r in alvo if r['Codigo'] not in blacklist_codes]
    com_blacklist = [r for r in alvo if r['Codigo'] in blacklist_codes]
    total_pos = sum(float(r['Qtd_Faturada'] or 0) for r in sem_blacklist)
    total_excluido = sum(float(r['Qtd_Faturada'] or 0) for r in com_blacklist)

    print()
    print(f"  Faturado SEM blacklist:  {total_alvo:>12,.2f}")
    print(f"  Faturado EXCLUÍDO pela blacklist: {total_excluido:>12,.2f}  ({len(com_blacklist)} SKUs)")
    print(f"  Faturado COM blacklist (esperado no portal): {total_pos:>12,.2f}")
    print()

    if com_blacklist:
        print(f"  SKUs excluídos pela blacklist no mês {args.mes:02d}/{args.ano}:")
        com_blacklist_sorted = sorted(com_blacklist, key=lambda r: float(r['Qtd_Faturada'] or 0), reverse=True)
        for r in com_blacklist_sorted:
            print(f"    {r['Codigo']:<12}  {float(r['Qtd_Faturada'] or 0):>12,.2f}")

    print()
    print("=== Diagnóstico ===")
    print(f"  Portal mostra: ?")
    print(f"  Esperado (SQL - blacklist gid=0): {total_pos:,.2f}")
    print(f"  Se portal mostrar valor MENOR -> blacklist do backend está lendo OUTRA aba")
    print(f"  Se portal mostrar valor IGUAL a {total_pos:,.0f} -> o problema é só drift de tempo")


if __name__ == '__main__':
    main()
