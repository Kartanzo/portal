"""
Render do HTML interativo da Torre S&OP (mesmo formato do n8n).

Pipeline:
1. Carrega o payload bruto (mesma fonte do endpoint /sop-dashboard/data).
2. Constroi os 6 buckets esperados pelo template HTML:
     DB_MAIN, DB_DRILL, DB_AI, DB_AGING, DB_LATE, PERIODS
3. Calcula os escalares (GLOBAL_LATE_VOL, GLOBAL_BACKLOG_VOL, CURRENT_YEAR,
   CURRENT_MONTH, DATA_ATUAL_FORMATADA).
4. Substitui placeholders __X__ no template e devolve a string final.

FASE 1: skeleton com buckets VAZIOS — valida o pipeline ponta a ponta.
Fases 2.x portam cada bucket.
"""
from __future__ import annotations

import os
import re
import json
import base64
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

logger = logging.getLogger(__name__)

BR_TZ = timezone(timedelta(hours=-3))
_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), 'templates', 'sop_dashboard_template.html')


def _load_template() -> str:
    with open(_TEMPLATE_PATH, encoding='utf-8') as f:
        return f.read()


def _b64_json(obj: Any) -> str:
    """Serializa obj em JSON UTF-8 e devolve base64 (string ascii)."""
    raw = json.dumps(obj, ensure_ascii=False, default=str).encode('utf-8')
    return base64.b64encode(raw).decode('ascii')


# =============================================================================
# Builders dos buckets — FASE 1: stubs vazios
# Cada Fase 2.x preenche um destes.
# =============================================================================
def build_periods(payload: dict) -> list[dict]:
    """[{y, m, sort}] ordenado cronologicamente."""
    # TODO Fase 2.4: extrair do dataset (faturamento/realizado/resultados).
    return []


def build_db_main(payload: dict, periods: list[dict]) -> list[dict]:
    """Uma linha por (sku, periodo). Campos: y,m,sort,cod,fam,desc,cls,
    meta,venda,fat,prod,cart,res,dem_liq,ops,sug,est_fab,est_log,
    pct_svc,pct_prod,mesAno,st,st_desc,seq_ai."""
    # TODO Fase 2.4
    return []


def build_db_drill(payload: dict) -> dict[str, dict]:
    """{cod: {p:[{ped,cli,sal,entr}], o_list:[{op,emi,apt,plan,real,saldo}]}}."""
    # TODO Fase 2.5
    return {}


def build_db_ai(payload: dict) -> list[dict]:
    """[{seq, cod, desc, qtd, val_total, qtd_peds, lista_peds}]."""
    # TODO Fase 2.3
    return []


def build_db_aging(payload: dict) -> list[dict]:
    """[{label, total, count, ops:[{op,cod,emi,apt,plan,real,saldo}]}]."""
    # TODO Fase 2.2
    return []


_MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
                "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def _parse_date_any(s) -> Optional[datetime]:
    """Aceita 'YYYY-MM-DD', 'DD/MM/YYYY', 'YYYY-MM-DD HH:MM:SS', etc."""
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    txt = str(s).strip()
    if not txt or txt == '-':
        return None
    # ISO com T
    txt10 = txt[:10]
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(txt10, fmt)
        except ValueError:
            continue
    return None


def _desc_map(payload: dict) -> dict[str, str]:
    """{codigo: descricao} a partir de base_abc (cadastro do item)."""
    out: dict[str, str] = {}
    for row in (payload.get('base_abc') or []):
        cod = str(row.get('CODIGO_PRODUTO') or row.get('Codigo') or '').strip()
        desc = (row.get('Descricao') or '').strip()
        if cod and cod not in out:
            out[cod] = desc
    return out


def build_db_late(payload: dict) -> list[dict]:
    """Pedidos com Entrega anterior a hoje e saldo > 0.
    Shape de saida (igual ao n8n): {ped, cli, cod, desc, dt, dias, qtd, mesAno, sortDt}.
    """
    detalhe = payload.get('detalhe') or []
    descs = _desc_map(payload)
    hoje = _now_br().replace(hour=0, minute=0, second=0, microsecond=0)
    out: list[dict] = []
    for r in detalhe:
        saldo = float(r.get('Saldo') or 0)
        if saldo <= 0:
            continue
        dt = _parse_date_any(r.get('Entrega'))
        if not dt:
            continue
        dt_naive = dt.replace(tzinfo=None) if dt.tzinfo else dt
        hoje_naive = hoje.replace(tzinfo=None)
        dias = (hoje_naive - dt_naive).days
        if dias <= 0:
            continue  # nao esta atrasado
        cod = str(r.get('Codigo') or '').strip()
        out.append({
            'ped': str(r.get('Pedido') or ''),
            'cli': str(r.get('Cliente') or ''),
            'cod': cod,
            'desc': descs.get(cod, ''),
            'dt': dt_naive.strftime('%Y-%m-%d 00:00:00'),
            'dias': int(dias),
            'qtd': int(round(saldo)),
            'mesAno': f"{_MESES_ABREV[dt_naive.month - 1]}/{dt_naive.year % 100:02d}",
            'sortDt': dt_naive.year * 100 + dt_naive.month,
        })
    out.sort(key=lambda x: x['dias'], reverse=True)
    return out


# =============================================================================
# Escalares
# =============================================================================
def _total_backlog_vol(db_main: list[dict]) -> int:
    return int(sum((row.get('cart') or 0) for row in db_main))


def _total_late_vol(db_late: list[dict]) -> int:
    return int(sum((row.get('qtd') or 0) for row in db_late))


def _now_br() -> datetime:
    return datetime.now(BR_TZ)


# =============================================================================
# Entrypoint
# =============================================================================
def gerar_html_from_buckets(
    *,
    db_main: list,
    db_drill: dict,
    db_ai: list,
    db_aging: list,
    db_late: list,
    periods: list,
    total_late_vol: int,
    total_backlog_vol: int,
    current_year: int,
    current_month: int,
) -> str:
    """Recebe os 6 buckets prontos (vindos do frontend) e devolve HTML final."""
    now = _now_br()
    sub = {
        '__B64_MAIN__': _b64_json(db_main),
        '__B64_DRILL__': _b64_json(db_drill),
        '__B64_AI__': _b64_json(db_ai),
        '__B64_AGING__': _b64_json(db_aging),
        '__B64_PERIODS__': _b64_json(periods),
        '__B64_LATE__': _b64_json(db_late),
        '__GLOBAL_LATE_VOL__': str(int(total_late_vol or 0)),
        '__GLOBAL_BACKLOG_VOL__': str(int(total_backlog_vol or 0)),
        '__CURRENT_YEAR__': str(int(current_year or now.year)),
        '__CURRENT_MONTH__': str(int(current_month or now.month)),
        '__DATA_ATUAL_FORMATADA__': now.strftime('%d/%m/%Y, %H:%M'),
    }
    html = _load_template()
    for k, v in sub.items():
        html = html.replace(k, v)
    return html


def gerar_caption_from_kpis(kpis: dict, total_late_vol: int = 0,
                            total_backlog_vol: int = 0) -> str:
    """Caption curto, montado a partir do kpisTopo + totais."""
    def f(v):
        try:
            return f"{int(v):,}".replace(',', '.')
        except Exception:
            return "0"
    meta = (kpis or {}).get('meta', 0)
    venda = (kpis or {}).get('venda', 0)
    prod = (kpis or {}).get('prod', 0)
    cart = (kpis or {}).get('cart', 0)
    pct_late = 0
    if total_backlog_vol and total_backlog_vol > 0:
        pct_late = round((total_late_vol or 0) / total_backlog_vol * 100)
    now = _now_br().strftime('%d/%m/%Y')
    return (
        f"📊 *S&OP CONTROL TOWER V50*\n"
        f"📅 *Ref:* {now}\n\n"
        f"🎯 *Meta:* {f(meta)}\n"
        f"💰 *Faturado:* {f(venda)}\n"
        f"🏗️ *Produzido:* {f(prod)}\n"
        f"📦 *Carteira:* {f(cart)}\n\n"
        f"🚨 *Atraso:* {f(total_late_vol)} ({pct_late}%)"
    )


def gerar_filename() -> str:
    stamp = _now_br().strftime('%Y-%m-%d_%H-%M')
    return f"SOP_Control_Tower_V50_{stamp}.html"
