# ANALISE TECNICA COMPLETA - PORTAL DE CHAMADO

**Projeto**: Portal de Chamados Full-Stack  
**Data**: 2026-04-24  
**Stack**: FastAPI (Python) + React 19 (TypeScript) + PostgreSQL  
**Versão Frontend**: 1.7.2

---

## 1. FUNCIONAMENTO GERAL

### Arquitetura

**Backend (FastAPI - Python)**
- Estrutura modular em `/backend/modulo/`: tickets, action_plans, financeiro, inter_sector, sac, sectors, users, dashboard, importation
- Database: PostgreSQL com raw SQL parametrizado
- Autenticação: Header `user-id` (sessão) + tokens para reset
- File uploads: `/uploads` com sanitização segura
- Email: SMTP com templates HTML

**Frontend (React 19 + TypeScript)**
- React Router v7 com HashRouter, Vite 6.2.0
- SessionStorage + Context API (Toast, Notifications)
- API via fetch com header `user-id`
- UI: Tailwind CDN, Recharts, Three.js 3D

**Banco de Dados**
- Migrations manuais incompletas
- Schemas: users, tickets, action_plans, sac_tickets, inter_sector_tickets, financeiro_data
- Password: bcrypt/pbkdf2 via passlib

### Módulos Principais

| Módulo | Função |
|--------|--------|
| **Tickets** | Chamados, comentários, attachments |
| **Action Plans** | Timeline de ações |
| **Financeiro** | DRE, orçado vs realizado |
| **Inter-Sector** | Tickets multi-setoriais |
| **SAC** | Atendimento cliente |
| **Dashboard** | Métricas e KPIs |

### Nota Arquitetura: 7/10

Organização clara, mas migrations manuais sem versionamento. Mixed concerns (emails + business logic).

---

## 2. SEGURANÇA

### Vulnerabilidades Críticas

**1. Header `user-id` falsificável (ALTA)**
- Sem assinatura ou JWT, cliente envia seu próprio ID
- [backend/modulo/tickets.py:77](backend/modulo/tickets.py#L77)
- Solução: Implementar JWT signed tokens

**2. Credenciais Google no repo (ALTA)**
- `credentials/google_credentials.json` pode estar versionado
- [backend/core/config.py:27-28](backend/core/config.py)
- Solução: Usar env var com JSON stringificado

**3. Permissões inconsistentes (MÉDIA)**
- `POST /tickets` verifica role após criar, não preemptivo
- [backend/modulo/tickets.py:340](backend/modulo/tickets.py#L340)
- Solução: Verificar via `check_module_permission()` antes de tudo

**4. Sem rate limiting (MÉDIA)**
- Login/reset-password sem throttle para força bruta
- Solução: APScheduler + middleware de rate limit

**Pontos Positivos:**
- SQL: Parametrizado com `%s`, safe de injection
- File upload: Regex sanitização + timestamp prefix
- CORS: Whitelist fixo (mas `allow_headers=["*"]` permissivo)
- BCRYPT: OK, (Argon2 seria melhor)

### Nota Segurança: 6/10

Auth fraca (sem JWT), secrets no repo, permissões incompletas. SQL/XSS/file upload OK.

---

## 3. BUGS E PROBLEMAS CONHECIDOS

### Debug Statements em Produção (Crítico)

**Backend:**
- [backend/modulo/action_plans.py:87](backend/modulo/action_plans.py#L87): `print(f"[DEBUG PUT]...")`
- [backend/modulo/importation.py:150](backend/modulo/importation.py#L150): `print(f"DEBUG: df_valores...")`
- [backend/modulo/tickets.py:342](backend/modulo/tickets.py#L342): `print(f"DEBUG: create_ticket...")`
- [backend/core/email.py:40](backend/core/email.py#L40): `print(f"DEBUG EMAIL...")`

**Frontend:**
- [frontend/src/App.tsx:182](frontend/src/App.tsx#L182): `console.log("App: Refreshed...")`
- [frontend/src/components/ActionPlan.tsx:45](frontend/src/components/ActionPlan.tsx#L45): `console.log("ActionPlan Loaded...")`
- [frontend/src/components/StrategicTimeline.tsx:340](frontend/src/components/StrategicTimeline.tsx#L340): `{console.log(...)}` inside JSX!

### Migrations Não Versionadas (Crítico)

- Único arquivo: `/backend/migrations/create_action_plan_history.sql`
- ALTERs diretos no `backend_app.py` (_startup_db)
- Sem Alembic, impossível replicar ou reverter
- [backend/backend_app.py:42-47](backend/backend_app.py#L42)

### Except Genéricos Silenciam Erros (Médio)

- [backend/backend_app.py:76](backend/backend_app.py#L76): `except Exception as e: print(...)`
- [backend/modulo/tickets.py:95](backend/modulo/tickets.py#L95): `except Exception: print(...)`
- Solução: Usar `logger.error()` estruturado

### Testes Ausentes

- ❌ Zero test coverage
- Sem pytest, vitest ou CI/CD visível

### Nota Bugs: 4/10

Debug statements, schema não versionado, erro handling fraco, sem testes.

---

## 4. QUALIDADE DE CÓDIGO

### Estrutura

- ✅ Pastas bem-organizadas (modulo/, schemas/, core/)
- ✅ Schemas separados (Pydantic)
- ✅ Utils centralizados (db_utils, permission_utils)
- ❌ Sem testes automatizados
- ❌ Debug scripts deixados (_debug_users.py, _debug_users2.py)
- ❌ Duplicação: permissões em backend + frontend

### Separação Responsabilidades

- Backend: Email logic misturado em modulo/users.py
- Frontend: 60+ componentes, alguns cores duplicadas
- N+1 potencial: action_plans lista + items individual

### Nota Qualidade: 5/10

Organização boa, mas sem testes, debug scripts, duplicação, e lógica misturada.

---

## 5. PERFORMANCE

### Paginação (Crítico)

- [backend/modulo/tickets.py:293](backend/modulo/tickets.py#L293): `cur.execute(query, params)` sem LIMIT
- Retorna TODOS tickets sem paging → risco OOM com 10k+ registros

### Índices (Crítico)

- Sem índices em foreign keys
- Sem CREATE INDEX em migrations
- Falta: user_id, sector, assigned_to

### Bundle Frontend (Médio)

- Three.js: 750KB+ (desnecessário em várias rotas)
- Sem lazy loading com React.lazy
- [frontend/src/App.tsx:1-50](frontend/src/App.tsx#L1) importa TUDO direto

### Queries N+1 (Médio)

- [backend/modulo/action_plans.py:48-100](backend/modulo/action_plans.py#L48): Lista plans, depois items individual

### Nota Performance: 4/10

Sem paginação (crítico), sem índices, bundle grande, potencial N+1.

---

## 6. RECOMENDAÇÕES PRIORITÁRIAS (TOP 10)

### CRÍTICAS (Sprint 1-2)

1. **JWT Tokens + Auth Session** (Segurança)
   - Remover header `user-id` simples
   - Implementar JWT signed + session backend
   - Arquivo: Refatorar [backend/modulo/users.py:100-130](backend/modulo/users.py#L100)

2. **Audit & Secure Credentials** (Segurança)
   - Verificar `credentials/google_credentials.json` em .git
   - Mover para env var `GOOGLE_CREDENTIALS=<json_string>`
   - Arquivo: [backend/core/config.py:27-28](backend/core/config.py)

3. **Alembic Migrations** (Estabilidade)
   - Converter ALTERs em backend_app.py para migrations numeradas
   - Remover _startup_db() auto-migrations
   - Criar `/backend/alembic/`

4. **Remove Debug Statements** (Production)
   - Remover todos `print()` backend
   - Remover todos `console.log()` frontend
   - Implementar logging estruturado Python

5. **Permissão Check em ALL Endpoints** (Segurança)
   - Adicionar `check_module_permission()` preemptivo
   - [backend/modulo/tickets.py:340](backend/modulo/tickets.py#L340) `POST /tickets` falta
   - Template: `if not check_module_permission(user_id, 'tickets'): raise HTTPException(403)`

### IMPORTANTES (Sprint 3-4)

6. **Paginação (LIMIT/OFFSET)**
   - [backend/modulo/tickets.py:293](backend/modulo/tickets.py#L293): `LIMIT 50 OFFSET :offset`
   - Aplica em: tickets, action_plans, sac_tickets

7. **Criar Índices** (Performance)
   ```sql
   CREATE INDEX idx_tickets_requester ON tickets(requester_id);
   CREATE INDEX idx_tickets_assigned ON tickets(assigned_to);
   CREATE INDEX idx_action_plans_sector ON action_plans(sector);
   CREATE INDEX idx_sac_sector ON sac_tickets(sector);
   ```

8. **Lazy Loading Componentes**
   - `const Financeiro = lazy(() => import('./components/Financeiro'))`
   - Aplica em: Financeiro, SAC, Implementation
   - Reduz bundle ~30%

9. **React Error Boundaries**
   - Wrapper em App.tsx
   - [frontend/src/App.tsx:180](frontend/src/App.tsx#L180)

10. **Rate Limiting Auth**
    - Throttle login/reset-password (3 tentativas/5min)
    - Arquivo: [backend/modulo/users.py:100](backend/modulo/users.py#L100)

---

## SUMÁRIO NOTAS

| Aspecto | Nota | Justificativa |
|---------|------|---|
| Funcionamento Geral | 7/10 | Arquitetura clara, migrations manuais |
| Segurança | 6/10 | Auth fraca, secrets no repo, SQL OK |
| Bugs | 4/10 | Debug statements, schema inconsistente, sem testes |
| Qualidade Código | 5/10 | Pastas OK, sem testes, duplicação |
| Performance | 4/10 | Sem paginação, sem índices, bundle grande |
| **GERAL** | **5.2/10** | Funcional, mas debt técnico significativo |

---

## PRÓXIMOS PASSOS

1. **AGORA**: Remover debug statements + audit credenciais
2. **Semana 1**: JWT implementation
3. **Semana 2**: Alembic migrations
4. **Semana 3**: Paginação + índices
5. **Semana 4**: Testes + lazy loading

---

*Análise gerada em 2026-04-24*
