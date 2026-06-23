"""
Teste de validação Importação v2.

Compara dois métodos de coleta (corrido vs. vendas-only) e duas fórmulas
de safety stock (ADS×63 atual vs. clássica Z×σ×√LT), sem modificar produção.

Uso:
    cd backend
    python _test_importacao_v2_validacao.py [--meses 4] [--modo corrido|vendas|ambos] [--lt 90]
"""
import os, sys, json, math, argparse
from datetime import date
from calendar import monthrange
from dateutil.relativedelta import relativedelta

import pandas as pd
import numpy as np

# ---- Setup BigQuery client (reaproveita credenciais do projeto) ----
from google.cloud import bigquery
from google.oauth2 import service_account

from core.config import IMPORTED_ITEM_CODES, PROJECT_ID, CREDENTIALS_PATH

def get_client():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if creds_json:
        info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(info)
        return bigquery.Client(project=PROJECT_ID, credentials=creds)
    path = CREDENTIALS_PATH or os.path.join(os.path.dirname(__file__), 'projeto-rpa-blackd-2023-16b15891f73c.json')
    creds = service_account.Credentials.from_service_account_file(path)
    return bigquery.Client(project=PROJECT_ID, credentials=creds)


# ---- Z para 90% nível de serviço (constante) ----
Z_90 = 1.2816


def fetch_vendas_mensais(client, codigos, meses_lookback=36):
    cods = ",".join(f"'{c}'" for c in codigos)
    q = f"""
        SELECT
          TRIM(CODIGO_PRODUTO) AS COD,
          FORMAT_DATE('%Y-%m', SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(EMISSAO,1,10))) AS MES,
          SUM(SAFE_CAST(QUANTIDADE AS FLOAT64)) AS QTD
        FROM `projeto-rpa-blackd-2023.VENDAS.VendasHistoricasDois`
        WHERE SAFE_CAST(SUBSTR(EMISSAO,1,10) AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL {meses_lookback} MONTH)
          AND DESC_TIPODOCUMENTO NOT IN ('BONIFICACAO','SAC','MOSTRUARIO','DISPLAY','CAMPANHAS','TROCA')
          AND EMPRESA = 'STAR_'
          AND TRIM(CODIGO_PRODUTO) IN ({cods})
        GROUP BY 1, 2
    """
    df = client.query(q).to_dataframe(create_bqstorage_client=False)
    return df


def fetch_estoque(client, codigos):
    cods = ",".join(f"'{c}'" for c in codigos)
    q = f"""
        SELECT TRIM(codigo_do_item) AS COD,
               SUM(SAFE_CAST(REPLACE(CAST(quantidade AS STRING), ',', '.') AS FLOAT64)) AS DISPONIVEL
        FROM `projeto-rpa-blackd-2023.VENDAS.View_SaldoFisicoPorItem`
        WHERE codigo_do_local_estoque_ LIKE '13%'
          AND TRIM(codigo_do_item) IN ({cods})
        GROUP BY 1
    """
    return client.query(q).to_dataframe(create_bqstorage_client=False)


def janela_corrido(hoje, n_meses):
    """Lista de tuplas (YYYY-MM, dias_no_mes) — N meses calendário até o mês passado."""
    meses = []
    for k in range(1, n_meses + 1):
        d = (hoje.replace(day=1) - relativedelta(months=k))
        meses.append((d.strftime('%Y-%m'), monthrange(d.year, d.month)[1]))
    return list(reversed(meses))


def janela_vendas(hoje, n_meses, vendas_por_mes, limite_meses=36):
    """Varre retroativamente, conta só meses com QTD > 0. Retorna meses coletados."""
    cursor = hoje.replace(day=1) - relativedelta(months=1)
    limite = hoje.replace(day=1) - relativedelta(months=limite_meses)
    coletados = []
    while len(coletados) < n_meses and cursor >= limite:
        mes = cursor.strftime('%Y-%m')
        v = vendas_por_mes.get(mes, 0)
        if v > 0:
            coletados.append((mes, monthrange(cursor.year, cursor.month)[1], v))
        cursor -= relativedelta(months=1)
    return list(reversed(coletados))


def calc_metricas(vendas_lista, lead_time_dias):
    """vendas_lista: [(mes, dias, qtd), ...] ou [(mes, dias)] + lookup. Retorna dict."""
    if not vendas_lista:
        return None
    qtds = [v for (_, _, v) in vendas_lista] if len(vendas_lista[0]) == 3 else []
    dias = sum(d for (_, d, *_) in vendas_lista)
    total = sum(qtds)
    n = len(qtds)
    ads = total / dias if dias else 0
    # STDEV.S amostral (n-1)
    if n >= 2:
        media = total / n
        sigma = math.sqrt(sum((x - media) ** 2 for x in qtds) / (n - 1))
    else:
        sigma = 0
    # Converter sigma mensal para diário (S-01 da validação)
    dias_medio_mes = dias / n if n else 30
    sigma_diario = sigma / math.sqrt(dias_medio_mes) if dias_medio_mes > 0 else 0
    safety_stock_classico = math.ceil(Z_90 * sigma_diario * math.sqrt(lead_time_dias)) if sigma_diario > 0 else 0
    safety_stock_atual = math.ceil(ads * 63)  # método atual do código (linha 692)
    ponto_reposicao = math.ceil(lead_time_dias * ads + safety_stock_classico)
    return {
        'meses_efetivos': n,
        'dias_periodo': dias,
        'total_vendas': total,
        'ADS': round(ads, 4),
        'sigma_mensal': round(sigma, 2),
        'sigma_diario': round(sigma_diario, 4),
        'SS_atual_x63': safety_stock_atual,
        'SS_classico_Zsig√LT': safety_stock_classico,
        'Ponto_Reposicao': ponto_reposicao,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--meses', type=int, default=4)
    ap.add_argument('--modo', choices=['corrido', 'vendas', 'ambos'], default='ambos')
    ap.add_argument('--lt', type=int, default=90, help='Lead time em dias (default 90)')
    args = ap.parse_args()

    hoje = date.today()
    print(f"\n=== Validação Importação v2 — {hoje} ===")
    print(f"SKUs: {len(IMPORTED_ITEM_CODES)} | meses={args.meses} | modo={args.modo} | LT={args.lt}d\n")

    client = get_client()
    df_vendas = fetch_vendas_mensais(client, IMPORTED_ITEM_CODES, meses_lookback=36)
    df_estoque = fetch_estoque(client, IMPORTED_ITEM_CODES)
    estoque_dict = dict(zip(df_estoque['COD'], df_estoque['DISPONIVEL']))

    # Pivot: vendas[cod][mes] = qtd
    vendas_por_cod = {}
    for _, r in df_vendas.iterrows():
        vendas_por_cod.setdefault(r['COD'], {})[r['MES']] = float(r['QTD'])

    rows = []
    for cod in IMPORTED_ITEM_CODES:
        vmap = vendas_por_cod.get(cod, {})

        if args.modo in ('corrido', 'ambos'):
            jc = janela_corrido(hoje, args.meses)
            vlist_c = [(m, d, vmap.get(m, 0)) for (m, d) in jc]
            mc = calc_metricas(vlist_c, args.lt)
            if mc:
                rows.append({'codigo': cod, 'modo': 'corrido',
                             'estoque': estoque_dict.get(cod, 0), **mc})

        if args.modo in ('vendas', 'ambos'):
            jv = janela_vendas(hoje, args.meses, vmap, limite_meses=36)
            mv = calc_metricas(jv, args.lt)
            if mv:
                aviso = '' if mv['meses_efetivos'] >= args.meses else f"⚠️ apenas {mv['meses_efetivos']} meses c/ venda em 36m"
                rows.append({'codigo': cod, 'modo': 'vendas',
                             'estoque': estoque_dict.get(cod, 0), **mv, 'aviso': aviso})

    df = pd.DataFrame(rows)
    print(df.to_string(index=False))

    out = os.path.join(os.path.dirname(__file__), '_test_importacao_v2_validacao.csv')
    df.to_csv(out, index=False, encoding='utf-8-sig')
    print(f"\n📄 CSV salvo em: {out}")

    # Resumo dos bugs detectados
    print("\n=== Divergências (atual vs. clássico) ===")
    if 'modo' in df.columns:
        for cod, sub in df[df['modo'] == 'corrido'].groupby('codigo'):
            r = sub.iloc[0]
            dif = r['SS_classico_Zsig√LT'] - r['SS_atual_x63']
            pct = (dif / r['SS_atual_x63'] * 100) if r['SS_atual_x63'] else 0
            flag = '⚠️' if abs(pct) > 30 else '  '
            print(f"{flag} {cod}: SS_atual={r['SS_atual_x63']:>5} | SS_clássico={r['SS_classico_Zsig√LT']:>5} | dif={dif:+6} ({pct:+.0f}%)")


if __name__ == '__main__':
    main()
