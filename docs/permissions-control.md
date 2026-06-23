# Controle de Permissões — Documentação Centralizada

> Gerado em 2026-03-18 | Banco: `criadordigital` | Schema: `portal_chamado`

---

## 1. Rotas/Endpoints de Controle de Permissão

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/role-permissions` | Busca as permissões de todas as roles cadastradas |
| `POST` | `/role-permissions` | Atualiza as permissões de uma role específica |
| `GET` | `/strategic-sectors` | Retorna setores e usuários permitidos para módulos estratégicos (fonte autoritativa para filtros de frontend) |

### Payload — `POST /role-permissions`

```json
{
  "role": "admin",
  "permissions": {
    "tickets": { "can_view": true, "can_edit": true, "can_delete": false }
  }
}
```

### Resposta — `GET /strategic-sectors`

```json
{
  "allowed_sectors": ["Comercial", "Compras", "Controladoria", "..."],
  "allowed_users": [
    { "id": "1", "name": "João Silva", "sector": "Financeiro", "role": "admin" }
  ]
}
```

> **Lógica interna:** lê `role_permissions` da role `admin`, prioriza o módulo `strategic_map` (fallback: `action_plans`), retorna os `allowed_sectors` configurados. Usuários retornados têm role `admin`, `super_user` ou `ceo` e pertencem a esses setores. `super_user` e `ceo` são sempre incluídos, independente de setor.

---

## 2. Funções de Autorização Internas (backend_app.py)

| Função | Descrição |
|--------|-----------|
| `get_user_context(user_id, conn)` | Mescla permissões padrão da `role_permissions` com as permissões individuais do usuário (`users.permissions`) |
| `check_module_permission(user_id, module_id)` | Valida se o usuário tem acesso ao módulo. Retorna `bool` |
| `load_role_permissions()` | Carrega defaults do banco (`role_permissions`) ou fallback do arquivo `role_permissions.json` |

---

## 3. Tabelas Relevantes

### `role_permissions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `role` | VARCHAR (PK) | Identificador da role: `admin`, `user`, `ceo`, `super_user` |
| `permissions` | JSONB | Objeto com permissões por módulo |

### `users` (colunas de permissão)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID do usuário |
| `name` | VARCHAR | Nome |
| `role` | VARCHAR | `super_user \| admin \| user \| ceo` |
| `sector` | VARCHAR | Setor principal |
| `managed_sectors` | TEXT | Setores gerenciados (separados por `;`) |
| `permissions` | JSONB | Override de permissões por módulo (sobrescreve o padrão da role) |
| `is_active` | BOOLEAN | Conta ativa |

---

## 4. Dados Reais — Tabela `role_permissions`

### Role: `super_user`
> Não possui entrada na tabela. Acesso irrestrito garantido por lógica de código — bypass total de verificações de setor e módulo.

---

### Role: `ceo`

| Módulo | can_view | Restrição de Setor |
|--------|----------|--------------------|
| `tickets` | ✅ | Nenhuma |
| `dashboard` | ✅ | Nenhuma |
| `schedule` | ✅ | Nenhuma |
| `action_plans` | ✅ | Nenhuma |
| `action_plan_dashboard` | ✅ | Nenhuma |
| `strategic_map` | — | Nenhuma |
| `strategic_kanban` | ✅ | Nenhuma |
| `strategic_timeline` | ✅ | Nenhuma |
| `impl_dashboard` | ✅ | Nenhuma |
| `impl_kanban` | ✅ | Nenhuma |
| `impl_timeline` | ✅ | Nenhuma |
| `impl_action_plan` | ✅ | Nenhuma |
| `financeiro_dre` | ✅ | Nenhuma |
| `financeiro_orcado` | ✅ | Nenhuma |
| `financeiro_orcado_realizado` | ✅ | Nenhuma |
| `financeiro_base_orcado` | ✅ | Nenhuma |
| `financeiro_base_realizado` | ✅ | Nenhuma |
| `financeiro_plano_contas` | ✅ | Nenhuma |
| `sector_info` | ✅ | Nenhuma |
| `importation` | — | Nenhuma |

---

### Role: `admin`

| Módulo | can_view | Setores Permitidos (`allowed_sectors`) |
|--------|----------|----------------------------------------|
| `strategic_map` | ✅ | Comercial, Compras, Controladoria, Ecommerce, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, RH |
| `strategic_kanban` | ✅ | Comercial, Compras, Controladoria, Ecommerce, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, RH |
| `strategic_timeline` | ✅ | Comercial, Compras, Controladoria, Ecommerce, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, RH |
| `action_plans` | ✅ | Comercial, Compras, Controladoria, Ecommerce, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, RH |
| `action_plan_dashboard` | ✅ | Comercial, Compras, Controladoria, Ecommerce, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, RH |
| `impl_dashboard` | ✅ | Todos os setores (29) |
| `impl_kanban` | ✅ | Todos os setores (29) |
| `impl_timeline` | ✅ | Todos os setores (29) |
| `impl_action_plan` | ✅ | Todos os setores (29) |
| `tickets` | ✅ | Todos os setores (29) |
| `dashboard` | ✅ | Todos os setores (29) |
| `schedule` | ✅ | Todos os setores (29) |
| `sector_info` | ✅ | Todos os setores (29) |
| `financeiro_dre` | ✅ | Financeiro |
| `financeiro_orcado` | ✅ | Financeiro |
| `financeiro_orcado_realizado` | ✅ | Financeiro |
| `financeiro_base_orcado` | ✅ | Financeiro |
| `financeiro_base_realizado` | ✅ | Financeiro |
| `financeiro_plano_contas` | ✅ | Financeiro |
| `importation` | — | Logística, Ecommerce |

> **Todos os setores (29):** Administrativo, Comercial, Compras, Controladoria, Custos, Diretoria, Ecommerce, Externo - 4bis, Fábrica, Financeiro, Gestão de Informação, Logística, Marketing, Qualidade, Regional Acessibilidade, Regional B2B, Regional Centro-Oeste, Regional Leroy, Regional Nordeste, Regional Norte, Regional São Paulo - Capital, Regional São Paulo - Interior, Regional Sudeste (MG/ES/RJ), Regional Sul, Regional Televendas, RH, Televendas, Terceiro - 4BIS, T.I

---

### Role: `user`

| Módulo | can_view | Setores Permitidos |
|--------|----------|--------------------|
| `tickets` | ✅ | Todos os setores (29) |
| `dashboard` | ✅ | Todos os setores (29) |
| `schedule` | ✅ | Todos os setores (29) |
| `sector_info` | ✅ | Todos os setores (29) |
| `action_plans` | ❌ | — |
| `action_plan_dashboard` | ❌ | — |
| `strategic_map` | ❌ | — |
| `strategic_kanban` | ❌ | — |
| `strategic_timeline` | ❌ | — |
| `impl_dashboard` | ❌ | — |
| `impl_kanban` | ❌ | — |
| `impl_timeline` | ❌ | — |
| `impl_action_plan` | ❌ | — |
| `financeiro_dre` | ✅ | Controladoria |
| `financeiro_orcado` | ✅ | Controladoria |
| `financeiro_orcado_realizado` | ✅ | Controladoria |
| `financeiro_base_orcado` | ✅ | Controladoria |
| `financeiro_base_realizado` | ✅ | Controladoria |
| `financeiro_plano_contas` | ✅ | Controladoria |
| `importation` | — | Logística |

---

## 5. Estrutura JSONB de Permissão por Módulo

```json
{
  "nome_do_modulo": {
    "can_view": true,
    "can_edit": true,
    "can_delete": false,
    "view_all_sectors": false,
    "allowed_sectors": ["Setor A", "Setor B"]
  }
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `can_view` | boolean | Pode visualizar o módulo |
| `can_edit` | boolean | Pode editar registros |
| `can_delete` | boolean | Pode excluir registros |
| `view_all_sectors` | boolean | Ignora restrição de setor (vê tudo) |
| `allowed_sectors` | string[] | Setores que este usuário/role pode acessar |

---

## 6. Hierarquia de Acesso

| Role | Edição | Exclusão | Setores | Emails |
|------|--------|----------|---------|--------|
| `super_user` | ✅ Total | ✅ Total | Todos | ✅ |
| `ceo` | ✅ Total | ❌ | Todos | ❌ Não recebe |
| `admin` | ✅ (módulo próprio) | Depende de `can_delete` | Configurados em `role_permissions` + override individual | ✅ |
| `user` | ❌ (somente leitura) | ❌ | Restrito por módulo | ✅ |

---

## 7. Modelo de Permissão no Frontend (padrão centralizado)

Todas as páginas devem seguir este padrão (referência: `ActionPlan.tsx`):

```typescript
// 1. Buscar setores e usuários autorizados via API
const [strategicData, setStrategicData] = useState<{
  allowed_sectors: string[];
  allowed_users: { id: string, name: string, sector: string, role: string }[];
} | null>(null);

useEffect(() => {
  api.getStrategicSectors()
    .then(data => setStrategicData(data))
    .catch(e => console.error('Failed to fetch strategic sectors', e));
}, []);

// 2. Variáveis de permissão padronizadas
const userRole = user.role;
const isSuperUser = userRole === 'super_user';
const isCEO = userRole === 'ceo';
const canEditOverride = user.permissions?.strategic?.can_edit === true;
const canDeleteOverride = user.permissions?.strategic?.can_delete === true;
const isAdmin = userRole === 'admin' || isSuperUser || isCEO || canEditOverride;
const isReadOnly = !isAdmin;
const canDelete = isSuperUser || canDeleteOverride;

// 3. Uso nos filtros
const sectorOptions = ['Todos', ...(strategicData?.allowed_sectors ?? [])];
const userOptions = strategicData?.allowed_users ?? [];
```
