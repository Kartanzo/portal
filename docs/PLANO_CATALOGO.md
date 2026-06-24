# Plano — Módulo Catálogo (Marketing)

> Ambiente alvo inicial: **homolog** (`portal_chamado_homolog`, backend 8010, frontend 8090). Só vai para produção após validação.

## 1. Objetivo
Permitir que o Marketing **monte catálogos de produtos** (estilo revista/flipbook — baseado na skill `empresa-catalogo-produtos`) configurando título, capas e produtos, e marque uma **versão oficial**. A página pública de Catálogo passa a refletir a versão oficial.

## 2. Onde entra (DECIDIDO)
Espelhando o padrão de "Eventos" (público em `/eventos`; config em `/marketing/eventos`):
- **Menu — abaixo de "Eventos"**: novo item **"Catálogo"** → rota pública `/catalogo` (flipbook da versão oficial), módulo `catalogo_view`. Link no `Sidebar.tsx` logo após o NavLink de `/eventos` (linha ~106).
- **Dentro de Marketing**: nova **aba "Catálogo"** em `MarketingPage.tsx` (ao lado de "Eventos") com as configurações/dados/fotos, módulo `catalogo_admin`.
- Novo componente `frontend/src/components/Marketing/CatalogoManager.tsx` (configurador).
- Nova página `frontend/src/components/Catalogo/CatalogoPublico.tsx` (flipbook adaptado da skill `empresa-catalogo-produtos`) na rota `/catalogo`.

## Decisões confirmadas pelo usuário
1. **Base**: importar com botão "Sincronizar" → tabela `catalogo_base_produtos`.
2. **Ficha técnica**: sempre reflete a base atual + colunas selecionadas no momento (não snapshot). → `catalogo_produto.ficha` é derivada na leitura a partir de `catalogo_base_produtos` + `colunas_ficha`; guardamos só `codigo_produto`, foto, flag e ordem.
3. **Página pública**: rota `/catalogo` dentro do portal, no menu abaixo de Eventos.

## 3. Análise da base (Google Sheets)
Fonte: `https://docs.google.com/spreadsheets/d/1CjXWXXd0rk5Bxnrt_DTGt9wmRk0AYbOzJWPtDBUlghw`

- **842 produtos**, cabeçalho de **2 níveis** (linha 1 = grupo, linha 2 = nome da coluna). **75 colunas**.
- Grupos: **MARKETING** (cols 1–18), **PCP** (19–27), **LOGÍSTICA - EMBALAGEM INDIVIDUAL** (28–32), **LOGÍSTICA - EMBALAGEM MASTER** (33–41), **Usuário 30** (42–45), **Usuário 30 - ICMS 18% / 12% / 7%** (46–74).
- Chave: **`CÓDIGO PRODUTO`** (col 0) + **`DESCRIÇÃO DO PRODUTO`** (col 1).
- STATUS: ATIVO 701, INATIVO 120, ESTUDO 14, vazio 7.
- FAMÍLIA: Assentos Sanitários 320, Acessibilidade e Prevenção 153, Acessórios p/ Banheiro 108, Utilidades 112, Linha Hidráulica 91, Orthopauher 47, Agrícola 10, Componentes 1.
- CANAL: Construção 634, Acessibilidade 199, Agrícola 8, Bonificação 1.

Colunas mais úteis p/ ficha técnica do catálogo (grupo MARKETING/PCP): DESCRIÇÃO, FAMÍLIA, LINHA, MODELO, CATEGORIA, TIPO, FORMATO LOUÇA, CANAL, ÁREA DE UTILIZAÇÃO, COR, MATERIAL, EAN 13.

## 4. Funcionalidades pedidas (mapeadas)
1. Aba "Catálogo" no Marketing.
2. Config geral: **título da página**, **ano** (default 2026), **subtítulo**.
3. **Seletor de colunas** (botão antes da configuração): marca quais colunas da base aparecem na ficha técnica — **aplica a TODOS os produtos** do modelo. (armazenado em `colunas_ficha`).
4. **Capas**: capa inicial (pré-salva: arte vermelha "Catálogo EMPRESA **2026**"), índice e capa final — todas opcionais/uploadáveis.
5. **Produtos**: adicionar produto = upload de foto + selecionar **CÓDIGO** ou **DESCRIÇÃO** (autocomplete da base). Ficha preenchida automaticamente com as colunas selecionadas.
6. **Flag de inclusão**: marcar quais produtos entram no catálogo.
7. **Salvar modelo** + opção **"versão oficial"**. Só 1 oficial por vez.
8. Página pública reflete a versão oficial.

## 5. Schema proposto (PostgreSQL — schema homolog primeiro)

```sql
-- Armazém de imagens (capas e fotos de produto) — padrão BYTEA igual eventos_album_fotos
CREATE TABLE catalogo_imagem (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imagem BYTEA NOT NULL,
  mime_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por UUID
);

-- Modelos/versões de catálogo
CREATE TABLE catalogo_modelo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(120) NOT NULL,
  titulo_pagina VARCHAR(160) NOT NULL DEFAULT 'Catálogo EMPRESA 2026',
  subtitulo TEXT,
  ano INTEGER NOT NULL DEFAULT 2026,
  oficial BOOLEAN NOT NULL DEFAULT FALSE,
  colunas_ficha JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ex: ["FAMÍLIA","TIPO","MATERIAL","COR"]
  capa_inicial_id UUID REFERENCES catalogo_imagem(id),
  capa_indice_id  UUID REFERENCES catalogo_imagem(id),
  capa_final_id   UUID REFERENCES catalogo_imagem(id),
  usar_capa_padrao BOOLEAN NOT NULL DEFAULT TRUE,  -- usa a arte vermelha pré-salva
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por UUID,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Garante no máximo 1 oficial:
CREATE UNIQUE INDEX uq_catalogo_oficial ON catalogo_modelo(oficial) WHERE oficial = TRUE;

-- Produtos dentro de um modelo
CREATE TABLE catalogo_produto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID NOT NULL REFERENCES catalogo_modelo(id) ON DELETE CASCADE,
  codigo_produto VARCHAR(40) NOT NULL,      -- chave na base
  descricao VARCHAR(200),                   -- snapshot p/ exibição
  imagem_id UUID REFERENCES catalogo_imagem(id),
  ficha JSONB NOT NULL DEFAULT '{}'::jsonb, -- {coluna: valor} das colunas selecionadas
  incluir BOOLEAN NOT NULL DEFAULT TRUE,    -- flag p/ entrar no catálogo
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_catalogo_produto_modelo ON catalogo_produto(modelo_id, ordem);

-- Cache/import da base (para autocomplete e preenchimento de ficha)
CREATE TABLE catalogo_base_produtos (
  codigo_produto VARCHAR(40) PRIMARY KEY,
  descricao VARCHAR(200),
  dados JSONB NOT NULL,                      -- todas as 75 colunas {coluna: valor}
  sincronizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 6. Endpoints backend (`backend/modulo/catalogo.py`, prefix `/catalogo`)
- `GET  /catalogo/base/colunas` → lista de colunas (com grupo) p/ o seletor.
- `POST /catalogo/base/sync` → busca o CSV do Sheets, popula `catalogo_base_produtos`. (admin)
- `GET  /catalogo/base/buscar?q=` → autocomplete por código/descrição (status ATIVO).
- `GET  /catalogo/modelos` / `POST` / `PATCH /{id}` / `DELETE /{id}` → CRUD de modelos.
- `POST /catalogo/modelos/{id}/oficial` → marca como oficial (zera os demais).
- `GET/POST/PATCH/DELETE /catalogo/modelos/{id}/produtos` (+ `/ordem`) → produtos do modelo + flag incluir.
- `POST /catalogo/imagens` (upload BYTEA) / `GET /catalogo/imagens/{id}` (binário).
- `GET  /catalogo/oficial` → payload pronto p/ a página pública (título, capas, produtos incluídos com ficha).

## 7. Permissões
- `catalogo_admin` (configurar — Marketing) e `catalogo_view` (ver página pública).
- Registrar ambos em `backend/role_permissions.json` em todos os roles (default `can_view:false`).
- Guard de rota no frontend + `check_module_permission` no backend.

## 8. Página pública
Adaptar `CatalogoPage` da skill `empresa-catalogo-produtos`: em vez de `catalogPages` fixo, consumir `GET /catalogo/oficial` e montar capa(s) + páginas de produto (ficha = colunas selecionadas). Capa padrão = arte vermelha com ano 2026.

## 9. Ordem de execução sugerida
1. Migrations (homolog) + permissões.
2. Backend: base sync + autocomplete + CRUD modelos/produtos/imagens + `/oficial`.
3. Frontend: aba Catálogo + CatalogoManager (config, seletor de colunas, capas, produtos, flag, salvar/oficial).
4. Página pública (flipbook) consumindo `/oficial`.
5. Validar em homolog → produção.
