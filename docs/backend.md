# Documentação Backend

## Visão Geral

O backend é uma aplicação **monolítica** construída com **FastAPI** (Python), servida via **Uvicorn**. Todo o código reside em um único arquivo principal:

- **Arquivo:** `backend_app.py` (~6.000 linhas)
- **Porta padrão:** `8002`
- **Banco de dados:** PostgreSQL com schema `portal_chamado`
- **Driver:** psycopg2 (queries SQL diretas, sem ORM)

---

## Inventário de Arquivos do Backend

| Arquivo | Propósito | Importado por |
|---------|-----------|---------------|
| `backend_app.py` | Aplicação FastAPI principal — todos os endpoints, lógica de negócio, agendamento | Ponto de entrada (uvicorn) |
| `db_utils.py` | Pool de conexões PostgreSQL + configuração de schema | `backend_app.py`, `permission_utils.py` |
| `permission_utils.py` | Verificação de permissões RBAC (`check_module_permission`, `load_role_permissions`) | `backend_app.py` |
| `modulo/__init__.py` | Pacote Python (vazio) | — |
| `modulo/category_controller.py` | Router FastAPI para CRUD de categorias e subcategorias de chamados | `backend_app.py` (registrado como `include_router`) |

---

## Configuração e Inicialização

### Credenciais

O backend busca credenciais na seguinte ordem de prioridade:

1. **Variáveis de ambiente** do sistema operacional
2. **Arquivo `cred.json`** na raiz do projeto (fallback local)

Variáveis suportadas:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_HOST` | Host do PostgreSQL | `localhost` |
| `DB_NAME` | Nome do banco | — |
| `DB_USER` | Usuário do banco | — |
| `DB_PASSWORD` | Senha do banco | — |
| `DB_PORT` | Porta do PostgreSQL | `5432` |
| `DB_SCHEMA` | Schema | `portal_chamado` |
| `GMAIL_USER` | Conta Gmail para envio | — |
| `GMAIL_PASSWORD` | App Password do Gmail | — |
| `FRONTEND_URL` | URL base do frontend | `http://localhost:5173` |
| `API_URL` | URL base da API | `http://localhost:8002` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path para service account GCP | — |

### CORS

Origens permitidas:

```python
allow_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "https://portal.blackd.com.br",
    "http://portal.blackd.com.br",
    "https://portal.tecnologia-blackd.com.br",
    "http://portal.tecnologia-blackd.com.br",
]
```

---

## Banco de Dados

### Schema: `portal_chamado`

O script de criação das tabelas está em `create_tables.py`.

### Tabelas

#### `users`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID do usuário |
| `name` | VARCHAR | Nome completo |
| `email` | VARCHAR UNIQUE | Email (login) |
| `username` | VARCHAR | Nome de usuário |
| `password_hash` | VARCHAR | Hash da senha (pbkdf2_sha256/bcrypt) |
| `role` | VARCHAR | `super_user | admin | user | ceo` |
| `sector` | VARCHAR | Setor principal |
| `managed_sectors` | TEXT | Setores gerenciados (separados por `;`) |
| `permissions` | JSONB | Permissões específicas por módulo |
| `notification_preferences` | JSONB | Preferências de notificação |
| `is_active` | BOOLEAN | Conta ativa |
| `last_login` | TIMESTAMP | Último acesso |
| `created_at` | TIMESTAMP | Data de criação |

#### `tickets`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID interno |
| `friendly_id` | VARCHAR | ID amigável (ex: `CH-0001`) |
| `title` | VARCHAR | Título do chamado |
| `description` | TEXT | Descrição detalhada |
| `category` | VARCHAR | Categoria do chamado |
| `priority` | VARCHAR | `Baixa | Média | Alta | Urgente` |
| `status` | VARCHAR | Status atual |
| `requester_id` | INTEGER FK | Usuário que abriu |
| `assignee_id` | INTEGER FK | Responsável pelo atendimento |
| `sector` | VARCHAR | Setor relacionado |
| `delivery_forecast` | DATE | Previsão de entrega |
| `created_at` | TIMESTAMP | Data de abertura |
| `updated_at` | TIMESTAMP | Última atualização |
| `closed_at` | TIMESTAMP | Data de encerramento |

**Status válidos:** `Aberto | Em Atendimento | Aguardando Usuário | Em Validação | Aguardando Suporte | Concluído | Cancelado`

**Categorias válidas (vêm dinamicamente de `GET /categories?sector=`):** Infraestrutura, StarSoft (setor T.I); Ajuste de erro ou problema, Criar automação, Novo dashboard / relatório, Sugestão e inclusão de campo (setor Gestão de Informação)

#### `ticket_updates`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `ticket_id` | INTEGER FK | Ticket relacionado |
| `user_id` | INTEGER FK | Autor do update |
| `message` | TEXT | Conteúdo do comentário |
| `attachment_path` | VARCHAR | Caminho do arquivo (se houver) |
| `created_at` | TIMESTAMP | Data do comentário |

#### `ticket_attachments`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `ticket_id` | INTEGER FK | Ticket relacionado |
| `file_path` | VARCHAR | Caminho do arquivo |
| `original_name` | VARCHAR | Nome original do arquivo |
| `uploaded_by` | INTEGER FK | Usuário que enviou |
| `created_at` | TIMESTAMP | Data do upload |

#### `action_plans`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `title` | VARCHAR | Título do plano |
| `sector` | VARCHAR | Setor responsável |
| `macro_theme` | VARCHAR | Tema macro (CLI, PIP, PAC) |
| `description` | TEXT | Descrição |
| `created_by` | INTEGER FK | Criador |
| `created_at` | TIMESTAMP | — |
| `updated_at` | TIMESTAMP | — |

#### `action_plan_items`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `plan_id` | INTEGER FK | Plano de ação |
| `title` | VARCHAR | Título do item |
| `description` | TEXT | Descrição |
| `status` | VARCHAR | `Não Iniciado | Em Andamento | Atrasado | Concluído | Suspenso` |
| `responsible_users` | JSONB | Lista de responsáveis |
| `start_date` | DATE | Data de início |
| `end_date` | DATE | Data de fim |
| `budget_planned` | NUMERIC | Orçamento planejado (R$) |
| `budget_actual` | NUMERIC | Orçamento realizado (R$) |
| `hours_planned` | NUMERIC | Horas planejadas |
| `hours_actual` | NUMERIC | Horas realizadas |
| `roi_percentage` | NUMERIC | ROI (%) |
| `stakeholder_satisfaction` | NUMERIC | Score de satisfação |
| `blocked_by_user_id` | INTEGER FK | Bloqueado por (usuário) |
| `waiting_for_return` | BOOLEAN | Aguardando retorno |
| `created_at` | TIMESTAMP | — |
| `updated_at` | TIMESTAMP | — |

#### `action_plan_history`

Registra todas as alterações em itens de plano de ação para auditoria.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `item_id` | INTEGER FK | Item alterado |
| `changed_by` | INTEGER FK | Usuário que alterou |
| `field_name` | VARCHAR | Campo modificado |
| `old_value` | TEXT | Valor anterior |
| `new_value` | TEXT | Novo valor |
| `changed_at` | TIMESTAMP | Data da alteração |

#### `implementation_schedules` e `implementation_schedule_items`

Estrutura espelhada a `action_plans` / `action_plan_items`, voltada para controle de implementações.

#### `notifications`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `user_id` | INTEGER FK | Destinatário |
| `title` | VARCHAR | Título da notificação |
| `message` | TEXT | Mensagem |
| `type` | VARCHAR | Tipo da notificação |
| `reference_id` | INTEGER | ID do objeto relacionado (ticket, etc.) |
| `is_read` | BOOLEAN | Se foi lida |
| `created_at` | TIMESTAMP | — |

#### `password_resets`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `user_id` | INTEGER FK | Usuário |
| `token` | VARCHAR UNIQUE | Token de reset |
| `expires_at` | TIMESTAMP | Expiração |
| `used` | BOOLEAN | Se já foi utilizado |

#### `role_permissions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `role` | VARCHAR PK | Nome da role |
| `permissions` | JSONB | Objeto de permissões por módulo |

#### `financeiro_bases`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | — |
| `type` | VARCHAR | `orcado | realizado` |
| `version_name` | VARCHAR | Nome da versão |
| `competencia` | VARCHAR | Mês/ano de competência |
| `uploaded_by` | INTEGER FK | Usuário que enviou |
| `file_path` | VARCHAR | Caminho do arquivo |
| `created_at` | TIMESTAMP | — |

#### `financeiro_data_orcado` e `financeiro_data_realizado`

Armazenam as linhas dos dados financeiros carregados, com colunas mapeadas para a estrutura DRE.

---

## Autenticação e Autorização

### Autenticação

- **Método:** Email + senha
- **Hash:** `passlib` com `pbkdf2_sha256` e `bcrypt`
- **Sem JWT:** Não há token de sessão no backend; a sessão é gerenciada pelo frontend via `sessionStorage`
- **Login registra** o `last_login` do usuário no banco

### Roles

| Role | Capacidades |
|------|------------|
| `super_user` | Acesso total, sem restrições de setor ou módulo |
| `ceo` | Acesso total, **não recebe emails** de notificação |
| `admin` | Gerencia seu setor principal + `managed_sectors` |
| `user` | Acesso apenas aos módulos/setores permitidos |

### Permissões por Módulo

Estrutura da coluna `permissions` em `users` (JSONB):

```json
{
  "tickets": {
    "can_view": true,
    "can_edit": true,
    "can_delete": false,
    "view_all_sectors": false,
    "allowed_sectors": ["T.I", "Financeiro"]
  }
}
```

### Funções de Autorização

**`get_user_context(user_id, conn)`**
- Retorna: `{ role, sector, managed_sectors, permissions }` mesclados (role_permissions padrão + permissões do usuário)

**`check_module_permission(user_id, module_id)`**
- Valida se o usuário pode acessar o módulo
- Retorna `bool`

**`load_role_permissions()`**
- Carrega defaults do banco (`role_permissions`) ou fallback do arquivo `role_permissions.json`

---

## Endpoints da API

Base URL: `http://localhost:8002`

Todos os endpoints retornam JSON exceto onde indicado.

### Sistema

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/ping` | Health check |

### Autenticação

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| `POST` | `/login` | `{ email, password }` | Autenticar usuário |
| `POST` | `/forgot-password` | `{ email }` | Solicitar reset de senha |
| `POST` | `/reset-password` | `{ token, new_password }` | Redefinir senha |
| `GET` | `/public/tickets/{ticket_id}/approve` | — | Aprovação via link de email (retorna HTML) |

### Tickets

| Método | Rota | Parâmetros | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/tickets` | `user_id?`, `role?` | Listar tickets filtrados por setor/role |
| `POST` | `/tickets` | multipart/form-data | Criar ticket com anexos |
| `GET` | `/tickets/{ticket_id}` | — | Buscar ticket por ID |
| `PUT` | `/tickets/{ticket_id}` | JSON com campos a atualizar | Atualizar ticket |
| `DELETE` | `/tickets/{ticket_id}` | — | Excluir ticket |
| `GET` | `/tickets/{ticket_id}/updates` | — | Histórico de updates/comentários |
| `POST` | `/tickets/{ticket_id}/updates` | multipart com `message`, `user_id`, `file?` | Adicionar comentário |
| `POST` | `/tickets/{ticket_id}/forward` | `{ to_sector, user_id }` | Encaminhar ticket para outro setor |

**Payload de criação de ticket:**

```json
{
  "title": "string",
  "description": "string (min. 50 caracteres)",
  "category": "Dashboard/Relatório | Automação | Sugestão de Campo | Ajuste/Erro | StarSoft | Infraestrutura",
  "priority": "Baixa | Média | Alta | Urgente",
  "requester_id": 1,
  "sector": "T.I",
  "delivery_forecast": "2025-12-31"
}
```

**Regras de validação de descrição:**
- Mínimo 50 caracteres
- Não pode ser apenas repetição de palavras
- Deve conter pelo menos uma frase completa

### Dashboard

| Método | Rota | Parâmetros | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/dashboard/metrics` | `user_id?` | KPIs e estatísticas do dashboard |

**Resposta inclui:**
- Total de tickets por status
- Tickets por prioridade
- Tempo médio de resolução
- Tickets abertos por setor

### Planos de Ação

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/action-plans` | Listar planos (filtros: `sector?`, `user_id?`) |
| `POST` | `/action-plans` | Criar plano |
| `PUT` | `/action-plans/{plan_id}` | Atualizar plano (objective, macro_theme, sector) |
| `DELETE` | `/action-plans/{plan_id}` | Excluir plano e itens |
| `POST` | `/action-plans/{plan_id}/items` | Adicionar item ao plano |
| `PUT` | `/action-plan-items/{item_id}` | Atualizar item (registra histórico) |
| `DELETE` | `/action-plan-items/{item_id}` | Excluir item |
| `GET` | `/action-plan-items/{item_id}/history` | Histórico de alterações do item |
| `POST` | `/action-plans/{item_id}/attachments` | Upload de anexo |
| `GET` | `/action-plans/{item_id}/attachments` | Listar anexos |
| `DELETE` | `/action-plans/attachments/{attachment_id}` | Excluir anexo |

### Cronogramas de Implementação

Estrutura idêntica à de Planos de Ação, com prefixo `/implementation-schedules`:

| Método | Rota |
|--------|------|
| `GET` | `/implementation-schedules` |
| `POST` | `/implementation-schedules` |
| `PUT` | `/implementation-schedules/{plan_id}` |
| `DELETE` | `/implementation-schedules/{plan_id}` |
| `POST` | `/implementation-schedules/{plan_id}/items` |
| `PUT` | `/implementation-schedule-items/{item_id}` |
| `DELETE` | `/implementation-schedule-items/{item_id}` |
| `GET` | `/implementation-schedule-items/{item_id}/history` |
| `POST` | `/implementation-schedules/{item_id}/attachments` |
| `GET` | `/implementation-schedules/{item_id}/attachments` |
| `DELETE` | `/implementation-schedules/attachments/{attachment_id}` |

### Usuários

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/users` | Listar todos os usuários |
| `POST` | `/users` | Criar usuário |
| `GET` | `/users/{user_id}` | Buscar usuário |
| `PUT` | `/users/{user_id}` | Atualizar usuário |
| `DELETE` | `/users/{user_id}` | Excluir usuário |
| `GET` | `/users/by-sector` | Usuários de um setor (`?sector=T.I`) |
| `GET` | `/users/list-all` | Lista simplificada (id, name, email, sector) |

**Payload de criação de usuário:**

```json
{
  "name": "string",
  "email": "string",
  "username": "string",
  "password": "string",
  "role": "user | admin | super_user | ceo",
  "sector": "string",
  "managed_sectors": "setor1;setor2",
  "is_active": true
}
```

### Roles e Permissões

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/role-permissions` | Buscar permissões de todas as roles |
| `POST` | `/role-permissions` | Atualizar permissões de uma role |

**Payload de atualização:**

```json
{
  "role": "admin",
  "permissions": {
    "tickets": { "can_view": true, "can_edit": true, "can_delete": false }
  }
}
```

### Notificações

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/notifications` | Buscar notificações (`?user_id=1`) |
| `PUT` | `/notifications/{notif_id}/read` | Marcar notificação como lida |
| `DELETE` | `/notifications/{notif_id}` | Excluir notificação |
| `POST` | `/users/{user_id}/preferences` | Salvar preferências de notificação |

### Setores

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/sectors` | Listar setores |
| `POST` | `/sectors` | Criar setor |
| `PUT` | `/sectors/{id}` | Atualizar setor |
| `DELETE` | `/sectors/{id}` | Excluir setor |

### Chamados Intersetoriais

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/inter-sector-tickets` | Listar tickets intersetoriais |
| `POST` | `/inter-sector-tickets` | Criar ticket intersetorial |
| `GET` | `/inter-sector-tickets/{ticket_id}` | Buscar ticket por ID |
| `PUT` | `/inter-sector-tickets/{ticket_id}` | Atualizar ticket |
| `DELETE` | `/inter-sector-tickets/{ticket_id}` | Excluir ticket |
| `GET` | `/inter-sector-tickets/{ticket_id}/updates` | Histórico de comentários |
| `POST` | `/inter-sector-tickets/{ticket_id}/updates` | Adicionar comentário |
| `POST` | `/inter-sector-tickets/{ticket_id}/forward` | Encaminhar para outro setor |
| `GET` | `/inter-sector-sectors` | Listar setores disponíveis para seleção intersetorial |
| `GET` | `/sector-categories` | Categorias por setor (`?sector=`) |
| `GET` | `/strategic-sectors` | Setores para planos estratégicos |
| `GET` | `/implementation-sectors` | Setores para cronogramas de implementação |

### Financeiro

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/financeiro/upload/{type}` | Upload de base (`type`: `orcado` ou `realizado`) |
| `GET` | `/financeiro/bases/{type}` | Listar bases por tipo |
| `DELETE` | `/financeiro/bases/{base_id}` | Excluir base |
| `GET` | `/financeiro/report/orcado` | Relatório de orçado |
| `GET` | `/financeiro/report/orcado-realizado` | Comparativo orçado x realizado |
| `GET` | `/financeiro/report/dre` | DRE (Demonstração do Resultado) |
| `GET` | `/financeiro/plano-contas` | Plano de contas |
| `GET` | `/financeiro/departamentos` | Listar departamentos |
| `GET` | `/financeiro/justificativas` | Buscar justificativas de variação |
| `POST` | `/financeiro/justificativa` | Salvar justificativa |
| `GET` | `/financeiro/drilldown` | Detalhamento de linha DRE por mês/departamento |

**Upload de base financeira (`multipart/form-data`):**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `file` | File | Planilha Excel (.xlsx) |
| `user_id` | int | Usuário que fez upload |
| `version_name` | str | Nome da versão (ex: "Orçamento 2025") |
| `competencia` | str | Competência (ex: "2025-01") |

### Importação de Dados

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/importation/template` | Download do template Excel |
| `POST` | `/importation/upload` | Upload e processamento do Excel |
| `POST` | `/importation/calculate` | Calcular previsão de demanda |
| `GET` | `/importation/cache` | Buscar cache do último cálculo |
| `GET` | `/importation/history` | Histórico de importações |
| `DELETE` | `/importation/history/{history_id}` | Excluir registro do histórico |

---

## Lógica de Negócio Principal

### Ciclo de Vida dos Tickets

```
Aberto
  └─► Em Atendimento
        ├─► Aguardando Usuário ──► Em Atendimento
        ├─► Em Validação ──────────► [Auto-fechamento em 5 dias úteis]
        │         └─► Concluído (aprovação pelo link de email)
        │         └─► Em Atendimento (reprovação)
        └─► Aguardando Suporte
              └─► Em Atendimento
Concluído (terminal)
Cancelado (terminal)
```

**Auto-fechamento:**
- Tickets em status `Em Validação` por mais de **5 dias úteis** são automaticamente fechados como `Concluído`
- Verificado pelo `APScheduler` em tarefas agendadas

**Restrições de comentário:**
- Tickets `Concluído` ou `Cancelado`: apenas `super_user` e `ceo` podem comentar

**Filtragem por setor:**
- `user`: vê tickets onde é `requester_id` ou `assignee_id`, dentro do seu setor
- `admin`: vê tickets do seu setor e setores gerenciados
- `super_user` / `ceo`: vê todos os tickets
- Setor **T.I** inclui automaticamente categorias `StarSoft` e `Infraestrutura` na filtragem

### Sistema de Notificações por Email

- **Biblioteca:** `smtplib` (Gmail SMTP, porta 587, STARTTLS)
- **Templates:** HTML inline com estilos CSS
- **Execução:** `BackgroundTasks` do FastAPI (assíncrono)
- **Eventos que disparam emails:**
  - Criação de ticket → notifica requester + admins do setor
  - Atualização de status → notifica partes interessadas
  - Mudança para `Em Validação` → email com botões "Aprovar" / "Reprovar"
  - Conclusão / Cancelamento → notifica requester
- **Exceção:** Role `ceo` nunca recebe emails

### Previsão de Demanda (ML)

**Modelo:** `HistGradientBoostingRegressor` (scikit-learn)

**Features utilizadas:**
- Dia da semana, dia do mês, mês
- Proximidade de feriados
- Lags de 7, 14, 30 dias
- Médias móveis de 7, 14, 30 dias
- Volatilidade histórica

**Output:**
- Previsão de demanda para os próximos **90 dias**, dividida em 3 buckets mensais
- Normalizada por "Meses Ativos" (últimos 3 meses com vendas > 0)
- Meta de estoque: `DIAS_ESTOQUE_ALVO = 180` dias

**Cache:** Resultado salvo em `importation_cache.json` para evitar recalcular

---

## Integrações Externas

### Gmail SMTP

```python
# Configuração
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
# Requer App Password (não a senha principal da conta)
```

### Google BigQuery

- **Projeto:** `projeto-rpa-blackd-2023`
- **Autenticação:** Service account via `GOOGLE_APPLICATION_CREDENTIALS`
- Usado para queries de dados analíticos e relatórios avançados

### Upload de Arquivos

- Diretório: `/uploads/`
- Nomenclatura: `{timestamp}_{uuid}_{nome_original_sanitizado}`
- Servidos estaticamente via rota `/uploads/{filename}`
- Suportados em: Tickets, Planos de Ação, Implementações, Financeiro

---

## Tarefas Agendadas (APScheduler)

| Tarefa | Frequência | Descrição |
|--------|-----------|-----------|
| Auto-fechamento de tickets | Diária | Fecha tickets em `Em Validação` há mais de 5 dias úteis |

---

## Arquivos de Suporte

| Arquivo | Descrição |
|---------|-----------|
| `role_permissions.json` | Permissões padrão por role (fallback do banco) |
| `importation_cache.json` | Cache dos cálculos de importação |
| `requirements.txt` | Dependências Python |
| `cred.json` | Credenciais locais (não commitado no repositório) |

---

## Valores Hardcoded (Candidatos a Migração para Banco)

Esta seção lista valores que estão fixos no código e que deveriam ser gerenciáveis via banco de dados.

### Alta Prioridade

| Valor | Localização | Impacto |
|-------|-------------|---------|
| `DRE_STRUCTURE` (~80 itens) | `backend_app.py` linha 104 + duplicado em `RelatorioOrcado.tsx` e `RelatorioDRE.tsx` | Qualquer mudança no plano de contas exige edição manual em 3 arquivos |
| Setores padrão (`ensure_sectors_table()`) | `backend_app.py` linhas 6036–6044 | 25 setores fixos inseridos no banco na inicialização; adicionar/renomear requer alterar o código |
| Status de chamados (`Aberto`, `Em Atendimento`, `Aguardando Usuário`, `Em Validação`, `Aguardando Suporte`, `Concluído`, `Cancelado`) | Espalhado pelo `backend_app.py` em validações e filtros | Nenhum endpoint retorna a lista de status; frontend e backend os duplicam |

### Média Prioridade

| Valor | Localização | Impacto |
|-------|-------------|---------|
| Prioridades (`Baixa`, `Média`, `Alta`, `Urgente`) | `backend_app.py` + frontend | Lista duplicada; score numérico associado hardcoded no frontend |
| Roles (`super_user`, `ceo`, `admin`, `user`) | `backend_app.py`, `permission_utils.py` | Adicionar nova role exige refatoração de múltiplos IFs |
| Status de itens de plano (`Não Iniciado`, `Em Andamento`, `Atrasado`, `Concluído`, `Suspenso`) | `backend_app.py` | Nenhum endpoint retorna a lista; frontend duplica |
| `target_admin_sector = 'T.I'` | `backend_app.py` linhas 1751, 1944 | Lógica de encaminhamento automático fixa para T.I |

### Observações

- **`DRE_STRUCTURE`** é o item mais crítico: está duplicado entre backend e dois componentes React. Uma tabela `financeiro_dre_structure` resolveria.
- **Setores default** podem ser removidos do `ensure_sectors_table()` agora que a tabela `sectors` existe e é gerenciada via UI (`/sectors`).
- **Categorias de chamados** já foram migradas para o banco (`ticket_categories` table) e são consumidas via `GET /categories`. ✅

---

## Dependências Python

```
fastapi
uvicorn
psycopg2-binary
pydantic
python-multipart
python-jose[cryptography]
passlib[bcrypt]
requests
apscheduler
openpyxl
pandas
numpy
google-cloud-bigquery
google-auth
google-cloud-bigquery-storage
pyarrow
db-dtypes
scikit-learn
```

---

## Mapeamento de Endpoints por Arquivo

Após a refatoração modular, cada domínio de rotas está em seu próprio arquivo dentro de `modulo/`.

### `modulo/tickets.py`
| Método | Rota |
|--------|------|
| `GET` | `/tickets/{ticket_id}/updates` |
| `POST` | `/tickets/{ticket_id}/updates` |
| `GET` | `/tickets` |
| `POST` | `/tickets` |
| `GET` | `/tickets/{ticket_id}` |
| `PUT` | `/tickets/{ticket_id}` |
| `POST` | `/tickets/{ticket_id}/forward` |
| `GET` | `/public/tickets/{ticket_id}/approve` |
| `DELETE` | `/tickets/{ticket_id}` |

### `modulo/users.py`
| Método | Rota |
|--------|------|
| `POST` | `/login` |
| `GET` | `/users/by-sector` |
| `GET` | `/users/list-all` |
| `GET` | `/users/{user_id}` |
| `POST` | `/forgot-password` |
| `POST` | `/reset-password` |
| `GET` | `/users` |
| `PUT` | `/users/{user_id}` |
| `DELETE` | `/users/{user_id}` |
| `POST` | `/users` |
| `GET` | `/role-permissions` |
| `POST` | `/role-permissions` |
| `GET` | `/notifications` |
| `PUT` | `/notifications/{notif_id}/read` |
| `POST` | `/users/{user_id}/preferences` |

### `modulo/action_plans.py`
| Método | Rota |
|--------|------|
| `GET` | `/action-plans` |
| `POST` | `/action-plans` |
| `PUT` | `/action-plan-items/{item_id}` |
| `GET` | `/action-plan-items/{item_id}/history` |
| `POST` | `/action-plans/{plan_id}/items` |
| `DELETE` | `/action-plans/{plan_id}` |
| `DELETE` | `/action-plan-items/{item_id}` |
| `POST` | `/action-plans/{item_id}/attachments` |
| `GET` | `/action-plans/{item_id}/attachments` |
| `DELETE` | `/action-plans/attachments/{attachment_id}` |
| `PUT` | `/action-plans/{plan_id}` |

### `modulo/implementation.py`
| Método | Rota |
|--------|------|
| `GET` | `/implementation-schedules` |
| `POST` | `/implementation-schedules` |
| `PUT` | `/implementation-schedules/{plan_id}` |
| `DELETE` | `/implementation-schedules/{plan_id}` |
| `POST` | `/implementation-schedules/{plan_id}/items` |
| `PUT` | `/implementation-schedule-items/{item_id}` |
| `DELETE` | `/implementation-schedule-items/{item_id}` |
| `POST` | `/implementation-schedules/{item_id}/attachments` |
| `GET` | `/implementation-schedules/{item_id}/attachments` |
| `DELETE` | `/implementation-schedules/attachments/{attachment_id}` |
| `GET` | `/implementation-schedule-items/{item_id}/history` |

### `modulo/sectors.py`
| Método | Rota |
|--------|------|
| `GET` | `/strategic-sectors` |
| `GET` | `/implementation-sectors` |
| `GET` | `/inter-sector-sectors` |
| `GET` | `/sectors` |
| `POST` | `/sectors` |
| `PUT` | `/sectors/{sector_id}` |
| `DELETE` | `/sectors/{sector_id}` |
| `GET` | `/sector-categories` |
| `POST` | `/sector-categories` |
| `DELETE` | `/sector-categories/{cat_id}` |

### `modulo/dashboard.py`
| Método | Rota |
|--------|------|
| `GET` | `/dashboard/metrics` |
| `GET` | `/ping` |

### `modulo/financeiro.py`
| Método | Rota |
|--------|------|
| `POST` | `/financeiro/upload/{type}` |
| `GET` | `/financeiro/bases/{type}` |
| `DELETE` | `/financeiro/bases/{base_id}` |
| `GET` | `/financeiro/departamentos` |
| `POST` | `/financeiro/justificativa` |
| `GET` | `/financeiro/justificativas` |
| `GET` | `/financeiro/drilldown` |
| `GET` | `/financeiro/report/orcado` |
| `GET` | `/financeiro/report/orcado-realizado` |
| `GET` | `/financeiro/report/dre` |
| `GET` | `/financeiro/plano-contas` |

### `modulo/importation.py`
| Método | Rota |
|--------|------|
| `GET` | `/importation/template` |
| `GET` | `/importation/cache` |
| `POST` | `/importation/upload` |
| `GET` | `/importation/history` |
| `DELETE` | `/importation/history/{history_id}` |
| `POST` | `/importation/calculate` |

### `modulo/inter_sector.py`
| Método | Rota |
|--------|------|
| `GET` | `/inter-sector-tickets` |
| `POST` | `/inter-sector-tickets` |
| `GET` | `/inter-sector-tickets/{ticket_id}` |
| `PUT` | `/inter-sector-tickets/{ticket_id}` |
| `DELETE` | `/inter-sector-tickets/{ticket_id}` |
| `GET` | `/inter-sector-tickets/{ticket_id}/updates` |
| `POST` | `/inter-sector-tickets/{ticket_id}/updates` |
| `POST` | `/inter-sector-tickets/{ticket_id}/forward` |

### `modulo/category_controller.py` (pré-existente, não modificado)
| Método | Rota |
|--------|------|
| `GET` | `/categories` |
| `POST` | `/categories` |
| `DELETE` | `/categories/{category_id}` |
| `GET` | `/categories/{category_id}/subcategories` |
| `POST` | `/categories/{category_id}/subcategories` |
| `DELETE` | `/subcategories/{subcategory_id}` |

---

## 12. Ambiente de Homologação

### Visão Geral

O projeto possui dois ambientes isolados, cada um com seu próprio schema PostgreSQL e serviços no Easypanel (Docker Swarm):

| Ambiente | Schema PostgreSQL | Backend | Frontend | App Easypanel |
|----------|-------------------|---------|----------|---------------|
| Produção | `portal_chamado` | porta `8000` | porta `8080` | `backend` / `portal-front` |
| Homologação | `portal_chamado_homolog` | porta `8010` | porta `8090` | `backend-homolog` / `homolog-portal-front` |

### Isolamento por Schema

O isolamento entre os ambientes é feito pela variável de ambiente `DB_SCHEMA`, lida em `db_utils.py`:

```python
db_schema = os.environ.get("DB_SCHEMA", "portal_chamado")
cur.execute(f"SET search_path TO {db_schema}, public")
```

- **Produção**: não define `DB_SCHEMA` → usa o padrão `portal_chamado`
- **Homologação**: define `DB_SCHEMA=portal_chamado_homolog` → todas as queries apontam para o schema homolog

> **Importante**: Nenhuma query no código deve ter prefixo de schema hardcoded (ex: `portal_chamado.tickets`). O `search_path` garante o roteamento correto.

### Fluxo Obrigatório de Desenvolvimento (Homolog-First)

```
desenvolvimento → homolog (validar) → produção
```

1. **Desenvolver** — toda nova feature, endpoint, migration ou correção é criada apontando para `portal_chamado_homolog`
2. **Validar** — testar no ambiente de homologação até aprovação explícita
3. **Aplicar em produção** — somente após validação, replicar as alterações no schema `portal_chamado`

**Nunca alterar diretamente o schema de produção sem que a mudança tenha sido validada em homologação.**

### Migrations e Alterações de Schema

Ao adicionar novas colunas ou tabelas:

```sql
-- 1. Aplicar em homolog primeiro
ALTER TABLE portal_chamado_homolog.tickets ADD COLUMN IF NOT EXISTS nova_coluna VARCHAR(100);

-- 2. Após validação, aplicar em produção
ALTER TABLE portal_chamado.tickets ADD COLUMN IF NOT EXISTS nova_coluna VARCHAR(100);
```

### Variáveis de Ambiente — Backend Homolog

```env
DB_HOST=criadordigital_postgres
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=<senha>
DB_SCHEMA=portal_chamado_homolog
```
