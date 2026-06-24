"""
core/dummy.py — Dados dummy determinísticos para rodar o portal SEM fontes externas.

Substitui o que antes vinha de BigQuery / Google Sheets / Drive / StarSoft.
Princípios:
  - Determinístico: a mesma chave gera sempre a mesma sequência (use rng(...)).
  - Cobertura anual: helpers de mês cobrem jan–dez de ANO_BASE (lançamentos em TODOS os meses).
  - Sem informação de empresa real: todos os pools são fictícios.

Os módulos importam estes helpers e montam o shape (colunas/keys) que cada página espera.
"""
from __future__ import annotations
import random as _random
from datetime import date, datetime, timedelta

# Ano-base dos dados dummy (ano corrente do projeto).
ANO_BASE = 2026
_SEED = 20260101


# --------------------------------------------------------------------------- #
# RNG determinístico
# --------------------------------------------------------------------------- #
def rng(*chaves) -> _random.Random:
    """RNG estável por chave: rng('faturamento', 3) sempre devolve a mesma sequência."""
    h = _SEED & 0x7FFFFFFF
    for k in chaves:
        h = ((h * 1000003) ^ (hash(str(k)) & 0x7FFFFFFF)) & 0x7FFFFFFF
    return _random.Random(h)


# --------------------------------------------------------------------------- #
# Tempo — sempre o ano inteiro
# --------------------------------------------------------------------------- #
def meses(ano: int = ANO_BASE):
    """[date(ano,1,1) ... date(ano,12,1)] — um por mês."""
    return [date(ano, m, 1) for m in range(1, 13)]


def meses_str(fmt: str = "%Y-%m", ano: int = ANO_BASE):
    return [d.strftime(fmt) for d in meses(ano)]


MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
MESES_PT_LONGO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]


def dia_aleatorio(ano: int, mes: int, r: _random.Random) -> date:
    """Um dia válido dentro do mês informado."""
    if mes == 12:
        prox = date(ano + 1, 1, 1)
    else:
        prox = date(ano, mes + 1, 1)
    ultimo = (prox - timedelta(days=1)).day
    return date(ano, mes, r.randint(1, ultimo))


def datas_no_ano(qtd: int, ano: int = ANO_BASE, chave: str = "datas"):
    """`qtd` datas espalhadas garantindo pelo menos uma em CADA mês."""
    r = rng(chave, ano, qtd)
    out = [dia_aleatorio(ano, m, r) for m in range(1, 13)]  # garante todos os meses
    while len(out) < qtd:
        out.append(dia_aleatorio(ano, r.randint(1, 12), r))
    out = out[:max(qtd, 12)]
    out.sort()
    return out


# --------------------------------------------------------------------------- #
# Pools fictícios (sem nenhuma empresa/pessoa real)
# --------------------------------------------------------------------------- #
CLIENTES = [
    "Cliente Alfa LTDA", "Comercial Beta ME", "Distribuidora Gama SA",
    "Atacado Delta LTDA", "Varejo Epsilon ME", "Mercado Zeta LTDA",
    "Loja Eta Comercio", "Importadora Theta SA", "Rede Iota LTDA",
    "Comercio Kappa ME", "Grupo Lambda SA", "Magazine Mu LTDA",
    "Emporio Nu ME", "Central Xi Distribuicao", "Casa Omicron LTDA",
    "Atacadao Pi SA", "Comercial Rho ME", "Distribuidor Sigma LTDA",
    "Varejista Tau ME", "Mercantil Upsilon SA",
]

# (codigo, descricao, unidade, categoria) — TUDO fictício; prefixo "104" exigido por
# filtros SQL (CODIGO_PRODUTO LIKE '104%'). Nada de catálogo/marca real.
PRODUTOS = [
    ("10400001", "Produto Demo Alfa", "UN", "Linha A"),
    ("10400002", "Produto Demo Beta", "PC", "Linha A"),
    ("10400003", "Produto Demo Gama", "UN", "Linha B"),
    ("10400004", "Produto Demo Delta", "PC", "Linha B"),
    ("10400005", "Produto Demo Epsilon", "UN", "Linha C"),
    ("10400006", "Produto Demo Zeta", "PC", "Linha C"),
    ("10400007", "Produto Demo Eta", "UN", "Linha A"),
    ("10400008", "Produto Demo Teta", "PC", "Linha B"),
    ("10400009", "Produto Demo Iota", "UN", "Linha C"),
    ("10400010", "Produto Demo Kappa", "PC", "Linha A"),
    ("10400011", "Produto Demo Lambda", "UN", "Linha B"),
    ("10400012", "Produto Demo Mi", "PC", "Linha C"),
]

# (codigo, nome)
VENDEDORES = [
    ("001", "Vendedor Um"), ("015", "Vendedor Quinze"), ("042", "Vendedor Quarenta"),
    ("088", "Vendedor Oitenta"), ("103", "Vendedor Cento"), ("170", "Vendedor Cento e Setenta"),
    ("205", "Vendedor Duzentos"), ("311", "Vendedor Trezentos"),
]

REPRESENTANTES = [(f"R{100+i}", f"Representante {i:02d}") for i in range(1, 13)]

SETORES = ["Comercial", "Financeiro", "Fabrica", "Logistica",
           "Marketing", "T.I", "RH", "Compras", "Ecommerce", "SAC"]

ESTADOS = ["SP", "RJ", "MG", "RS", "PR", "SC", "BA", "PE", "CE", "GO", "DF", "ES"]

CIDADES = ["Sao Paulo", "Campinas", "Santos", "Rio de Janeiro", "Belo Horizonte",
           "Porto Alegre", "Curitiba", "Florianopolis", "Salvador", "Recife",
           "Fortaleza", "Goiania", "Brasilia", "Vitoria"]

MAQUINAS = [(f"MAQ-{i:02d}", f"Maquina {i:02d}") for i in range(1, 11)]

CATEGORIAS_PRODUTO = ["Linha A", "Linha B", "Linha C", "Linha D", "Linha E"]

STATUS_PEDIDO = ["Faturado", "Em Aberto", "Pendente", "Cancelado"]


# --------------------------------------------------------------------------- #
# Geradores numéricos
# --------------------------------------------------------------------------- #
def valor(r: _random.Random, base: float = 10000.0, var: float = 0.4, casas: int = 2) -> float:
    """Valor monetário em torno de `base` (+/- var)."""
    return round(base * (1 + r.uniform(-var, var)), casas)


def inteiro(r: _random.Random, lo: int, hi: int) -> int:
    return r.randint(lo, hi)


def escolher(r: _random.Random, seq):
    return r.choice(list(seq))


def serie_mensal(chave: str, base: float = 100000.0, var: float = 0.35,
                 tendencia: float = 0.02, ano: int = ANO_BASE, casas: int = 2):
    """
    Série de 12 valores (um por mês) com leve tendência de crescimento.
    Retorna lista de dicts: {'mes': date, 'mes_str': 'YYYY-MM', 'valor': float}.
    """
    r = rng(chave, ano)
    out = []
    for i, d in enumerate(meses(ano)):
        fator = (1 + tendencia) ** i
        v = round(base * fator * (1 + r.uniform(-var, var)), casas)
        out.append({"mes": d, "mes_str": d.strftime("%Y-%m"),
                    "mes_num": d.month, "valor": v})
    return out
