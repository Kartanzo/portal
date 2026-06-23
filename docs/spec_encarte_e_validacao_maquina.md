# Especificação — Encarte + Validação de Máquina por Produto

> Planejamento. Nada será implementado antes da sua aprovação. homolog-first.
> Mantém os padrões de UI (background, ícones, sem emoji, sem quebra de linha, sem alertas nativos / modais próprios).

---

## 1. O que você pediu (resumo fiel)

### Aba "Encarte" (no Cadastro de Máquinas)
- Nova aba que retorna **todos os produtos que contêm "ENCARTE" no nome** (os encartes).
- Praticamente todo **produto acabado (começa com 104)** tem um encarte que vai junto.
- Serve para **selecionar quais produtos vão com cada encarte**.

### Encarte na Programação
- Ao montar a programação, **puxar o encarte** de cada produto.
- Se **não houver cadastro**, mostrar **alerta** e um **campo para informar o código do encarte manualmente**.
- Ao informar manualmente, **perguntar se deseja cadastrar** aquele produto com esse encarte (para puxar automático na próxima). Se **sim**, **registrar na aba nova**.

### Validação de máquina ao arrastar
- Ao arrastar um produto, **sinalizar em qual máquina ele está cadastrado** e **não deixar soltar** numa máquina onde **não está cadastrado**.
- Para produtos **sem máquina cadastrada**: ao arrastar para uma máquina, **perguntar se deseja cadastrar** aquela máquina para o produto. Se **já tiver** cadastro, **não** oferecer essa opção (e bloquear máquinas não cadastradas).

---

## 2. Modelo de dados (backend)

### `produto_encarte` (nova) — 1 encarte por produto
| Coluna | Tipo |
|--------|------|
| `cod_produto` | TEXT PK |
| `cod_encarte` | TEXT |
| `updated_at` | TIMESTAMP |
| `updated_by` | TEXT |

(O vínculo é produto → encarte. Na aba, ao escolher os produtos de um encarte, gravamos `produto_encarte[produto] = encarte`.)

### Máquinas
- Já existe o cadastro produto↔máquina (regras + exceções em `maquina_*`). A validação usará a resolução já existente (`/programacao/sugestoes` → `por_codigo`). "Cadastrar máquina para o produto" = criar **exceção de inclusão** (`maquina_excecoes` incluir) daquele produto naquela máquina.

---

## 3. Backend — endpoints

### Encarte (módulo `maquinas.py`)
- `GET /maquinas/encartes` → produtos cujo `DESC_ITEM` contém "ENCARTE" (código + descrição), da `view_info_ie`.
- `GET /maquinas/encarte/{cod_encarte}/produtos` → produtos vinculados a um encarte.
- `POST /maquinas/produto-encarte` `{cod_produto, cod_encarte}` → upsert do vínculo.
- `POST /maquinas/produto-encarte-lote` `{cod_encarte, cod_produtos:[...]}` → vincular vários de uma vez (para a aba).
- `DELETE /maquinas/produto-encarte/{cod_produto}` → desvincular.

### Programação (módulo `programacao.py`)
- `POST /programacao/encartes` `{codigos:[...]}` → `{ cod_produto: {cod_encarte, desc_encarte} }` para os produtos do plano.
- A validação de máquina reusa `/programacao/sugestoes` (`por_codigo`). Registrar máquina = `POST /maquinas/{id}/excecoes` (incluir) — já existe.

---

## 4. Frontend — Cadastro de Máquinas (aba Encarte)
- Nova aba "Encarte" (ao lado de Máquinas e Produtos).
- Lista de **encartes** (busca por código/descrição). Ao selecionar um encarte:
  - Mostra os **produtos vinculados** e um **buscar+adicionar** (multiseleção, igual ao das máquinas) para incluir produtos (de preferência os 104…).
  - Remover vínculo por item.
- Mesmos padrões visuais (tabela com ordenar/redimensionar, modais próprios).

## 5. Frontend — Programação
- Ao carregar a versão, busca os encartes dos códigos (`/programacao/encartes`).
- **Card / modal de dados:** mostra o **encarte** do produto. Se faltar:
  - Indicador no card (ex.: ponto/etiqueta "sem encarte").
  - No **modal de dados**: alerta "Encarte não cadastrado" + **campo** para informar o código + botão. Ao confirmar, **pergunta** (modal próprio) "Cadastrar este produto com o encarte X?"; se sim, grava via `/maquinas/produto-encarte`.
- **Arraste com validação de máquina:**
  - Ao iniciar o arraste, **realçar as máquinas cadastradas** do produto (verde) e marcar as demais como **bloqueadas**.
  - Soltar numa máquina **não cadastrada**:
    - Produto **com** máquinas cadastradas → **bloqueia** (volta) e avisa.
    - Produto **sem** nenhuma máquina cadastrada → permite e **pergunta** "Cadastrar esta máquina para o produto?"; se sim, cria a inclusão e o produto passa a ser válido ali.

---

## 6. Decisões pendentes (confirmar antes de implementar)

1. **Encarte por produto é único** (um encarte por produto), e a aba é orientada por **encarte → seleciona produtos**, certo? (Alternativa: orientada por produto → escolhe o encarte.)
2. **Bloqueio de máquina:** confirmar a regra — produto **com** cadastro só pode ser solto nas máquinas cadastradas (demais bloqueadas); produto **sem** cadastro pode ir em qualquer uma e aí pergunta se quer cadastrar. (Os baldes "A programar" continuam aceitando todos.)
3. **Onde mostrar o encarte na Programação:** no **modal de dados** (clique) com o campo manual + indicador no card — ok? Ou também no PDF/board?

---

## 7. Ordem de implementação (após aprovação)
1. Backend: tabela `produto_encarte` + endpoints de encarte; `/programacao/encartes`.
2. Cadastro de Máquinas: aba Encarte (lista + vínculo de produtos).
3. Programação: puxar encarte, indicador/alerta + campo manual + confirmação de cadastro.
4. Programação: realce de máquinas válidas no arraste + bloqueio + pergunta de cadastro quando sem máquina.
5. Validação e, com seu OK, commit/push em `homolog`.
