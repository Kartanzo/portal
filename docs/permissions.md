# Controle de Permissão — Portal de Chamado

> **Schema:** `portal_chamado` · **Banco:** PostgreSQL (`postgres-corp` em `192.0.2.10`)  
> **Gerado em:** 2026-03-18

---

## 1. Tabelas Envolvidas

### `users`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID PK | ID único do usuário |
| `name` | VARCHAR | Nome completo |
| `email` | VARCHAR UNIQUE | Email (login) |
| `role` | VARCHAR | `super_user \| admin \| user \| ceo` |
| `sector` | VARCHAR | Setor principal do usuário |
| `managed_sectors` | TEXT | Setores gerenciados separados por `;` (apenas `admin`) |
| `permissions` | JSONB | Permissões específicas por módulo (sobrescreve o padrão da role) |
| `is_active` | BOOLEAN | Conta ativa (`true`) ou desativada (`false`) |

### `role_permissions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `role` | VARCHAR PK | Nome da role (`admin`, `user`, `ceo`, `super_user`) |
| `permissions` | JSONB | Objeto de permissões padrão por módulo para aquela role |

---

## 2. Roles e Capacidades

| Role | Descrição |
|------|-----------|
| `super_user` | Acesso irrestrito a todos os módulos e setores |
| `ceo` | Acesso irrestrito; **não recebe e-mails** de notificação |
| `admin` | Gerencia seu `sector` + todos em `managed_sectors` |
| `user` | Acesso limitado ao que está definido em `role_permissions` e na coluna `permissions` do próprio usuário |

---

## 3. Módulos Controlados por Permissão

Cada módulo aparece como chave no JSON de `permissions`. As propriedades possíveis são:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `can_view` | boolean | O usuário pode visualizar o módulo |
| `can_edit` | boolean | O usuário pode editar |
| `can_delete` | boolean | O usuário pode excluir |
| `allowed_sectors` | string[] | Setores que a permissão abrange |

**Módulos identificados no banco:**

| Chave do módulo | Descrição |
|-----------------|-----------|
| `tickets` | Chamados / Tickets |
| `dashboard` | Dashboard principal |
| `schedule` | Cronograma |
| `action_plans` | Planos de Ação |
| `action_plan_dashboard` | Dashboard de Planos de Ação |
| `impl_kanban` | Kanban de Implementações |
| `impl_timeline` | Timeline de Implementações |
| `impl_action_plan` | Plano de Ação dentro de Implementações |
| `impl_dashboard` | Dashboard de Implementações |
| `strategic_map` | Mapa Estratégico |
| `strategic_kanban` | Kanban Estratégico |
| `strategic_timeline` | Timeline Estratégica |
| `sector_info` | Informações de Setores |
| `importation` | Importação de Dados |
| `financeiro_dre` | DRE Financeiro |
| `financeiro_orcado` | Financeiro — Orçado |
| `financeiro_base_orcado` | Base do Orçado |
| `financeiro_base_realizado` | Base do Realizado |
| `financeiro_orcado_realizado` | Comparativo Orçado x Realizado |
| `financeiro_plano_contas` | Plano de Contas |

---

## 4. Permissões por Role (dados do banco)

### Role: `admin`

| Módulo | `can_view` | `allowed_sectors` |
|--------|:----------:|-------------------|
| `tickets` | ✅ | Todos os setores |
| `dashboard` | ✅ | Todos os setores |
| `schedule` | ✅ | Todos os setores |
| `sector_info` | ✅ | Todos os setores |
| `impl_kanban` | ✅ | Todos os setores |
| `impl_timeline` | ✅ | Todos os setores |
| `impl_action_plan` | ✅ | Todos os setores |
| `impl_dashboard` | ✅ | Todos os setores |
| `action_plans` | ❌ | Comercial, Compras, Controladoria, Ecommerce, Fabrica, Financeiro, Gestão de Informação, Logistica, Marketing, RH, T.I |
| `action_plan_dashboard` | ❌ | Comercial, Compras, Controladoria, Ecommerce, Fabrica, Financeiro, Gestão de Informação, Logistica, Marketing, Qualidade, RH |
| `strategic_map` | ❌ | Comercial, Compras, Controladoria, Ecommerce, Fabrica, Financeiro, Gestão de Informação, Logistica, Marketing, RH, T.I |
| `strategic_kanban` | ❌ | Comercial, Compras, Controladoria, Ecommerce, Fabrica, Financeiro, Gestão de Informação, Logistica, Marketing, RH, T.I |
| `strategic_timeline` | ❌ | Comercial, Compras, Controladoria, Ecommerce, Fabrica, Financeiro, Gestão de Informação, Logistica, Marketing, RH, T.I |
| `importation` | — | Logistica, Ecommerce |
| `financeiro_dre` | ✅ | Financeiro |
| `financeiro_orcado` | ✅ | Financeiro |
| `financeiro_base_orcado` | ✅ | Financeiro |
| `financeiro_base_realizado` | ✅ | Financeiro |
| `financeiro_orcado_realizado` | ✅ | Financeiro |
| `financeiro_plano_contas` | ✅ | Financeiro |

### Role: `ceo`

> Acesso total a todos os módulos sem restrição de setor. Não recebe e-mails de notificação.

| Módulo | `can_view` |
|--------|:----------:|
| Todos os módulos | ✅ |

### Role: `user`

| Módulo | `can_view` | `allowed_sectors` |
|--------|:----------:|-------------------|
| `tickets` | ✅ | Todos os setores |
| `dashboard` | ✅ | Todos os setores |
| `schedule` | ✅ | Todos os setores |
| `sector_info` | ✅ | Todos os setores |
| `financeiro_dre` | ✅ | Controladoria |
| `financeiro_orcado` | ✅ | Controladoria |
| `financeiro_base_orcado` | ✅ | Controladoria |
| `financeiro_base_realizado` | ✅ | Controladoria |
| `financeiro_orcado_realizado` | ✅ | Controladoria |
| `financeiro_plano_contas` | ✅ | Controladoria |
| `importation` | — | Logistica |
| `impl_kanban` | ❌ | — |
| `impl_timeline` | ❌ | — |
| `impl_action_plan` | ❌ | — |
| `impl_dashboard` | ❌ | — |
| `action_plans` | ❌ | — |
| `action_plan_dashboard` | ❌ | — |
| `strategic_map` | ❌ | — |
| `strategic_kanban` | ❌ | — |
| `strategic_timeline` | ❌ | — |

### Role: `super_user`

> Acesso irrestrito a tudo. Sem verificação de setor ou módulo.

---

## 5. Usuários Ativos por Role

### `super_user` (ativos)

| Nome | Email | Setor |
|------|-------|-------|
| Usuário 1 | usuario1@empresa.com.br | Gestão de Informação |
| Usuário 2 | usuario2@empresa.com.br | Gestão de Informação |

### `ceo` (ativos)

| Nome | Email | Setor |
|------|-------|-------|
| Usuário 3 | usuario3@empresa.com.br | Diretoria |

### `admin` (ativos)

| Nome | Email | Setor Principal | Setores Gerenciados | Permissões Especiais |
|------|-------|-----------------|---------------------|----------------------|
| Usuário 4 | usuario4@empresa.com.br | Financeiro | — | — |
| Usuário 5 | usuario5@empresa.com.br | Compras | Compras; Logistica | — |
| Usuário 6 | usuario6@empresa.com.br | Marketing | Marketing; Ecommerce | — |
| Usuário 7 | usuario7@empresa.com.br | T.I | — | `tickets.can_edit: true` |
| Usuário 1 | gsi@empresa.com.br | T.I | T.I | `tickets.can_edit: true` |
| Usuário 8 | usuario8@empresa.com.br | Fabrica | — | — |
| Usuário 9 | usuario9@empresa.com.br | Regional SP Interior | Regional SP Interior; Regional Sul | — |
| Usuário 10 | usuario10@empresa.com.br | RH | — | — |
| Usuário 11 | usuario11@empresa.com.br | Regional Centro-Oeste | Regional Centro-Oeste; Regional Norte | — |
| Usuário 12 | usuario12@empresa.com.br | Financeiro | Financeiro; Controladoria | — |
| Usuário 13 | usuario13@empresa.com.br | Financeiro | — | — |
| Usuário 14 | usuario14@empresa.com.br | Regional SP Capital | Regional SP Capital; Regional Sudeste | — |
| Usuário 15 | usuario15@empresa.com.br | Comercial | — | `projects.can_edit/delete: true` |
| Usuário 16 | usuario16@empresa.com.br | Marketing | — | — |
| Usuário 17 | usuario17@empresa.com.br | Televendas | Televendas | — |
| Usuário 18 | usuario18@empresa.com.br | Regional Nordeste | Regional Nordeste | — |

### `user` (ativos — 27 usuários)

| Nome | Email | Setor |
|------|-------|-------|
| Usuário 19 | usuario19@empresa.com.br | Controladoria |
| Usuário 20 | credito@empresa.com.br | Financeiro |
| Usuário 21 | usuario21@empresa.com.br | Comercial |
| Usuário 22 | usuario22@empresa.com.br | Televendas |
| Usuário 23 | cpagar@empresa.com.br | Financeiro |
| Usuário 24 | creceber@empresa.com.br | Financeiro |
| Usuário 25 | usuario25@empresa.com.br | Qualidade |
| Usuário 26 | sac@empresa.com.br | Comercial |
| Usuário 27 | ecommerce@empresa.com.br | Ecommerce |
| Usuário 28 | usuario28@empresa.com.br | Logistica |
| Usuário 29 | usuario29@empresa.com.br | Comercial |
| Usuário 30 | fiscal@empresa.com.br | Financeiro |
| Usuário 31 | usuario31@empresa.com.br | Marketing |
| Usuário 32 | usuario32@empresa.com.br | Televendas |
| Usuário 33 | usuario33@empresa.com.br | Televendas |
| Usuário 34 | usuario34@empresa.com.br | Televendas |
| Usuário 35 | usuario35@empresa.com.br | Televendas |
| Usuário 36 | usuario36@empresa.com.br | Ecommerce |
| Usuário 37 | usuario37@empresa.com.br | Televendas |
| Usuário 38 | compras2@empresa.com.br | Compras |
| Usuário 39 | usuario39@empresa.com.br | Comercial |
| Usuário 40 | usuario40@empresa.com.br | Compras |
| Usuário 41 | usuario41@empresa.com.br | Televendas |
| Usuário 42 | usuario42@empresa.com.br | Ecommerce |

---

## 6. Rotas da API — Controle de Permissão

Base URL: `http://localhost:8002`

### Autenticação (pré-requisito para autorização)

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| `POST` | `/login` | `{ email, password }` | Autentica o usuário; retorna dados incluindo `role` e `permissions` |
| `POST` | `/forgot-password` | `{ email }` | Solicita reset de senha |
| `POST` | `/reset-password` | `{ token, new_password }` | Redefine a senha |

### Roles e Permissões (gerenciamento direto de controle de acesso)

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| `GET` | `/role-permissions` | — | Retorna as permissões padrão de **todas** as roles |
| `POST` | `/role-permissions` | `{ role, permissions: {...} }` | Atualiza/sobrescreve as permissões de uma role específica |

**Exemplo de payload para `POST /role-permissions`:**
```json
{
  "role": "admin",
  "permissions": {
    "tickets":    { "can_view": true, "can_edit": true, "can_delete": false },
    "financeiro_dre": { "can_view": true, "allowed_sectors": ["Financeiro"] }
  }
}
```

### Usuários (onde `role` e `permissions` individuais são configurados)

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| `GET` | `/users` | — | Lista todos os usuários (contém `role`, `permissions`, `managed_sectors`) |
| `POST` | `/users` | `{ name, email, username, password, role, sector, managed_sectors, is_active }` | Cria usuário com role e setor definidos |
| `GET` | `/users/{user_id}` | — | Retorna dados do usuário incluindo permissões |
| `PUT` | `/users/{user_id}` | `{ role?, permissions?, managed_sectors?, is_active?, ... }` | Atualiza role, permissões individuais ou setores gerenciados |
| `DELETE` | `/users/{user_id}` | — | Desativa/exclui o usuário |
| `GET` | `/users/by-sector` | `?sector=T.I` | Lista usuários de um setor específico |
| `GET` | `/users/list-all` | — | Lista simplificada: `id, name, email, sector` |

### Preferências de Notificação (associada ao perfil de acesso)

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| `POST` | `/users/{user_id}/preferences` | `{ notification_preferences: {...} }` | Salva preferências de notificação por evento |

---

## 7. Funções de Autorização no Backend

Definidas em `backend_app.py`:

| Função | Retorno | Descrição |
|--------|---------|-----------|
| `get_user_context(user_id, conn)` | `{ role, sector, managed_sectors, permissions }` | Mescla permissões da `role_permissions` com as permissões individuais do usuário |
| `check_module_permission(user_id, module_id)` | `bool` | Verifica se o usuário pode acessar um módulo específico |
| `load_role_permissions()` | `dict` | Carrega os defaults do banco (`role_permissions`) ou do arquivo `role_permissions.json` como fallback |

---

## 8. Fluxo de Verificação de Acesso

```
1. Frontend envia user_id no request
        │
        ▼
2. Backend chama get_user_context(user_id)
        │
        ├── Busca role em portal_chamado.users
        ├── Busca permissões padrão em portal_chamado.role_permissions
        └── Mescla com permissions JSONB do usuário (override individual)
        │
        ▼
3. check_module_permission(user_id, module_id)
        │
        ├── super_user / ceo → acesso total (retorna True)
        ├── admin → verifica sector + managed_sectors
        └── user → verifica allowed_sectors do módulo
        │
        ▼
4. Filtragem de dados por setor aplicada nas queries SQL
```

---

## 9. Arquivo de Fallback

| Arquivo | Localização | Descrição |
|---------|------------|-----------|
| `role_permissions.json` | Raiz do projeto | Permissões padrão por role (usado quando a tabela `role_permissions` não está disponível) |
