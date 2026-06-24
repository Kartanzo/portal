import os
import json
import logging
from passlib.context import CryptContext

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Directory constants
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
CACHE_FILE = os.path.join(os.getcwd(), "importation_cache.json")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# CORS origins
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "https://portal.empresa.com.br",
    "http://portal.empresa.com.br",
    "https://portal.tecnologia-empresa.com.br",
    "http://portal.tecnologia-empresa.com.br",
    "http://localhost:5173",
]

# Frontend / API URLs
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
API_URL = os.environ.get("API_URL", "http://localhost:8002")

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

# BigQuery — credenciais lidas de GOOGLE_CREDENTIALS_JSON (env var com JSON inline) via importation.py/sac.py
# Este path aqui é fallback opcional somente se GOOGLE_APPLICATION_CREDENTIALS estiver explicitamente setada
CREDENTIALS_PATH = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '')
PROJECT_ID = 'projeto-rpa-empresa-2023'

# Importation constants
IMPORTED_ITEM_CODES = [
    "10400166", "10400167", "10400169", "10400170", "10400171", "10400176", "10400178", "10400179",
    "10400196", "10400289", "10400313", "10400377", "10400626", "10400628", "10400629", "10400630",
    "10400631", "10400632", "10400689", "10400750",
    "10400944", "10400945", "10400946", "10400947", "10400948", "10400949", "10400950", "10400951",
    "10400952", "10400953"
]
FILE_PARAMETROS = "ParametrosImportacao.xlsx"
DIAS_ESTOQUE_ALVO = 180

# DRE Structure Definition
DRE_STRUCTURE = [
    # 1. Receita Bruta
    {"id": "receita_bruta", "label": "RECEITA BRUTA", "type": "total", "bg": "#b91c1c", "color": "white", "bold": True},

    # 2. Impostos
    {"id": "deducoes", "label": "(-) Impostos sobre a vendas", "type": "data", "source_accounts": ["4.2.2.004", "4.2.2.003", "4.2.2.007", "4.2.2.006", "4.2.2.005"], "color": "red", "bold": True},

    # 3. Receita Líquida
    {"id": "receita_liquida", "label": "RECEITA LÍQUIDA", "type": "total", "bg": "#b91c1c", "color": "white", "bold": True},

    # 4. CPV
    {"id": "cpv", "label": "(-) Custos dos produtos vendidos", "type": "total", "color": "red", "bold": True},
    {"id": "materia_prima", "label": "(-) Matéria-prima", "type": "data", "source_groups": ["Matéria-Prima Consumida"], "parent_id": "cpv", "level": 1},
    {"id": "pessoal_cpv", "label": "(-) Despesa com pessoal", "type": "data", "source_accounts": ["5.1.2.001", "5.1.2.003", "5.1.2.007", "5.1.2.008", "5.1.2.010", "5.1.2.011", "5.1.2.014", "5.1.2.015", "5.1.2.016", "5.1.2.017"], "parent_id": "cpv", "level": 1},
    {"id": "ocupacao_cpv", "label": "(-) Despesa com ocupação", "type": "data", "source_accounts": ["5.1.3.001", "5.1.3.002"], "parent_id": "cpv", "level": 1},
    {"id": "cif", "label": "(-) Custos indiretos de fabricação (CIF)", "type": "data", "source_accounts": ["5.1.3.003"], "parent_id": "cpv", "level": 1},

    # 5. Resultado Bruto
    {"id": "resultado_bruto", "label": "RESULTADO BRUTO", "type": "total", "bg": "#b91c1c", "color": "white", "bold": True},
    {"id": "margem_bruta_pct", "label": "(%) Margem bruta", "type": "percentage", "formula_ref": "resultado_bruto", "denom": "receita_liquida", "bg": "#fed7d7", "italic": True},

    # 6. Despesas Comerciais
    {"id": "despesas_comerciais_total", "label": "(-) Despesas comerciais", "type": "total", "color": "red", "bold": True},
    {"id": "despesas_comerciais", "label": "(-) Despesas comerciais", "type": "data", "source_accounts": ["6.1.1.001", "6.1.1.002", "6.1.1.004", "6.1.1.005", "6.1.1.007", "6.1.1.010"], "parent_id": "despesas_comerciais_total", "level": 1},
    {"id": "marketing", "label": "(-) Despesas com marketing", "type": "data", "source_accounts": ["6.1.2.001", "6.1.2.002", "6.1.2.003", "6.1.2.005", "6.1.2.008", "6.1.2.014", "6.1.2.015", "6.1.2.016", "6.1.2.017"], "parent_id": "despesas_comerciais_total", "level": 1},
    {"id": "negocios_digitais", "label": "(-) Despesas com negócios digitais", "type": "data", "source_accounts": ["6.1.3.001", "6.1.3.004", "6.1.3.012"], "parent_id": "despesas_comerciais_total", "level": 1},

    # 7. Margem de Contribuição
    {"id": "margem_contribuicao", "label": "($) MARGEM DE CONTRIBUIÇÃO", "type": "total", "bg": "#b91c1c", "color": "white", "bold": True},
    {"id": "margem_contribuicao_pct", "label": "(%) Margem de contribuição", "type": "percentage", "formula_ref": "margem_contribuicao", "denom": "receita_liquida", "bg": "#fed7d7", "italic": True},

    # 8. Despesas Administrativas
    {"id": "despesas_administrativas", "label": "(-) Despesas administrativas", "type": "total", "color": "red", "bold": True},
    {"id": "pessoal_adm", "label": "(-) Despesa com pessoal", "type": "data", "source_accounts": ["6.2.1.001", "6.2.1.005", "6.2.1.006", "6.2.1.007", "6.2.1.008", "6.2.1.009", "6.2.1.010", "6.2.1.011", "6.2.1.012", "6.2.1.014", "6.2.1.015", "6.2.1.016", "6.2.1.017"], "parent_id": "despesas_administrativas", "level": 1},
    {"id": "servicos_terceiros", "label": "(-) Despesas com serviços de terceiros", "type": "data", "source_accounts": ["6.2.2.002", "6.2.2.003", "6.2.2.004", "6.2.2.005", "6.2.2.006", "6.2.2.007", "6.2.2.011", "6.2.2.014", "6.2.2.015", "6.2.2.018", "6.2.2.021"], "parent_id": "despesas_administrativas", "level": 1},
    {"id": "despesas_gerais", "label": "(-) Despesas gerais", "type": "data", "source_accounts": ["5.1.3.003", "6.2.4.001", "6.2.4.002", "6.2.4.006", "6.2.4.007", "6.2.4.009", "6.2.4.010", "6.2.4.012", "6.2.4.015", "6.2.4.018", "6.2.4.020", "6.2.4.023", "6.2.4.026", "6.2.4.028", "6.2.4.029", "6.2.4.030", "6.2.4.031", "6.2.4.032"], "parent_id": "despesas_administrativas", "level": 1},

    # 9. Despesas Operacionais (sum of all OPEX)
    {"id": "despesas_operacionais", "label": "(-) Despesas operacionais", "type": "total", "color": "red", "bold": True},

    # 10. Resultado Operacional
    {"id": "resultado_operacional", "label": "RESULTADO OPERACIONAL", "type": "total", "bg": "#b91c1c", "color": "white", "bold": True},
    {"id": "margem_operacional_pct", "label": "(%) Margem operacional", "type": "percentage", "formula_ref": "resultado_operacional", "denom": "receita_liquida", "bg": "#fed7d7", "italic": True},
]
