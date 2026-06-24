"""Endpoint admin-only que popula o módulo RH com 30 registros de cada tipo
para testes visuais. Só pode ser chamado por super_user/ceo/admin."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import date, timedelta
import random
import json
import logging

from db_utils import get_db_connection
from auth_utils import get_user_id_from_session

# Garante que as tabelas existem antes de inserir
from modulo.rh_colaboradores import ensure_table as ensure_colab
from modulo.rh_recrutamento import ensure_tables as ensure_recrut
from modulo.rh_documentos import ensure_tables as ensure_docs
from modulo.rh_jornada import ensure_tables as ensure_jor
from modulo.rh_movimentacoes import ensure_tables as ensure_mov
from modulo.rh_config import ensure_tables as ensure_cfg
from modulo.rh_equipamentos import ensure_tables as ensure_equip

router = APIRouter(prefix="/rh/_dev", tags=["rh-dev"])
logger = logging.getLogger(__name__)


NOMES = [
    "Ana Silva Rodrigues", "Pedro Costa Almeida", "Maria Lima Santos", "Lucas Souza Oliveira",
    "Carla Mendes Pereira", "Roberto Ferreira", "Beatriz Carvalho", "João Pereira Lopes",
    "Mariana Torres", "Rafael Gomes", "Patrícia Ribeiro", "Bruno Castro",
    "Fernanda Dias", "Tiago Nunes", "Camila Rocha", "Eduardo Vieira",
    "Juliana Martins", "Gabriel Araújo", "Renata Pinto", "Felipe Cardoso",
    "Letícia Barros", "Marcos Andrade", "Larissa Cruz", "Diego Moreira",
    "Vanessa Freitas", "Henrique Teixeira", "Carolina Ramos", "André Cunha",
    "Sofia Monteiro", "Gustavo Cavalcanti",
]
SETORES = ["RH", "Financeiro", "Logística", "Produção", "Comercial", "T.I", "Almoxarifado", "Qualidade"]
CARGOS = ["Analista DP", "Auxiliar Administrativo", "Supervisor", "Ajudante Geral", "Gerente",
          "Operador de Máquina", "Vendedor", "Conferente", "Estagiário", "Coordenador",
          "Assistente Comercial", "Analista Fiscal", "Programador", "Designer"]
TIPOS_COL = ["CLT", "CLT", "CLT", "PJ", "Temporario", "Estagiario"]
STATUS_COL = ["ativo", "ativo", "ativo", "ativo", "experiencia", "afastado", "demitido"]

# Catálogo de equipamentos realistas
NOTEBOOK_MODELOS = [
    ("Dell", "Latitude 5530", "Intel i5 12ª, 16GB RAM, 256GB SSD"),
    ("Dell", "Latitude 7440", "Intel i7 13ª, 32GB RAM, 512GB SSD"),
    ("Lenovo", "ThinkPad E14 Gen 5", "Intel i5 13ª, 16GB RAM, 512GB SSD"),
    ("Lenovo", "ThinkPad T14", "Intel i7 12ª, 16GB RAM, 1TB SSD"),
    ("HP", "EliteBook 840 G10", "Intel i5 13ª, 16GB RAM, 512GB SSD"),
    ("Acer", "TravelMate P4", "Intel i5 12ª, 8GB RAM, 256GB SSD"),
]
CELULAR_MODELOS = [
    ("Samsung", "Galaxy A54"), ("Samsung", "Galaxy S22"), ("Motorola", "Moto G84"),
    ("Apple", "iPhone 13"), ("Xiaomi", "Redmi Note 12"),
]
MONITOR_MODELOS = [
    ("Dell", "P2422H 24\""), ("LG", "24MP400 24\""), ("Samsung", "S24R350 24\""), ("AOC", "27B2H 27\""),
]
HEADSET_MODELOS = [
    ("Logitech", "H390"), ("Jabra", "Evolve 30 II"), ("Plantronics", "Blackwire 3220"),
]


def _require_admin(user_id):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT role FROM users WHERE id = %s", (str(user_id),))
    r = cur.fetchone()
    cur.close()
    conn.close()
    if not r or r[0] not in ('super_user', 'ceo', 'admin'):
        raise HTTPException(status_code=403, detail="Apenas super_user/ceo/admin podem semear dados")
    return user_id


@router.post("/clear-dummy")
def clear_dummy(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Apaga TODOS os registros das tabelas RH (uso de teste apenas)."""
    _require_admin(user_id)
    ensure_colab(); ensure_recrut(); ensure_docs(); ensure_jor(); ensure_mov(); ensure_cfg(); ensure_equip()
    conn = get_db_connection()
    cur = conn.cursor()
    apagados = {}
    for tabela in [
        "rh_equipamentos", "rh_candidatos", "rh_vagas",
        "rh_banco_horas", "rh_ferias",
        "rh_movimentacoes", "rh_documentos",
        "rh_colaboradores", "rh_sindicatos",
    ]:
        try:
            cur.execute(f"DELETE FROM {tabela}")
            apagados[tabela] = cur.rowcount
            conn.commit()
        except Exception as e:
            conn.rollback()
            apagados[tabela] = f"erro: {e}"
    cur.close()
    conn.close()
    return {"ok": True, "apagados": apagados}


@router.post("/seed-dummy")
def seed_dummy(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Gera 30 registros de cada tipo com dados consistentes entre módulos."""
    uid = _require_admin(user_id)
    ensure_colab(); ensure_recrut(); ensure_docs(); ensure_jor(); ensure_mov(); ensure_cfg(); ensure_equip()

    conn = get_db_connection()
    cur = conn.cursor()
    hoje = date.today()
    counts = {}

    # ===== 30 COLABORADORES =====
    colab_ids = []
    colab_nomes = {}
    for i in range(30):
        nome = NOMES[i % len(NOMES)]
        if i >= len(NOMES):
            nome = f"{nome} ({i})"
        anos_atras = random.randint(0, 8)
        meses_atras = random.randint(0, 11)
        admissao = hoje - timedelta(days=anos_atras * 365 + meses_atras * 30)
        status = random.choice(STATUS_COL)
        demissao = None
        if status == 'demitido':
            demissao = admissao + timedelta(days=random.randint(180, 2000))
            if demissao > hoje:
                demissao = hoje - timedelta(days=random.randint(1, 90))
        cur.execute(
            """INSERT INTO rh_colaboradores
                (nome, cpf, email, telefone, matricula, cargo, setor, salario, jornada, tipo,
                 data_admissao, data_demissao, status, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id""",
            (
                nome,
                f"{random.randint(100, 999)}.{random.randint(100, 999)}.{random.randint(100, 999)}-{random.randint(10, 99)}",
                f"colab{i+1}@empresa.com.br",
                f"(11) 9{random.randint(1000, 9999)}-{random.randint(1000, 9999)}",
                f"{1000 + i:04d}",
                random.choice(CARGOS),
                random.choice(SETORES),
                round(random.uniform(1500, 12000), 2),
                "44h semanais",
                random.choice(TIPOS_COL),
                admissao,
                demissao,
                status,
                uid, uid,
            ),
        )
        cid = cur.fetchone()[0]
        colab_ids.append(cid)
        colab_nomes[cid] = nome
    counts['colaboradores'] = len(colab_ids)
    conn.commit()

    # ===== 30 VAGAS =====
    vaga_ids = []
    STATUS_VAGA = ["aberta", "aberta", "aberta", "em_entrevistas", "fechada", "cancelada"]
    for i in range(30):
        abertura = hoje - timedelta(days=random.randint(0, 90))
        prazo = abertura + timedelta(days=random.randint(15, 60))
        st = random.choice(STATUS_VAGA)
        fechamento = (abertura + timedelta(days=random.randint(15, 70))) if st in ('fechada', 'cancelada') else None
        cur.execute(
            """INSERT INTO rh_vagas
                (titulo, setor, tipo, n_posicoes, descricao, requisitos, salario_min, salario_max,
                 jornada, local_trabalho, data_abertura, prazo, data_fechamento, status, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id""",
            (
                random.choice(CARGOS), random.choice(SETORES), random.choice(["CLT", "PJ", "Estagiario"]),
                random.randint(1, 3),
                f"Vaga para {random.choice(CARGOS)} em {random.choice(SETORES)}.",
                "Experiência mínima de 1 ano, conhecimento em Office.",
                round(random.uniform(1500, 5000), 2),
                round(random.uniform(5000, 12000), 2),
                "44h semanais",
                random.choice(["Presencial", "Híbrido", "Remoto"]),
                abertura, prazo, fechamento, st, uid, uid,
            ),
        )
        vaga_ids.append(cur.fetchone()[0])
    counts['vagas'] = len(vaga_ids)
    conn.commit()

    # ===== 30 CANDIDATOS =====
    STATUS_CAND = ["triagem", "triagem", "entrevista", "entrevista", "parecer", "aprovado", "rejeitado"]
    for i in range(30):
        cur.execute(
            """INSERT INTO rh_candidatos
                (vaga_id, nome, cpf, email, telefone, status, observacoes, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                random.choice(vaga_ids), NOMES[random.randint(0, len(NOMES) - 1)] + f" [Cand. {i+1}]",
                f"{random.randint(100, 999)}.{random.randint(100, 999)}.{random.randint(100, 999)}-{random.randint(10, 99)}",
                f"cand{i+1}@example.com",
                f"(11) 9{random.randint(1000, 9999)}-{random.randint(1000, 9999)}",
                random.choice(STATUS_CAND),
                "Candidato gerado para testes.",
                uid, uid,
            ),
        )
    counts['candidatos'] = 30
    conn.commit()

    # ===== 30 DOCUMENTOS =====
    cur.execute("SELECT id FROM rh_modelos_documento WHERE ativo = TRUE LIMIT 20")
    modelo_ids = [r[0] for r in cur.fetchall()]
    STATUS_DOC = ["vigente", "vigente", "vigente", "vencido", "pendente", "arquivado"]
    for i in range(30):
        emissao = hoje - timedelta(days=random.randint(0, 365))
        validade = emissao + timedelta(days=random.randint(90, 730))
        cur.execute(
            """INSERT INTO rh_documentos
                (colaborador_id, modelo_id, file_url, data_emissao, data_validade, status, observacoes, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                random.choice(colab_ids),
                random.choice(modelo_ids) if modelo_ids else None,
                None,
                emissao, validade, random.choice(STATUS_DOC),
                "Documento de teste.",
                uid, uid,
            ),
        )
    counts['documentos'] = 30
    conn.commit()

    # ===== 30 BANCO DE HORAS =====
    TIPOS_BH = ["extra", "extra", "bh+", "bh-"]
    STATUS_BH = ["pendente", "pendente", "aprovado", "aprovado", "aprovado", "rejeitado"]
    for i in range(30):
        data_bh = hoje - timedelta(days=random.randint(0, 90))
        cur.execute(
            """INSERT INTO rh_banco_horas
                (colaborador_id, data, horas, tipo, motivo, status, solicitante_id, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                random.choice(colab_ids), data_bh,
                round(random.uniform(0.5, 6.0) * 2) / 2,
                random.choice(TIPOS_BH),
                random.choice(["Demanda urgente do cliente", "Fechamento de mês", "Compensação de feriado", "Atraso por trânsito", "Reunião extraordinária"]),
                random.choice(STATUS_BH),
                uid, uid, uid,
            ),
        )
    counts['banco_horas'] = 30
    conn.commit()

    # ===== 30 FÉRIAS =====
    STATUS_FER = ["pendente", "pendente", "aprovado", "aprovado", "aprovado", "rejeitado"]
    for i in range(30):
        inicio = hoje + timedelta(days=random.randint(-180, 180))
        dias = random.choice([10, 15, 20, 30])
        fim = inicio + timedelta(days=dias - 1)
        abono = random.random() < 0.3
        cur.execute(
            """INSERT INTO rh_ferias
                (colaborador_id, data_inicio, data_fim, dias, status, abono_pecuniario, abono_dias, adiantamento_13, observacoes, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                random.choice(colab_ids), inicio, fim, dias,
                random.choice(STATUS_FER),
                abono, 10 if abono else None,
                random.random() < 0.4,
                "Solicitação de teste.",
                uid, uid,
            ),
        )
    counts['ferias'] = 30
    conn.commit()

    # ===== 30 MOVIMENTAÇÕES (15 admissão completas + 15 desligamento) =====
    SISTEMAS_EXTERNOS = ['4Bis', 'Chatwoot', 'StarSoft', 'Krayin (CRM)', 'WAHA (WhatsApp)', 'BigQuery', 'Looker Studio', 'Conta Azul']
    MODULOS_PORTAL = ['Dashboard', 'Chamados (T.I)', 'Importação V2 · Análise de Ruptura', 'SAC', 'Metas de Faturamento', 'RH / DP', 'Otimizador de Produção']
    EQUIP = ['Notebook médio (i5/8GB)', 'Monitor adicional', 'Headset com microfone', 'Celular corporativo']
    ACESSOS = ['Email @empresa.com.br', 'Office 365', 'VPN']
    BLOQ = ['Email corporativo', 'Office 365', 'VPN', 'Acesso remoto', '4Bis', 'Chatwoot', 'StarSoft']
    URG = ["normal", "normal", "importante", "urgente"]
    STATUS_MOV = ["pendente", "aprovado", "aprovado", "aprovado", "rejeitado"]

    movimentacoes_admissao = {}  # cargo -> mov_id (pra equipamentos referenciarem)

    for i in range(30):
        tipo = "admissao" if i < 15 else "desligamento"
        urg = random.choice(URG)
        st_mov = random.choice(STATUS_MOV)
        data_prev = hoje + timedelta(days=random.randint(-60, 60))

        if tipo == "admissao":
            cargo = random.choice(CARGOS)
            setor = random.choice(SETORES)
            titulo = f"Vaga {cargo}"
            colab = None  # admissão pode não estar vinculada a um colab ainda
            nb_marca, nb_modelo, nb_spec = random.choice(NOTEBOOK_MODELOS)
            cel_marca, cel_modelo = random.choice(CELULAR_MODELOS) if random.random() < 0.5 else (None, None)
            mon_marca, mon_modelo = random.choice(MONITOR_MODELOS)
            ti_dados = {
                "modelo_computador": f"{nb_marca} {nb_modelo}",
                "patrimonio_computador": f"MEB-NB-{1000 + i:04d}",
                "modelo_celular": f"{cel_marca} {cel_modelo}" if cel_marca else "",
                "patrimonio_celular": f"MEB-CEL-{2000 + i:04d}" if cel_marca else "",
                "monitor": f"{mon_marca} {mon_modelo}",
                "cracha": f"CRC-{3000 + i:04d}",
                "outros": f"Especificação: {nb_spec}",
            }
            dados = {
                "equipamentos": random.sample(EQUIP, random.randint(1, 4)),
                "acessos": random.sample(ACESSOS, random.randint(1, 3)),
                "sistemas_externos": random.sample(SISTEMAS_EXTERNOS, random.randint(1, 4)),
                "modulos_portal": random.sample(MODULOS_PORTAL, random.randint(2, 5)),
                "pastas_rede": [f"\\\\servidor\\{setor}", f"\\\\servidor\\Compartilhado"],
                "permissoes": [],
                "fisicos": ["Crachá / Cartão de proximidade"],
                "ti_equipamentos": ti_dados,
                "observacoes_ti": "Provisionamento padrão para o cargo.",
            }
            motivo = random.choice(["Aumento de quadro", "Substituição", "Vaga sazonal"])
        else:
            colab = random.choice(colab_ids)
            titulo = colab_nomes[colab]
            cargo = random.choice(CARGOS)
            setor = random.choice(SETORES)
            dados = {
                "bloqueios": random.sample(BLOQ, random.randint(3, 6)),
                "devolucao_equipamentos": random.sample(["Notebook", "Crachá", "Celular corporativo", "Headset"], random.randint(2, 4)),
                "observacoes_ti": "Bloqueio total nos sistemas internos.",
            }
            motivo = random.choice(["Pedido do colaborador", "Sem justa causa", "Acordo entre as partes"])

        aprovado_em = None
        if st_mov == 'aprovado':
            aprovado_em = hoje - timedelta(days=random.randint(0, 30))

        cur.execute(
            """INSERT INTO rh_movimentacoes
                (tipo, colaborador_id, titulo, setor, cargo, motivo, urgencia, data_prevista, status,
                 solicitante_id, aprovado_por, aprovado_em, dados, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id""",
            (
                tipo, colab, titulo, setor, cargo,
                motivo, urg, data_prev, st_mov,
                uid, uid if st_mov == 'aprovado' else None, aprovado_em,
                json.dumps(dados), uid, uid,
            ),
        )
        mov_id = cur.fetchone()[0]
        if tipo == 'admissao':
            movimentacoes_admissao[mov_id] = colab  # pode ser None

    counts['movimentacoes'] = 30
    conn.commit()

    # ===== 30 EQUIPAMENTOS T.I (mistura: alguns atribuídos, alguns em estoque) =====
    STATUS_EQ = ['estoque', 'estoque', 'ativo', 'ativo', 'ativo', 'ativo', 'manutencao', 'descartado']
    equipamentos_a_criar = []
    # Distribuição: 12 notebooks, 6 celulares, 6 monitores, 4 headsets, 2 outros
    distribuicao = [('notebook', 12), ('celular', 6), ('monitor', 6), ('headset', 4), ('token', 2)]
    contador = 1
    for tipo_eq, qtd in distribuicao:
        for _ in range(qtd):
            if tipo_eq == 'notebook':
                marca, modelo, spec = random.choice(NOTEBOOK_MODELOS)
                prefix = 'NB'; valor = random.uniform(3500, 9000)
            elif tipo_eq == 'celular':
                marca, modelo = random.choice(CELULAR_MODELOS); spec = ''
                prefix = 'CEL'; valor = random.uniform(1200, 6000)
            elif tipo_eq == 'monitor':
                marca, modelo = random.choice(MONITOR_MODELOS); spec = ''
                prefix = 'MON'; valor = random.uniform(700, 2000)
            elif tipo_eq == 'headset':
                marca, modelo = random.choice(HEADSET_MODELOS); spec = ''
                prefix = 'HD'; valor = random.uniform(150, 500)
            else:
                marca = 'SafeNet'; modelo = 'eToken 5110'; spec = ''
                prefix = 'TKN'; valor = 250.0

            status_eq = random.choice(STATUS_EQ)
            colab_eq = None
            data_atrib = None
            if status_eq == 'ativo':
                colab_eq = random.choice(colab_ids)
                data_atrib = hoje - timedelta(days=random.randint(0, 365))

            cur.execute(
                """INSERT INTO rh_equipamentos
                    (tipo, modelo, marca, patrimonio, serial_number, status, colaborador_id,
                     data_aquisicao, valor, nota_fiscal, data_atribuicao, observacoes, created_by, updated_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    tipo_eq, modelo, marca,
                    f"MEB-{prefix}-{contador:04d}",
                    f"SN{random.randint(100000, 999999)}",
                    status_eq, colab_eq,
                    hoje - timedelta(days=random.randint(30, 1800)),
                    round(valor, 2),
                    f"NF-{random.randint(10000, 99999)}",
                    data_atrib,
                    spec if spec else None,
                    uid, uid,
                ),
            )
            contador += 1
    counts['equipamentos'] = sum(q for _, q in distribuicao)
    conn.commit()

    # ===== 5 SINDICATOS =====
    SINDS = [
        ("Sindicato dos Comerciários de SP", "62.640.121/0001-78", "Comerciários", "contato@sindcom.org.br", "(11) 3242-0000"),
        ("Sindicato dos Metalúrgicos", "00.000.000/0001-00", "Metalúrgicos", "sind@metalurgicos.org.br", "(11) 3333-3333"),
        ("Sindicato dos Trabalhadores em Logística", "11.222.333/0001-44", "Logística", "logistica@sind.org.br", "(11) 4444-4444"),
        ("SECONCI - Construção Civil", "33.444.555/0001-66", "Construção", "seconci@sind.org.br", "(11) 5555-5555"),
        ("STIASP - Alimentação", "55.666.777/0001-88", "Alimentação", "stiasp@sind.org.br", "(11) 6666-6666"),
    ]
    for nome, cnpj, cat, email, tel in SINDS:
        cur.execute(
            """INSERT INTO rh_sindicatos (nome, cnpj, categoria, contato_email, contato_telefone, data_base, ativo, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, %s)
                ON CONFLICT DO NOTHING""",
            (nome, cnpj, cat, email, tel, random.choice(["Janeiro", "Maio", "Setembro", "Novembro"]), uid, uid),
        )
    counts['sindicatos'] = len(SINDS)
    conn.commit()

    cur.close()
    conn.close()
    return {"ok": True, "criados": counts}
