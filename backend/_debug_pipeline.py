"""
Replica o pipeline completo de processamento do S&OP dashboard em Python,
usando as MESMAS queries do backend e a MESMA lógica do TSX.

Objetivo: descobrir POR QUE o "Faturado Real" do portal (14.299) diverge
do n8n (16.390) quando a query SQL bruta retorna 16.466.

Rodar (de backend/):  venv\\Scripts\\python.exe _debug_pipeline.py
"""
import os
import sys
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict

BR_TZ = timezone(timedelta(hours=-3))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.config import PROJECT_ID, IMPORTED_ITEM_CODES
# Importa exatamente as queries usadas pelo backend
from modulo.sop_dashboard import (
    _build_sql_vendas_hist_proxy,
    SQL_REALIZADO_ANO_ATUAL,
    SQL_ESTOQUE,
    SQL_OPS_ABERTO,
    SQL_FATURAMENTO_ANO_ATUAL,
    SQL_CARTEIRA,
    SQL_DETALHE_PEDIDOS,
    SQL_BASE_ABC,
    SQL_INDICADORES,
)


def get_bq_client():
    from google.cloud import bigquery
    from google.oauth2 import service_account
    candidates = [
        os.path.join(os.path.dirname(__file__), 'projeto-rpa-empresa-2023-16b15891f73c.json'),
    ]
    for path in candidates:
        if os.path.exists(path):
            credentials = service_account.Credentials.from_service_account_file(path)
            return bigquery.Client(credentials=credentials, project=PROJECT_ID)
    raise RuntimeError("Sem credencial BQ local")


def bq_query(client, sql):
    return [dict(row) for row in client.query(sql).result(timeout=180)]


def clean_key(v):
    if v is None:
        return ''
    return str(v).strip()


def clean_float(v):
    if v is None or v == '':
        return 0.0
    try:
        return float(v)
    except Exception:
        return 0.0


def main():
    today = datetime.now(BR_TZ)
    current_year = today.year
    current_month = today.month
    print(f"=== Debug Pipeline S&OP ===")
    print(f"Data: {today.isoformat()}")
    print(f"current_year={current_year}, current_month={current_month}")
    print()

    bq = get_bq_client()

    # 1. Executa SOMENTE as queries que afetam o Faturado Real
    print("Rodando queries BigQuery...")
    queries = {
        'faturamento': SQL_FATURAMENTO_ANO_ATUAL,
        'realizado':   SQL_REALIZADO_ANO_ATUAL,
        'estoque':     SQL_ESTOQUE,
        'carteira':    SQL_CARTEIRA,
        'ops_aberto':  SQL_OPS_ABERTO,
    }
    raw = {}
    for name, sql in queries.items():
        rows = bq_query(bq, sql)
        raw[name] = rows
        print(f"  {name:<12} -> {len(rows):>5} linhas")
    print()

    # 2. Monta map.fat (chave SKU_ANO_MES)
    map_fat = defaultdict(float)
    for i in raw['faturamento']:
        k = clean_key(i.get('Codigo'))
        m = i.get('Mes')
        a = i.get('Ano')
        if k and m and a:
            try:
                m = int(m); a = int(a)
            except Exception:
                continue
            map_fat[f"{k}_{a}_{m}"] += clean_float(i.get('Qtd_Faturada'))

    # 3. Universo de SKUs vindos de resultados (PULAMOS — sem Postgres local),
    #    estoque, carteira
    unique_skus = set()
    for i in raw['estoque']:
        k = clean_key(i.get('Codigo'))
        if k:
            unique_skus.add(k)
    for i in raw['carteira']:
        k = clean_key(i.get('Codigo'))
        if k:
            unique_skus.add(k)
    print(f"uniqueProductCodes (estoque ∪ carteira): {len(unique_skus)} SKUs")
    print("  (NOTA: SEM raw.resultados/forecast — só captura SKUs com estoque ou pedido aberto)")
    print()

    # 4. Estoque indexado por SKU
    map_est = {}
    for i in raw['estoque']:
        k = clean_key(i.get('Codigo'))
        if k:
            map_est[k] = {
                'fab': clean_float(i.get('Est_Fabrica')),
                'disp': clean_float(i.get('Est_Log_Disp')),
                'res': clean_float(i.get('Est_Log_Reserva')),
            }

    # 5. Blacklist — usa fallback IMPORTED_ITEM_CODES do config.py
    blacklist = set(str(c).strip() for c in IMPORTED_ITEM_CODES)
    print(f"Blacklist (fallback IMPORTED_ITEM_CODES): {len(blacklist)} SKUs")
    print(f"  {sorted(blacklist)}")
    print()

    # 6. Faturado Real do mês alvo (currentYear/currentMonth)
    print("=" * 70)
    print(f"FATURADO REAL — Mês alvo {current_month:02d}/{current_year}")
    print("=" * 70)

    # SKUs com faturamento no mês alvo
    fat_mes_alvo = {}
    for key, v in map_fat.items():
        parts = key.split('_')
        if len(parts) != 3:
            continue
        cod, a, m = parts[0], int(parts[1]), int(parts[2])
        if a == current_year and m == current_month:
            fat_mes_alvo[cod] = v

    total_bruto = sum(fat_mes_alvo.values())
    print(f"Bruto da query (todos os {len(fat_mes_alvo)} SKUs com fat>0 em mai/26): {total_bruto:,.2f}")

    # Etapa A: filtro uniqueProductCodes (precisa estar em estoque OU carteira)
    not_in_unique = {cod: v for cod, v in fat_mes_alvo.items() if cod not in unique_skus}
    in_unique = {cod: v for cod, v in fat_mes_alvo.items() if cod in unique_skus}
    print()
    print(f"  Etapa A — SKUs faturados que NÃO estão em uniqueProductCodes (sem estoque/carteira):")
    print(f"    {len(not_in_unique)} SKUs, soma = {sum(not_in_unique.values()):,.2f}")
    if not_in_unique:
        for cod, v in sorted(not_in_unique.items(), key=lambda x: -x[1])[:15]:
            print(f"      {cod}  {v:>10,.2f}")
    print(f"  Subtotal após etapa A: {sum(in_unique.values()):,.2f}")

    # Etapa B: blacklist
    in_bl = {cod: v for cod, v in in_unique.items() if cod in blacklist}
    pos_bl = {cod: v for cod, v in in_unique.items() if cod not in blacklist}
    print()
    print(f"  Etapa B — SKUs no blacklist:")
    print(f"    {len(in_bl)} SKUs, soma = {sum(in_bl.values()):,.2f}")
    if in_bl:
        for cod, v in sorted(in_bl.items(), key=lambda x: -x[1])[:15]:
            print(f"      {cod}  {v:>10,.2f}")
    print(f"  Subtotal após etapa B: {sum(pos_bl.values()):,.2f}")

    # Etapa C: hasActivity || hasStock — para o mês alvo, com fat>0 já tem activity, não filtra mais
    print()
    print(f"  Etapa C — hasActivity||hasStock (fat>0 já garante activity, nada removido aqui)")
    print()
    print("=" * 70)
    print(f"TOTAL FATURADO REAL (esperado no portal): {sum(pos_bl.values()):,.2f}")
    print(f"Portal mostra: 14.299")
    print(f"n8n mostra:    16.390")
    print(f"SQL bruta:     16.466 (16.466 = todos 174 SKUs do mês)")
    print("=" * 70)
    print()
    print("Conclusão:")
    print(f"  Se o número acima bate com 14.299 -> bug está no que somei aqui (blacklist/uniqueProductCodes)")
    print(f"  Se o número acima NÃO bate com 14.299 -> bug está fora desses (filtro de período TSX, etc.)")


if __name__ == '__main__':
    main()
