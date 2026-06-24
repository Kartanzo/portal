"""
Catálogo — Builder de catálogos de produtos (Marketing) + página pública (flipbook).

Modelo de dados:
- catalogo_imagem        → BYTEA das capas e fotos de produto (já padronizadas no upload)
- catalogo_biblioteca    → BIBLIOTECA reutilizável de produtos (código + descrição + foto), uma vez
- catalogo_modelo        → versões/modelos do catálogo (título, ano, capas, colunas da ficha, flag oficial)
- catalogo_produto       → itens de um modelo = produtos da biblioteca FLAGADOS para aquele catálogo
- catalogo_base_produtos → cache da base do Google Sheets (autocomplete + valores da ficha)
- catalogo_base_meta     → metadados da base (lista de colunas com grupo)

A ficha técnica de cada produto é derivada na leitura: base (por código) + colunas selecionadas no modelo.

────────────────────────────────────────────────────────────────────────────
RELATÓRIO — Conversão para dados dummy (SEM fontes externas)
────────────────────────────────────────────────────────────────────────────
(a) Externas substituídas:
    - ÚNICA chamada externa: requests.get(SHEET_CSV_URL) em base_sync() (Google
      Sheets CSV). Substituída por geração determinística via `from core import
      dummy` (dummy.PRODUTOS / dummy.rng / dummy.valor / dummy.escolher), mantendo
      o MESMO formato CSV (linha 0=grupos, 1=nomes, 2+=produtos). O parsing e
      TODOS os INSERTs em catalogo_base_produtos / catalogo_base_meta seguem
      intactos. As constantes SHEET_ID/SHEET_CSV_URL e o import `requests`
      permanecem (não removidos — precisão cirúrgica), apenas não são mais usados.
    - Nenhuma outra fonte externa (sem gspread/Drive/BigQuery). Imagens são BYTEA
      no Postgres do app — mantidas intactas; nenhuma URL placeholder necessária.
    - Postgres do app (ensure_catalogo_tables e todos os CRUDs) NÃO foi tocado.

(b) Shape exato preservado (consumido por CatalogoManager.tsx / CatalogoPublico.tsx):
    - GET  /base/colunas → {colunas:[{grupo,nome}], sincronizado_em, total}
    - POST /base/sync    → {ok:true, total:int, colunas:int}
    - dados (JSONB) tem as chaves "DESCRIÇÃO DO PRODUTO" e "STATUS" (ATIVO/INATIVO)
      usadas por base_buscar e pela ficha; demais colunas: CATEGORIA, UNIDADE,
      PREÇO, PESO (KG).

(c) Teste real (cd backend; /c/Python312/python, get_db_connection mockado):
    RESPONSE: {'ok': True, 'total': 12, 'colunas': 7}
    PRODUTOS inseridos: 12
    SAMPLE: codigo=10401085, descricao=BENGALA DOBRAVEL COM REGULAGEM
    dados keys: ['CÓDIGO','DESCRIÇÃO DO PRODUTO','CATEGORIA','UNIDADE','STATUS','PREÇO','PESO (KG)']
    COLUNAS META: [{grupo:'',nome:'CÓDIGO'}, {grupo:'IDENTIFICAÇÃO',nome:'DESCRIÇÃO DO PRODUTO'}, ...]
    DETERMINISTIC dados match: True  (re-run idêntico)

(d) Não confirmados / observações:
    - Datas: base_sync usa CURRENT_TIMESTAMP do Postgres (já 2026 no ambiente); o
      módulo não fixa anos no código além do default ano=2026 já existente.
    - O mojibake "C�DIGO" visto no print é só o encoding do console Windows; o
      JSON gravado usa UTF-8 (ensure_ascii=False) corretamente.
"""

import csv
import io
import json
from typing import List, Optional

import requests
from fastapi import APIRouter, HTTPException, UploadFile, File, Response, Depends
from pydantic import BaseModel

from core import dummy
from db_utils import get_db_connection
from permission_utils import check_module_permission
from auth_utils import get_user_id_from_session


router = APIRouter(prefix="/catalogo", tags=["Catálogo"])

MODULE_VIEW = "catalogo_view"
MODULE_ADMIN = "catalogo_admin"

SHEET_ID = "1CjXWXXd0rk5Bxnrt_DTGt9wmRk0AYbOzJWPtDBUlghw"
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"


def _require_view(user_id: Optional[str]):
    # Catálogo é visível a todos os usuários logados (igual ao álbum de Eventos)
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")


def _require_admin(user_id: Optional[str]):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado")
    # Quem gerencia o Marketing (eventos_admin) também gerencia o catálogo
    if not (check_module_permission(user_id, MODULE_ADMIN, "can_view")
            or check_module_permission(user_id, "eventos_admin", "can_view")):
        raise HTTPException(status_code=403, detail="Sem permissão para gerenciar o catálogo")


# ─────────────────────────────────────────────
#  Criação das tabelas (idempotente — chamado no startup)
# ─────────────────────────────────────────────
def ensure_catalogo_tables():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS catalogo_imagem (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                imagem     BYTEA NOT NULL,
                mime_type  VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
                criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                criado_por UUID
            );

            CREATE TABLE IF NOT EXISTS catalogo_biblioteca (
                id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                codigo_produto VARCHAR(40) NOT NULL UNIQUE,
                descricao      VARCHAR(200),
                imagem_id      UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
                criado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                criado_por     UUID
            );

            CREATE TABLE IF NOT EXISTS catalogo_modelo (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                nome            VARCHAR(120) NOT NULL,
                titulo_pagina   VARCHAR(160) NOT NULL DEFAULT 'Catálogo EMPRESA 2026',
                subtitulo       TEXT,
                ano             INTEGER NOT NULL DEFAULT 2026,
                oficial         BOOLEAN NOT NULL DEFAULT FALSE,
                colunas_ficha   JSONB NOT NULL DEFAULT '[]'::jsonb,
                capa_inicial_id UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
                capa_indice_id  UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
                capa_final_id   UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
                usar_capa_padrao BOOLEAN NOT NULL DEFAULT TRUE,
                criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                criado_por      UUID,
                atualizado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- Antes só permitia UMA ficha oficial; agora várias fichas podem ser
            -- publicadas (oficiais) ao mesmo tempo e aparecem na galeria pública.
            DROP INDEX IF EXISTS uq_catalogo_oficial;

            CREATE TABLE IF NOT EXISTS catalogo_produto (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                modelo_id     UUID NOT NULL REFERENCES catalogo_modelo(id) ON DELETE CASCADE,
                biblioteca_id UUID REFERENCES catalogo_biblioteca(id) ON DELETE CASCADE,
                ordem         INTEGER NOT NULL DEFAULT 0,
                criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- Convergência de instalações anteriores (tabela criada antes da biblioteca)
            ALTER TABLE catalogo_produto ADD COLUMN IF NOT EXISTS biblioteca_id UUID REFERENCES catalogo_biblioteca(id) ON DELETE CASCADE;
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = current_schema()
                           AND table_name = 'catalogo_produto'
                           AND column_name = 'codigo_produto') THEN
                ALTER TABLE catalogo_produto ALTER COLUMN codigo_produto DROP NOT NULL;
              END IF;
            END $$;

            CREATE INDEX IF NOT EXISTS idx_catalogo_produto_modelo ON catalogo_produto (modelo_id, ordem);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_produto_item ON catalogo_produto (modelo_id, biblioteca_id);

            CREATE TABLE IF NOT EXISTS catalogo_base_produtos (
                codigo_produto  VARCHAR(40) PRIMARY KEY,
                descricao       VARCHAR(200),
                dados           JSONB NOT NULL,
                sincronizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS catalogo_base_meta (
                chave         VARCHAR(40) PRIMARY KEY,
                valor         JSONB NOT NULL,
                atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        conn.commit()
        print("catalogo tables OK.")
    except Exception as e:
        conn.rollback()
        print(f"catalogo table setup error: {e}")
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Base dummy (geração determinística, sem fontes externas)
# ─────────────────────────────────────────────
def _gerar_linhas_base():
    """Gera as linhas da base no MESMO formato CSV usado por base_sync
    (linha 0 = grupos, linha 1 = nomes, linhas 2+ = produtos), a partir de
    dummy.PRODUTOS. Retorna (linhas, colunas)."""
    cols = [
        ("", "CÓDIGO"),
        ("IDENTIFICAÇÃO", "DESCRIÇÃO DO PRODUTO"),
        ("IDENTIFICAÇÃO", "CATEGORIA"),
        ("IDENTIFICAÇÃO", "UNIDADE"),
        ("COMERCIAL", "STATUS"),
        ("COMERCIAL", "PREÇO"),
        ("LOGÍSTICA", "PESO (KG)"),
    ]
    grupos_row = [g for (g, _n) in cols]
    nomes_row = [n for (_g, n) in cols]
    linhas = [grupos_row, nomes_row]
    for codigo, descricao, unidade, categoria in dummy.PRODUTOS:
        r = dummy.rng("catalogo_base", codigo)
        status = dummy.escolher(r, ["ATIVO", "ATIVO", "ATIVO", "INATIVO"])
        preco = f"{dummy.valor(r, base=180.0, var=0.5):.2f}".replace(".", ",")
        peso = f"{dummy.valor(r, base=2.5, var=0.6):.2f}".replace(".", ",")
        linhas.append([codigo, descricao, categoria, unidade, status, preco, peso])

    grupos_raw = linhas[0]
    nomes = linhas[1]
    colunas = []
    grupo_atual = ""
    for i, nome in enumerate(nomes):
        g = grupos_raw[i].strip() if i < len(grupos_raw) and grupos_raw[i].strip() else None
        if g:
            grupo_atual = g
        nome_l = (nome or "").strip()
        if nome_l:
            colunas.append({"indice": i, "grupo": grupo_atual, "nome": nome_l})
    return linhas, colunas


def seed_dummy_catalogo(admin_id: str) -> dict:
    """Popula o catálogo com dados dummy para a página ter conteúdo.

    Idempotente: só insere se as tabelas estiverem vazias (checa COUNT). Usa
    conexão própria. NÃO altera assinaturas/rotas/permissões nem adiciona libs.

    Popula, a partir de dummy.PRODUTOS:
    - catalogo_base_produtos / catalogo_base_meta (mesma lógica de base_sync)
    - catalogo_imagem (1 placeholder BYTEA mínimo)
    - catalogo_biblioteca (1 item por produto)
    - catalogo_modelo (2 catálogos, ambos oficiais)
    - catalogo_produto (vincula os produtos da biblioteca a cada modelo)
    """
    # PNG 1x1 transparente — placeholder mínimo válido para BYTEA
    PNG_1X1 = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6360000002000100ffff0300000600055700a30000"
        "0000049454e44ae426082"
    )
    linhas, colunas = _gerar_linhas_base()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Idempotência: se já há modelos, não faz nada.
        cur.execute("SELECT COUNT(*) FROM catalogo_modelo")
        if (cur.fetchone()[0] or 0) > 0:
            return {"ok": True, "skipped": True, "motivo": "catálogo já populado"}

        # 1) Base de produtos (cache da "planilha") + meta de colunas
        cur.execute("SELECT COUNT(*) FROM catalogo_base_produtos")
        if (cur.fetchone()[0] or 0) == 0:
            for r in linhas[2:]:
                if not r or not (r[0] or "").strip():
                    continue
                codigo = r[0].strip()
                dados = {}
                for c in colunas:
                    idx = c["indice"]
                    dados[c["nome"]] = (r[idx].strip() if idx < len(r) and r[idx] is not None else "")
                descricao = dados.get("DESCRIÇÃO DO PRODUTO", "")
                cur.execute(
                    """INSERT INTO catalogo_base_produtos (codigo_produto, descricao, dados, sincronizado_em)
                       VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                       ON CONFLICT (codigo_produto)
                       DO UPDATE SET descricao = EXCLUDED.descricao, dados = EXCLUDED.dados,
                                     sincronizado_em = CURRENT_TIMESTAMP""",
                    (codigo, descricao[:200], json.dumps(dados, ensure_ascii=False)),
                )
            cur.execute(
                """INSERT INTO catalogo_base_meta (chave, valor, atualizado_em)
                   VALUES ('colunas', %s, CURRENT_TIMESTAMP)
                   ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP""",
                (json.dumps([{"grupo": c["grupo"], "nome": c["nome"]} for c in colunas], ensure_ascii=False),),
            )

        # 2) Imagem placeholder (reutilizada por biblioteca e capas)
        cur.execute(
            "INSERT INTO catalogo_imagem (imagem, mime_type, criado_por) VALUES (%s, %s, %s) RETURNING id::text",
            (PNG_1X1, "image/png", admin_id),
        )
        img_id = cur.fetchone()[0]

        # 3) Biblioteca: 1 item por produto da base
        bib_ids = []
        for r in linhas[2:]:
            codigo = (r[0] or "").strip()
            if not codigo:
                continue
            descricao = (r[1] or "").strip()
            cur.execute(
                """INSERT INTO catalogo_biblioteca (codigo_produto, descricao, imagem_id, criado_por)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (codigo_produto)
                   DO UPDATE SET descricao = EXCLUDED.descricao
                   RETURNING id::text""",
                (codigo, descricao[:200], img_id, admin_id),
            )
            bib_ids.append(cur.fetchone()[0])

        # 4) Modelos (catálogos) — 2 versões, ambas oficiais p/ aparecerem na galeria
        colunas_ficha = ["DESCRIÇÃO DO PRODUTO", "CATEGORIA", "UNIDADE", "PREÇO", "PESO (KG)"]
        modelos = [
            ("Catálogo Geral 2026", "Catálogo EMPRESA 2026", "Linha completa de produtos", 2026),
            ("Catálogo Destaques 2026", "Destaques EMPRESA 2026", "Seleção de produtos em destaque", 2026),
        ]
        criados = 0
        produtos_vinculados = 0
        for idx_m, (nome, titulo, subtitulo, ano) in enumerate(modelos):
            cur.execute(
                """INSERT INTO catalogo_modelo
                       (nome, titulo_pagina, subtitulo, ano, oficial, colunas_ficha,
                        capa_inicial_id, capa_indice_id, capa_final_id, usar_capa_padrao, criado_por)
                   VALUES (%s, %s, %s, %s, TRUE, %s, %s, %s, %s, FALSE, %s)
                   RETURNING id::text""",
                (
                    nome, titulo, subtitulo, ano,
                    json.dumps(colunas_ficha, ensure_ascii=False),
                    img_id, img_id, img_id, admin_id,
                ),
            )
            mid = cur.fetchone()[0]
            criados += 1
            # O 1º modelo recebe todos os produtos; o 2º recebe metade (destaques)
            alvo = bib_ids if idx_m == 0 else bib_ids[: max(1, len(bib_ids) // 2)]
            for ordem, bib_id in enumerate(alvo, start=1):
                cur.execute(
                    """INSERT INTO catalogo_produto (modelo_id, biblioteca_id, ordem)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (modelo_id, biblioteca_id) DO NOTHING""",
                    (mid, bib_id, ordem),
                )
                produtos_vinculados += 1

        conn.commit()
        return {
            "ok": True,
            "skipped": False,
            "base_produtos": len(bib_ids),
            "colunas": len(colunas),
            "biblioteca": len(bib_ids),
            "modelos": criados,
            "produtos_vinculados": produtos_vinculados,
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao popular catálogo dummy: {e}")
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Payloads
# ─────────────────────────────────────────────
class ModeloCreate(BaseModel):
    nome: str
    titulo_pagina: Optional[str] = "Catálogo EMPRESA 2026"
    subtitulo: Optional[str] = None
    ano: Optional[int] = 2026
    colunas_ficha: Optional[List[str]] = None
    usar_capa_padrao: Optional[bool] = True


class ModeloUpdate(BaseModel):
    nome: Optional[str] = None
    titulo_pagina: Optional[str] = None
    subtitulo: Optional[str] = None
    ano: Optional[int] = None
    colunas_ficha: Optional[List[str]] = None
    usar_capa_padrao: Optional[bool] = None
    capa_inicial_id: Optional[str] = None
    capa_indice_id: Optional[str] = None
    capa_final_id: Optional[str] = None


class BibliotecaCreate(BaseModel):
    codigo_produto: str
    descricao: Optional[str] = None
    imagem_id: Optional[str] = None


class BibliotecaUpdate(BaseModel):
    descricao: Optional[str] = None
    imagem_id: Optional[str] = None


class ItemCreate(BaseModel):
    biblioteca_id: str


class ReordenarPayload(BaseModel):
    ordem: List[str]  # lista de biblioteca_id na nova ordem


# ─────────────────────────────────────────────
#  Base (Google Sheets)
# ─────────────────────────────────────────────
@router.get("/base/colunas")
def base_colunas(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT valor FROM catalogo_base_meta WHERE chave = 'colunas'")
        row = cur.fetchone()
        colunas = row[0] if row else []
        cur.execute("SELECT MAX(sincronizado_em), COUNT(*) FROM catalogo_base_produtos")
        meta = cur.fetchone()
        return {
            "colunas": colunas,
            "sincronizado_em": meta[0].isoformat() if meta and meta[0] else None,
            "total": meta[1] if meta else 0,
        }
    finally:
        cur.close()
        conn.close()


@router.post("/base/sync")
def base_sync(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    # DUMMY: sem fontes externas — a base (antes vinda do Google Sheets) é gerada
    # deterministicamente a partir de dummy.PRODUTOS, no MESMO formato CSV
    # (linha 0 = grupos, linha 1 = nomes das colunas, linhas 2+ = produtos).
    try:
        cols = [
            ("", "CÓDIGO"),
            ("IDENTIFICAÇÃO", "DESCRIÇÃO DO PRODUTO"),
            ("IDENTIFICAÇÃO", "CATEGORIA"),
            ("IDENTIFICAÇÃO", "UNIDADE"),
            ("COMERCIAL", "STATUS"),
            ("COMERCIAL", "PREÇO"),
            ("LOGÍSTICA", "PESO (KG)"),
        ]
        grupos_row = [g for (g, _n) in cols]
        nomes_row = [n for (_g, n) in cols]
        linhas = [grupos_row, nomes_row]
        for codigo, descricao, unidade, categoria in dummy.PRODUTOS:
            r = dummy.rng("catalogo_base", codigo)
            status = dummy.escolher(r, ["ATIVO", "ATIVO", "ATIVO", "INATIVO"])
            preco = f"{dummy.valor(r, base=180.0, var=0.5):.2f}".replace(".", ",")
            peso = f"{dummy.valor(r, base=2.5, var=0.6):.2f}".replace(".", ",")
            linhas.append([codigo, descricao, categoria, unidade, status, preco, peso])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao gerar a base dummy: {e}")

    if len(linhas) < 3:
        raise HTTPException(status_code=422, detail="Base vazia ou em formato inesperado")

    grupos_raw = linhas[0]
    nomes = linhas[1]
    colunas = []
    grupo_atual = ""
    for i, nome in enumerate(nomes):
        g = grupos_raw[i].strip() if i < len(grupos_raw) and grupos_raw[i].strip() else None
        if g:
            grupo_atual = g
        nome_l = (nome or "").strip()
        if nome_l:
            colunas.append({"indice": i, "grupo": grupo_atual, "nome": nome_l})

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("TRUNCATE catalogo_base_produtos")
        total = 0
        for r in linhas[2:]:
            if not r or not (r[0] or "").strip():
                continue
            codigo = r[0].strip()
            dados = {}
            for c in colunas:
                idx = c["indice"]
                dados[c["nome"]] = (r[idx].strip() if idx < len(r) and r[idx] is not None else "")
            descricao = dados.get("DESCRIÇÃO DO PRODUTO", "")
            cur.execute(
                """INSERT INTO catalogo_base_produtos (codigo_produto, descricao, dados, sincronizado_em)
                   VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                   ON CONFLICT (codigo_produto)
                   DO UPDATE SET descricao = EXCLUDED.descricao, dados = EXCLUDED.dados,
                                 sincronizado_em = CURRENT_TIMESTAMP""",
                (codigo, descricao[:200], json.dumps(dados, ensure_ascii=False)),
            )
            total += 1
        cur.execute(
            """INSERT INTO catalogo_base_meta (chave, valor, atualizado_em)
               VALUES ('colunas', %s, CURRENT_TIMESTAMP)
               ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP""",
            (json.dumps([{"grupo": c["grupo"], "nome": c["nome"]} for c in colunas], ensure_ascii=False),),
        )
        conn.commit()
        return {"ok": True, "total": total, "colunas": len(colunas)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/base/buscar")
def base_buscar(q: str = "", limit: int = 20, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    termo = f"%{q.strip()}%"
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT codigo_produto, descricao, COALESCE(dados->>'STATUS','') AS status
               FROM catalogo_base_produtos
               WHERE codigo_produto ILIKE %s OR descricao ILIKE %s
               ORDER BY (COALESCE(dados->>'STATUS','') = 'ATIVO') DESC, codigo_produto ASC
               LIMIT %s""",
            (termo, termo, max(1, min(limit, 50))),
        )
        rows = cur.fetchall()
        return {"itens": [{"codigo": r[0], "descricao": r[1], "status": r[2]} for r in rows]}
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Biblioteca de produtos (reutilizável)
# ─────────────────────────────────────────────
@router.get("/biblioteca")
def listar_biblioteca(q: str = "", user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    termo = f"%{q.strip()}%"
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id::text, codigo_produto, descricao, imagem_id::text
               FROM catalogo_biblioteca
               WHERE codigo_produto ILIKE %s OR COALESCE(descricao,'') ILIKE %s
               ORDER BY codigo_produto ASC""",
            (termo, termo),
        )
        return {"itens": [{"id": r[0], "codigo": r[1], "descricao": r[2], "imagem_id": r[3]} for r in cur.fetchall()]}
    finally:
        cur.close()
        conn.close()


@router.post("/biblioteca")
def adicionar_biblioteca(payload: BibliotecaCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        descricao = payload.descricao
        if not descricao:
            cur.execute("SELECT descricao FROM catalogo_base_produtos WHERE codigo_produto = %s", (payload.codigo_produto,))
            b = cur.fetchone()
            descricao = b[0] if b else None
        cur.execute(
            """INSERT INTO catalogo_biblioteca (codigo_produto, descricao, imagem_id, criado_por)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (codigo_produto)
               DO UPDATE SET descricao = COALESCE(EXCLUDED.descricao, catalogo_biblioteca.descricao),
                             imagem_id = COALESCE(EXCLUDED.imagem_id, catalogo_biblioteca.imagem_id)
               RETURNING id::text""",
            (payload.codigo_produto, (descricao or "")[:200], payload.imagem_id, user_id),
        )
        bid = cur.fetchone()[0]
        conn.commit()
        return {"ok": True, "id": bid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.patch("/biblioteca/{bid}")
def atualizar_biblioteca(bid: str, payload: BibliotecaUpdate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    data = payload.dict(exclude_unset=True)
    if not data:
        return {"ok": True, "atualizado": False}
    campos, valores = [], []
    for col in ("descricao", "imagem_id"):
        if col in data:
            campos.append(f"{col} = %s")
            valores.append(data[col])
    valores.append(bid)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"UPDATE catalogo_biblioteca SET {', '.join(campos)} WHERE id = %s", valores)
        conn.commit()
        return {"ok": True, "atualizado": cur.rowcount > 0}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.delete("/biblioteca/{bid}")
def remover_biblioteca(bid: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM catalogo_biblioteca WHERE id = %s", (bid,))
        conn.commit()
        return {"ok": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Helpers de leitura
# ─────────────────────────────────────────────
def _ficha_do_produto(cur, codigo: str, colunas_ficha: List[str]) -> dict:
    if not colunas_ficha or not codigo:
        return {}
    cur.execute("SELECT dados FROM catalogo_base_produtos WHERE codigo_produto = %s", (codigo,))
    row = cur.fetchone()
    dados = row[0] if row else {}
    return {col: dados.get(col, "") for col in colunas_ficha}


def _modelo_dict(cur, mid: str, com_produtos: bool = True) -> Optional[dict]:
    cur.execute(
        """SELECT id::text, nome, titulo_pagina, subtitulo, ano, oficial, colunas_ficha,
                  capa_inicial_id::text, capa_indice_id::text, capa_final_id::text,
                  usar_capa_padrao, criado_em, atualizado_em
           FROM catalogo_modelo WHERE id = %s""",
        (mid,),
    )
    m = cur.fetchone()
    if not m:
        return None
    colunas_ficha = m[6] or []
    out = {
        "id": m[0], "nome": m[1], "titulo_pagina": m[2], "subtitulo": m[3],
        "ano": m[4], "oficial": bool(m[5]), "colunas_ficha": colunas_ficha,
        "capa_inicial_id": m[7], "capa_indice_id": m[8], "capa_final_id": m[9],
        "usar_capa_padrao": bool(m[10]),
        "criado_em": m[11].isoformat() if m[11] else None,
        "atualizado_em": m[12].isoformat() if m[12] else None,
    }
    if com_produtos:
        cur.execute(
            """SELECT b.id::text, b.codigo_produto, b.descricao, b.imagem_id::text, p.ordem
               FROM catalogo_produto p JOIN catalogo_biblioteca b ON b.id = p.biblioteca_id
               WHERE p.modelo_id = %s ORDER BY p.ordem ASC, p.criado_em ASC""",
            (mid,),
        )
        produtos = []
        for p in cur.fetchall():
            produtos.append({
                "biblioteca_id": p[0], "codigo_produto": p[1], "descricao": p[2],
                "imagem_id": p[3], "ordem": p[4],
                "ficha": _ficha_do_produto(cur, p[1], colunas_ficha),
            })
        out["produtos"] = produtos
    return out


# ─────────────────────────────────────────────
#  Modelos (CRUD)
# ─────────────────────────────────────────────
@router.get("/modelos")
def listar_modelos(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT m.id::text, m.nome, m.titulo_pagina, m.ano, m.oficial, m.atualizado_em,
                      (SELECT COUNT(*) FROM catalogo_produto p WHERE p.modelo_id = m.id) AS incluidos
               FROM catalogo_modelo m ORDER BY m.oficial DESC, m.atualizado_em DESC"""
        )
        return {
            "modelos": [
                {
                    "id": r[0], "nome": r[1], "titulo_pagina": r[2], "ano": r[3],
                    "oficial": bool(r[4]),
                    "atualizado_em": r[5].isoformat() if r[5] else None,
                    "produtos_incluidos": r[6],
                }
                for r in cur.fetchall()
            ]
        }
    finally:
        cur.close()
        conn.close()


@router.post("/modelos")
def criar_modelo(payload: ModeloCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO catalogo_modelo (nome, titulo_pagina, subtitulo, ano, colunas_ficha, usar_capa_padrao, criado_por)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
            (
                payload.nome,
                payload.titulo_pagina or "Catálogo EMPRESA 2026",
                payload.subtitulo,
                payload.ano or 2026,
                json.dumps(payload.colunas_ficha or [], ensure_ascii=False),
                payload.usar_capa_padrao if payload.usar_capa_padrao is not None else True,
                user_id,
            ),
        )
        mid = cur.fetchone()[0]
        conn.commit()
        return {"ok": True, "id": mid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/modelos/{mid}")
def obter_modelo(mid: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        m = _modelo_dict(cur, mid, com_produtos=True)
        if not m:
            raise HTTPException(status_code=404, detail="Modelo não encontrado")
        return m
    finally:
        cur.close()
        conn.close()


@router.patch("/modelos/{mid}")
def atualizar_modelo(mid: str, payload: ModeloUpdate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    data = payload.dict(exclude_unset=True)
    if not data:
        return {"ok": True, "atualizado": False}
    campos, valores = [], []
    for col in ("nome", "titulo_pagina", "subtitulo", "ano", "usar_capa_padrao",
                "capa_inicial_id", "capa_indice_id", "capa_final_id"):
        if col in data:
            campos.append(f"{col} = %s")
            valores.append(data[col])
    if "colunas_ficha" in data:
        campos.append("colunas_ficha = %s")
        valores.append(json.dumps(data["colunas_ficha"] or [], ensure_ascii=False))
    campos.append("atualizado_em = CURRENT_TIMESTAMP")
    valores.append(mid)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"UPDATE catalogo_modelo SET {', '.join(campos)} WHERE id = %s", valores)
        conn.commit()
        return {"ok": True, "atualizado": cur.rowcount > 0}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.delete("/modelos/{mid}")
def remover_modelo(mid: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM catalogo_modelo WHERE id = %s", (mid,))
        conn.commit()
        return {"ok": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.post("/modelos/{mid}/oficial")
def marcar_oficial(mid: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Toggle independente: cada ficha pode ser publicada (oficial) sem desmarcar as
        # outras — várias fichas oficiais coexistem e aparecem na galeria pública.
        cur.execute("UPDATE catalogo_modelo SET oficial = NOT oficial, atualizado_em = CURRENT_TIMESTAMP WHERE id = %s RETURNING oficial", (mid,))
        row = cur.fetchone()
        if row is None:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Modelo não encontrado")
        conn.commit()
        return {"ok": True, "oficial": bool(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Itens do modelo (flag de inclusão a partir da biblioteca)
# ─────────────────────────────────────────────
@router.get("/modelos/{mid}/biblioteca")
def biblioteca_do_modelo(mid: str, q: str = "", user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Lista a biblioteca com flag 'incluido' p/ este modelo (alimenta a lista de flags + busca)."""
    _require_admin(user_id)
    termo = f"%{q.strip()}%"
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT b.id::text, b.codigo_produto, b.descricao, b.imagem_id::text,
                      p.id IS NOT NULL AS incluido, COALESCE(p.ordem, 0)
               FROM catalogo_biblioteca b
               LEFT JOIN catalogo_produto p ON p.biblioteca_id = b.id AND p.modelo_id = %s
               WHERE b.codigo_produto ILIKE %s OR COALESCE(b.descricao,'') ILIKE %s
               ORDER BY incluido DESC, COALESCE(p.ordem, 0) ASC, b.codigo_produto ASC""",
            (mid, termo, termo),
        )
        return {
            "itens": [
                {"biblioteca_id": r[0], "codigo": r[1], "descricao": r[2], "imagem_id": r[3],
                 "incluido": bool(r[4]), "ordem": r[5]}
                for r in cur.fetchall()
            ]
        }
    finally:
        cur.close()
        conn.close()


@router.post("/modelos/{mid}/itens")
def incluir_item(mid: str, payload: ItemCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT COALESCE(MAX(ordem), 0) FROM catalogo_produto WHERE modelo_id = %s", (mid,))
        ordem = (cur.fetchone()[0] or 0) + 1
        cur.execute(
            """INSERT INTO catalogo_produto (modelo_id, biblioteca_id, ordem)
               VALUES (%s, %s, %s)
               ON CONFLICT (modelo_id, biblioteca_id) DO NOTHING""",
            (mid, payload.biblioteca_id, ordem),
        )
        conn.commit()
        return {"ok": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.delete("/modelos/{mid}/itens/{biblioteca_id}")
def excluir_item(mid: str, biblioteca_id: str, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM catalogo_produto WHERE modelo_id = %s AND biblioteca_id = %s", (mid, biblioteca_id))
        conn.commit()
        return {"ok": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.post("/modelos/{mid}/itens/ordem")
def reordenar_itens(mid: str, payload: ReordenarPayload, user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for idx, bid in enumerate(payload.ordem, start=1):
            cur.execute("UPDATE catalogo_produto SET ordem = %s WHERE modelo_id = %s AND biblioteca_id = %s", (idx, mid, bid))
        conn.commit()
        return {"ok": True, "total": len(payload.ordem)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Imagens (BYTEA) — já padronizadas no cliente antes do upload
# ─────────────────────────────────────────────
@router.post("/imagens")
async def upload_imagem(file: UploadFile = File(...), user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_admin(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        content = await file.read()
        mime = file.content_type or "image/jpeg"
        cur.execute(
            "INSERT INTO catalogo_imagem (imagem, mime_type, criado_por) VALUES (%s, %s, %s) RETURNING id::text",
            (content, mime, user_id),
        )
        iid = cur.fetchone()[0]
        conn.commit()
        return {"ok": True, "id": iid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/imagens/{iid}")
def obter_imagem(
    iid: str,
    _uid: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id_from_session),
):
    effective = user_id or _uid
    if not effective:
        raise HTTPException(status_code=401, detail="Não autenticado")
    # Imagens do catálogo são visíveis a todos os usuários logados
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT imagem, mime_type FROM catalogo_imagem WHERE id = %s", (iid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Imagem não encontrada")
        return Response(content=bytes(row[0]), media_type=row[1])
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────
#  Página pública — versão oficial
# ─────────────────────────────────────────────
@router.get("/oficial")
def catalogo_oficial(user_id: Optional[str] = Depends(get_user_id_from_session)):
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id::text FROM catalogo_modelo WHERE oficial = TRUE LIMIT 1")
        row = cur.fetchone()
        if not row:
            return {"oficial": None}
        m = _modelo_dict(cur, row[0], com_produtos=True)
        return {"oficial": m}
    finally:
        cur.close()
        conn.close()


@router.get("/oficiais")
def catalogos_oficiais(user_id: Optional[str] = Depends(get_user_id_from_session)):
    """Todas as fichas marcadas como oficiais (com produtos), para a galeria pública.
    A busca por nome da ficha ou por produto é feita no frontend sobre esta lista."""
    _require_view(user_id)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id::text FROM catalogo_modelo WHERE oficial = TRUE ORDER BY ano DESC, atualizado_em DESC")
        ids = [r[0] for r in cur.fetchall()]
        fichas = [_modelo_dict(cur, i, com_produtos=True) for i in ids]
        return {"fichas": [f for f in fichas if f]}
    finally:
        cur.close()
        conn.close()
