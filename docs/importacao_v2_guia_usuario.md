---
name: importacao-v2-guia-usuario
description: Guia completo da página Importação v2 — como ler, como calcula, exemplos práticos
type: project
date: 2026-05-19
---

# 📦 Importação v2 — Guia do Usuário

> Análise de ruptura para produtos importados. Mostra quando comprar, quanto comprar e quais itens estão em risco — tudo em escala mensal.

---

## 🎯 Para que serve

Toda compra de importação tem **prazo de entrega** longo (90+ dias). Se você espera o estoque zerar pra comprar, fica em ruptura. Esta página responde **três perguntas** pra cada SKU:

1. **Vai faltar?** (Status: 🔴 Ruptura / 🟠 Atenção / 🟢 OK)
2. **Quando comprar?** (Ponto de reposição em unidades)
3. **Quanto comprar?** (Sugerido + ajuste pro lote mínimo)

---

## 🧮 Como o cálculo funciona

### Etapa 1 — Coletar o histórico de vendas

O sistema busca as vendas dos últimos **N meses** (você escolhe — padrão **15**) da tabela `VendasHistoricasDois` no BigQuery, filtrando:
- Empresa `STAR_`
- Excluindo `BONIFICACAO`, `SAC`, `MOSTRUARIO`, `DISPLAY`, `CAMPANHAS`, `TROCA`
- Piso fixo em **2023-01-01** (nunca busca antes disso)

Dois modos:
- **Período corrido**: pega os últimos N meses calendário (mesmo os zerados)
- **Só meses com venda**: varre pra trás, ignora meses zerados (até 36 meses)

> ⚠️ Em ambos os modos, **só os meses com venda > 0** entram no cálculo da média.

### Etapa 2 — Calcular a Venda/Mês média

```
Venda/Mês = soma das vendas / quantidade de meses com venda
```

**Exemplo prático** — produto vendeu nos últimos 5 meses:

| Mês     | Venda |
|---------|-------|
| Jan/26  | 200   |
| Fev/26  | 180   |
| Mar/26  | 0     |
| Abr/26  | 220   |
| Mai/26  | 240   |

```
Soma = 200 + 180 + 0 + 220 + 240 = 840
Meses com venda = 4 (ignora março)
Venda/Mês = 840 / 4 = 210 un/mês
```

### Etapa 3 — Calcular a Variação (σ)

Mede o quanto a venda **oscila** mês a mês (desvio padrão amostral, só sobre os meses com venda):

```
σ = √( Σ(xᵢ - média)² / (n-1) )
```

No exemplo acima:
- média = (200+180+220+240) / 4 = 210
- variação² = ((200-210)² + (180-210)² + (220-210)² + (240-210)²) / 3
- variação² = (100 + 900 + 100 + 900) / 3 = 666,67
- **σ ≈ 25,8**

### Etapa 4 — Colchão de Segurança (Safety Stock)

⚠️ **Importante**: o Colchão de Segurança é APENAS o buffer extra contra variações da demanda. **Não inclui a demanda dos meses do prazo** — essa entra em "Quando Comprar".

Fórmula:

```
Estoque Mínimo = ⌈ Z × σ × √(Prazo em meses) ⌉
```

- **Z** = depende da Confiança escolhida. Com 90% (padrão), Z ≈ 1,28
- **σ** = variação mensal calculada
- **Prazo** = lead time em meses (padrão 3 meses)

Continuando o exemplo (Z=1,28, σ=25,8, Prazo=3m):
```
Col. Segurança = ⌈ 1,28 × 25,8 × √3 ⌉
              = ⌈ 1,28 × 25,8 × 1,732 ⌉
              = ⌈ 57,2 ⌉
              = 58 unidades
```

> **Por que apenas 58 e não os 630 que seriam 3 meses de venda?**
> Porque "Col. Segurança" é só o buffer extra. A demanda dos 3 meses do prazo está embutida no **"Quando Comprar"** (próxima etapa).

### Etapa 5 — Quando Comprar (Ponto de Reposição)

Estoque que você precisa ter pra aguentar o prazo de entrega da próxima compra:

```
Quando Comprar = ⌈ Prazo × Venda/Mês + Col. Segurança ⌉
              = ⌈ 3 × 210 + 58 ⌉
              = 688 unidades
```

**Significa**: quando o estoque atual chegar em **688**, dispare a compra. Vai chegar daqui a 3 meses, e até lá você vai consumir mais ~630 (3×210) + 58 de colchão.

### Etapa 6 — Status

Compara estoque atual (+ pipeline) contra os limites:

| Condição                                       | Status        |
|------------------------------------------------|---------------|
| Estoque + Trânsito ≤ Col. Segurança            | 🔴 **Ruptura** |
| Estoque + Trânsito < Quando Comprar            | 🟠 **Atenção** |
| Estoque + Trânsito ≥ Quando Comprar            | 🟢 **OK**      |

### Etapa 7 — Sugerido vs Comprar c/ MOQ

```
Sugerido    = ⌈ Quando Comprar − (Estoque + Trânsito) ⌉
Comprar c/ MOQ = MAX(Sugerido, MOQ)
```

Exemplo — Estoque=300, Trânsito=0, MOQ=3000:
- Sugerido = 688 − 300 = **388 unidades**
- Comprar c/ MOQ = MAX(388, 3000) = **3.000 unidades** ↑ (subiu pro MOQ)

A coluna **Comprar c/ MOQ** aparece com o indicador `↑` quando o MOQ subiu o valor.

---

## 📊 Cada coluna explicada

| Coluna           | O que mostra                                                                 | Editável? |
|------------------|------------------------------------------------------------------------------|-----------|
| **Código**       | SKU do produto                                                               | —         |
| **Descrição**    | Nome do produto                                                              | —         |
| **Estoque**      | Quantidade disponível agora (depósito 13xx do BigQuery)                      | —         |
| **Em Trânsito**  | Quantidade já comprada que ainda vai chegar                                  | ✎ inline  |
| **Prazo (m)**    | Tempo de entrega em meses (China → BR). Padrão 3m                            | ✎ inline  |
| **Confiança**    | Probabilidade de não faltar. 0,9 = 90%                                       | ✎ inline  |
| **MOQ**          | Lote mínimo de compra do fornecedor. Vem da página *MOQ por SKU*             | ✎ inline  |
| **Venda/Mês**    | Média mensal nos meses com venda (Etapa 2)                                   | —         |
| **Variação**     | Quanto a venda mensal oscila (σ — Etapa 3)                                   | —         |
| **Col. Segurança**  | Colchão de segurança (Etapa 4)                                               | —         |
| **Quando Comprar** | Ponto de reposição em unidades (Etapa 5)                                   | —         |
| **Meses p/ Zerar** | (Estoque + Trânsito) / Venda/Mês — quantos meses dura o estoque atual      | —         |
| **Sugerido**     | Déficit puro: o quanto falta pra chegar em Quando Comprar                    | —         |
| **Comprar c/ MOQ** | Quantidade final aplicando o lote mínimo. `↑` indica que MOQ subiu o valor | —         |
| **Vendas por mês** | Gráfico mini (sparkline) — clique na linha pra ver o gráfico grande         | —         |
| **Picos / Vales** | Meses anômalos (vendeu muito acima/abaixo do normal)                        | —         |
| **Status**       | 🔴 Ruptura · 🟠 Atenção · 🟢 OK                                              | —         |

---

## 🎛 Parâmetros globais (topo da página)

- **Modelo**: combinação salva de itens + parâmetros. `Padrão (sistema)` é o ponto de partida.
- **Como contar os meses**: corrido (com zeros) ou só meses com venda.
- **Histórico (meses)**: quantos meses passados analisar. Padrão 15. Máximo limitado ao piso 01/2023.
- **Prazo entrega (meses)**: padrão pra todos. Você pode sobrescrever por SKU inline.
- **Confiança**: padrão 0,9 (90%). Mais alta = mais Estoque Mínimo.
- **Sensibilidade picos/vales**: 1,5 σ (padrão equilibrado). Define quando um mês vira pico/vale.

---

## 🔍 Picos e Vales

O sistema calcula a média e o desvio padrão, e marca um mês como **anômalo** quando ele está a mais de N desvios padrão (default 1,5) da média.

**Exemplo**: produto com média 100/mês e σ=20:
- Mês A: 130 → diferença 30 → 30/20 = **1,5σ** → marca como pico
- Mês B: 60  → diferença -40 → -40/20 = **-2σ** → marca como vale
- Mês C: 110 → diferença 10 → 10/20 = **0,5σ** → não marca

Hover no chip de mês mostra o detalhe: `Mar/2025: pico de venda — vendeu 628 unidades (acima do normal)`.

### Tabela de sensibilidade

| Valor | % de meses marcados | Significado |
|-------|---------------------|-------------|
| 1,0   | ~32% (1 em 3)       | Muito sensível |
| 1,5   | ~13% (1 em 8)       | **Padrão** equilibrado |
| 2,0   | ~5%  (1 em 20)      | Conservador |
| 2,5   | ~1%  (1 em 80)      | Só extremos |

---

## ✏️ Edição inline (tempo real)

Você pode editar **4 campos por linha** sem precisar clicar em Atualizar:

- **Em Trânsito** — quantidade comprada que vai chegar
- **Prazo** — lead time específico desse SKU
- **Confiança** — nível de serviço específico
- **MOQ** — lote mínimo específico

Ao mudar qualquer um, o sistema **recalcula em JavaScript** (sem chamar o backend): Col. Segurança, Quando Comprar, Meses p/ Zerar, Sugerido, Comprar c/ MOQ, Status — tudo na hora.

> O botão **Atualizar** só é necessário pra buscar vendas/estoque novos do BigQuery.

---

## 💾 Modelos vs Versões

São coisas **diferentes**:

### Modelos
- Combinação salva de **itens + parâmetros** (lista de SKUs, qtd_meses, modo, lead, confiança, overrides)
- Reaplica os parâmetros mas **não guarda o resultado**
- Útil pra "criei uma análise pra produtos de banho" e quero reusar
- Você gerencia em "Restaurar padrão / Salvar modelo"

### Versões
- **Snapshot completo**: parâmetros + resultado calculado + autoria + data/hora
- Tem **labels** ("Aprovado", "Q1", custom)
- Tem **observação** (notas livres)
- Permanecem visíveis pra todos os usuários do módulo
- Útil pra registrar "decisão de compra final aprovada em mai/2026"
- Carregar uma versão repopula tudo direto do snapshot (sem refazer query)

---

## 📤 Exportações

3 formatos, todos disponíveis no header:

- **Excel**: gerado no backend (openpyxl) com formatação, freeze pane, aba de parâmetros
- **PDF**: mesmo layout da Torre de Controle S&OP (logo 3LACKD, faixa vermelha, KPIs coloridos)
- **WhatsApp**: envia o Excel anexado via WAHA pro número autorizado, com resumo no caption

Os 3 respeitam **filtros e ordenação** ativos. Se você filtrou só os em Ruptura, só esses vão pro arquivo.

---

## 📈 Gráfico comparativo

Botão **"Comparar produtos"** abre modal com lista lateral. Você seleciona até 5 SKUs e vê todos sobrepostos. Cada ponto tem rótulo com o valor — não precisa passar o cursor.

Útil pra:
- Comparar tendência entre produtos similares
- Identificar correlações (todos crescendo juntos? algum despencando?)
- Analisar sazonalidade

---

## 🔧 Filtros e ordenação

- 🔍 **Busca** — código OU descrição (parcial, case-insensitive)
- 🎯 **Chips de status** — clique pra ativar/desativar (multi-select). "Mostrando X de Y" atualiza ao vivo
- ↕️ **Ordenação** — clique no header de qualquer coluna ordenável. 1º click = desc, 2º = asc
- 🧹 **Limpar filtros** — reseta busca + status + ordenação

---

## 📱 Mobile

- Tabela vira **cards verticais**, um por SKU
- Status no canto superior direito + faixa colorida na lateral
- 6 KPIs essenciais em grid 3×2 (Estoque, Venda/mês, Meses p/ Zerar, Col. Segurança, Quando Comprar, Comprar c/ MOQ)
- Tap no card abre o gráfico
- Botão "Editar Pipeline / Prazo / Confiança / MOQ" expande os campos inline
- Ações do header viram **ícones only**

---

## 🧠 Como usar no dia-a-dia

### Cenário 1 — Revisão mensal de compras

1. Abra a página
2. Confirma os parâmetros (15 meses, 3m prazo)
3. **Atualizar** pra puxar vendas/estoque fresh
4. Filtra por **🔴 Ruptura** → vê quais itens precisam ação imediata
5. Para cada um, edita Pipeline (qtd já em pedido) inline se necessário
6. Decide o que comprar — anota o Comprar c/ MOQ
7. **Salvar versão** com label "Revisão mensal" + observação da decisão
8. Exporta PDF/Excel pra reunião

### Cenário 2 — Simular efeito de mudar fornecedor (Prazo)

1. Encontre o SKU
2. Edita **Prazo** inline: ex. de 3m → 2m
3. Veja na hora: Col. Segurança cai, Quando Comprar cai, Status pode virar OK
4. Compara antes vs depois — vale negociar com o fornecedor?

### Cenário 3 — Investigar produto sazonal

1. Filtra por código ou descrição
2. Olha **Picos / Vales** — se tem muitos picos em dezembro = sazonal
3. Tap no gráfico (mobile) ou clique na linha (desktop) → veja a curva mensal
4. Considera aumentar a **Sensibilidade** pra 2,0 ou 2,5 pra não marcar tantos meses como anômalos

---

## 📋 MOQ por SKU (página separada)

Acesso pelo menu: **Logística › Comex › MOQ por SKU**

- **Subir planilha** — Excel de 1 aba com colunas `ITEM NO`, `MOQ`, `DESCRIPTION` (qualquer dos aliases aceitos). O sistema lê no browser e envia só os dados.
- **Novo SKU** — cadastro manual
- **Editar / Excluir** — por linha
- **Origem** — `upload` (vermelho) / `manual` (verde)

### Fontes de MOQ (ordem de prioridade)

1. **Banco** (esta página) — vence sempre
2. **UNIT/CTN** do `ParametrosImportacao.xlsx` — fallback se SKU não está no banco
3. **Override inline** na tabela da Importação v2 — vence tudo (mas só na sessão)

---

## ❓ FAQ rápido

**P: Por que aparece `Apenas 4 meses de venda registrados`?**
R: O produto não tem 15 meses de histórico (no modo "vendas") OU é novo. O cálculo usa o que tem, mas a confiabilidade estatística é menor.

**P: Por que `Variação` é 0?**
R: Menos de 2 meses com venda — não dá pra calcular desvio padrão. Estoque Mínimo cai pra 0 também.

**P: Posso recalcular sem ir no BigQuery?**
R: Sim. Edição inline é tudo client-side. Só clique em **Atualizar** quando quiser puxar vendas/estoque **novos**.

**P: O cálculo considera mês atual?**
R: Não — só meses completos. Mês corrente sempre fica fora.

**P: Onde fica o limite máximo de meses?**
R: Piso fixo em **2023-01-01**. Para a janela "corrido", calculado dinamicamente: hoje (mai/2026) − 2023-01 ≈ 40 meses.

---

## 🗂 Arquivos técnicos relacionados

- Backend: `backend/modulo/importation_v2.py`
- Frontend: `frontend/src/components/Comex/ImportacaoV2.tsx`
- MOQ frontend: `frontend/src/components/Comex/ImportacaoMoq.tsx`
- Spec consolidado: `docs/importacao_v2_spec_consolidado.md`
- Validação: `docs/importacao_v2_validacao.md`
- Mapeamento original da planilha: `docs/importacao_mapeamento_calculos.md`
