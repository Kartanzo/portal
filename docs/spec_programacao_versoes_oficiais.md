# Especificação — Versões Oficiais, Programação e Auditoria de Máquinas

> Documento de planejamento. Nada será implementado antes da sua aprovação.
> Ambiente: **homolog-first** (`portal_chamado_homolog`). Mantém os padrões de UI já firmados
> (background da T.I, KPI/badges, ícones lucide — **sem emoji**, **sem quebra de linha**,
> **sem alertas nativos** (modais próprios), tabelas com **ordenar/redimensionar/cache por usuário**).

---

## 1. O que você pediu (resumo fiel)

1. **Auditoria de máquinas**: ao excluir uma máquina não fica registro de quem excluiu. Precisa registrar **quem criou** e **quem excluiu** (e quando).
2. **Flag "oficial" no Otimizador de Produção**: ao salvar um modelo/versão, ter a opção de marcar como **oficial**.
3. **Programação deixa de puxar a última versão automaticamente**. Novo fluxo:
   - Ao entrar na Programação, aparece a **lista das versões com flag oficial**; o usuário **seleciona** e os dados carregam.
   - A versão escolhida fica **fixa**: toda vez que o usuário entrar, ela aparece carregada.
   - Se alguém criar uma **nova versão oficial**, a tela de Programação mostra um **alerta** de que há uma nova versão.
   - O usuário pode **carregar** a nova versão **ou comparar**:
     - ver **o que mudou** da versão carregada para a nova;
     - **itens que saíram**, **itens novos**, **mudança de sequência**, **mudança na quantidade a produzir**.
4. **Layout muito bom** em tudo isso.

---

## 2. Modelo de dados (backend)

### 2.1. `plano_producao_versoes` (alterar)
Adicionar colunas:
| Coluna | Tipo | Uso |
|--------|------|-----|
| `oficial` | BOOLEAN DEFAULT FALSE | marca a versão como oficial |
| `oficial_em` | TIMESTAMP | quando virou oficial |
| `oficial_por` | TEXT | id do usuário que marcou |
| `oficial_por_nome` | TEXT | nome (resolvido de `users`) |

> Migração idempotente via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Versões antigas continuam válidas (oficial = false).

### 2.2. `maquina_log` (nova) — auditoria de máquinas
| Coluna | Tipo |
|--------|------|
| `id` | SERIAL PK |
| `maquina_id` | INTEGER (sem FK — sobrevive à exclusão) |
| `maquina_nome` | TEXT (guardado no momento da ação) |
| `acao` | TEXT — `criou` \| `excluiu` \| `renomeou` |
| `detalhe` | TEXT (opcional, ex.: nome antigo→novo) |
| `user_id` | TEXT |
| `user_nome` | TEXT |
| `created_at` | TIMESTAMP DEFAULT NOW() |

Gravado em: criar máquina, excluir máquina, renomear (opcional).
*(As regras/exceções já têm `created_by` + auditoria no modal de exceções; o log de máquina cobre o ciclo de vida da máquina.)*

### 2.3. Versão selecionada por usuário
- **Proposta:** salvar no **localStorage por usuário** (`programacao:versao:{userId}` = id da versão), igual ao padrão das tabelas.
- *Decisão pendente (ver §7):* localStorage (por navegador) **ou** no banco (acompanha em qualquer dispositivo).

---

## 3. Backend — endpoints

### 3.1. Otimizador de Produção
- **Alterar** `POST /fabrica/plano-producao/gerar`: aceitar `oficial: bool` no corpo → grava a versão já marcada como oficial (com `oficial_por`/nome/data).
- **Novo** `PUT /fabrica/plano-producao/versoes/{id}/oficial` `{ oficial: true|false }`: marca/desmarca uma versão existente como oficial (registra usuário/data).
- Em `GET /fabrica/plano-producao/versoes`: incluir os campos `oficial`, `oficial_em`, `oficial_por_nome`.

### 3.2. Programação
- **Novo** `GET /programacao/versoes-oficiais` → lista só as versões `oficial = true` (id, data de criação, autor, `hoje`, `oficial_em`, autor do flag), ordenadas da mais nova para a mais antiga.
- **Alterar** `GET /programacao/plano` → passa a aceitar `?versao_id=` e retorna o plano **daquela** versão (não mais "a última"). Sem `versao_id`, retorna vazio (a tela pede para selecionar).
- `GET /programacao/ops` → permanece igual.
- **Novo** `GET /programacao/comparar?base={id}&novo={id}` → retorna o **diff** entre dois planos:
  ```json
  {
    "novos":      [{ "codigo","descricao","sequencia_novo","qtd_novo" }],
    "removidos":  [{ "codigo","descricao","sequencia_base","qtd_base" }],
    "seq_mudou":  [{ "codigo","descricao","sequencia_base","sequencia_novo" }],
    "qtd_mudou":  [{ "codigo","descricao","qtd_base","qtd_novo","delta" }],
    "resumo": { "novos": n, "removidos": n, "seq": n, "qtd": n }
  }
  ```
  Diff por **CODIGO_PRODUTO**; sequência e quantidade comparadas item a item.

### 3.3. Máquinas
- Gravar em `maquina_log` ao criar/excluir/renomear.
- **Novo** `GET /maquinas/historico` → lista o log (ação, máquina, usuário, data), com busca. Usado por um botão "Histórico" na tela.

---

## 4. Frontend — Programação (fluxo e layout)

### 4.1. Ao entrar
1. Busca `versoes-oficiais`.
2. Se há uma versão salva no localStorage do usuário **e ela ainda é oficial** → carrega ela direto (fixa).
3. Senão → mostra um **seletor de versão oficial** (card central com a lista; o usuário clica e carrega). Após escolher, salva no localStorage.

### 4.2. Seletor de versão (layout)
- Card "Selecione a versão oficial" com lista em linhas: data, autor, marcador "oficial", botão **Carregar**.
- Acessível também depois por um botão no cabeçalho (**"Versão: …"**) para trocar quando quiser.

### 4.3. Alerta de nova versão
- Se a versão oficial **mais recente** tiver id diferente da carregada → **banner** no topo (não-bloqueante, estilo destaque âmbar/azul, com ícone):
  > "Há uma nova versão oficial (de FULANO, dd/mm hh:mm)." — botões **[Comparar]** e **[Carregar nova]**.

### 4.4. Modal de comparação (layout caprichado)
- Cabeçalho: "Comparando versão carregada (data) → nova versão (data)".
- **4 KPIs** de diff: Novos, Removidos, Sequência alterada, Quantidade alterada (cada um com cor/ícone).
- **Abas/seções** com tabelas (info-first, valores por último; truncate+tooltip):
  - **Itens novos** (verde) — código, descrição, seq, qtd.
  - **Itens removidos** (vermelho) — código, descrição, seq/qtd antigos.
  - **Sequência alterada** (azul) — código, descrição, seq antiga → nova (com seta).
  - **Quantidade alterada** (âmbar) — código, descrição, qtd antiga → nova, delta (+/−).
- Botão **[Carregar nova versão]** no rodapé do modal.

### 4.5. Demais
- Mantém os KPIs e a tabela do plano atuais, com expandir/duplo-clique/OPs já feitos.
- Cache continua: não recarrega ao reentrar; botão "Atualizar" recarrega.

---

## 5. Frontend — Otimizador de Produção
- Na ação de **salvar versão**, adicionar um controle (checkbox/switch) **"Marcar como oficial"**.
- Na lista de versões, ação para **marcar/desmarcar oficial** (badge "Oficial" visível).
- *(Só toca no fluxo de salvar/listar; não altera o cálculo do otimizador.)*

---

## 6. Frontend — Cadastro de Máquinas (auditoria)
- Botão **"Histórico"** no painel → modal com tabela: **Ação** (Criou/Excluiu/Renomeou, badge), **Máquina**, **Usuário**, **Data**, com busca.
- Confirmação de exclusão já usa o modal próprio (`useConfirm`); a exclusão passa a gravar no `maquina_log`.

---

## 7. Decisões pendentes (preciso confirmar antes de implementar)

1. **Persistência da versão selecionada**: localStorage por usuário (simples, por navegador) **ou** no banco por conta (acompanha em qualquer dispositivo)?
2. **Auditoria**: registrar só **máquinas** (criar/excluir/renomear), ou também criar/remover **regras e exceções** no mesmo histórico?
3. **Marcar oficial**: pode haver **várias versões oficiais** ao mesmo tempo (o que combina com "lista de versões oficiais"), correto? Ou **apenas uma** oficial por vez (a nova desmarca a anterior)?
4. **Comparação**: comparar sempre **carregada × mais recente oficial**, ou permitir o usuário escolher **duas versões quaisquer** para comparar?

---

## 8. Ordem de implementação (após aprovação)

1. Backend: migração de colunas + `maquina_log` + endpoints (oficial, versões-oficiais, plano por id, comparar, histórico).
2. Otimizador: flag oficial (salvar + marcar/listar).
3. Programação: seletor de versão + carga fixa + alerta + modal de comparação.
4. Máquinas: log + modal de histórico.
5. Validação (type-check/compile) e, com seu OK, commit/push em `homolog`.

> Cada etapa validada antes da próxima. Push só em `homolog`, com sua autorização.
