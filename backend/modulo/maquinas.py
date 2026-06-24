"""Módulo Fábrica — Cadastro de Máquinas e associação dinâmica de produtos.

- Máquinas: cadastro simples (só nome).
- Regras dinâmicas por COD_ITEM (prefixo "começa com" ou código exato) — reavaliadas ao vivo.
- Exceções manuais (incluir/excluir um produto específico numa máquina).
- Produtos vêm do BigQuery `projeto-rpa-empresa-2023.VIEW.view_info_ie` (COD_ITEM, DESC_ITEM).

Um produto pode pertencer a mais de uma máquina (relação N:N resolvida pelas regras).

--- CONVERSÃO MODO DUMMY (sem fontes externas) -------------------------------
(a) Externas substituídas: APENAS BigQuery (view_info_ie), usado só por
    carregar_produtos(). _bq_client() vira no-op. NÃO há gspread/Sheets/Drive/
    pymssql/requests neste arquivo. Postgres do app (get_db_connection) intacto:
    máquinas, regras, exceções, tempos, log, estrutura/BOM continuam no banco.
(b) Shape preservado (carregar_produtos -> view_info_ie): dict com as 5 chaves
    {cod_item, desc_item, un_medida, cod_agrupamento, desc_agrupamento} — igual
    ao consumido por /maquinas/produtos (ProdutoRow), /buscar-produtos (ProdBusca)
    e resolver_associacoes. Inclui todos os COD_ITEM do SEED_MAQUINA_TEMPOS.
(c) Teste real (cd backend && /c/Python312/python -c ...): carregar_produtos()
    -> 167 produtos; keys = [cod_agrupamento, cod_item, desc_agrupamento,
    desc_item, un_medida]; todos os códigos do seed cobertos; determinístico
    entre refresh=True. Ex.: {'cod_item':'10300001','desc_item':'TRAVESSEIRO
    SLIM 001','un_medida':'KG','cod_agrupamento':'03','desc_agrupamento':
    'MONTADOS'}.
(d) Não confirmados: este módulo é cadastro/registro (catálogo de produtos +
    config de máquinas no Postgres) — NÃO possui séries de produção/indicadores
    mensais; logo não há dados temporais de 2026 a gerar aqui. A planilha .xls
    de estrutura (upload_estrutura) é entrada do usuário, não fonte externa.
-----------------------------------------------------------------------------
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime
import os
import io
import json
import time
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session

router = APIRouter(prefix="/maquinas", tags=["maquinas"])
logger = logging.getLogger(__name__)

MODULE_ID = "cadastro_maquinas"

# ============================================================================
# BIGQUERY (mesmo padrão de plano_producao.py)
# ============================================================================
_BQ_KEY_FILE = os.path.join(os.path.dirname(__file__), "..", "projeto-rpa-empresa-2023-16b15891f73c.json")
_BQ_PROJECT = "projeto-rpa-empresa-2023"
_PRODUTOS_TABELA = "projeto-rpa-empresa-2023.VIEW.view_info_ie"


def _bq_client():
    # DUMMY: sem fontes externas. BigQuery desnecessário — carregar_produtos()
    # gera os dados localmente. Mantido como no-op para preservar a assinatura.
    raise RuntimeError("BigQuery desativado no modo dummy (use carregar_produtos)")


# cache simples em memória dos produtos (view_info_ie é pequena ~7,8k linhas)
_PROD_CACHE = {"data": None, "ts": 0.0}
_PROD_TTL = 600  # 10 min


def carregar_produtos(refresh: bool = False) -> List[dict]:
    """Lista de produtos {cod_item, desc_item} — DUMMY determinístico (sem BigQuery), com cache.

    Mantém EXATAMENTE o shape consumido pela view_info_ie: cod_item, desc_item,
    un_medida, cod_agrupamento, desc_agrupamento. Inclui todos os COD_ITEM do
    SEED_MAQUINA_TEMPOS (para as máquinas semeadas resolverem produtos) mais um
    conjunto extra, todos com prefixos 103xxxxx (Sopro) e 104xxxxx (Injetora).
    """
    agora = time.time()
    if not refresh and _PROD_CACHE["data"] is not None and (agora - _PROD_CACHE["ts"]) < _PROD_TTL:
        return _PROD_CACHE["data"]
    from core import dummy

    UNIDADES = ["PC", "UN", "CX", "KG"]
    AGRUP = [("01", "INJETADOS"), ("02", "SOPRADOS"), ("03", "MONTADOS"), ("04", "ACESSORIOS")]
    DESCS = ["Produto Demo", "Componente", "Peca Modelo", "Conjunto", "Item Padrao",
             "Modulo", "Estrutura", "Perfil", "Base", "Suporte", "Tampa", "Frasco",
             "Painel", "Kit Demo", "Unidade", "Bloco"]

    # códigos garantidos (os do seed) + extras determinísticos
    cods_seed = [cod for (_nome, cod, _ph) in SEED_MAQUINA_TEMPOS]
    cods_extra = [str(c) for c in range(10300001, 10300041)] + [str(c) for c in range(10400001, 10400061)]
    cods = sorted(set(cods_seed) | set(cods_extra))

    produtos = []
    for cod in cods:
        r = dummy.rng("maquinas_produto", cod)
        agp = r.choice(AGRUP)
        desc = f"{r.choice(DESCS)} {dummy.escolher(r, ['SLIM', 'PLUS', 'PRO', 'MAX', 'ECO', 'STD'])} {cod[-3:]}"
        produtos.append({"cod_item": cod,
                         "desc_item": desc,
                         "un_medida": r.choice(UNIDADES),
                         "cod_agrupamento": agp[0],
                         "desc_agrupamento": agp[1]})
    produtos.sort(key=lambda p: p["cod_item"])
    _PROD_CACHE["data"] = produtos
    _PROD_CACHE["ts"] = agora
    return produtos


# ============================================================================
# TABELAS (criadas no schema corrente — em homolog: portal_chamado_homolog)
# ============================================================================
def ensure_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS maquinas (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            ativo BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    cur.execute("ALTER TABLE maquinas ADD COLUMN IF NOT EXISTS cor TEXT")  # cor do card na Programação
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS maquina_regras (
            id SERIAL PRIMARY KEY,
            maquina_id INTEGER NOT NULL REFERENCES maquinas(id) ON DELETE CASCADE,
            tipo TEXT NOT NULL,          -- 'prefixo' | 'codigo'
            valor TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            created_by TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS maquina_excecoes (
            id SERIAL PRIMARY KEY,
            maquina_id INTEGER NOT NULL REFERENCES maquinas(id) ON DELETE CASCADE,
            cod_item TEXT NOT NULL,
            acao TEXT NOT NULL,          -- 'incluir' | 'excluir'
            created_at TIMESTAMP DEFAULT NOW(),
            created_by TEXT,
            UNIQUE (maquina_id, cod_item)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS maquina_produto_tempo (
            id SERIAL PRIMARY KEY,
            maquina_id INTEGER NOT NULL REFERENCES maquinas(id) ON DELETE CASCADE,
            cod_item TEXT NOT NULL,
            pecas_hora NUMERIC,          -- velocidade: peças por hora nessa máquina
            updated_at TIMESTAMP DEFAULT NOW(),
            updated_by TEXT,
            UNIQUE (maquina_id, cod_item)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS maquina_log (
            id SERIAL PRIMARY KEY,
            maquina_id INTEGER,          -- sem FK: sobrevive à exclusão
            maquina_nome TEXT,
            acao TEXT NOT NULL,          -- 'criou' | 'excluiu' | 'renomeou'
            detalhe TEXT,
            user_id TEXT,
            user_nome TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS estrutura_versao (
            id SERIAL PRIMARY KEY,
            arquivo_nome TEXT,
            total_linhas INT,
            enviado_em TIMESTAMPTZ DEFAULT NOW(),
            enviado_por TEXT,
            enviado_por_nome TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS estrutura_item (
            id SERIAL PRIMARY KEY,
            versao_id INT REFERENCES estrutura_versao(id) ON DELETE CASCADE,
            ordem INT,
            ukeyk13 TEXT,
            cod TEXT,
            text TEXT,
            level INT,
            tipo TEXT,
            fab DOUBLE PRECISION,
            qtdbase DOUBLE PRECISION,
            unidade TEXT,
            parent1 TEXT,
            codest TEXT
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_estrutura_item_versao_parent ON estrutura_item (versao_id, parent1)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_estrutura_item_versao_level_cod ON estrutura_item (versao_id, level, cod)")
    conn.commit()
    cur.close()
    conn.close()


# ============================================================================
# SEED de peças/hora padrão (roda no deploy) — mapeado por NOME da máquina,
# pois os IDs diferem entre ambientes. Idempotente: só insere se ainda não
# existir (ON CONFLICT DO NOTHING) — nunca sobrescreve ajustes feitos depois.
# ============================================================================
SEED_MAQUINA_TEMPOS = [
    ("INJETORA 1", "10400001", 120), ("INJETORA 1", "10400020", 120), ("INJETORA 1", "10400022", 120),
    ("INJETORA 1", "10400024", 120), ("INJETORA 1", "10400026", 120), ("INJETORA 1", "10400321", 120),
    ("INJETORA 1", "10400322", 120), ("INJETORA 1", "10400323", 120), ("INJETORA 1", "10400363", 120),
    ("INJETORA 1", "10400364", 120), ("INJETORA 1", "10400365", 120), ("INJETORA 1", "10400366", 120),
    ("INJETORA 1", "10400369", 120), ("INJETORA 1", "10400372", 120), ("INJETORA 1", "10400716", 120),
    ("INJETORA 1", "10400915", 120), ("INJETORA 1", "10400928", 120), ("INJETORA 1", "10400969", 120),
    ("INJETORA 1", "10401079", 120), ("INJETORA 1", "10401080", 120), ("INJETORA 1", "10401084", 120),
    ("INJETORA 1", "10401085", 120), ("INJETORA 1", "10401086", 120), ("INJETORA 1", "10401087", 120),
    ("INJETORA 1", "10401101", 120), ("INJETORA 1", "10401102", 120), ("INJETORA 1", "10401111", 120),
    ("INJETORA 2", "10400633", 160), ("INJETORA 2", "10400634", 160), ("INJETORA 2", "10400639", 160),
    ("INJETORA 2", "10400660", 160), ("INJETORA 2", "10400661", 160), ("INJETORA 2", "10400667", 160),
    ("INJETORA 2", "10400668", 160), ("INJETORA 2", "10400708", 55), ("INJETORA 2", "10400709", 55),
    ("INJETORA 2", "10400712", 45), ("INJETORA 2", "10400713", 45),
    ("INJETORA 3", "10300391", 60), ("INJETORA 3", "10400717", 120), ("INJETORA 3", "10400781", 50),
    ("INJETORA 3", "10400925", 50),
    ("INJETORA 4", "10400031", 120), ("INJETORA 4", "10400224", 120), ("INJETORA 4", "10400225", 120),
    ("INJETORA 4", "10400725", 120), ("INJETORA 4", "10401099", 120),
    ("INJETORA 5", "10400030", 120), ("INJETORA 5", "10400034", 120), ("INJETORA 5", "10400039", 120),
    ("INJETORA 5", "10400211", 120), ("INJETORA 5", "10400279", 120), ("INJETORA 5", "10400280", 120),
    ("INJETORA 5", "10400315", 120), ("INJETORA 5", "10400385", 120), ("INJETORA 5", "10400386", 120),
    ("INJETORA 5", "10400440", 120), ("INJETORA 5", "10400468", 120), ("INJETORA 5", "10400716", 120),
    ("INJETORA 5", "10400782", 120), ("INJETORA 5", "10400866", 120), ("INJETORA 5", "10400927", 120),
    ("INJETORA 5", "10400970", 120), ("INJETORA 5", "10400971", 120), ("INJETORA 5", "10400989", 120),
    ("INJETORA 5", "10401043", 120), ("INJETORA 5", "10401081", 120), ("INJETORA 5", "10401104", 120),
    ("SOPRO 1", "10300019", 140), ("SOPRO 1", "10300021", 140), ("SOPRO 1", "10300023", 140),
    ("SOPRO 2", "10300059", 120), ("SOPRO 2", "10300062", 120), ("SOPRO 2", "10300078", 120),
    ("SOPRO 2", "10300267", 90), ("SOPRO 2", "10300269", 90), ("SOPRO 2", "10300535", 90),
    ("SOPRO 3", "10300091", 25), ("SOPRO 3", "10300377", 35), ("SOPRO 3", "10300929", 25),
    ("SOPRO 4", "10300003", 100), ("SOPRO 4", "10300005", 100),
]


def seed_tempos_padrao():
    """Seed idempotente (no deploy): garante a associação dos produtos às máquinas e a
    peças/hora padrão, mapeando por NOME (IDs diferem por ambiente). Só insere se ainda não
    existir — nunca sobrescreve ajustes feitos depois. Falha em silêncio (não quebra o startup)."""
    try:
        ensure_tables()
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, nome FROM maquinas")
        id_por_nome = {str(n).strip().upper(): i for (i, n) in cur.fetchall()}
        n_exc = n_tmp = 0
        for nome, cod, ph in SEED_MAQUINA_TEMPOS:
            mid = id_por_nome.get(nome.strip().upper())
            if not mid:
                continue
            cur.execute(
                "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao) VALUES (%s, %s, 'incluir') "
                "ON CONFLICT (maquina_id, cod_item) DO NOTHING",
                (mid, cod),
            )
            n_exc += cur.rowcount
            cur.execute(
                "INSERT INTO maquina_produto_tempo (maquina_id, cod_item, pecas_hora) VALUES (%s, %s, %s) "
                "ON CONFLICT (maquina_id, cod_item) DO NOTHING",
                (mid, cod, ph),
            )
            n_tmp += cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        if n_exc or n_tmp:
            logger.info(f"seed_tempos_padrao: {n_exc} associacoes e {n_tmp} pecas/hora inseridas")
    except Exception as e:
        logger.error(f"seed_tempos_padrao falhou: {e}")


# ============================================================================
# SEED DUMMY de configuração de FÁBRICA (popula páginas vazias) — idempotente.
# Cria as máquinas (mapeadas por NOME ao SEED_MAQUINA_TEMPOS), associa produtos
# via maquina_produto_tempo + maquina_excecoes/maquina_regras e monta uma
# estrutura/BOM (estrutura_versao + estrutura_item) coerente com carregar_produtos().
# ============================================================================
def seed_dummy_maquinas(admin_id: str) -> dict:
    """Popula dados dummy de configuração de fábrica (máquinas, tempos, regras,
    exceções e estrutura/BOM). IDEMPOTENTE: se já houver máquinas, não duplica.

    Conexão/commit/rollback próprios (try/finally). Reusa SEED_MAQUINA_TEMPOS
    (mesmos nomes/tempos) e carregar_produtos() para os códigos. Retorna um dict
    com a contagem do que foi inserido (ou skipped=True se já populado)."""
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # idempotência: já há máquinas? não duplica nada.
        cur.execute("SELECT COUNT(*) FROM maquinas")
        if (cur.fetchone()[0] or 0) > 0:
            return {"ok": True, "skipped": True, "motivo": "ja_existem_maquinas"}

        nome_admin = _nome_usuario(cur, admin_id)

        # --- 1) MÁQUINAS: nomes distintos do SEED_MAQUINA_TEMPOS, na ordem ----
        nomes_maquinas = []
        for nome, _cod, _ph in SEED_MAQUINA_TEMPOS:
            if nome not in nomes_maquinas:
                nomes_maquinas.append(nome)
        # cores de card (ciclo) para a Programação
        cores = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed",
                 "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"]
        id_por_nome = {}
        for i, nome in enumerate(nomes_maquinas):
            cur.execute(
                "INSERT INTO maquinas (nome, ativo, cor, created_by, updated_by) "
                "VALUES (%s, TRUE, %s, %s, %s) RETURNING id",
                (nome, cores[i % len(cores)], str(admin_id) if admin_id else None,
                 str(admin_id) if admin_id else None),
            )
            mid = cur.fetchone()[0]
            id_por_nome[nome] = mid
            _log(cur, mid, nome, "criou", admin_id, detalhe="seed dummy")

        # --- 2) maquina_excecoes (incluir) + maquina_produto_tempo -----------
        # Associa cada produto do seed à sua máquina (1 ou 2) com pecas_hora.
        n_exc = n_tmp = 0
        for nome, cod, ph in SEED_MAQUINA_TEMPOS:
            mid = id_por_nome.get(nome)
            if not mid:
                continue
            cur.execute(
                "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by) "
                "VALUES (%s, %s, 'incluir', %s) ON CONFLICT (maquina_id, cod_item) DO NOTHING",
                (mid, cod, str(admin_id) if admin_id else None),
            )
            n_exc += cur.rowcount
            cur.execute(
                "INSERT INTO maquina_produto_tempo (maquina_id, cod_item, pecas_hora, updated_by) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (maquina_id, cod_item) DO NOTHING",
                (mid, cod, ph, str(admin_id) if admin_id else None),
            )
            n_tmp += cur.rowcount

        # --- 3) maquina_regras: prefixo por tipo de máquina (Injetora/Sopro) --
        # Regras dinâmicas plausíveis: Injetoras pegam 104xxxxx, Sopros 103xxxxx.
        n_reg = 0
        for nome, mid in id_por_nome.items():
            up = nome.upper()
            if up.startswith("INJETORA"):
                prefixo = "104"
            elif up.startswith("SOPRO"):
                prefixo = "103"
            else:
                prefixo = None
            if prefixo:
                cur.execute(
                    "INSERT INTO maquina_regras (maquina_id, tipo, valor, created_by) "
                    "VALUES (%s, 'prefixo', %s, %s)",
                    (mid, prefixo, str(admin_id) if admin_id else None),
                )
                n_reg += 1
        # uma exceção 'excluir' de exemplo (tira um código que a regra incluiria)
        mid_inj1 = id_por_nome.get("INJETORA 1")
        if mid_inj1:
            cur.execute(
                "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by) "
                "VALUES (%s, '10400969', 'excluir', %s) "
                "ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = 'excluir'",
                (mid_inj1, str(admin_id) if admin_id else None),
            )

        # --- 3b) DISTRIBUIÇÃO dos produtos do PLANO entre as Injetoras ---------
        # Os códigos que caem na Programação de Produção vêm do plano do otimizador
        # (core.dummy.PRODUTOS) — todos com prefixo "104". A regra de prefixo acima
        # faz CADA um desses códigos casar com TODAS as Injetoras, então a alocação
        # automática (por_codigo[cod][0]) jogava tudo numa máquina só. Aqui forçamos
        # um round-robin: cada código do plano é INCLUÍDO em UMA injetora e EXCLUÍDO
        # das demais (a exceção tem precedência sobre a regra em resolver_associacoes),
        # de modo que cada injetora receba uma fatia. Além disso garantimos
        # maquina_produto_tempo (pecas_hora) para cada par produto×máquina resolvido,
        # eliminando o aviso "itens sem peças/hora cadastrada".
        from core import dummy
        injetoras = [(nm, id_por_nome[nm]) for nm in nomes_maquinas
                     if nm.upper().startswith("INJETORA") and nm in id_por_nome]
        cods_plano = []
        seen_cp = set()
        for p in dummy.PRODUTOS:
            c = str(p[0]).strip()
            if c and c not in seen_cp:
                seen_cp.add(c)
                cods_plano.append(c)
        if injetoras and cods_plano:
            # peças/hora determinística por código (faixa plausível 80..160)
            ph_plano = {c: 80 + (int(c[-2:]) % 9) * 10 for c in cods_plano}
            n_inj = len(injetoras)
            for idx, cod in enumerate(cods_plano):
                alvo_nome, alvo_id = injetoras[idx % n_inj]
                ph = ph_plano[cod]
                # inclui o código na injetora-alvo
                cur.execute(
                    "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by) "
                    "VALUES (%s, %s, 'incluir', %s) "
                    "ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = 'incluir'",
                    (alvo_id, cod, str(admin_id) if admin_id else None),
                )
                n_exc += 1
                cur.execute(
                    "INSERT INTO maquina_produto_tempo (maquina_id, cod_item, pecas_hora, updated_by) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (maquina_id, cod_item) DO NOTHING",
                    (alvo_id, cod, ph, str(admin_id) if admin_id else None),
                )
                n_tmp += cur.rowcount
                # exclui o código das demais injetoras (a regra de prefixo "104"
                # casaria com todas; a exceção 'excluir' tira o código delas)
                for outro_nome, outro_id in injetoras:
                    if outro_id == alvo_id:
                        continue
                    cur.execute(
                        "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by) "
                        "VALUES (%s, %s, 'excluir', %s) "
                        "ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = 'excluir'",
                        (outro_id, cod, str(admin_id) if admin_id else None),
                    )

        # --- 4) ESTRUTURA / BOM (estrutura_versao + estrutura_item) ----------
        # Árvore: para alguns produtos-pai (nível 1) cria componentes nível 2/3.
        # O endpoint estrutura_do_produto liga pai->filhos por parent1 = ukeyk13
        # do pai. Usamos a chave ukeyk13 = "K<cod>" como elo da árvore.
        produtos = carregar_produtos()
        desc_por_cod = {p["cod_item"]: p["desc_item"] for p in produtos}
        un_por_cod = {p["cod_item"]: p.get("un_medida", "PC") for p in produtos}

        cur.execute(
            "INSERT INTO estrutura_versao (arquivo_nome, total_linhas, enviado_por, enviado_por_nome) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            ("estrutura_dummy.xls", 0, str(admin_id) if admin_id else None, nome_admin),
        )
        versao_id = cur.fetchone()[0]

        # produtos-pai: primeiros códigos de produção montados/soprados/injetados
        pais = [c for (_n, c, _p) in SEED_MAQUINA_TEMPOS]
        # remove duplicatas mantendo ordem e limita a 12 árvores
        seen = set()
        pais = [c for c in pais if not (c in seen or seen.add(c))][:12]

        # pool de componentes (códigos 103xxxxx extras gerados em carregar_produtos)
        comps_pool = [p["cod_item"] for p in produtos if p["cod_item"].startswith("10300")]
        ordem = 0
        n_itens = 0
        for idx, cod_pai in enumerate(pais):
            keyk = f"K{cod_pai}"          # elo da árvore (ukeyk13 do pai)
            # linha nível 1 (produto-pai). parent1 vazio; ukeyk13 = keyk
            cur.execute(
                "INSERT INTO estrutura_item "
                "(versao_id, ordem, ukeyk13, cod, text, level, tipo, fab, qtdbase, unidade, parent1, codest) "
                "VALUES (%s, %s, %s, %s, %s, 1, 'PA', 1, 1, %s, %s, %s)",
                (versao_id, ordem, keyk, cod_pai,
                 desc_por_cod.get(cod_pai, f"PRODUTO {cod_pai}"),
                 un_por_cod.get(cod_pai, "PC"), "", cod_pai),
            )
            ordem += 1
            n_itens += 1
            # 2 a 3 componentes nível 2 ligados ao pai por parent1 = keyk
            base = (idx * 3) % max(1, len(comps_pool))
            n_comp = 2 + (idx % 2)       # 2 ou 3 filhos
            for j in range(n_comp):
                if not comps_pool:
                    break
                cod_comp = comps_pool[(base + j) % len(comps_pool)]
                tipo_comp = "TABA" if (j == 0 and idx % 2 == 0) else "MP"
                texto = f"{tipo_comp} {desc_por_cod.get(cod_comp, cod_comp)}"
                cur.execute(
                    "INSERT INTO estrutura_item "
                    "(versao_id, ordem, ukeyk13, cod, text, level, tipo, fab, qtdbase, unidade, parent1, codest) "
                    "VALUES (%s, %s, %s, %s, %s, 2, %s, 0, %s, %s, %s, %s)",
                    (versao_id, ordem, f"{keyk}.{j}", cod_comp, texto, tipo_comp,
                     round(0.5 + j * 0.5, 2), un_por_cod.get(cod_comp, "PC"), keyk, cod_comp),
                )
                ordem += 1
                n_itens += 1
                # 1 subcomponente nível 3 para o primeiro filho (profundidade 3)
                if j == 0 and comps_pool:
                    cod_sub = comps_pool[(base + n_comp) % len(comps_pool)]
                    cur.execute(
                        "INSERT INTO estrutura_item "
                        "(versao_id, ordem, ukeyk13, cod, text, level, tipo, fab, qtdbase, unidade, parent1, codest) "
                        "VALUES (%s, %s, %s, %s, %s, 3, 'MP', 0, 2, %s, %s, %s)",
                        (versao_id, ordem, f"{keyk}.{j}.0", cod_sub,
                         f"MP {desc_por_cod.get(cod_sub, cod_sub)}",
                         un_por_cod.get(cod_sub, "PC"), f"{keyk}.{j}", cod_sub),
                    )
                    ordem += 1
                    n_itens += 1

        # total_linhas reflete os itens inseridos
        cur.execute("UPDATE estrutura_versao SET total_linhas = %s WHERE id = %s", (n_itens, versao_id))

        conn.commit()
        resultado = {
            "ok": True,
            "skipped": False,
            "maquinas": len(id_por_nome),
            "tempos": n_tmp,
            "excecoes": n_exc,
            "regras": n_reg,
            "estrutura_versao_id": versao_id,
            "estrutura_itens": n_itens,
        }
        logger.info(f"seed_dummy_maquinas: {resultado}")
        return resultado
    except Exception as e:
        conn.rollback()
        logger.error(f"seed_dummy_maquinas falhou: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# ============================================================================
# MODELOS
# ============================================================================
class MaquinaIn(BaseModel):
    nome: str
    ativo: Optional[bool] = True
    cor: Optional[str] = None


class RegraIn(BaseModel):
    tipo: str            # 'prefixo' | 'codigo'
    valor: str


class ExcecaoIn(BaseModel):
    cod_item: str
    acao: str            # 'incluir' | 'excluir'


class TempoIn(BaseModel):
    cod_item: str
    pecas_hora: Optional[float] = None   # peças por hora; None/0 limpa o tempo


class TempoLoteIn(BaseModel):
    cod_items: List[str]
    pecas_hora: Optional[float] = None


class ExcecaoLoteIn(BaseModel):
    cod_items: List[str]
    acao: str            # 'incluir' | 'excluir'


class RemoverProdutosIn(BaseModel):
    cod_items: List[str]


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _nome_usuario(cur, user_id):
    if not user_id:
        return None
    try:
        cur.execute("SELECT name FROM users WHERE id::text = %s", (str(user_id),))
        r = cur.fetchone()
        return r[0] if r else None
    except Exception:
        return None


def _log(cur, maquina_id, maquina_nome, acao, user_id, detalhe=None):
    """Registra uma ação de máquina no maquina_log."""
    cur.execute(
        "INSERT INTO maquina_log (maquina_id, maquina_nome, acao, detalhe, user_id, user_nome) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (maquina_id, maquina_nome, acao, detalhe, str(user_id) if user_id else None, _nome_usuario(cur, user_id)),
    )


def _uid(user_id, edit=False):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    lvl = "can_edit" if edit else "can_view"
    if not check_module_permission(user_id, MODULE_ID, lvl):
        raise HTTPException(status_code=403, detail="Sem permissão para Cadastro de Máquinas")
    return user_id


# ============================================================================
# RESOLUÇÃO DINÂMICA produto <-> máquina
# ============================================================================
def _carregar_regras_excecoes():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, maquina_id, tipo, valor FROM maquina_regras")
    regras = cur.fetchall()
    cur.execute("SELECT maquina_id, cod_item, acao FROM maquina_excecoes")
    excecoes = cur.fetchall()
    cur.close()
    conn.close()
    return regras, excecoes


def _match_regra(cod_item: str, tipo: str, valor: str) -> bool:
    cod = (cod_item or "").strip()
    val = (valor or "").strip()
    if not val:
        return False
    if tipo == "prefixo":
        return cod.startswith(val)
    if tipo == "codigo":
        return cod == val
    return False


def resolver_associacoes(refresh: bool = False):
    """Retorna (produtos, maquinas_por_produto, produtos_por_maquina).

    Aplica regras dinâmicas + exceções manuais (incluir/excluir).
    """
    produtos = carregar_produtos(refresh=refresh)
    regras, excecoes = _carregar_regras_excecoes()

    regras_por_maq = {}
    for _id, maq_id, tipo, valor in regras:
        regras_por_maq.setdefault(maq_id, []).append((tipo, valor))

    incluir = {}  # maq_id -> set(cod)
    excluir = {}
    for maq_id, cod, acao in excecoes:
        alvo = incluir if acao == "incluir" else excluir
        alvo.setdefault(maq_id, set()).add(str(cod).strip())

    maquina_ids = set(regras_por_maq) | set(incluir) | set(excluir)

    maquinas_por_produto = {p["cod_item"]: [] for p in produtos}
    produtos_por_maquina = {m: set() for m in maquina_ids}
    cods_validos = set(maquinas_por_produto.keys())

    for p in produtos:
        cod = p["cod_item"]
        for maq_id in maquina_ids:
            casa = any(_match_regra(cod, t, v) for (t, v) in regras_por_maq.get(maq_id, []))
            if cod in incluir.get(maq_id, set()):
                casa = True
            if cod in excluir.get(maq_id, set()):
                casa = False
            if casa:
                maquinas_por_produto[cod].append(maq_id)
                produtos_por_maquina[maq_id].add(cod)

    # exceções 'incluir' de códigos que não estão na view ainda também contam
    for maq_id, cods in incluir.items():
        for cod in cods:
            if cod not in cods_validos:
                produtos_por_maquina.setdefault(maq_id, set()).add(cod)

    return produtos, maquinas_por_produto, produtos_por_maquina


# ============================================================================
# ENDPOINTS — MÁQUINAS
# ============================================================================
@router.get("")
def listar_maquinas(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, nome, ativo, created_at, updated_at, cor FROM maquinas ORDER BY ativo DESC, nome")
    maquinas = [{"id": r[0], "nome": r[1], "ativo": r[2],
                 "created_at": _iso(r[3]), "updated_at": _iso(r[4]), "cor": r[5]} for r in cur.fetchall()]
    # contagem de regras/exceções por máquina
    cur.execute("SELECT maquina_id, COUNT(*) FROM maquina_regras GROUP BY maquina_id")
    nreg = dict(cur.fetchall())
    cur.execute("SELECT maquina_id, COUNT(*) FROM maquina_excecoes GROUP BY maquina_id")
    nexc = dict(cur.fetchall())
    cur.close()
    conn.close()
    for m in maquinas:
        m["n_regras"] = nreg.get(m["id"], 0)
        m["n_excecoes"] = nexc.get(m["id"], 0)
    return {"maquinas": maquinas, "total": len(maquinas)}


@router.post("")
def criar_maquina(payload: MaquinaIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    nome = (payload.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome da máquina é obrigatório")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO maquinas (nome, ativo, cor, created_by, updated_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (nome, bool(payload.ativo), payload.cor, uid, uid),
    )
    new_id = cur.fetchone()[0]
    _log(cur, new_id, nome, "criou", uid)
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.put("/{maquina_id}")
def atualizar_maquina(maquina_id: int, payload: MaquinaIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    novo_nome = (payload.nome or "").strip()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT nome FROM maquinas WHERE id = %s", (maquina_id,))
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Máquina não encontrada")
    nome_antigo = r[0]
    cur.execute(
        "UPDATE maquinas SET nome = %s, ativo = %s, cor = %s, updated_at = NOW(), updated_by = %s WHERE id = %s",
        (novo_nome, bool(payload.ativo), payload.cor, uid, maquina_id),
    )
    if nome_antigo != novo_nome:
        _log(cur, maquina_id, novo_nome, "renomeou", uid, detalhe=f"{nome_antigo} → {novo_nome}")
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.delete("/{maquina_id}")
def remover_maquina(maquina_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT nome FROM maquinas WHERE id = %s", (maquina_id,))
    r = cur.fetchone()
    if not r:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Máquina não encontrada")
    nome = r[0]
    cur.execute("DELETE FROM maquinas WHERE id = %s", (maquina_id,))
    _log(cur, maquina_id, nome, "excluiu", uid)
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


# ============================================================================
# ENDPOINTS — REGRAS / EXCEÇÕES
# ============================================================================
@router.get("/{maquina_id}/regras")
def listar_regras(maquina_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, tipo, valor, created_at FROM maquina_regras WHERE maquina_id = %s ORDER BY id", (maquina_id,))
    regras = [{"id": r[0], "tipo": r[1], "valor": r[2], "created_at": _iso(r[3])} for r in cur.fetchall()]
    cur.execute("SELECT id, cod_item, acao, created_at, created_by FROM maquina_excecoes WHERE maquina_id = %s ORDER BY id", (maquina_id,))
    raw_exc = cur.fetchall()
    # nome do usuário que fez cada exceção
    nomes = {}
    for cb in {r[4] for r in raw_exc if r[4]}:
        try:
            cur.execute("SELECT name FROM users WHERE id::text = %s", (str(cb),))
            rr = cur.fetchone()
            nomes[cb] = rr[0] if rr else None
        except Exception:
            conn.rollback()
            nomes[cb] = None
    cur.close()
    conn.close()
    desc_map = {p["cod_item"]: p["desc_item"] for p in carregar_produtos()}
    excecoes = [{"id": r[0], "cod_item": r[1], "acao": r[2], "created_at": _iso(r[3]),
                 "created_by_name": nomes.get(r[4]), "desc_item": desc_map.get(r[1], "")} for r in raw_exc]
    return {"regras": regras, "excecoes": excecoes}


@router.post("/{maquina_id}/regras")
def criar_regra(maquina_id: int, payload: RegraIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    if payload.tipo not in ("prefixo", "codigo"):
        raise HTTPException(status_code=400, detail="Tipo de regra inválido (use 'prefixo' ou 'codigo')")
    if not (payload.valor or "").strip():
        raise HTTPException(status_code=400, detail="Valor da regra é obrigatório")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO maquina_regras (maquina_id, tipo, valor, created_by) VALUES (%s, %s, %s, %s) RETURNING id",
        (maquina_id, payload.tipo, payload.valor.strip(), uid),
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "ok": True}


@router.delete("/regras/{regra_id}")
def remover_regra(regra_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM maquina_regras WHERE id = %s", (regra_id,))
    conn.commit()
    n = cur.rowcount
    cur.close()
    conn.close()
    if n == 0:
        raise HTTPException(status_code=404, detail="Regra não encontrada")
    return {"ok": True}


@router.post("/{maquina_id}/excecoes")
def criar_excecao(maquina_id: int, payload: ExcecaoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = _uid(user_id, edit=True)
    ensure_tables()
    if payload.acao not in ("incluir", "excluir"):
        raise HTTPException(status_code=400, detail="Ação inválida (use 'incluir' ou 'excluir')")
    cod = (payload.cod_item or "").strip()
    if not cod:
        raise HTTPException(status_code=400, detail="Código do item é obrigatório")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = EXCLUDED.acao""",
        (maquina_id, cod, payload.acao, uid),
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.post("/{maquina_id}/excecoes-lote")
def criar_excecoes_lote(maquina_id: int, payload: ExcecaoLoteIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Adiciona várias exceções (incluir/excluir) de uma vez."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    if payload.acao not in ("incluir", "excluir"):
        raise HTTPException(status_code=400, detail="Ação inválida")
    cods = [c.strip() for c in (payload.cod_items or []) if c and c.strip()]
    if not cods:
        return {"ok": True, "afetados": 0}
    conn = get_db_connection()
    cur = conn.cursor()
    for cod in cods:
        cur.execute(
            """INSERT INTO maquina_excecoes (maquina_id, cod_item, acao, created_by)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = EXCLUDED.acao""",
            (maquina_id, cod, payload.acao, uid),
        )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "afetados": len(cods)}


@router.post("/{maquina_id}/remover-produtos")
def remover_produtos(maquina_id: int, payload: RemoverProdutosIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Remove produtos da máquina: apaga inclusão manual e, se vier de uma regra,
    cria exceção 'excluir' para tirá-lo do resultado."""
    _uid(user_id, edit=True)
    ensure_tables()
    cods = [c.strip() for c in (payload.cod_items or []) if c and c.strip()]
    if not cods:
        return {"ok": True, "removidos": 0}
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT tipo, valor FROM maquina_regras WHERE maquina_id = %s", (maquina_id,))
    regras = cur.fetchall()
    for cod in cods:
        cur.execute("DELETE FROM maquina_excecoes WHERE maquina_id = %s AND cod_item = %s", (maquina_id, cod))
        if any(_match_regra(cod, t, v) for (t, v) in regras):
            cur.execute(
                "INSERT INTO maquina_excecoes (maquina_id, cod_item, acao) VALUES (%s, %s, 'excluir') "
                "ON CONFLICT (maquina_id, cod_item) DO UPDATE SET acao = 'excluir'",
                (maquina_id, cod),
            )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "removidos": len(cods)}


@router.delete("/excecoes/{excecao_id}")
def remover_excecao(excecao_id: int, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _uid(user_id, edit=True)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM maquina_excecoes WHERE id = %s", (excecao_id,))
    conn.commit()
    n = cur.rowcount
    cur.close()
    conn.close()
    if n == 0:
        raise HTTPException(status_code=404, detail="Exceção não encontrada")
    return {"ok": True}


# ============================================================================
# ENDPOINTS — PRODUTOS (view_info_ie) + coluna Máquina
# ============================================================================
@router.get("/produtos")
def listar_produtos(busca: Optional[str] = None, limite: int = 500, refresh: bool = False,
                    user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Produtos da view_info_ie com a coluna 'maquinas' (lista de máquinas a que pertence)."""
    _uid(user_id)
    ensure_tables()
    produtos, maquinas_por_produto, _ = resolver_associacoes(refresh=refresh)

    # nomes das máquinas
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, nome FROM maquinas")
    nome_maq = dict(cur.fetchall())
    cur.close()
    conn.close()

    termo = (busca or "").strip().upper()
    saida = []
    for p in produtos:
        if termo and termo not in p["cod_item"].upper() and termo not in p["desc_item"].upper():
            continue
        maqs = [nome_maq.get(mid, f"#{mid}") for mid in maquinas_por_produto.get(p["cod_item"], [])]
        saida.append({"cod_item": p["cod_item"], "desc_item": p["desc_item"],
                      "un_medida": p.get("un_medida", ""),
                      "cod_agrupamento": p.get("cod_agrupamento", ""),
                      "desc_agrupamento": p.get("desc_agrupamento", ""),
                      "maquinas": sorted(maqs)})
        if len(saida) >= limite:
            break
    return {"produtos": saida, "total_exibido": len(saida), "total_base": len(produtos)}


@router.get("/buscar-produtos")
def buscar_produtos(busca: Optional[str] = None, limite: int = 50, refresh: bool = False,
                    user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Busca leve de produtos (por código OU parte da descrição) para o seletor.
    Ex.: busca='slim' retorna código + descrição de todos que contêm 'slim'."""
    _uid(user_id)
    produtos = carregar_produtos(refresh=refresh)
    termo = (busca or "").strip().upper()
    if not termo:
        return {"produtos": [], "total": 0}
    out = []
    for p in produtos:
        if termo in p["cod_item"].upper() or termo in p["desc_item"].upper():
            out.append(p)
            if len(out) >= limite:
                break
    total = sum(1 for p in produtos if termo in p["cod_item"].upper() or termo in p["desc_item"].upper())
    return {"produtos": out, "total": total, "exibido": len(out)}


@router.get("/{maquina_id}/produtos")
def produtos_da_maquina(maquina_id: int, refresh: bool = False,
                        user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Produtos resolvidos (ao vivo) para uma máquina, com o tempo (peças/hora) de cada um."""
    _uid(user_id)
    ensure_tables()
    produtos, _, produtos_por_maquina = resolver_associacoes(refresh=refresh)
    desc = {p["cod_item"]: p["desc_item"] for p in produtos}

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT cod_item, pecas_hora FROM maquina_produto_tempo WHERE maquina_id = %s", (maquina_id,))
    tempos = {r[0]: (float(r[1]) if r[1] is not None else None) for r in cur.fetchall()}
    cur.close()
    conn.close()

    cods = sorted(produtos_por_maquina.get(maquina_id, set()))
    itens = [{"cod_item": c, "desc_item": desc.get(c, "(fora da base atual)"),
              "pecas_hora": tempos.get(c)} for c in cods]
    return {"maquina_id": maquina_id, "produtos": itens, "total": len(itens)}


# ============================================================================
# ENDPOINTS — ESTRUTURA (BOM de produtos, importada de planilha .xls)
# ============================================================================
def _norm_cod(v):
    """Normaliza cod/codest: float (10300001.0) -> '10300001'; NaN/None -> ''."""
    import math
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return ""
        return str(int(v))
    s = str(v).strip()
    if s.lower() in ("nan", ""):
        return ""
    # caso venha como '10300001.0'
    try:
        f = float(s)
        if not math.isnan(f) and f == int(f):
            return str(int(f))
    except (ValueError, TypeError):
        pass
    return s


def _norm_num(v):
    """Normaliza qtdbase/fab: float (NaN->0)."""
    import math
    try:
        f = float(v)
        return 0.0 if math.isnan(f) else f
    except (ValueError, TypeError):
        return 0.0


def _norm_int(v):
    import math
    try:
        f = float(v)
        return None if math.isnan(f) else int(f)
    except (ValueError, TypeError):
        return None


def _norm_str(v):
    import math
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    s = str(v).strip()
    return "" if s.lower() == "nan" else s


@router.post("/estrutura/upload")
def upload_estrutura(arquivo: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Importa a planilha de estruturas (.xls BIFF), criando uma nova versão."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    import pandas as pd
    from psycopg2.extras import execute_values

    conteudo = arquivo.file.read()
    try:
        df = pd.read_excel(io.BytesIO(conteudo), engine="xlrd")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler planilha: {e}")

    cols = {c.lower().strip(): c for c in df.columns}

    def col(name):
        return cols.get(name)

    total = len(df)
    conn = get_db_connection()
    cur = conn.cursor()
    nome_usr = _nome_usuario(cur, uid)
    cur.execute(
        "INSERT INTO estrutura_versao (arquivo_nome, total_linhas, enviado_por, enviado_por_nome) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (arquivo.filename, total, str(uid) if uid else None, nome_usr),
    )
    versao_id = cur.fetchone()[0]

    valores = []
    for ordem, (_, row) in enumerate(df.iterrows()):
        valores.append((
            versao_id, ordem,
            _norm_str(row.get(col("ukeyk13"))),
            _norm_cod(row.get(col("cod"))),
            _norm_str(row.get(col("text"))),
            _norm_int(row.get(col("level"))),
            _norm_str(row.get(col("tipo"))),
            _norm_num(row.get(col("fab"))),
            _norm_num(row.get(col("qtdbase"))),
            _norm_str(row.get(col("unidade"))),
            _norm_str(row.get(col("parent1"))),
            _norm_cod(row.get(col("codest"))),
        ))

    execute_values(
        cur,
        "INSERT INTO estrutura_item "
        "(versao_id, ordem, ukeyk13, cod, text, level, tipo, fab, qtdbase, unidade, parent1, codest) VALUES %s",
        valores,
        page_size=1000,
    )

    cur.execute(
        "DELETE FROM estrutura_versao WHERE id NOT IN "
        "(SELECT id FROM estrutura_versao ORDER BY enviado_em DESC LIMIT 20)"
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"versao_id": versao_id, "arquivo_nome": arquivo.filename, "total_linhas": total}


@router.get("/estrutura/versoes")
def listar_versoes_estrutura(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Últimas versões de estrutura importadas (máx 20)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, arquivo_nome, total_linhas, enviado_em, enviado_por_nome "
        "FROM estrutura_versao ORDER BY enviado_em DESC LIMIT 20"
    )
    versoes = [{"id": r[0], "arquivo_nome": r[1], "total_linhas": r[2],
                "enviado_em": _iso(r[3]), "enviado_por_nome": r[4]} for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"versoes": versoes}


@router.get("/estrutura/produto/{cod}")
def estrutura_do_produto(cod: str, versao_id: Optional[int] = None,
                         user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Estrutura (BOM) de um produto de nível 1, agrupada por parent1."""
    _uid(user_id)
    ensure_tables()
    cod = (cod or "").strip()
    conn = get_db_connection()
    cur = conn.cursor()
    if versao_id is None:
        cur.execute("SELECT id FROM estrutura_versao ORDER BY enviado_em DESC LIMIT 1")
        r = cur.fetchone()
        if not r:
            cur.close()
            conn.close()
            return {"encontrado": False, "versao_id": None}
        versao_id = r[0]

    cur.execute(
        "SELECT parent1, ukeyk13 FROM estrutura_item "
        "WHERE versao_id = %s AND level = 1 AND cod = %s ORDER BY ordem LIMIT 1",
        (versao_id, cod),
    )
    linha = cur.fetchone()
    if not linha:
        cur.close()
        conn.close()
        return {"encontrado": False, "versao_id": versao_id}
    key = linha[0] or linha[1]

    cur.execute(
        "SELECT cod, text, level, tipo, qtdbase, unidade, fab, parent1, codest "
        "FROM estrutura_item WHERE versao_id = %s AND parent1 = %s ORDER BY ordem",
        (versao_id, key),
    )
    itens = [{"cod": r[0], "text": r[1], "level": r[2], "tipo": r[3], "qtdbase": r[4],
              "unidade": r[5], "fab": r[6], "parent1": r[7], "codest": r[8]} for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"encontrado": True, "versao_id": versao_id, "cod": cod, "total": len(itens), "itens": itens}


@router.get("/estrutura/tabas")
def estrutura_tabas(versao_id: Optional[int] = None,
                    user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Componentes do tipo TABA (ou ALMA), nível >= 2, de TODOS os produtos nível 1 de uma vez.

    Usado pela programação automática para gerar os cards de taba no Sopro sem abrir cada produto.
    Mesma regra do detalhe (frontend derivarEncarteTaba): texto com \\bTABA\\b ou \\bALMA\\b, level >= 2.
    """
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    if versao_id is None:
        cur.execute("SELECT id FROM estrutura_versao ORDER BY enviado_em DESC LIMIT 1")
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return {"versao_id": None, "itens": []}
        versao_id = r[0]
    cur.execute(
        "SELECT p.cod AS cod_item, c.cod AS cod_componente, c.text AS descricao, c.qtdbase "
        "FROM estrutura_item p "
        "JOIN estrutura_item c ON c.versao_id = p.versao_id "
        "   AND c.parent1 = COALESCE(p.parent1, p.ukeyk13) AND c.level >= 2 "
        "WHERE p.versao_id = %s AND p.level = 1 "
        "   AND (c.text ~* '\\ytaba\\y' OR c.text ~* '\\yalma\\y') "
        "   AND c.text !~* '\\yencarte\\y' "   # ENCARTE tem precedência (mesma regra do frontend)
        "ORDER BY p.cod, c.ordem",
        (versao_id,),
    )
    itens = [{"cod_item": r[0], "cod_componente": r[1], "descricao": r[2],
              "qtdbase": float(r[3]) if r[3] is not None else 0.0} for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"versao_id": versao_id, "itens": itens}


@router.get("/estrutura/buscar-item")
def buscar_item_estrutura(q: str = "", limite: int = 15, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Busca itens na estrutura mais recente por código ou descrição (para 'outro código' no modal)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM estrutura_versao ORDER BY enviado_em DESC LIMIT 1")
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return {"itens": []}
    versao_id = row[0]
    like = f"%{q.strip()}%"
    cur.execute(
        "SELECT DISTINCT cod, text, unidade FROM estrutura_item "
        "WHERE versao_id = %s AND (cod ILIKE %s OR text ILIKE %s) "
        "ORDER BY cod LIMIT %s",
        (versao_id, like, like, limite),
    )
    itens = [{"cod": r[0], "text": r[1], "unidade": r[2]} for r in cur.fetchall()]
    cur.close(); conn.close()
    return {"itens": itens}


@router.get("/historico")
def historico(limite: int = 500, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Auditoria das máquinas: quem criou, excluiu ou renomeou (e quando)."""
    _uid(user_id)
    ensure_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, maquina_nome, acao, detalhe, user_nome, created_at "
        "FROM maquina_log ORDER BY created_at DESC LIMIT %s", (limite,)
    )
    itens = [{"id": r[0], "maquina_nome": r[1], "acao": r[2], "detalhe": r[3],
              "user_nome": r[4], "created_at": _iso(r[5])} for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"historico": itens, "total": len(itens)}


@router.put("/{maquina_id}/tempo")
def definir_tempo(maquina_id: int, payload: TempoIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Define/atualiza o tempo (peças por hora) de um produto nesta máquina."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    cod = (payload.cod_item or "").strip()
    if not cod:
        raise HTTPException(status_code=400, detail="Código do item é obrigatório")
    ph = payload.pecas_hora
    if ph is not None and ph < 0:
        raise HTTPException(status_code=400, detail="Peças/hora não pode ser negativo")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO maquina_produto_tempo (maquina_id, cod_item, pecas_hora, updated_by, updated_at)
           VALUES (%s, %s, %s, %s, NOW())
           ON CONFLICT (maquina_id, cod_item) DO UPDATE SET
               pecas_hora = EXCLUDED.pecas_hora, updated_by = EXCLUDED.updated_by, updated_at = NOW()""",
        (maquina_id, cod, ph, uid),
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True}


@router.put("/{maquina_id}/tempo-lote")
def definir_tempo_lote(maquina_id: int, payload: TempoLoteIn, user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Define o mesmo peças/hora para vários produtos de uma vez."""
    uid = _uid(user_id, edit=True)
    ensure_tables()
    ph = payload.pecas_hora
    if ph is not None and ph < 0:
        raise HTTPException(status_code=400, detail="Peças/hora não pode ser negativo")
    cods = [c.strip() for c in (payload.cod_items or []) if c and c.strip()]
    if not cods:
        return {"ok": True, "afetados": 0}
    conn = get_db_connection()
    cur = conn.cursor()
    for cod in cods:
        cur.execute(
            """INSERT INTO maquina_produto_tempo (maquina_id, cod_item, pecas_hora, updated_by, updated_at)
               VALUES (%s, %s, %s, %s, NOW())
               ON CONFLICT (maquina_id, cod_item) DO UPDATE SET
                   pecas_hora = EXCLUDED.pecas_hora, updated_by = EXCLUDED.updated_by, updated_at = NOW()""",
            (maquina_id, cod, ph, uid),
        )
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "afetados": len(cods)}
