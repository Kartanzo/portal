# Levantamento de Requisitos — Faturamento, Programação e Menu

> Organização dos pedidos enviados (texto + 7 imagens) para você revisar **antes** de eu implementar.
> **Legenda:** ✅ entendi · ❓ preciso confirmar · 🔴 prioridade (lógica).

---

## 0. Princípio geral (o mais importante)

🔴 **"para de efeitar e foca na lógica" / "precisamos garantir a LÓGICA".**
Antes de qualquer ajuste visual, validar e garantir a **lógica de cálculo** (cobertura de estoque/produção, abatimento em cascata, ordenação por data de entrega). Os itens de lógica abaixo têm prioridade sobre os cosméticos.

---

## 1. Menu lateral — Torre S&OP (img 5)

| # | Pedido | Interpretação |
|---|--------|---------------|
| 1.1 | "coloca na ordem que deve acontecer" | **Reordenar** o menu na ordem do processo: **Produção → Programação de Produção → Faturamento**. |
| 1.2 | "(coloca de produção)" | Renomear **"Programação"** → **"Programação de Produção"**. |

- **Ordem atual:** Dashboard · Otimizador de Produção · Otimizador de Faturamento · Cadastro de Máquinas · Programação
- **Ordem proposta:** Dashboard · Otimizador de Produção · **Programação de Produção** · Otimizador de Faturamento · Cadastro de Máquinas

---

## 2. Otimizador de Faturamento — Tabela (img 4, 8)

| # | Pedido | Interpretação |
|---|--------|---------------|
| 2.1 | "botão pra gerar o relatório em pdf" | ✅ Botão **Gerar PDF** do faturamento. |
| 2.2 | "numérica crescente" | ✅ Produtos **dentro do pedido** ordenados por **código (numérico crescente)**. |
| 2.3 | "O que é essa programar?... coloca só SEM PROGRAMAÇÃO" | ✅ Trocar o aviso **"⚠ Programar"** por **"SEM PROGRAMAÇÃO"** (item ainda sem programação). |
| 2.4 | "Em produção é o programado? deve se chamar PREVISTO PRODUÇÃO" | ❓ Confirmar: a coluna **"Em Produção"** é a quantidade **programada/prevista**? Se sim → renomear para **"PREVISTO PRODUÇÃO"**. |
| 2.5 | "colocar data de emissão e entrega do pedido" | ✅ Mostrar **data de emissão** e **data de entrega** do pedido (no cabeçalho do pedido). |
| 2.6 | "tira essa coisa de hora" | ❓ Remover a **hora** da "Previsão Término" (ex.: `07/06/2026, 21:00` → `07/06/2026`). **Atenção:** isso reverte o "data e hora" que você pediu antes — confirmar se é só exibição ou tira a hora de tudo. |
| 2.7 | "botao de encolher o pedido com os itens" | ✅ Botão de **encolher/expandir** cada pedido (no cabeçalho `#MBK-...`). |
| 2.8 | "botao para encolher tudo e expandir tudo" | ✅ Botões **"Encolher tudo"** e **"Expandir tudo"**. |

---

## 3. Cobertura / Saldo — LÓGICA (img 6) 🔴

| # | Pedido | Interpretação |
|---|--------|---------------|
| 3.1 | "podem escolher usar disponivel, reserva, produção ou tudo" | 🔴 Trocar o toggle único de "reserva" por uma **seleção de fontes do saldo**: **Disponível**, **Reserva**, **Produção (previsto)**, ou **Tudo**. |
| 3.2 | "onde é consumido o saldo projetado de produção?" | 🔴 O **abatimento em cascata** deve consumir também o **saldo projetado de produção** — hoje só consome Disponível + Reserva. |
| 3.3 | "precisa ter um botão que faça isso aqui para saldo de produção" | ✅ Botão/seleção equivalente para incluir o **saldo de produção** no cálculo (parte do 3.1). |

❓ **Preciso entender:** "saldo projetado de produção" = a coluna **"Em Produção"** (OPs abertas) ou a quantidade que a **Programação** prevê produzir? **De onde vem esse número?**

---

## 4. Faturamento — Filtros / Simulador (img 3, 9)

| # | Pedido | Interpretação |
|---|--------|---------------|
| 4.1 | "numérica crescente" (lista de produtos, img 3) | ✅ Lista de **produtos** do seletor em **ordem numérica crescente** (por código). |
| 4.2 | "ordem alfabetica" (lista de clientes, img 9) | ✅ Lista de **clientes** do seletor em **ordem alfabética**. |
| 4.3 | "filtro de data... pela data de entrega... não só um filtro" | ✅ Filtro por **data de entrega**, permitindo **mais de um filtro** combinado. |
| 4.4 | "escolher um ou varios pedidos, um ou varios clientes" | ✅ Seletor de **pedidos** (um ou vários) além do de clientes. |
| 4.5 | "range de data... salvo... deste ano até 10 dias pra frente, pré-selecionado" | ✅ **Range de data** com **default pré-selecionado**: de **01/01 do ano atual** até **hoje + 10 dias**. |

❓ "no **otimizador de logística**" — assumo que é o **Otimizador de Faturamento** (não existe tela "logística"). Confirmar.

---

## 5. Programação de Produção — Board (img 7) 🔴

| # | Pedido | Interpretação |
|---|--------|---------------|
| 5.1 | "tira essa barra azul pra ver tudo" | ✅ Remover/ajustar a **barra azul** (scroll horizontal) que atrapalha ver o board todo. |
| 5.2 | "tira essa coisa de hora" | ❓ Tirar a **hora** dos campos Início/Entrega (volta a só **data**?). Reverte o "data e hora" pedido antes — confirmar. |
| 5.3 | "botão pra gerar toda a programação" | ✅ Botão **"Gerar toda a programação"**. ❓ O que ele faz exatamente (auto-distribuir itens nas máquinas? gerar PDF? salvar versão?). |
| 5.4 | "pedidos otimizados considerando datas de entrega do mais antigo pro mais recente" | 🔴 **Validar a lógica**: ordenação por **data de entrega crescente** (mais antigo → mais recente). |

---

## 6. Lógica a validar (resumo 🔴)

1. **Ordenação por data de entrega** (mais antigo → mais recente) nos pedidos otimizados.
2. **Cobertura/abatimento** deve considerar e consumir: **Disponível + Reserva + Produção projetada** (configurável: usar uma, outra ou todas).
3. **Cascata** correta: pedido consome o saldo; próximo vê o que sobrou (já implementado p/ disp+reserva — falta incluir **produção**).

---

## 7. Dúvidas que preciso você responder antes de codar

1. **Hora (itens 2.6 e 5.2):** tirar a hora de **tudo** (faturamento + programação) e voltar a **só data**? Ou só não exibir a hora, mantendo internamente?
2. **"Em Produção" (2.4 / 3.2):** essa coluna é a **quantidade programada/prevista de produção**? De onde vem o "saldo projetado de produção" que deve entrar na cobertura — das **OPs abertas** ou da **Programação**?
3. **"Gerar toda a programação" (5.3):** o que esse botão faz exatamente?
4. **"Otimizador de logística" (4.5):** é o Otimizador de Faturamento, certo?
5. **Range default (4.5):** "deste ano" = a partir de **01/01/{ano atual}**? Salvar a config por **usuário**?
6. **Ordem (2.2 / 4.1 / 4.2):** produtos por **código crescente**; clientes **alfabético** — confirmado?

---

## 8. Ordem sugerida de execução (quando você aprovar)

1. 🔴 **Lógica**: cobertura com produção projetada + abatimento em cascata + ordenação por data de entrega (validar com testes).
2. **Faturamento**: fontes de saldo (disp/reserva/produção/tudo), filtros (pedidos, clientes, range de entrega com default), ordenações.
3. **Faturamento UI**: encolher/expandir, SEM PROGRAMAÇÃO, PREVISTO PRODUÇÃO, emissão/entrega, sem hora, PDF.
4. **Menu**: reordenar + renomear.
5. **Programação**: barra azul, hora, botão gerar programação.
