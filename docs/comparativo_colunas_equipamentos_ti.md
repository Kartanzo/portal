# Comparativo de colunas — Página "Equipamentos T.I" × Planilhas

**Conclusão:** a página **NÃO** contém todas as colunas das planilhas. Ela é um cadastro **genérico** (~15 campos) e as planilhas trazem muitas colunas **específicas por tipo de equipamento** que hoje não existem.

## Campos atuais da página (tabela `rh_equipamentos`)
`tipo`, `modelo`, `marca`, `patrimonio`, `serial_number`, `status`, `colaborador` (responsável), `localizacao`, `descricao`, `data_aquisicao`, `valor`, `nota_fiscal`, `data_atribuicao`, `data_devolucao`, `observacoes` (+ histórico).

Legenda: ✅ existe · 🟡 parcial/aproximado · ❌ não existe

## 1. Controle_Contadores_Impressao (aba Resumo)
| Coluna planilha | Página |
|---|---|
| Modelo da Impressora | ✅ modelo |
| Setor | 🟡 localizacao |
| IP | ❌ |
| Modelo Toner | ❌ |
| Cilindro | ❌ |
| Total Anual + contadores mensais (jan–dez) | ❌ |

## 2. Aparelhos Voz_IP (Página1)
| Coluna planilha | Página |
|---|---|
| Setor/Local | 🟡 localizacao |
| usuario | ✅ colaborador |
| Ramal | ❌ |
| Modelo | ✅ modelo |
| Qtde | ❌ |

## 3a. Atual_Inventario de Daniel (aba 2022-2026 — computadores)
| Coluna planilha | Página |
|---|---|
| Etiqueta TAG | 🟡 patrimonio |
| Usuário | ✅ colaborador |
| Departamento | 🟡 localizacao |
| Modelo | ✅ modelo |
| Nota Fiscal | ✅ nota_fiscal |
| Data Entrega | 🟡 data_aquisicao |
| Observações | ✅ observacoes |
| REV. | ❌ |
| Bios TAG | ❌ |
| MAC Rede Cabeada | ❌ |
| MAC Rede Sem Fio | ❌ |
| EMPRESA Domain | ❌ |
| Hard Drive | ❌ |
| Capacidade | ❌ |
| Hardware | 🟡 tipo |
| Linha | ❌ |
| Processador | ❌ |
| Memoria | ❌ |
| Nome Estação | ❌ |
| User AD | ❌ |
| User Win local | ❌ |
| Senha Win Local | ❌ |
| Senha / PIN local | ❌ |
| Senha Microsoft | ❌ |
| Authenticator / Linha | ❌ |
| S.O. Instalado | ❌ |
| Serial S.O. Instalado | ❌ |
| Serial S.O. Etiqueta Foto | ❌ |
| Office Instalado | ❌ |
| Serial Office | ❌ |
| Nº de Instalações | ❌ |
| Precisa ser | ❌ |
| AnyDesk | ❌ |
| Bitdefender | ❌ |
| Garantia datas | ❌ |
| Garantia | ❌ |

## 3b. Atual_Inventario de Daniel (aba Inventario T.I.)
| Coluna planilha | Página |
|---|---|
| Usuário | ✅ colaborador |
| Modelo | ✅ modelo |
| Serial | ✅ serial_number |
| NF Compra | ✅ nota_fiscal |
| Ativo | 🟡 status |
| Descrição Estação | 🟡 descricao |
| Ramal | ❌ |
| Capacidade | ❌ |
| Nome Estação | ❌ |
| User Win / Senha Win Local | ❌ |
| User AD / Senha AD | ❌ |
| E-Mail | ❌ |
| S.O. / Serial S.O. | ❌ |
| Office / Serial Office | ❌ |
| Detalhe da Versão | ❌ |
| Processador | ❌ |
| Memoria | ❌ |
| AnyDesk | ❌ |
| Acesso Não Controlado | ❌ |

> Obs.: as abas de licenças/chaves (Usuarios Microsoft 365, Chaves Geradas, Office 10&13, NFs x Licenças) são controles de software, não de equipamento.

## 4. Controle de Celulares (usados) (Página1)
| Coluna planilha | Página |
|---|---|
| Modelo | ✅ modelo |
| Condição | 🟡 status |
| IMEI SIM1 | 🟡 serial_number |
| Tela | ❌ |
| Processador | ❌ |
| Memoria | ❌ |
| Armazenam | ❌ |
| Cam Traseira / Frontal | ❌ |
| Bateria (mAh) | ❌ |
| SO | ❌ |
| Conectividade | ❌ |
| Dual SIM | ❌ |
| Tipo de Carregador | ❌ |
| Chip | ❌ |

## 5. NUMEROS_VIVO_EMPRESA (linhas/chips telefônicos)
### aba ATIVO
| Coluna planilha | Página |
|---|---|
| USUARIO | ✅ colaborador |
| SETOR | 🟡 localizacao |
| APARELHO_EMPRESA | 🟡 modelo/descricao |
| OBS | ✅ observacoes |
| NUMERO | ❌ |
| registro_vivo | ❌ |
| contador | ❌ |

### aba VIVO_LINHAS_REGISTRADAS
| Coluna planilha | Página |
|---|---|
| Linha (número) | ❌ |
| Situação | 🟡 status |
| Tipo de Chip | ❌ |
| lista_equipe | ❌ |

## Resumo dos grupos de colunas FALTANTES
- **Rede/identidade:** MAC cabeada, MAC sem fio, Domínio, Nome Estação, User/Senha AD, User/Senha Win local, Senha Microsoft, Authenticator, E-mail, IP
- **Hardware detalhado:** Processador, Memória, HD, Capacidade, Tela, Câmeras, Bateria, Armazenamento, Linha, Hardware
- **Software:** S.O. instalado + serial, Office instalado + serial, Nº instalações, Detalhe versão, AnyDesk, Bitdefender
- **Telefonia / linhas Vivo:** Ramal, Número/Linha, Tipo de Chip, Chip, Dual SIM, Tipo de carregador, IMEI, registro Vivo, contador, lista_equipe
- **Impressão:** IP, Modelo Toner, Cilindro, contadores mensais/anual
- **Gestão:** REV., Bios TAG, Garantia (datas), "Precisa ser", Qtde, Acesso Não Controlado
