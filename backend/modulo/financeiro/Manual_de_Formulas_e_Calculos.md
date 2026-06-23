# Manual de Fórmulas e Cálculos Financeiros

**Data de Geração:** 19/02/2026 07:51

Este documento detalha a estrutura, dados, fórmulas e o propósito das planilhas financeiras analisadas.

## Resumo Executivo e Propósito

### 1. `Cópia de Cópia de Plano de Contas - Reforma Tributária e CPCs.xlsx`
**Propósito:** Definir a estrutura do Plano de Contas da empresa, categorizando ativos, passivos, receitas e despesas.
- **Aba `Plano de Contas`:** Contém a hierarquia completa das contas (Grupo, Subgrupo, Natureza), classificações contábeis e observações sobre o impacto da Reforma Tributária de 2026 e adequação aos CPCs/IFRS.

### 2. `MBK_Relatórios Gerenciais_2026.xlsx`
**Propósito:** Relatório Gerencial para acompanhamento orçamentário e performance financeira (DRE).
- **Aba `Base Orçamento`:** É a base de dados bruta ("raw data"). Contém os lançamentos orçados detalhados por Competência, Departamento, Setor e Conta Contábil. É a fonte de dados para as outras abas.
- **Aba `Orçado`:** Demonstração do Orçamento mensal. Utiliza fórmulas `SUMIFS` para consolidar os valores da aba `Base Orçamento` com base nos filtros selecionados (como Departamento).
- **Aba `Orçado x Realizado`:** Comparativo entre o planejado (Orçado) e o executado (Realizado). Puxa o Orçado da base e o Realizado (provavelmente preenchido manualmente ou via outra fonte integrada, mas nas fórmulas aparece referências diretas ou somas). Calcula variações (`r`).
- **Aba `DRE Comparativo`:** Demonstrativo de Resultados do Exercício comparando o ano anterior (2025) com o atual (2026). Permite análise de evolução das contas de resultado.
- **Aba `Filtros`:** Lista auxiliar para os menus suspensos de seleção (ex: filtro de Departamento nas outras abas).

### 3. Requisitos para Nova Aba: `Base Realizado`
**Solicitação:** Criar uma nova aba chamada `Base Realizado` para input dos dados executados.
- **Estrutura:** Deve ser idêntica à aba `Base Orçamento`.
- **Propósito:** Alimentar as colunas de "Realizado" nos relatórios gerenciais, substituindo eventuais inputs manuais ou vínculos externos atuais.
- **Fluxo:** O usuário fará o upload/preenchimento dos dados realizados nesta nova aba, mantendo a consistência de colunas (Competência, Departamento, Conta, Valor, etc.) para facilitar as fórmulas de soma (`SUMIFS`).

---



## Arquivo: `Cópia de Cópia de Plano de Contas - Reforma Tributária e CPCs.xlsx`

### Aba: `Plano de Contas`
- **Total de Linhas:** 436
- **Total de Colunas:** 13
- **Linha de Cabeçalho Identificada:** 1

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Código da Conta | `1.1.1`, `1`, `1.1` | - |
| B | Código da Conta | `1.1.1`, `1`, `1.1` | - |
| C | Código da Conta | `1.1.1`, `1`, `1.1` | - |
| D | Código da Conta | `1.1.1`, `1`, `1.1` | - |
| E | Classificação | `CLIENTES`, `APLICAÇÕES FINANCEIRAS`, `DISPONIBILIDADES` | - |
| F | Nome da Conta | `DISPONIBILIDADES`, `ATIVO`, `ATIVO CIRCULANTE` | - |
| G | Grupo | `PASSIVO`, `ATIVO` | - |
| H | Subgrupo | `PASSIVO CIRCULANTE`, `ATIVO NÃO CIRCULANTE`, `ATIVO CIRCULANTE` | - |
| I | Natureza | `Devedora`, `Credora` | - |
| J | Tipo de Conta | `Sintética`, `Analítica` | - |
| K | Impacto Reforma Tributária 2026 | `Afetado (Crédito IBS)`, `Não Direto`, `Afetado (Base do IBS)` | - |
| L | Ref. CPC/IFRS | `CPC 00`, `CPC 48 / IFRS 9`, `CPC 26` | - |
| M | Comentários | `Realizável a curto prazo`, `Numerário em poder da empresa`, `Bens e direitos da empresa` | - |

---
## Arquivo: `MBK_Relatórios Gerenciais_2026.xlsx`

### Aba: `Orçado`
- **Total de Linhas:** 122
- **Total de Colunas:** 20
- **Linha de Cabeçalho Identificada:** 5

#### Estrutura de Agrupamento (Outlines)
- **Agrupamento de Linhas (Collapse):** Nível 1: Linhas 6, 11-15, 21-25, 27-36, 38-39, 41, 48-53, 55-63, 65-67, 74-86, 88-98, 100-117
- **Agrupamento de Colunas:** Nível 1: Coluna B

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Column 1 | - | - |
| B | Column 2 | `4.2.2.004`, `4.1.1.001`, `4.2.2.003` | - |
| C | Column 3 | `RECEITA LÍQUIDA`, `RECEITA BRUTA`, `(-) Impostos sobre a vendas` | - |
| D | Column 4 | `(-) Matéria-prima`, `(-) Despesa com pessoal`, `(-) Despesa com ocupação` | - |
| E | Column 5 | `(-) ICMS`, `Receita com venda de produtos`, `(-) IPI` | - |
| F | Column 6 | - | - |
| G | Janeiro | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B30),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B30,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B86),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B86,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B14),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B14,'Base Orçamento'!G:G,$G$3))` |
| H | Fevereiro | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$H$5,'Base Orçamento'!H:H,B31),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$H$5,'Base Orçamento'!H:H,B31,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$H$5,'Base Orçamento'!H:H,B84),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$H$5,'Base Orçamento'!H:H,B84,'Base Orçamento'!G:G,$G$3))`<br>`=IF(H17=0,0,SUM(H43,H46)-H26)` |
| I | Março | - | `=SUM(I27:I36)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$I$5,'Base Orçamento'!H:H,B90),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$I$5,'Base Orçamento'!H:H,B90,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$I$5,'Base Orçamento'!H:H,B35),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$I$5,'Base Orçamento'!H:H,B35,'Base Orçamento'!G:G,$G$3))` |
| J | Abril | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B39),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B39,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B30),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B30,'Base Orçamento'!G:G,$G$3))` |
| K | Maio | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$K$5,'Base Orçamento'!H:H,B51),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$K$5,'Base Orçamento'!H:H,B51,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$K$5,'Base Orçamento'!H:H,B81),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$K$5,'Base Orçamento'!H:H,B81,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(K55:K63)` |
| L | Junho | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$L$5,'Base Orçamento'!H:H,B97),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$L$5,'Base Orçamento'!H:H,B97,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(L41)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$L$5,'Base Orçamento'!H:H,B82),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$L$5,'Base Orçamento'!H:H,B82,'Base Orçamento'!G:G,$G$3))` |
| M | Julho | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B52),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B52,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(M73,M87,M99)` |
| N | Agosto | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B29),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B29,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B12),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B12,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$N$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))` |
| O | Setembro | - | `=SUM(O27:O36)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$O$5,'Base Orçamento'!H:H,B56),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$O$5,'Base Orçamento'!H:H,B56,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$O$5,'Base Orçamento'!H:H,B80),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$O$5,'Base Orçamento'!H:H,B80,'Base Orçamento'!G:G,$G$3))` |
| P | Outubro | - | `=SUM(P27:P36)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B61),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B61,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))` |
| Q | Novembro | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B51),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B51,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B58),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B58,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B61),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Q$5,'Base Orçamento'!H:H,B61,'Base Orçamento'!G:G,$G$3))` |
| R | Dezembro | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B21),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B21,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B58),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B58,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B30),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$R$5,'Base Orçamento'!H:H,B30,'Base Orçamento'!G:G,$G$3))` |
| S | Column 19 | - | - |
| T | 2026 | - | `=SUM(G58:R58)`<br>`=SUM(G81:R81)`<br>`=SUM(G48:R48)` |

---

### Aba: `Orçado x Realizado`
- **Total de Linhas:** 128
- **Total de Colunas:** 46
- **Linha de Cabeçalho Identificada:** 7

#### Estrutura de Agrupamento (Outlines)
- **Agrupamento de Linhas (Collapse):** Nível 1: Linhas 8, 13-17, 23-27, 29-38, 40-41, 43, 50-55, 57-65, 67-69, 76-88, 90-100, 102-123
- **Agrupamento de Colunas:** Nível 1: Coluna B

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Column 1 | - | - |
| B | Column 2 | `4.2.2.004`, `4.1.1.001`, `4.2.2.003` | - |
| C | Column 3 | `RECEITA LÍQUIDA`, `RECEITA BRUTA`, `(-) Impostos sobre a vendas` | - |
| D | Column 4 | `(-) Matéria-prima`, `(-) Despesa com pessoal`, `(-) Despesa com ocupação` | - |
| E | Column 5 | `(-) ICMS`, `Receita com venda de produtos`, `(-) IPI` | - |
| F | Column 6 | - | - |
| G | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| H | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| I | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| J | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| K | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| L | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| M | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| N | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| O | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| P | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| Q | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| R | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| S | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| T | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| U | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| V | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| W | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| X | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| Y | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| Z | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AA | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AB | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AC | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AD | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AE | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AF | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AG | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AH | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AI | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AJ | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AK | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AL | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AM | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AN | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AO | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AP | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |
| AQ | Column 43 | - | - |
| AR | Orçado | - | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)` |
| AS | Realizado | - | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AT | r | - | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((K80-J80)/K80,0)` |

---

### Aba: `DRE Comparativo`
- **Total de Linhas:** 128
- **Total de Colunas:** 46
- **Linha de Cabeçalho Identificada:** 5

#### Estrutura de Agrupamento (Outlines)
- **Agrupamento de Linhas (Collapse):** Nível 1: Linhas 8, 13-17, 23-27, 29-38, 40-41, 43, 50-55, 57-65, 67-69, 76-88, 90-100, 102-123
- **Agrupamento de Colunas:** Nível 1: Coluna B

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Column 1 | - | - |
| B | Column 2 | `4.2.2.004`, `4.1.1.001`, `4.2.2.003` | - |
| C | Column 3 | `RECEITA LÍQUIDA`, `RECEITA BRUTA`, `(-) Impostos sobre a vendas` | - |
| D | Column 4 | `(-) Matéria-prima`, `(-) Despesa com pessoal`, `(-) Despesa com ocupação` | - |
| E | Column 5 | `(-) ICMS`, `Receita com venda de produtos`, `(-) IPI` | - |
| F | Column 6 | - | - |
| G | Janeiro | `2025` | `=SUM(G22,G28,G39,G42)`<br>`=SUM(G19,G21)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B30),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$G$5,'Base Orçamento'!H:H,B30,'Base Orçamento'!G:G,$G$3))` |
| H | Column 8 | `2026` | - |
| I | Column 9 | `r` | `=IFERROR((H65-G65)/H65,0)`<br>`=IFERROR((H36-G36)/H36,0)`<br>`=IFERROR((H64-G64)/H64,0)` |
| J | Fevereiro | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=IFERROR(J45/J19,0)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B30),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$J$5,'Base Orçamento'!H:H,B30,'Base Orçamento'!G:G,$G$3))` |
| K | Column 11 | `2026` | - |
| L | Column 12 | `r` | `=IFERROR((K80-J80)/K80,0)`<br>`=IFERROR((K93-J93)/K93,0)`<br>`=IFERROR((K10-J10)/K10,0)` |
| M | Março | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B43),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B43,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B91),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B91,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B52),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$M$5,'Base Orçamento'!H:H,B52,'Base Orçamento'!G:G,$G$3))` |
| N | Column 14 | `2026` | - |
| O | Column 15 | `r` | `=IFERROR((N54-M54)/N54,0)`<br>`=IFERROR((N65-M65)/N65,0)`<br>`=IFERROR((N77-M77)/N77,0)` |
| P | Abril | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B61),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B61,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$P$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(P10,P12)` |
| Q | Column 17 | `2026` | - |
| R | Column 18 | `r` | `=IFERROR((Q94-P94)/Q94,0)`<br>`=IFERROR((Q69-P69)/Q69,0)`<br>`=IFERROR((Q74-P74)/Q74,0)` |
| S | Maio | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B64),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B64,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B51),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B51,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B67),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$S$5,'Base Orçamento'!H:H,B67,'Base Orçamento'!G:G,$G$3))` |
| T | Column 20 | `2026` | - |
| U | Column 21 | `r` | `=IFERROR((T87-S87)/T87,0)`<br>`=IFERROR((T10-S10)/T10,0)`<br>`=IFERROR((T48-S48)/T48,0)` |
| V | Junho | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B27,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B37),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B37,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B87),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$V$5,'Base Orçamento'!H:H,B87,'Base Orçamento'!G:G,$G$3))` |
| W | Column 23 | `2026` | - |
| X | Column 24 | `r` | `=IFERROR((W67-V67)/W67,0)`<br>`=IFERROR((W99-V99)/W99,0)`<br>`=IFERROR((W23-V23)/W23,0)` |
| Y | Julho | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B26),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B26,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B32),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B32,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B83),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$Y$5,'Base Orçamento'!H:H,B83,'Base Orçamento'!G:G,$G$3))` |
| Z | Column 26 | `2026` | - |
| AA | Column 27 | `r` | `=IFERROR((Z62-Y62)/Z62,0)`<br>`=IFERROR((Z57-Y57)/Z57,0)`<br>`=IFERROR((Z75-Y75)/Z75,0)` |
| AB | Agosto | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B60),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B60,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B33),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B33,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B57),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AB$5,'Base Orçamento'!H:H,B57,'Base Orçamento'!G:G,$G$3))` |
| AC | Column 29 | `2026` | - |
| AD | Column 30 | `r` | `=IFERROR((AC62-AB62)/AC62,0)`<br>`=IFERROR((AC89-AB89)/AC89,0)`<br>`=IFERROR((AC59-AB59)/AC59,0)` |
| AE | Setembro | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B33),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B33,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B81),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B81,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B51),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AE$5,'Base Orçamento'!H:H,B51,'Base Orçamento'!G:G,$G$3))` |
| AF | Column 32 | `2026` | - |
| AG | Column 33 | `r` | `=IFERROR((AF17-AE17)/AF17,0)`<br>`=IFERROR((AF98-AE98)/AF98,0)`<br>`=IFERROR((AF55-AE55)/AF55,0)` |
| AH | Outubro | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B53),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B53,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B65),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B65,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B51),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AH$5,'Base Orçamento'!H:H,B51,'Base Orçamento'!G:G,$G$3))` |
| AI | Column 35 | `2026` | - |
| AJ | Column 36 | `r` | `=IFERROR((AI27-AH27)/AI27,0)`<br>`=IFERROR((AI21-AH21)/AI21,0)`<br>`=IFERROR((AI61-AH61)/AI61,0)` |
| AK | Novembro | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AK$5,'Base Orçamento'!H:H,B95),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AK$5,'Base Orçamento'!H:H,B95,'Base Orçamento'!G:G,$G$3))`<br>`=SUM(AK67:AK69)`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AK$5,'Base Orçamento'!H:H,B25),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AK$5,'Base Orçamento'!H:H,B25,'Base Orçamento'!G:G,$G$3))` |
| AL | Column 38 | `2026` | - |
| AM | Column 39 | `r` | `=IFERROR((AL53-AK53)/AL53,0)`<br>`=IFERROR((AL28-AK28)/AL28,0)`<br>`=IFERROR((AL58-AK58)/AL58,0)` |
| AN | Dezembro | `2025` | `=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B90),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B90,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B52),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B52,'Base Orçamento'!G:G,$G$3))`<br>`=IF($G$3="Todos",SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B61),SUMIFS('Base Orçamento'!K:K,'Base Orçamento'!B:B,$AN$5,'Base Orçamento'!H:H,B61,'Base Orçamento'!G:G,$G$3))` |
| AO | Column 41 | `2026` | - |
| AP | Column 42 | `r` | `=IFERROR((AO61-AN61)/AO61,0)`<br>`=IFERROR((AO65-AN65)/AO65,0)`<br>`=IFERROR((AO55-AN55)/AO55,0)` |
| AQ | Column 43 | - | - |
| AR | Comparativo | `2025` | `=SUM(AR10,AR12)`<br>`=SUM(G17,J17,M17,P17,S17,V17,Y17,AB17,AE17,AH17,AK17,AN17)`<br>`=SUM(G85,J85,M85,P85,S85,V85,Y85,AB85,AE85,AH85,AK85,AN85)` |
| AS | Column 45 | `2026` | `=SUM(H67,K67,N67,Q67,T67,W67,Z67,Z67,AC67,AF67,AI67,AL67,AO67)`<br>`=SUM(H81,K81,N81,Q81,T81,W81,Z81,Z81,AC81,AF81,AI81,AL81,AO81)`<br>`=SUM(H64,K64,N64,Q64,T64,W64,Z64,Z64,AC64,AF64,AI64,AL64,AO64)` |
| AT | Column 46 | `r` | `=IFERROR((AS74-AR74)/AS74,0)`<br>`=IFERROR((AS27-AR27)/AS27,0)`<br>`=IFERROR((AS56-AR56)/AS56,0)` |

---

### Aba: `Base Orçamento`
- **Total de Linhas:** 6513
- **Total de Colunas:** 15
- **Linha de Cabeçalho Identificada:** 2

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Column 1 | - | - |
| B | Competência | `Janeiro` | - |
| C | EBTIDA | `1. EBTIDA` | - |
| D | Margem de Contribuição | `3. Despesas fixas`, `2. Margem de Contribuição` | - |
| E | Tipo | `5. Despesa variável`, `4. Custo de produção`, `6. Despesa fixa` | - |
| F | Setor | `Supply Chain`, `Fábrica`, `Administração` | - |
| G | Departamento | `Segurança do Trabalho`, `RH`, `Fábrica` | - |
| H | Conta | `6.2.2.004`, `6.2.2.021`, `6.2.2.003` | - |
| I | Grupo | `Despesas gerais`, `Despesas com serviços de terceiros`, `Despesas com pessoal` | - |
| J | Descrição da conta | `Despesa com serviços de assessoria e consultoria`, `Despesa com serviços de cursos e treinamentos`, `Despesa com serviços locação de máquinas e equipamentos` | - |
| K | Valor | `-9450`, `-1500`, `-3200` | - |
| L | Column 12 | - | - |
| M | Column 13 | - | - |
| N | Column 14 | - | - |
| O | Column 15 | - | - |

---

### Aba: `Filtros`
- **Total de Linhas:** 38
- **Total de Colunas:** 2
- **Linha de Cabeçalho Identificada:** 2

#### Estrutura e Fórmulas
| Coluna | Nome (Cabeçalho) | Exemplos de Dados | Exemplos de Fórmulas |
| :--- | :--- | :--- | :--- |
| A | Column 1 | - | - |
| B | Departamento | `DP`, `Todos`, `Diretoria` | - |

---

## Mapeamento Detalhado da DRE (Baseado no Banco de Dados)

A estrutura da DRE no Portal segue o agrupamento definido na coluna `Grupo` da aba `Base Orçamento`. Abaixo estão os itens que compõem cada linha do relatório, conforme extraído do banco de dados.

### 1. Venda de Produtos Plásticos (Receita Bruta)
*Conta Contábil | Descrição*
- `4.1.1.001` | Receita com venda de produtos

### 2. Imposto sobre Bens e Serviços sobre Vendas
*Conta Contábil | Descrição*
- `4.2.2.003` | (-) IPI
- `4.2.2.004` | (-) ICMS
- `4.2.2.005` | (-) COFINS
- `4.2.2.006` | (-) PIS
- `4.2.2.007` | (-) ICMS ST

### 3. Matéria-Prima Consumida
*Conta Contábil | Descrição*
- `5.1.1.001` | Polietileno (PE)
- `5.1.1.008` | (+) Créditos de ICMS
- `5.1.1.009` | (+) Créditos de IPI
- `5.1.1.010` | (+) Créditos de PIS
- `5.1.1.011` | (+) Créditos de COFINS

### 4. Custos Indiretos de Fabricação (CIF)
*Conta Contábil | Descrição*
- `5.1.3.003` | Outros custos de produção

### 5. Despesas comerciais
*Conta Contábil | Descrição*
- `6.1.1.001` | Despesa com comissões
- `6.1.1.002` | Despesa com serviços de fretes e carretos
- `6.1.1.004` | Despesa com pedágios e estacionamentos
- `6.1.1.005` | Despesa com serviços de uber e táxi
- `6.1.1.007` | Despesa com brindes e presentes
- `6.1.1.010` | Despesa com feiras e eventos


### 6. Despesas com pessoal
*Conta Contábil | Descrição*
- `5.1.2.001` | Despesa com salários
- `5.1.2.003` | Despesa com rescisões
- `5.1.2.007` | Despesa com VT
- `5.1.2.008` | Despesa com refeições
- `5.1.2.010` | Despesa com cesta básica
- `5.1.2.011` | Despesa com seguro de vida
- `5.1.2.014` | Despesa com férias
- `5.1.2.015` | Despesa com 13º salário
- `5.1.2.016` | Despesa com INSS
- `5.1.2.017` | Despesa com FGTS
- `6.2.1.001` | Despesa com salários
- `6.2.1.005` | Despesa com pró-labore
- `6.2.1.006` | Despesa com VR
- `6.2.1.007` | Despesa com VT
- `6.2.1.008` | Despesa com refeições
- `6.2.1.009` | Despesa com assistência médica
- `6.2.1.010` | Despesa com cesta básica
- `6.2.1.011` | Despesa com seguro de vida
- `6.2.1.012` | Despesa com auxílio-combustível
- `6.2.1.014` | Despesa com férias
- `6.2.1.015` | Despesa com 13º salário
- `6.2.1.016` | Despesa com INSS
- `6.2.1.017` | Despesa com FGTS

### 7. Despesas com ocupação
*Conta Contábil | Descrição*
- `5.1.3.001` | Despesa com energia
- `5.1.3.002` | Despesa com águas e esgostos
- `5.1.3.003` | Despesa com aluguel

### 8. Despesas com serviços de terceiros
*Conta Contábil | Descrição*
- `6.2.2.002` | Despesa com serviços locação de veículos
- `6.2.2.003` | Despesa com serviços locação de máquinas e equipamentos
- `6.2.2.004` | Despesa com serviços de assessoria e consultoria
- `6.2.2.005` | Despesa com serviços PJ
- `6.2.2.006` | Despesa com serviços de manutenção de máquinas e equipamentos
- `6.2.2.007` | Despesa com serviços de manutenção e conservação predial
- `6.2.2.011` | Despesa com serviços de dedetização e desratização
- `6.2.2.014` | Despesa com serviços de monitoramento e segurança
- `6.2.2.015` | Despesa com serviços de correios e despachos
- `6.2.2.016` | Despesa com serviços de telefonia
- `6.2.2.017` | Despesa com serviços de internet
- `6.2.2.018` | Despesa com serviços de coleta de lixos e resíduos
- `6.2.2.021` | Despesa com serviços de cursos e treinamentos
- `6.2.4.017` | Despesa com serviços de hospedagem on-line

### 9. Despesas de marketing
*Conta Contábil | Descrição*
- `6.1.2.001` | Despesa com materiais gráficos e papelaria
- `6.1.2.002` | Despesa com displays e mostruários
- `6.1.2.003` | Despesa com serviços de produção áudio-visual
- `6.1.2.005` | Despesa com materiais de marketing e propaganda
- `6.1.2.008` | Despesa com serviços de uber e táxi
- `6.1.2.014` | Despesa com tráfego pago
- `6.1.2.015` | Despesa com marketing e propaganda
- `6.1.2.016` | Despesa com promotores
- `6.1.2.017` | Despesa com serviços de designar gráfico

### 10. Despesas gerais
*Conta Contábil | Descrição*
- `6.1.1.010` | Despesa com feiras e eventos / Despesa com viagens
- `6.2.4.001` | Despesa com softwares e sistemas
- `6.2.4.002` | Despesa com combustível
- `6.2.4.003` | Despesa com seguros e garantias
- `6.2.4.006` | Despesa com materiais de copa e cozinha
- `6.2.4.007` | Despesa com medicamentos
- `6.2.4.009` | Despesa com ferramentas gerais
- `6.2.4.010` | Despesa com materiais de escritório
- `6.2.4.012` | Despesa com materiais de limpeza e conservação
- `6.2.4.015` | Despesa com uniformes e EPIs
- `6.2.4.018` | Despesa com materiais de segurança predial
- `6.2.4.019` | Despesa com suprimentos de informática
- `6.2.4.020` | Despesa com lanches e refeições
- `6.2.4.023` | Despesa com equipamentos eletrônicos
- `6.2.4.026` | Despesa com ações de endomarketing
- `6.2.4.028` | Despesa com serviços de cursos e treinamentos
- `6.2.4.029` | Despesas com Licenças e Alvarás
- `6.2.4.030` | Despesa com cesta básica
- `6.2.4.031` | Despesa com seguro de vida
- `6.2.4.032` | Despesa com assistência médica
- `6.2.1.017` | Despesa com FGTS

### 11. Despesas com negócios digitais
*Conta Contábil | Descrição*
- `6.1.3.001` | Despesa com taxa de gestão comercial
- `6.1.3.004` | Despesa com comissão de marketplace
- `6.1.3.012` | Despesa com serviços de fretes e carretos

---