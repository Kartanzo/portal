# Spec — Otimizador de Faturamento (sobre a Programação)

> **Status:** especificação consolidada (decisões fechadas) — pronta para refino de implementação.
> **Última atualização:** 2026-06-06
> **Ambiente alvo:** homolog-first (`portal_chamado_homolog`) → produção (`portal_chamado`).
> **Legenda:**
> - ✅ **DECISÃO** = definido/confirmado pelo usuário (Diego).
> - 💡 **PROPOSTA** = detalhe técnico da IA derivado das decisões (a refinar na implementação).
> - 🔗 **DEPENDÊNCIA** = exige mudança em outro módulo (Programação) antes de implementar o faturamento.

---

## 1. Objetivo

O **Otimizador de Faturamento** deixa de analisar o **plano cru** do otimizador de produção e passa a ser gerado **sobre a Programação** (a versão oficial que a operação confirmou). Ganha:

1. ✅ **Versionamento + comparação** entre versões (igual à Programação).
2. ✅ **Visão por pedido inteiro** (não por linha de produto).
3. ✅ **Ordenação pela previsão de término definida na Programação** (não pela sequência de produção).
4. ✅ **Simulador de cenários** ("e se") com filtros, remoção de produtos/clientes e **salvar com labels**.
5. ✅ **Versão oficial** de faturamento.

---

## 2. Arquitetura: a cadeia de versões (CRÍTICO)

### 2.1 ✅ DECISÃO — O faturamento é vinculado à PROGRAMAÇÃO, não ao otimizador de produção

É uma **cadeia**. Mudou a versão do plano → afeta a **Programação** → afeta o **Faturamento**. A mudança **cascateia**.

```
Plano oficial (otimizador de produção)
        │  (Programação avisa: "versão oficial nova" + comparar)
        ▼
   PROGRAMAÇÃO  ← FONTE DA VERDADE do faturamento
   (board: máquina × item × ordem × lote × previsão de término)
        │  (Faturamento avisa: "a programação mudou" + comparar)
        ▼
   OTIMIZADOR DE FATURAMENTO  ← novo elo final da cadeia
   (pedidos completos, ordenados pela previsão de término da Programação)
```

**Consequências (✅):**
- O faturamento **sempre olha a versão oficial** vigente.
- A noção de "pedido completo" **nasce** no otimizador de produção, mas o faturamento a consome **através da Programação** — porque a Programação é a camada que o usuário confirmou e que pode ter alterado quantidades, itens e datas.
- Todos os dados do faturamento (demanda, estoques, em produção, datas) refletem a **Programação oficial**, **não** o plano cru.
- O aviso de "versão nova" no faturamento dispara a partir da **Programação** (não do plano).

### 2.2 ✅ DECISÃO — Notificação quando a Programação muda

Assim como a Programação avisa quando surge nova versão oficial do plano, o **Faturamento avisa quando a Programação muda** (com opção de **comparar** e **regerar**), porque o faturamento é gerado **sobre** a Programação.

### 2.3 ✅ DECISÃO — Salvar a Programação cria a versão

A pessoa da **operação** tem um **botão/campo para salvar a Programação**. Cada save explícito **gera uma versão/snapshot** da Programação. É esse snapshot que:
- o faturamento consome;
- serve de base para o aviso "mudou" e para a comparação.

---

## 3. Visualização: por pedido inteiro

### 3.1 ✅ DECISÃO — Granularidade

| | Otimizador de **Produção** | Otimizador de **Faturamento** |
|---|---|---|
| Unidade visual | **Linha do produto** (SKU) | **Pedido inteiro** |
| Eixo de ordenação | **Sequência de produção** | **Previsão de término da Programação** |
| Pergunta que responde | "O que produzir e em que ordem?" | "Quais pedidos faturam, e quando?" |

- A visão **por pedido inteiro já existe hoje** — mantém-se.
- ✅ **Não** mostrar a sequência de produção. **Ordenar pela previsão de término da Programação.**

### 3.2 ✅ DECISÃO — Dados trazidos por produto dentro do pedido

Para cada **produto** de cada pedido, o faturamento traz:

| Coluna | Origem |
|---|---|
| **Demanda** (do produto naquele pedido) | carteira / detalhe do pedido |
| **Estoque disponível** | estoque |
| **Reserva** | estoque |
| **Estoque físico** | estoque |
| **Quantidade em produção** | Programação / OPs |

💡 Interpretação: o faturamento mostra, por produto, **demanda × (disponível + reserva + físico + em produção)** — deixando claro o quanto está coberto e o que depende de produção.

### 3.3 ✅ DECISÃO — Quais pedidos podem ser faturados

- Apenas os pedidos marcados como **COMPLETO** (origem: `pedidos_completos` do otimizador de produção), **consumidos via Programação oficial** (§2.1).

---

## 4. Regras de ordenação (CRÍTICO)

### 4.1 ✅ DECISÃO — Hierarquia de ordenação

1. **PRIMÁRIO — Previsão de término definida pela Programação** (mais cedo primeiro). É a Programação quem posiciona o pedido na linha do tempo.
2. **SECUNDÁRIO — Regra de atraso** (mesma do otimizador de produção: atrasado / imediato / programado), **dentro da mesma data**: atrasados primeiro.
3. **TERCIÁRIO — Valor total do pedido** (maior primeiro), como desempate **dentro da mesma data**.

### 4.2 ✅ DECISÃO — A previsão de término da Programação NÃO é sobreposta pelo atraso

> **Regra de ouro:** atraso e valor **não reordenam por cima da data da Programação**. Eles só desempatam **entre pedidos que a Programação colocou na mesma data**.

### 4.3 Exemplo decisivo (caso dos 40 dias)

> Pedido **A**: **40 dias de atraso**, mas a Programação previu término no **mês seguinte**.
> Pedido **B**: 3 dias de atraso, previsto para **esta semana**.

**Resultado:** **B vem antes de A.** O A **não** vai pro topo por estar muito atrasado — cai no **mês seguinte**, na data que a Programação prometeu.

```
ERRADO (só por atraso):          CERTO (previsão da Programação manda):
1º A (40 dias atraso)            1º B (término esta semana)
2º B (3 dias atraso)             2º A (término mês seguinte)
```

### 4.4 Exemplo de desempate dentro da mesma data

> Três pedidos previstos para **término em 10/06**:
> - **P1** — 12 dias de atraso — pedido total R$ 8.000
> - **P2** — 12 dias de atraso — pedido total R$ 25.000
> - **P3** — imediato — pedido total R$ 50.000

```
Janela 10/06:
1º  P2  (atrasado, R$ 25.000)  ┐ atrasados primeiro;
2º  P1  (atrasado, R$ 8.000)   ┘ entre atrasados, MAIOR VALOR TOTAL DO PEDIDO
3º  P3  (imediato, R$ 50.000)  → não atrasado entra depois dos atrasados da mesma data
```

✅ Confirmado: o desempate entre pedidos atrasados na mesma data é pelo **valor total do pedido** (não por dias de atraso).

### 4.5 ✅ DECISÃO — Pedidos sem data na Programação

Se o pedido não tem previsão de término (algum item não foi colocado/programado no board):
- **Não** entra na fila ordenada por data.
- Mostrar o pedido sinalizado como **"sem data de programação"**.
- **Informar qual(is) produto(s) está(ão) faltando** para o pedido ficar completo.

💡 **PROPOSTA** — exibir esses pedidos num bucket/seção separada "Sem data de programação", listando os produtos pendentes.

### 4.6 Pseudo-ordenação (proposta)

```python
def chave_ordenacao(pedido):
    return (
        pedido.previsao_termino,            # 1º ASC (mais cedo primeiro)
        0 if pedido.atrasado else 1,        # 2º atrasados antes (dentro da data)
        -pedido.valor_total_pedido,         # 3º maior valor total do pedido
    )
# pedidos sem previsao_termino -> bucket separado "sem data de programação"
```

---

## 5. Previsão de término (data de entrega) — origem do dado

### 5.1 ✅ IMPLEMENTADO — Campo de previsão de término na Programação

A **Programação** tem um **campo de previsão de término por linha** (produto × máquina × lote):
- preenchido **manualmente** pelo usuário (override); **OU**
- **calculado automaticamente** a partir do **peças/hora já existente** do produto na máquina.

**Decisões de cálculo (confirmadas):**
- **Regra:** `previsão = início do lote + (qtd ÷ peças/hora)` em horas.
- **24h contínuo:** as horas estimadas viram tempo corrido (a fábrica não para).
- **Independente:** cada item parte do **início do lote** (não acumula com os anteriores).
- **Início do lote** agora tem **data + hora** (input `datetime-local`).
- **Fuso:** data e hora do **Brasil**.

**Reuso (importante):** NÃO foi criado um `qtd_por_hora` novo. Reusou-se o recurso
**peças/hora** já existente (`maquina_produto_tempo`, endpoints `/programacao/tempos-maquina`
e `PUT /maquinas/{id}/tempo`), evitando duplicar a fonte da verdade.

**Persistência (contrato com o faturamento):** a coluna `previsao_termino` guarda
**apenas o override MANUAL**. `NULL` significa **automático** — o valor automático é
calculado on-the-fly (no front, para exibição; e no backend do faturamento, de forma
autoritativa). Assim o faturamento só **lê/calcula** a partir da Programação.

**Arquivos:** `backend/modulo/programacao.py` (coluna + GET/PUT board),
`backend/migrations/add_previsao_termino_programacao.sql`,
`frontend/.../Fabrica/ProgramacaoPage.tsx` (coluna "Previsão término" no modal da máquina,
manual/auto, início do lote com hora).

### 5.2 ✅ DECISÃO — Produto sem duplicidade + split por máquina

- No faturamento **não pode haver o mesmo produto duplicado dentro de um pedido** (uma linha por produto).
- Se o produto tem **duas previsões de término diferentes** (porque está sendo produzido em **duas máquinas diferentes**), a linha do produto carrega **as datas e a quantidade liberada em cada data**.

**Exemplo:**
> Produto **104-XYZ** no pedido **#555**, demanda 1.000 un, produzido em 2 máquinas:
> - Máquina A → libera **600 un** em **10/06 14:00 (BR)**
> - Máquina B → libera **400 un** em **12/06 09:00 (BR)**
>
> No faturamento: **uma linha** para 104-XYZ no pedido #555, com **duas liberações**: (10/06 → 600) e (12/06 → 400).

💡 **PROPOSTA** — a previsão de término **do pedido** (para a ordenação por data, §4) = **máx(datas de liberação)** entre todos os produtos/quantidades necessárias do pedido (quando o pedido fica **100% liberado**).

---

## 6. Simulador de cenários ("e se")

### 6.1 ✅ DECISÃO — Ao atualizar, permitir simular

O usuário roda **quantas simulações quiser** sobre a Programação, ajustando filtros antes de calcular o faturamento.

### 6.2 ✅ DECISÃO — Filtros disponíveis

| Filtro | Descrição |
|---|---|
| **Dias de entrega** | um ou mais **dias** específicos de término/entrega. |
| **Semana** | semana desejada — ✅ **semana ISO** (segunda a domingo). |
| **Remover produto(s)** | tirar um ou mais **produtos** da otimização. |
| **Remover cliente(s)** | tirar um ou mais **clientes** da otimização. |

💡 Filtros **combináveis** (ex.: "semana ISO 24 **e** sem cliente X **e** sem produto Y").

### 6.3 ✅ DECISÃO — Salvar simulações com label (congeladas)

- Salvar cada cenário com um **label** (etiqueta).
- ✅ **Congelado:** a simulação guarda o **resultado do momento do salvamento** (não recalcula sozinha ao abrir).
- 💡 **PROPOSTA** — botão opcional "recalcular" para reprojetar o cenário sobre a Programação atual.
- Conteúdo salvo: label, versão da Programação base, filtros aplicados, resultado congelado (pedidos ordenados + KPIs), autor e timestamp (BR_TZ).

### 6.4 Exemplo de uso

> 1. Abre o faturamento sobre a Programação oficial.
> 2. Filtros: `semana ISO = 24`, `remover cliente = ATACADÃO`, `remover produto = 104-XYZ`.
> 3. Recalcula → pedidos + KPIs do cenário.
> 4. Salva como **"Semana 24 — sem ATACADÃO / sem 104-XYZ"**.
> 5. Roda **"Semana 24 — base"** (com tudo) e salva.
> 6. Compara os dois cenários salvos.

---

## 7. Comparação entre versões

### 7.1 ✅ DECISÃO — Comparar e ver o que mudou

Igual à Programação, o Faturamento permite **comparar duas versões** e ver o diff. Como a unidade é o **pedido**, o diff é **por pedido**:

| Categoria do diff | Significado |
|---|---|
| **Pedidos novos** | passaram a faturar nesta versão |
| **Pedidos removidos** | deixaram de faturar |
| **Data de término mudou** | mesma carteira, Programação mudou o *quando* |
| **Valor mudou** | qtd/itens mudaram → valor faturável diferente |
| **Posição na ordem mudou** | subiu/desceu na fila por mudança de data/atraso |

💡 Comparações possíveis:
- versão **carregada** × **mais recente** (caso do alerta de "mudou");
- duas **versões** quaisquer do faturamento;
- duas **simulações salvas** (cenário A × cenário B).

---

## 8. Modelo de dados (proposta)

💡 **PROPOSTA** — tabelas no schema atual (isoladas por ambiente via `search_path`/`DB_SCHEMA`), padrão `CREATE TABLE IF NOT EXISTS`, **homolog antes de produção**.

### 8.1 🔗 Programação — versão/snapshot + previsão de término

```sql
-- Snapshot versionado da Programação, gerado no SAVE explícito da operação (§2.3)
CREATE TABLE IF NOT EXISTS programacao_versao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plano_versao_id UUID NOT NULL,            -- versão oficial do plano que originou
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID,
    created_by_name TEXT,
    snapshot        JSONB NOT NULL,           -- board + lotes + previsões no momento
    hash            TEXT NOT NULL,            -- dedup de save sem mudança
    oficial         BOOLEAN DEFAULT FALSE
);

-- ✅ IMPLEMENTADO: previsão de término por linha do board (manual; NULL = automático).
-- O automático reusa o peças/hora existente (maquina_produto_tempo) — NÃO há qtd_por_hora novo.
ALTER TABLE programacao_board ADD COLUMN IF NOT EXISTS previsao_termino TIMESTAMPTZ;       -- override manual; NULL = auto
-- (split por máquina: ver 8.2)
```

🔗 **DEPENDÊNCIA** — o split por máquina (§5.2) exige representar **(produto, máquina, data de liberação, qtd liberada)**. Como o board já tem `maquina_id`/`lote`, a liberação por data sai de `programacao_lote` + `qtd` do board por lote. 💡 Avaliar tabela auxiliar `programacao_liberacao` se precisar de granularidade explícita por data:

```sql
CREATE TABLE IF NOT EXISTS programacao_liberacao (
    versao_id        UUID NOT NULL,
    cod_item         TEXT NOT NULL,
    maquina_id       INTEGER,
    previsao_termino TIMESTAMPTZ NOT NULL,    -- BR_TZ
    qtd_liberada     NUMERIC NOT NULL,
    UNIQUE (versao_id, cod_item, maquina_id, previsao_termino)
);
```

### 8.2 Faturamento — versão

```sql
CREATE TABLE IF NOT EXISTS faturamento_versao (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programacao_versao_id UUID NOT NULL,      -- base (Programação oficial)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            UUID,
    created_by_name       TEXT,
    pedidos               JSONB NOT NULL,     -- pedidos ordenados + produtos + colunas (§3.2)
    totais                JSONB NOT NULL,     -- KPIs de faturamento
    oficial               BOOLEAN DEFAULT FALSE,  -- ✅ versão oficial (§ ponto 6)
    oficial_em            TIMESTAMPTZ,
    oficial_por           UUID,
    oficial_por_nome      TEXT
);
```

### 8.3 Faturamento — simulações salvas (com label)

```sql
CREATE TABLE IF NOT EXISTS faturamento_simulacao (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programacao_versao_id UUID NOT NULL,      -- base da simulação
    label                 TEXT NOT NULL,      -- etiqueta do usuário
    filtros               JSONB NOT NULL,     -- {dias:[], semana_iso:n, remover_produtos:[], remover_clientes:[]}
    resultado             JSONB NOT NULL,     -- pedidos ordenados + KPIs CONGELADOS (§6.3)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            UUID,
    created_by_name       TEXT
);
CREATE INDEX IF NOT EXISTS idx_fat_sim_prog ON faturamento_simulacao(programacao_versao_id);
```

> ✅ Persistência da seleção/cenário do usuário fica **no banco** (não localStorage) — acompanha em qualquer dispositivo.

---

## 9. Endpoints (proposta)

💡 **PROPOSTA** — padrão `programacao.py`, validando `check_module_permission(user_id, 'otimizador_faturamento', lvl)`.

| Método | Rota | Função |
|---|---|---|
| `POST` | `/programacao/salvar-versao` | 🔗 Save explícito → cria `programacao_versao` (§2.3) |
| `GET` | `/faturamento/programacao-oficial` | Versão oficial vigente da Programação |
| `GET` | `/faturamento/tem-versao-nova?base={prog_versao_id}` | A Programação mudou desde a base carregada? |
| `POST` | `/faturamento/gerar` | Gera faturamento sobre a Programação oficial (com filtros opcionais) |
| `GET` | `/faturamento/versoes` | Lista versões de faturamento |
| `PUT` | `/faturamento/versoes/{id}/oficial` | Marca versão de faturamento como oficial |
| `GET` | `/faturamento/comparar?base={id}&novo={id}` | Diff por pedido |
| `POST` | `/faturamento/simulacoes` | Salva simulação (label + filtros + resultado congelado) |
| `GET` | `/faturamento/simulacoes` | Lista simulações salvas |
| `GET` | `/faturamento/simulacoes/{id}` | Carrega simulação |
| `GET` | `/faturamento/simulacoes/comparar?a={id}&b={id}` | Compara dois cenários |
| `DELETE` | `/faturamento/simulacoes/{id}` | Remove simulação |

### 9.1 Corpo proposto do `POST /faturamento/gerar`

```jsonc
{
  "programacao_versao_id": "uuid",   // opcional: default = Programação oficial vigente
  "filtros": {
    "dias": ["2026-06-10", "2026-06-11"],
    "semana_iso": 24,
    "remover_produtos": ["104-XYZ"],
    "remover_clientes": ["ATACADAO"]
  }
}
```

### 9.2 Resposta proposta (por pedido)

```jsonc
{
  "programacao_versao_id": "uuid",
  "gerado_em": "2026-06-06T10:00:00-03:00",
  "pedidos": [
    {
      "pedido": "555",
      "cliente": "...",
      "valor_total_pedido": 25000.0,
      "atrasado": true,
      "dias_atraso": 12,
      "previsao_termino_pedido": "2026-06-12T09:00:00-03:00",  // máx das liberações
      "produtos": [
        {
          "cod": "104-XYZ", "descricao": "...",
          "demanda": 1000,
          "estoque_disponivel": 200, "reserva": 100, "estoque_fisico": 300,
          "qtd_em_producao": 700,
          "liberacoes": [
            {"data": "2026-06-10T14:00:00-03:00", "qtd": 600, "maquina_id": 1},
            {"data": "2026-06-12T09:00:00-03:00", "qtd": 400, "maquina_id": 2}
          ]
        }
      ]
    }
  ],
  "sem_data_programacao": [
    { "pedido": "777", "produtos_faltando": ["104-ABC"] }   // §4.5
  ],
  "totais": { /* KPIs */ }
}
```

---

## 10. Permissões

💡 **PROPOSTA** — reutilizar o `module_id` existente **`otimizador_faturamento`** (`backend/role_permissions.json`):
- `can_view` → ver / gerar / comparar / simular.
- `can_edit` → salvar simulações com label / marcar versão oficial.
- Validar em **todo** endpoint novo.
- 🔗 O endpoint de **salvar versão da Programação** usa o módulo `programacao` (`can_edit`).

---

## 11. Dependências e ordem de implementação

> Como o faturamento é vinculado à Programação, **a Programação precisa evoluir primeiro**.

1. ✅ **FEITO — Programação:** campo de **previsão de término** (manual + cálculo automático reusando peças/hora; início do lote com hora; BR).
2. ✅ **FEITO — Programação:** **save explícito** que gera `programacao_versao` (snapshot de itens/lotes/componentes/peças-hora + dedup por hash + oficial). Endpoints: `POST /programacao/salvar-versao`, `GET /programacao/versoes-salvas`, `PUT /programacao/versoes-salvas/{id}/oficial`. Botão "Salvar versão" na barra da Programação.
3. ✅ **FEITO — Programação:** representação do **split por máquina**. SEM tabela nova: derivado do board (cada produto em N máquinas = N linhas). Helper `compute_liberacoes(snapshot)` + endpoint `GET /programacao/liberacoes` retornam, por produto, as liberações (data de término efetiva + qtd + máquina), calculando o auto autoritativo (peças/hora congelado, 24h contínuo, independente, fuso BR). Manual sobrescreve; inativos fora.
4. ✅ **FEITO (backend + frontend) — Faturamento:** geração sobre a Programação oficial. Módulo `backend/modulo/otimizador_faturamento.py`, endpoint `GET /otimizador-faturamento/gerar` (consome a `programacao_versao` oficial via `compute_liberacoes` + `plano_producao_versoes`). Pedidos completos por pedido inteiro, colunas por produto (demanda, disponível, reserva, físico, em produção), ordenação data→atraso→valor total, bucket "sem data" com produtos faltantes. Função pura `montar_faturamento` testada. Frontend reescrito: `frontend/.../Fabrica/OtimizadorFaturamento.tsx` (tabela por pedido, KPIs, busca, bucket sem-data, liberações por máquina, salvar versão oficial).
5. ✅ **FEITO (backend) — Faturamento:** versões congeladas (`faturamento_versao`) + comparação por pedido (`GET /comparar`) + detecção "a programação mudou" (`GET /tem-versao-nova`) + versão oficial (`POST /salvar-versao`, `PUT /versoes/{id}/oficial`). Funções puras `comparar_faturamento` testadas. **Falta o frontend.**
6. ✅ **FEITO (backend + frontend) — Faturamento:** simulador `POST /simular` (filtros: dias / semana ISO / remover produtos / remover clientes) + salvar cenários com label congelados (`POST/GET/DELETE /simulacoes`, `GET /simulacoes-comparar`). Versão oficial já em (5). Função `gerar_com_filtros` testada. Frontend: painel do simulador (filtros + Simular + Salvar cenário + carregar/remover cenários salvos).

### Pendências de frontend (backend pronto)
- 🔲 UI de **comparação** entre versões/cenários de faturamento (`GET /comparar`, `GET /simulacoes-comparar`).
- 🔲 UI do **aviso "a programação mudou"** (`GET /tem-versao-nova`).
- 🔲 UI de **listar/abrir versões oficiais** salvas (`GET /versoes`, `PUT /versoes/{id}/oficial`).
- 🔲 Filtros de remover produtos/clientes via **multiseleção** (hoje texto separado por vírgula).

---

## 12. Observações técnicas / riscos

- **Regra de atraso (DRY):** já existe duplicada em `plano_producao.py::sequenciar` e `sop_dashboard.py` (~698-732). O faturamento seria a 3ª. 💡 **Proposta:** extrair para util compartilhado (`modulo/pcp_regras.py`) e reutilizar. *(recomendado, não bloqueante.)*
- **Previsão de término do pedido:** = **máx(datas de liberação)** dos produtos do pedido (pedido 100% liberado). Confirmar na implementação com casos reais.
- **Fuso BR:** todo cálculo automático de previsão usa `BR_TZ` (UTC-3). Cuidado ao serializar/persistir (gravar com timezone).
- **Performance do simulador:** calcular a base (pedidos × produtos × liberações) **uma vez** e aplicar filtros em memória/SQL — não reconsultar BigQuery a cada filtro.
- **Cache compartilhado:** se houver cache de faturamento, usar **Postgres** (não arquivo local), como já corrigido no S&OP — para funcionar em multi-réplica.
- **Sem produto duplicado no pedido:** garantir agregação correta quando o mesmo SKU aparece em múltiplos lotes/máquinas → consolidar em **uma linha** com várias liberações (§5.2).

---

## 13. Resumo executivo

O Otimizador de Faturamento passa a ser o **elo final da cadeia PCP**, vinculado à **Programação oficial** (não ao plano cru). Ele:
- parte dos **pedidos completos**, lidos **via Programação**;
- mostra **pedido inteiro**, com **demanda, disponível, reserva, físico e em produção** por produto;
- ordena pela **previsão de término da Programação** (a data manda; atraso e **valor total do pedido** só desempatam **dentro da mesma data**; pedido muito atrasado mas programado pro mês seguinte **não** vai pro topo);
- consolida o produto em **uma linha** mesmo quando produzido em **várias máquinas**, mostrando **quantidade liberada por data**;
- lista à parte os pedidos **sem data de programação**, indicando o **produto faltante**;
- avisa quando a **Programação muda**, permite **comparar versões/cenários**, **simular** (dias/semana ISO, remover produtos/clientes) e **salvar cenários com label** (congelados), com **versão oficial** e persistência **no banco**.
