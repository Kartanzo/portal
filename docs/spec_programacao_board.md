# Especificação — Programação como Quadro de Montagem (drag-and-drop)

> Planejamento. Nada será implementado antes da sua aprovação.
> homolog-first. Mantém padrões de UI (background, ícones lucide — sem emoji, sem quebra de linha,
> sem alertas nativos/modais próprios, cores estáticas).

---

## 1. O que você pediu (resumo fiel)

Reformular a página de Programação inteira para funcionar como um **sistema/quadro**:

- **Lado esquerdo:** lista de itens do plano — **sequência, código, produto (descrição), quantidade a produzir**.
- **Lado direito:** colunas com o **nome das máquinas** (cadastradas no Cadastro de Máquinas).
- **Arrastar** uma sequência para dentro de uma máquina → assim o usuário **monta a ordem de produção**.
- **Sugestão automática:**
  - Código com **1 máquina** cadastrada → já aparece **sugerido naquela máquina**, na ordem da sequência.
  - Código **sem máquina** cadastrada → fica num **canto "Sem máquina"**; pode ser arrastado para qualquer máquina.
  - Código com **mais de uma máquina** cadastrada → fica num **canto específico**, avisando que tem mais de uma máquina; o usuário decide para qual arrastar.
- Dentro de uma máquina, o usuário pode **reordenar** arrastando para cima/baixo.
- **Muito fácil de usar.**
- **Clique** num produto → abre os **dados** (quantidades; dados de OP quando houver).
- Produto com **OP aberta** → mostra só uma **numeração ao lado** (contador de OPs); **duplo clique** abre o detalhamento.
- Trazer também os **números do pedido** e o **valor do produto naquele pedido**.

---

## 2. Layout proposto

```
┌───────────────────────────── Programação (versão oficial X) ─────────────────────────────┐
│ [Versão ▼] [Comparar] [Atualizar]                          KPIs: itens · qtd · alocados   │
├───────────────┬───────────────────────────────────────────────────────────────────────────┤
│ A PROGRAMAR   │  MÁQUINAS (colunas roláveis horizontalmente)                                │
│ (não aloca-   │  ┌── INJETORA 1 ──┐ ┌── INJETORA 2 ──┐ ┌── SOPRO ──┐ ...                     │
│  dos ainda)   │  │ 1 ▸ 103045 ...  │ │ ...            │ │ ...        │                       │
│               │  │ 2 ▸ 103046 ...  │ │                │ │            │                       │
│ • Sem máquina │  │ [arraste aqui]  │ │                │ │            │                       │
│ • Múltiplas   │  └─────────────────┘ └────────────────┘ └────────────┘                      │
│   máquinas ⚠  │                                                                             │
└───────────────┴───────────────────────────────────────────────────────────────────────────┘
```

- **Coluna "A programar"** (esquerda) com 2 baldes:
  - **Sem máquina** — códigos sem cadastro (arrastáveis para qualquer máquina).
  - **Múltiplas máquinas** ⚠ — com aviso/listagem das máquinas possíveis (badge com as opções).
- **Colunas de máquina** (direita) — uma por máquina cadastrada (ativa). Cada card de item mostra: posição (ordem), código, descrição (truncada), qtd, contador de OP (se houver).
- **Card de item:** clique = painel de dados; duplo clique = detalhe das OPs.
- Cabeçalho com **seletor de versão oficial / comparar / atualizar** (reaproveita o que já existe).

---

## 3. Comportamento (regras)

1. Ao carregar a versão oficial: cada item do plano é classificado pelo **Cadastro de Máquinas**:
   - 1 máquina → entra **sugerido** naquela coluna, ordenado pela **SEQUENCIA** do plano.
   - 0 máquina → balde **Sem máquina**.
   - >1 máquina → balde **Múltiplas máquinas** (com as opções listadas).
2. Arrastar move o item entre baldes/máquinas; arrastar dentro da máquina **reordena**.
3. A ordem dentro de cada máquina é a **ordem da produção** naquela máquina.
4. Clique simples no card → **painel lateral/modal** com: qtd a produzir, estoque físico, reserva, **pedidos** (números) e **valor do produto naquele pedido**, e OPs (se houver).
5. OP aberta → **badge numérico** (nº de OPs) no card; duplo clique → modal com o detalhamento das OPs (como hoje).

---

## 4. Dados (de onde vem cada coisa)

- **Sequência / código / descrição / qtd a produzir / estoque / reserva:** do plano da versão oficial (já temos).
- **Pedidos do item + valor no pedido:** o próprio plano já traz por linha
  `PEDIDOS_QUE_USAM_SKU`, `DEMANDA_POR_PEDIDO` e `VALOR_POR_PEDIDO_COMPLETO` (valor do item por pedido). Uso esses.
- **Máquina(s) sugerida(s) por código:** resolução do Cadastro de Máquinas (regras + exceções). Endpoint novo enxuto: dada a lista de códigos do plano, retorna `cod → [máquinas]` (evita baixar os ~7.800 produtos).
- **OPs em produção:** `view_ORDEM_PRODUCAO` situação 8 (já temos `/programacao/ops`).

---

## 5. Backend

- **Novo** `POST /programacao/maquinas-por-codigos` `{ codigos: [...] }` → `{ "10300045": ["INJETORA 1"], ... }` (resolve só os códigos do plano).
- **Persistência do quadro** (ver decisão §7): se sim, criar tabela `programacao_board`
  (chave: versão + usuário) guardando, por item, a máquina e a ordem; endpoints `GET/PUT /programacao/board`.
- Reaproveita: `/programacao/plano`, `/programacao/ops`, `/programacao/versoes-oficiais`, `/comparar`.

---

## 6. Frontend

- Reescrita da página como **quadro** (colunas + arraste).
- **Drag-and-drop:** proposta usar **@dnd-kit** (leve, acessível, ótimo para listas ordenáveis) — precisa instalar a dependência. Alternativa sem instalar: HTML5 nativo (funciona, porém reordenar fica menos suave).
- Painel de dados do item (clique) + modal de OPs (duplo clique) — reaproveita os modais atuais.
- Mantém seletor de versão, alerta de nova versão e comparação.

---

## 7. Decisões pendentes (preciso confirmar antes de implementar)

1. **"Gerar ordem de produção"**: por enquanto significa **salvar a montagem no portal** (quadro persistido por versão), certo? Ou você espera que isso **crie OP de verdade no StarSoft/ERP** (integração de escrita — bem mais complexo, provavelmente uma fase futura)?
2. **Persistência do quadro**: salvar no **banco** (acompanha qualquer dispositivo e outros usuários veem a mesma montagem) ou **localStorage por usuário** (cada um monta o seu)? Recomendo banco, pois "ordem de produção" tende a ser compartilhada.
3. **Drag-and-drop**: posso **instalar o @dnd-kit** (recomendado, arraste suave/reordenável) ou prefere **sem dependência** (HTML5 nativo)?
4. **Quem entra no quadro**: todos os itens do plano (inclusive os com estoque suficiente / qtd a produzir 0), ou **somente os que precisam produzir** (qtd a produzir > 0)?
5. **Substituir x conviver**: o quadro **substitui** a tabela atual da Programação, ou fica como uma **segunda aba** (mantendo a tabela/visão atual também)?

---

## 8. Ordem de implementação (após aprovação)

1. Backend: endpoint `maquinas-por-codigos` (+ tabela/endpoints do board, se persistir).
2. Frontend: estrutura do quadro (baldes + colunas de máquina) com classificação automática.
3. Drag-and-drop (mover entre colunas + reordenar) e salvar.
4. Painel de dados (clique) com pedidos/valor + badge e modal de OP (duplo clique).
5. Validação e, com seu OK, commit/push em `homolog`.
