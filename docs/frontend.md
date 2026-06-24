> **Nota de estrutura (atualizado):** Todos os arquivos-fonte do frontend estão agora em `frontend/src/` e os arquivos de configuração (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`) estão em `frontend/`. O `node_modules/` permanece na raiz do projeto.

# Documentação Frontend

## Visão Geral

O frontend é uma Single Page Application (SPA) construída com **React 19 + TypeScript**, usando **Vite** como build tool. A navegação é feita via **HashRouter** (`/#/rota`), o que permite deploy em qualquer servidor estático sem configurações especiais de rewrite.

Toda comunicação com o backend é feita pelo arquivo centralizado [`app_api.ts`](../app_api.ts), que abstrai as chamadas `fetch` para a API.

---

## Arquitetura

```
index.tsx
  └── App.tsx  (HashRouter + ProtectedRoute + ToastProvider + NotificationProvider)
        ├── Login.tsx           (rota pública)
        ├── ResetPassword.tsx   (rota pública)
        └── [Rotas protegidas por role]
              ├── Header.tsx + Sidebar.tsx  (layout persistente)
              └── [Componentes de página]
```

**Fluxo de inicialização:**
1. `index.tsx` monta `<App />`
2. `App.tsx` verifica `sessionStorage.empresa_user`
3. Se usuário existir → carrega interface; se não → redireciona para `/login`
4. Após carregar, `NotificationContext` inicia polling a cada 30s

---

## Estrutura de Arquivos

```
/
├── app_api.ts              # Cliente HTTP com ~50 métodos
├── App.tsx                 # Rotas e layout principal
├── index.tsx               # Entry point
├── ErrorBoundary.tsx       # Fallback global de erros
├── types.ts                # Interfaces TypeScript globais
├── constants.ts            # Constantes (setores, objetivos, config)
├── vite.config.ts          # Config Vite (proxy dev → porta 8002)
│
├── components/
│   ├── Login.tsx                       # Tela de login com 3D
│   ├── Header.tsx                      # Barra de navegação superior
│   ├── Sidebar.tsx                     # Menu lateral com RBAC
│   ├── Home3D.tsx                      # Background 3D do login
│   ├── ConfirmationModal.tsx           # Modal de confirmação
│   ├── FilterBar.tsx                   # Filtros reutilizáveis
│   ├── MultiSelectDropdown.tsx         # Dropdown multi-seleção
│   ├── DateRangePicker.tsx             # Seletor de intervalo de datas
│   ├── MonthYearPicker.tsx             # Seletor mês/ano
│   ├── NotificationSettings.tsx        # Preferências de notificação
│   ├── ResetPassword.tsx               # Formulário de reset de senha
│   ├── Toast.tsx                       # Componente de toast
│   ├── GeneralOverview.tsx             # Dashboard principal
│   ├── SectorInfo.tsx                  # Informações de setor
│   ├── Metrics.tsx                     # Métricas do sistema
│   │
│   ├── [Tickets]
│   ├── TicketList.tsx                  # Lista de tickets com filtros
│   ├── TicketDetail.tsx                # Detalhe do ticket + histórico
│   ├── NewTicket.tsx                   # Formulário de abertura
│   ├── ScheduleView.tsx                # Agenda/calendário de atendimentos
│   │
│   ├── [Planejamento Estratégico]
│   ├── ActionPlan.tsx                  # Planos de ação (lista + formulário)
│   ├── ActionPlanDashboard.tsx         # Dashboard de planos
│   ├── StrategicKanban.tsx             # Kanban estratégico
│   ├── StrategicTimeline.tsx           # Timeline/Gantt estratégico
│   ├── StrategicMap.tsx                # Mapa estratégico
│   │
│   ├── [Implementação]
│   ├── ImplementationActionPlan.tsx    # Planos de implementação
│   ├── ImplementationDashboard.tsx     # Dashboard de implementação
│   ├── ImplementationKanban.tsx        # Kanban de implementação
│   ├── ImplementationTimeline.tsx      # Timeline de implementação
│   │
│   ├── [Financeiro]
│   ├── Financeiro/BaseUpload.tsx       # Upload de bases orçado/realizado
│   ├── Financeiro/RelatorioOrcado.tsx         # Relatório de orçado
│   ├── Financeiro/RelatorioOrcadoRealizado.tsx # Comparativo orçado x realizado
│   ├── Financeiro/RelatorioDRE.tsx     # DRE (Demonstração de Resultado)
│   ├── Financeiro/PlanoContas.tsx      # Plano de contas
│   │
│   ├── [Administração]
│   ├── UserManagement.tsx              # CRUD de usuários
│   ├── RolePermissionsView.tsx         # Configuração de permissões por role
│   ├── SectorManagement.tsx            # Gestão de setores
│   └── Importation.tsx                 # Importação de dados via Excel
│
├── contexts/
│   ├── ToastContext.tsx                # Provider global de notificações toast
│   └── NotificationContext.tsx        # Polling de notificações do sistema
│
├── hooks/
│   ├── useAutoLogout.ts               # Hook de logout por inatividade
│   └── useNotificationSound.ts        # Hook de som para notificações
│
└── utils/
    └── permissionUtils.ts             # Funções RBAC de controle de acesso
```

---

## Rotas da Aplicação

O `App.tsx` usa `HashRouter`. Todas as rotas protegidas passam pelo componente `ProtectedRoute`, que verifica autenticação e permissão de módulo antes de renderizar.

### Rotas Públicas

| Rota | Componente | Descrição |
|------|-----------|-----------|
| `/` | `Login` | Tela de login (redireciona ao dashboard se autenticado) |
| `/reset-password` | `ResetPassword` | Formulário de redefinição de senha via token |

### Rotas Protegidas — Módulos

| Rota | Componente | Módulo de Permissão |
|------|-----------|---------------------|
| `/overview` | `GeneralOverview` | `overview` |
| `/tickets` | `TicketList` | `tickets` |
| `/tickets/new` | `NewTicket` | `tickets` |
| `/tickets/:id` | `TicketDetail` | `tickets` |
| `/schedule` | `ScheduleView` | `schedule` |
| `/sector-info` | `SectorInfo` | — |
| `/action-plan` | `ActionPlan` | `action_plan` |
| `/action-plan-dashboard` | `ActionPlanDashboard` | `action_plan` |
| `/strategic-kanban` | `StrategicKanban` | `action_plan` |
| `/strategic-timeline` | `StrategicTimeline` | `action_plan` |
| `/strategic-map` | `StrategicMap` | `action_plan` |
| `/implementation-action-plan` | `ImplementationActionPlan` | `implementation` |
| `/implementation-dashboard` | `ImplementationDashboard` | `implementation` |
| `/implementation-kanban` | `ImplementationKanban` | `implementation` |
| `/implementation-timeline` | `ImplementationTimeline` | `implementation` |
| `/financeiro/base-orcado` | `BaseUpload` | `financeiro` |
| `/financeiro/base-realizado` | `BaseUpload` | `financeiro` |
| `/financeiro/orcado` | `RelatorioOrcado` | `financeiro` |
| `/financeiro/orcado-realizado` | `RelatorioOrcadoRealizado` | `financeiro` |
| `/financeiro/dre` | `RelatorioDRE` | `financeiro` |
| `/financeiro/plano-contas` | `PlanoContas` | `financeiro` |

### Rotas Protegidas — Administração (requerem `admin` ou `super_user`)

| Rota | Componente | Descrição |
|------|-----------|-----------|
| `/users` | `UserManagement` | Gestão de usuários |
| `/sectors` | `SectorManagement` | Gestão de setores |
| `/permissions` | `RolePermissionsView` | Configuração de roles |
| `/importation` | `Importation` | Importação de dados |
| `/metrics` | `Metrics` | Métricas do sistema |

---

## Autenticação

### Fluxo de Login

1. Usuário preenche email e senha em `Login.tsx`
2. `api.login(email, password)` → `POST /api/login`
3. Backend retorna objeto `User` com permissões mescladas
4. Objeto salvo em `sessionStorage.empresa_user`
5. App renderiza interface conforme role e permissões

### Sessão

- **Persistência**: `sessionStorage` (limpa ao fechar o browser/aba)
- **Chave**: `empresa_user` (objeto JSON do usuário)
- **Refresh**: Ao carregar a página, o app tenta atualizar dados via `api.getUser(id)`

### Auto-Logout (`useAutoLogout.ts`)

- Registra atividade nos eventos: `mousemove`, `keydown`, `click`, `scroll`, `touchstart`
- Salva timestamp em `sessionStorage.last_activity_time`
- Verifica inatividade a cada **60 segundos**
- Realiza logout após **2 horas** de inatividade

### Recuperação de Senha

1. Usuário clica em "Esqueci minha senha" no `Login.tsx`
2. `api.forgotPassword(email)` → `POST /api/forgot-password`
3. Backend envia email com link contendo token
4. Usuário acessa `/#/reset-password?token=xxx`
5. `api.resetPassword(token, newPassword)` → `POST /api/reset-password`

---

## Sistema de Permissões (RBAC)

**Arquivo:** `utils/permissionUtils.ts`

### Roles

| Role | Descrição |
|------|-----------|
| `super_user` | Acesso total a todos os módulos e setores |
| `ceo` | Acesso total (sem receber emails de notificação) |
| `admin` | Acesso ao seu setor e setores gerenciados |
| `user` | Acesso apenas aos módulos permitidos para seu setor |

### Estrutura de Permissão por Módulo

```typescript
{
  "module_name": {
    "can_view": boolean,
    "can_edit": boolean,
    "can_delete": boolean,
    "view_all_sectors": boolean,
    "allowed_sectors": string[]
  }
}
```

### Função Principal

```typescript
hasAccess(user: User, module: string): boolean
```

Retorna `true` se:
1. Role é `super_user` ou `ceo` (acesso irrestrito), **OU**
2. `user.permissions[module]` existe E `can_view === true` E o setor do usuário está em `allowed_sectors` (quando aplicável)

### `ProtectedRoute`

Wrapper de rota em `App.tsx` que:
1. Redireciona para `/` se usuário não autenticado
2. Bloqueia a rota se `hasAccess(user, module)` retornar `false`
3. Renderiza o componente somente se ambas as verificações passarem

---

## Gerenciamento de Estado

### Context API

**`ToastContext`** (`contexts/ToastContext.tsx`)
- Gerencia notificações toast globais
- API: `showToast(message: string, type: 'success' | 'error' | 'warning' | 'info')`
- Renderizado em posição fixa (`z-index: 9999`) no canto superior direito

**`NotificationContext`** (`contexts/NotificationContext.tsx`)
- Polling de notificações do sistema a cada **30 segundos**
- Mantém contagem de não lidas (`unreadCount`)
- Dispara som via Web Audio API
- Suporta notificações desktop (API Notifications do browser)
- Preferências de notificação salvas no banco via `api.updateNotificationPreferences`

### Estado Local dos Componentes

- `useState` para dados e formulários locais
- `useMemo` para cálculos derivados (filtragem, ordenação, agregações)
- Sem biblioteca externa de state management (apenas Context API nativo do React)

---

## Cliente da API (`app_api.ts`)

Arquivo com ~600 linhas que exporta o objeto `api` com todos os métodos HTTP organizados por domínio. Em desenvolvimento, o Vite proxy redireciona `/api/*` para `http://127.0.0.1:8002/`.

### Autenticação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.login(email, password)` | `POST /login` | Autenticar usuário |
| `api.forgotPassword(email)` | `POST /forgot-password` | Solicitar reset de senha |
| `api.resetPassword(token, newPassword)` | `POST /reset-password` | Redefinir senha |

### Tickets

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.getTickets(userId?, role?)` | `GET /tickets` | Listar tickets |
| `api.getTicket(id)` | `GET /tickets/:id` | Buscar ticket por ID |
| `api.createTicket(ticket, files?)` | `POST /tickets` | Criar ticket (multipart) |
| `api.updateTicket(id, updates)` | `PUT /tickets/:id` | Atualizar ticket |
| `api.deleteTicket(id)` | `DELETE /tickets/:id` | Excluir ticket |
| `api.getTicketUpdates(ticketId)` | `GET /tickets/:id/updates` | Histórico de updates |
| `api.sendTicketUpdate(ticketId, userId, message, file?)` | `POST /tickets/:id/updates` | Enviar comentário |

### Planos de Ação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.getActionPlans(sector?, userId?)` | `GET /action-plans` | Listar planos |
| `api.createActionPlan(plan)` | `POST /action-plans` | Criar plano |
| `api.updateActionPlan(id, data)` | `PUT /action-plans/:id` | Atualizar plano |
| `api.deleteActionPlan(id)` | `DELETE /action-plans/:id` | Excluir plano |
| `api.createActionPlanItem(planId, item)` | `POST /action-plans/:id/items` | Adicionar item |
| `api.updateActionPlanItem(id, item)` | `PUT /action-plan-items/:id` | Atualizar item |
| `api.deleteActionPlanItem(id)` | `DELETE /action-plan-items/:id` | Excluir item |
| `api.getActionPlanHistory(itemId)` | `GET /action-plan-items/:id/history` | Histórico de alterações |
| `api.uploadActionPlanAttachment(itemId, file, userId?)` | `POST /action-plans/:id/attachments` | Upload de anexo |
| `api.getActionPlanAttachments(itemId)` | `GET /action-plans/:id/attachments` | Listar anexos |
| `api.deleteActionPlanAttachment(attachmentId)` | `DELETE /action-plans/attachments/:id` | Excluir anexo |

### Implementação (estrutura similar a Planos de Ação)

Mesmos métodos prefixados com `Implementation`: `getImplementationSchedules`, `createImplementationSchedule`, etc.

### Usuários

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.getUsers()` | `GET /users` | Listar usuários |
| `api.getUser(id)` | `GET /users/:id` | Buscar usuário |
| `api.createUser(user)` | `POST /users` | Criar usuário |
| `api.updateUser(id, user)` | `PUT /users/:id` | Atualizar usuário |
| `api.deleteUser(id)` | `DELETE /users/:id` | Excluir usuário |
| `api.getUsersBySector(sector)` | `GET /users/by-sector` | Usuários por setor |
| `api.getAllUsersSimple()` | `GET /users/list-all` | Lista simplificada |

### Notificações

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.getNotifications(userId)` | `GET /notifications` | Buscar notificações |
| `api.markNotificationRead(id)` | `PUT /notifications/:id/read` | Marcar como lida |
| `api.updateNotificationPreferences(userId, prefs)` | `POST /users/:id/preferences` | Atualizar preferências |

### Financeiro

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.uploadFinanceBase(type, file, userId, versionName, competencia?)` | `POST /financeiro/upload/:type` | Upload de base financeira |
| `api.getFinanceBases(type)` | `GET /financeiro/bases/:type` | Listar bases por tipo |
| `api.getFinanceReport(...)` | `GET /financeiro/report/*` | Relatórios financeiros |

### Dashboard e Importação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `api.getDashboardMetrics(userId?)` | `GET /dashboard/metrics` | Métricas do dashboard |
| `api.uploadImportationExcel(formData, userId)` | `POST /importation/upload` | Upload de Excel |
| `api.calculateImportation(data)` | `POST /importation/calculate` | Calcular previsão |
| `api.getImportationCache()` | `GET /importation/cache` | Cache de cálculo |
| `api.getImportationHistory()` | `GET /importation/history` | Histórico de importações |
| `api.deleteImportationHistory(historyId)` | `DELETE /importation/history/:id` | Excluir histórico |

---

## Módulos de Negócio

### Tickets de Suporte

**Prioridades:** `Baixa | Média | Alta | Urgente`

**Status:** `Aberto | Em Atendimento | Aguardando Usuário | Em Validação | Aguardando Suporte | Concluído | Cancelado`

**Categorias (T.I):** `Infraestrutura | StarSoft`

**Categorias (Gestão de Informação):** `Ajuste de erro ou problema | Criar automação | Novo dashboard / relatório | Sugestão e inclusão de campo`

Funcionalidades:
- Abertura com upload de arquivos
- Histórico de comentários e atualizações
- Campo de previsão de entrega
- Filtragem por setor, status, prioridade, categoria
- Exclusão (somente admin/super_user)

### Planejamento Estratégico

Planos de ação com sub-itens que rastreiam:
- **Orçamento:** planejado vs realizado (`budget_planned`, `budget_actual`)
- **Horas:** planejadas vs realizadas
- **ROI:** percentual de retorno (`roi_percentage`)
- **Satisfação:** score de stakeholders (`stakeholder_satisfaction`)
- **Dependências:** bloqueado por (`blocked_by_user_id`), aguardando retorno
- **Responsáveis:** lista de pessoas

Visualizações disponíveis: Lista, Kanban, Timeline/Gantt, Mapa Estratégico

### Módulo Financeiro

- Upload de bases orçadas e realizadas (Excel)
- Comparativo **orçado x realizado** por departamento
- **DRE** (Demonstração do Resultado do Exercício) com hierarquia de contas
- Cálculo de margens: Bruta, Contribuição, Operacional
- Justificativas de variações
- Controle de versões com competência (mês/ano)

### Importação de Dados

- Upload de planilha Excel com validação de colunas
- Previsão de demanda para 90 dias usando `HistGradientBoostingRegressor` (scikit-learn)
- Feature engineering: dia da semana, mês, proximidade de feriados, lags, médias móveis
- Download de template de importação
- Histórico de importações realizadas

---

## Estilização

- **Tailwind CSS** via classes utilitárias em todos os componentes
- **Cor principal:** vermelho `#1E73C8` (identidade EMPRESA)
- **Paleta secundária:** cinzas `slate`, branco, preto
- **CSS customizado** para animação de partículas na tela de login
- **Responsivo:** breakpoints `md:` e `lg:` com mobile-first
- **Animações:** keyframes CSS para partículas; `animate-` do Tailwind para feedback visual

---

## Inventário Detalhado de Componentes de Página

> Para cada componente: caminho do arquivo, chamadas à API (requisições ao banco) e campos hardcoded no frontend que deveriam vir do banco de dados.

---

### Visão Geral

#### `GeneralOverview`
- **Arquivo:** `components/GeneralOverview.tsx`
- **API / Banco:**
  - `GET /tickets` — lista de tickets do usuário
  - `GET /notifications` — notificações do usuário
  - `GET /sectors` — setores cadastrados
  - `GET /inter-sector-tickets` — tickets intersetoriais
  - `GET /action-plans` — planos de ação
- **Hardcoded:** nenhum campo crítico — usa dados dinâmicos do banco

---

### Suporte de TI

#### `TicketList`
- **Arquivo:** `components/TicketList.tsx`
- **API / Banco:**
  - `GET /tickets` — lista de tickets com filtros
  - `GET /users` — lista de usuários para filtro de responsável
  - `DELETE /tickets/{id}` — exclusão de ticket
- **Hardcoded que deveria vir do banco:**
  - Nomes dos setores usados para agrupar colunas: `['T.I', 'Gestão de Informação']` — deveriam vir de `/sectors`
  - Pesos de prioridade `{ 'Urgente': 4, 'Alta': 3, 'Média': 2, 'Baixa': 1 }` — deveriam vir junto com os dados de prioridade
  - Mapa de cores de status (CSS classes) — poderia ser centralizado em config do banco

#### `TicketDetail`
- **Arquivo:** `components/TicketDetail.tsx`
- **API / Banco:**
  - `GET /tickets/{id}` — dados do ticket
  - `GET /tickets/{id}/updates` — histórico de comentários
  - `POST /tickets/{id}/updates` — enviar comentário/arquivo
  - `PUT /tickets/{id}` — atualizar ticket
  - `POST /tickets/{id}/forward` — encaminhar ticket
  - `GET /categories?sector=` — categorias por setor
  - `GET /categories/{id}/subcategories` — subcategorias
- **Hardcoded que deveria vir do banco:**
  - Setores de encaminhamento fixos: `'T.I'` e `'GESTÃO DE INFORMAÇÃO'` — deveriam vir de `/sectors`

#### `NewTicket`
- **Arquivo:** `components/NewTicket.tsx`
- **API / Banco:**
  - `GET /users/list-all` — lista simplificada de usuários
  - `GET /categories?sector=T.I` — categorias (fixo em T.I)
  - `GET /categories/{id}/subcategories` — subcategorias
  - `POST /tickets` — criar ticket (multipart/form-data)
- **Hardcoded que deveria vir do banco:**
  - Setor fixo `'T.I'` na busca de categorias — deveria ser dinâmico conforme setor do usuário ou configurável

#### `ScheduleView`
- **Arquivo:** `components/ScheduleView.tsx`
- **API / Banco:**
  - `GET /tickets` — tickets para montar calendário
  - `PUT /tickets/{id}` — atualizar status via drag
- **Hardcoded:** nomes dos meses (internacionalização local — aceitável)

#### `CategoryManagement`
- **Arquivo:** `components/CategoryManagement.tsx`
- **API / Banco:**
  - `GET /categories?sector=` — listar categorias por setor
  - `GET /categories/{id}/subcategories` — listar subcategorias
  - `POST /categories` — criar categoria
  - `POST /categories/{id}/subcategories` — criar subcategoria
  - `DELETE /categories/{id}` — excluir categoria (cascata)
  - `DELETE /subcategories/{id}` — excluir subcategoria
- **Hardcoded:** nomes dos dois setores de aba `'T.I'` e `'GESTÃO DE INFORMAÇÃO'` — fixos por design

---

### Chamados Entre Setores

#### `InterSectorTicketList`
- **Arquivo:** `components/InterSetorial/InterSectorTicketList.tsx`
- **API / Banco:**
  - `GET /inter-sector-tickets` — lista de tickets intersetoriais
  - `GET /inter-sector-sectors` — setores disponíveis
  - `DELETE /inter-sector-tickets/{id}` — excluir ticket
- **Hardcoded que deveria vir do banco:**
  - Array de status: `['Aberto', 'Em Atendimento', 'Aguardando Usuário', 'Em Validação', 'Aguardando Suporte', 'Concluído', 'Cancelado']`
  - Array de prioridades: `['Baixa', 'Média', 'Alta', 'Urgente']`

#### `NewInterSectorTicket`
- **Arquivo:** `components/InterSetorial/NewInterSectorTicket.tsx`
- **API / Banco:**
  - `GET /inter-sector-sectors` — setores disponíveis
  - `GET /sector-categories?sector=` — categorias do setor destino
  - `POST /inter-sector-tickets` — criar ticket
- **Hardcoded:** prioridade padrão `'Média'` (aceitável como default)

#### `InterSectorTicketDetail`
- **Arquivo:** `components/InterSetorial/InterSectorTicketDetail.tsx`
- **API / Banco:**
  - `GET /inter-sector-tickets/{id}` — dados do ticket
  - `GET /inter-sector-tickets/{id}/updates` — histórico
  - `GET /sector-categories?sector=` — categorias do setor
  - `GET /sectors` — setores para encaminhamento
  - `PUT /inter-sector-tickets/{id}` — atualizar ticket
  - `POST /inter-sector-tickets/{id}/updates` — comentário/arquivo
  - `POST /inter-sector-tickets/{id}/forward` — encaminhar
- **Hardcoded que deveria vir do banco:**
  - Mesmos arrays de status e prioridades duplicados de `InterSectorTicketList`

#### `InterSectorKanban`
- **Arquivo:** `components/InterSetorial/InterSectorKanban.tsx`
- **API / Banco:**
  - `GET /inter-sector-tickets` — tickets para montar kanban
  - `PUT /inter-sector-tickets/{id}` — atualizar status via drag
- **Hardcoded:** colunas de status (mesma lista duplicada)

#### `InterSectorScheduleView`
- **Arquivo:** `components/InterSetorial/InterSectorScheduleView.tsx`
- **API / Banco:**
  - `GET /inter-sector-tickets` — tickets para calendário
  - `PUT /inter-sector-tickets/{id}` — atualizar status
- **Hardcoded:** nomes dos meses (aceitável)

#### `SectorCategoryManager`
- **Arquivo:** `components/InterSetorial/SectorCategoryManager.tsx`
- **API / Banco:**
  - `GET /sector-categories?sector=` — categorias do setor
  - `POST /sector-categories` — criar categoria
  - `DELETE /sector-categories/{id}` — excluir categoria
- **Hardcoded:** nenhum campo crítico

---

### Planejamento Estratégico

#### `ActionPlan`
- **Arquivo:** `components/ActionPlan.tsx`
- **API / Banco:**
  - `GET /action-plans` — listar planos
  - `POST /action-plans` — criar plano
  - `POST /action-plans/{id}/items` — criar item
  - `PUT /action-plan-items/{id}` — atualizar item
  - `DELETE /action-plan-items/{id}` — excluir item
  - `GET /action-plan-items/{id}/history` — histórico de alterações
  - `POST /action-plans/{id}/attachments` — upload anexo
  - `GET /action-plans/{id}/attachments` — listar anexos
  - `DELETE /action-plans/attachments/{id}` — excluir anexo
  - `GET /users/list-all` — lista de usuários responsáveis
- **Hardcoded que deveria vir do banco:**
  - Status inicial `'Não Iniciado'` e lista de status possíveis — constante local em `constants.ts`
  - `STRATEGIC_OBJECTIVES` importado de `constants.ts` — deveria ser editável via banco

#### `ActionPlanDashboard`
- **Arquivo:** `components/ActionPlanDashboard.tsx`
- **API / Banco:**
  - `GET /action-plans` — dados para os indicadores
- **Hardcoded:** lógica de cálculo de KPIs (aceitável no front)

#### `StrategicKanban`
- **Arquivo:** `components/StrategicKanban.tsx`
- **API / Banco:**
  - `GET /action-plans` — planos para montar colunas kanban
  - `PUT /action-plan-items/{id}` — mover item entre colunas
- **Hardcoded:** agrupamento por status (reflete os status do banco)

#### `StrategicTimeline`
- **Arquivo:** `components/StrategicTimeline.tsx`
- **API / Banco:**
  - `GET /action-plans` — planos para timeline/Gantt
- **Hardcoded:** lógica de renderização de barras (aceitável)

#### `StrategicMap`
- **Arquivo:** `components/StrategicMap.tsx`
- **API / Banco:** nenhuma chamada direta — recebe dados via props
- **Hardcoded:** configuração de visualização 3D (aceitável)

---

### Gestão de Projetos (Implementação)

#### `ImplementationActionPlan`
- **Arquivo:** `components/ImplementationActionPlan.tsx`
- **API / Banco:**
  - `GET /implementation-schedules` — listar planos
  - `POST /implementation-schedules` — criar plano
  - `POST /implementation-schedules/{id}/items` — criar item
  - `PUT /implementation-schedule-items/{id}` — atualizar item
  - `DELETE /implementation-schedule-items/{id}` — excluir item
  - `GET /users/list-all` — responsáveis
- **Hardcoded:** mesmos campos de `ActionPlan` (status, objetivos)

#### `ImplementationDashboard`
- **Arquivo:** `components/ImplementationDashboard.tsx`
- **API / Banco:**
  - `GET /implementation-schedules` — dados para indicadores
- **Hardcoded:** lógica de KPIs (aceitável)

#### `ImplementationKanban`
- **Arquivo:** `components/ImplementationKanban.tsx`
- **API / Banco:**
  - `GET /implementation-schedules` — planos para kanban
  - `PUT /implementation-schedule-items/{id}` — mover item
- **Hardcoded:** colunas por status

#### `ImplementationTimeline`
- **Arquivo:** `components/ImplementationTimeline.tsx`
- **API / Banco:**
  - `GET /implementation-schedules` — planos para timeline
- **Hardcoded:** lógica de Gantt (aceitável)

---

### Financeiro

#### `BaseUpload`
- **Arquivo:** `components/Financeiro/BaseUpload.tsx`
- **API / Banco:**
  - `GET /financeiro/bases/{type}` — listar versões de base (orçado ou realizado)
  - `POST /financeiro/upload/{type}` — upload de arquivo Excel
  - `DELETE /financeiro/bases/{id}` — excluir versão
- **Hardcoded:** nomes dos meses (aceitável)

#### `RelatorioOrcado`
- **Arquivo:** `components/Financeiro/RelatorioOrcado.tsx`
- **API / Banco:**
  - `GET /financeiro/bases/orcado` — versões disponíveis
  - `GET /financeiro/report/orcado` — dados do relatório
  - `GET /financeiro/departamentos` — departamentos disponíveis
  - `GET /financeiro/justificativas` — justificativas de variação
  - `POST /financeiro/justificativa` — salvar justificativa
- **Hardcoded:** larguras de colunas (aceitável para layout)

#### `RelatorioOrcadoRealizado`
- **Arquivo:** `components/Financeiro/RelatorioOrcadoRealizado.tsx`
- **API / Banco:**
  - `GET /financeiro/bases/{type}` — versões orçado e realizado
  - `GET /financeiro/report/orcado-realizado` — dados comparativos
  - `GET /financeiro/departamentos` — filtro de departamento
  - `GET /financeiro/justificativas` — justificativas
- **Hardcoded:** lógica de comparação (aceitável)

#### `RelatorioDRE`
- **Arquivo:** `components/Financeiro/RelatorioDRE.tsx`
- **API / Banco:**
  - `GET /financeiro/report/dre` — demonstração de resultado
  - `GET /financeiro/departamentos` — filtro de departamento
- **Hardcoded:** estrutura hierárquica do DRE (poderia ser configurável via banco)

#### `PlanoContas`
- **Arquivo:** `components/Financeiro/PlanoContas.tsx`
- **API / Banco:**
  - `GET /financeiro/plano-contas` — plano de contas completo
- **Hardcoded:** nenhum campo crítico

---

### Administração

#### `UserManagement`
- **Arquivo:** `components/UserManagement.tsx`
- **API / Banco:**
  - `GET /users` — listar usuários
  - `POST /users` — criar usuário
  - `PUT /users/{id}` — atualizar usuário
  - `DELETE /users/{id}` — excluir usuário
- **Hardcoded que deveria vir do banco:**
  - Hierarquia de roles `{ 'ceo': 1, 'super_user': 2, 'admin': 3, 'user': 4 }` — usada para ordenação na UI

#### `SectorManagement`
- **Arquivo:** `components/SectorManagement.tsx`
- **API / Banco:**
  - `GET /sectors` — listar setores
  - `POST /sectors` — criar setor
  - `PUT /sectors/{id}` — atualizar setor
  - `DELETE /sectors/{id}` — excluir setor
- **Hardcoded:** nenhum campo crítico — totalmente dinâmico

#### `RolePermissionsView`
- **Arquivo:** `components/RolePermissionsView.tsx`
- **API / Banco:**
  - `GET /role-permissions` — permissões por role
  - `POST /role-permissions` — salvar permissões
- **Hardcoded que deveria vir do banco:**
  - Lista completa de 50+ módulos e permissões definida no próprio componente — novos módulos exigem alteração de código

#### `Metrics`
- **Arquivo:** `components/Metrics.tsx`
- **API / Banco:**
  - `GET /tickets` — todos os tickets para métricas
  - `GET /users` — todos os usuários
- **Hardcoded:** lógica de cálculo de SLA e agrupamentos (aceitável)

#### `Importation`
- **Arquivo:** `components/Importation.tsx`
- **API / Banco:**
  - `GET /importation/cache` — último cálculo em cache
  - `GET /importation/history` — histórico de importações
  - `POST /importation/upload` — upload de planilha Excel
  - `POST /importation/calculate` — rodar previsão ML
  - `DELETE /importation/history/{id}` — excluir item do histórico
  - `GET /importation/template` — download do template Excel
- **Hardcoded:** mapeamento de larguras de colunas da tabela (aceitável para layout)

---

## Campos Hardcoded Prioritários para Migração ao Banco

| Componente | Campo Hardcoded | Impacto | Endpoint sugerido |
|---|---|---|---|
| `TicketList` | Nomes dos setores `['T.I', 'Gestão de Informação']` | Se um setor for renomeado, quebra agrupamento | `GET /sectors` |
| `TicketDetail` / `NewTicket` | Setor `'T.I'` fixo para buscar categorias | Categorias sempre buscam só T.I | `GET /sectors` dinâmico |
| `InterSectorTicketList` / `InterSectorTicketDetail` / `InterSectorKanban` | Arrays de status e prioridade duplicados em 3 arquivos | Qualquer mudança precisa ser feita em 3 lugares | Centralizar em `types.ts` ou `GET /ticket-config` |
| `RolePermissionsView` | Lista de 50+ módulos hardcoded no componente | Novo módulo exige deploy de código | `GET /modules` |
| `ActionPlan` / `ImplementationActionPlan` | `STRATEGIC_OBJECTIVES` em `constants.ts` | Objetivos não editáveis sem deploy | `GET /strategic-objectives` |
