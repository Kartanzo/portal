# Crucial Development Rules - Antigravity Project

This file contains the absolute guidelines and execution protocol for the AI assistant. Failure to comply with these rules will result in task failure.

## 🎯 Golden Rule: Strict Adherence to Scope
**Follow exactly what the user requests.**
- **Prohibition of Hallucination**: Do not invent functionalities, do not add unsolicited "improvements," and do not assume intentions beyond the explicit text of the prompt.
- **Operational Minimalism**: If the request is to "fix error X in file A," you MUST ONLY fix error X in file A. Do not refactor file B, do not update dependencies, and do not clean up comments elsewhere.
- **Silence on Unsolicited Matters**: If you identify an issue outside the current scope, **do not fix it**. Only briefly mention it after completing the requested task, if it is critical.

## 🚦 Homolog-First Protocol (Obrigatório)

**Toda criação ou alteração de código DEVE ser desenvolvida e validada no ambiente de homologação antes de ir para produção.**

- **Ambiente de homolog:** schema `portal_chamado_homolog`, backend porta `8010`, frontend porta `8090`
- **Ambiente de produção:** schema `portal_chamado`, backend porta `8000`, frontend porta `8080`
- **Fluxo obrigatório:** `desenvolvimento → homolog (validar) → produção`
- Ao criar novos endpoints, páginas, queries ou migrations, configurar sempre apontando para `portal_chamado_homolog` primeiro
- Somente após validação explícita do usuário no ambiente de homolog, aplicar as mesmas alterações em produção
- Nunca alterar diretamente o schema `portal_chamado` sem que a mudança tenha sido testada em `portal_chamado_homolog`

---

## 🛠 Execution Protocol (Mandatory Chain-of-Thought)
Before any code alteration, you must internally (or express in your thought process) perform the following steps:
1.  **Target Identification**: Explicitly list which files and which lines will be modified.
2.  **Scope Validation**: Compare the list of targets with the user's prompt. If any file or function not mentioned is present, remove it from execution.
3.  **Dependency Verification**: Assess whether the change will break anything, but **do not alter** dependent code unless explicitly authorized by the user.

## ✅ Unconditional Veracity and Testing
Never claim to have completed a task without empirical evidence.
- **Actual Execution**: The code must be saved and executed in the environment.
- **Debugging**: Check error logs and console outputs.
- **Proven Facts**: Your responses must be based on what happened in the terminal, not on what you "expected" to happen.

## 🚫 Negative Constraints (What NOT to do)
- **DO NOT** add new libraries without permission.
- **DO NOT** change coding style (e.g., switch from Tabs to Spaces) unless requested.
- **DO NOT** remove existing comments.
- **DO NOT** attempt to "help" by expanding the scope to adjacent files based on presumed "best practices." In Antigravity, the best practice is **surgical precision**.

## 📝 Response Format for Changes
When making a change, follow this pattern:
- **Requested Scope**: [Summary of the user's request]
- **Modified Files**: [List of files]
- **Verification Result**: [Output of the test/execution command]
- **Scope Observations**: [Confirmation that nothing beyond what was requested was touched]

---

## 📚 Guia de Boas Práticas (Referência Obrigatória)

O arquivo [`Guia de Instruções para Projeto Full Stack.md`](./Guia%20de%20Instruções%20para%20Projeto%20Full%20Stack.md) na raiz do projeto contém as regras de boas práticas que **devem ser seguidas sempre** ao criar ou modificar páginas, componentes e endpoints do backend. Isso inclui:

- Estrutura de pastas recomendada (frontend e backend)
- Segurança de senhas (Argon2/Bcrypt — nunca texto puro)
- Separação de responsabilidades (controllers, services, routes)
- Organização por recurso (feature-based) no frontend
- Bibliotecas recomendadas para animações 3D

---

## 🔐 Segurança e Controle de Permissões (Obrigatório)

Estas regras se aplicam **sempre** que uma nova página, rota, campo ou endpoint for criado ou modificado.

### Sistema de Permissões do Projeto

O controle de acesso é centralizado em dois lugares:
- **Backend**: `backend/permission_utils.py` → função `check_module_permission(user_id, module_id, min_permission)`
- **Fonte da verdade**: tabela `role_permissions` no banco de dados (fallback: `backend/role_permissions.json`)
- **Níveis de permissão**: `can_view`, `can_edit`
- **Roles existentes**: `super_user`, `ceo` (acesso total automático), `admin`, `user`

### Regras Invioláveis

#### 1. Nova página ou rota → obrigatoriamente registrar nas permissões
Ao criar qualquer nova página/rota no frontend:
1. Definir um `module_id` único em snake_case (ex: `relatorio_vendas`)
2. Adicionar esse `module_id` em **todos os roles** no `backend/role_permissions.json` com valor padrão `"can_view": false`
3. Informar ao usuário para configurar o acesso correto pela tela de Administração do portal

#### 2. Proteção de rota no frontend (guard obrigatório)
Toda rota protegida deve verificar permissão **antes** de renderizar. Nunca confiar apenas em esconder o link do menu — o usuário pode acessar diretamente pela URL.

Padrão obrigatório:
```tsx
// Verificar permissão via contexto/hook de permissões antes de renderizar
if (!hasPermission('module_id', 'can_view')) {
  return <Navigate to="/unauthorized" />;
}
```

#### 3. Sem dados no frontend sem autorização
- **NUNCA** buscar dados de uma API e renderizá-los sem antes validar `can_view`
- **NUNCA** filtrar dados sensíveis apenas no frontend (ex: esconder coluna mas fazer o fetch) — a filtragem deve acontecer no backend
- Campos sensíveis (financeiro, permissões, dados de outros usuários) devem ser omitidos na resposta do backend se o usuário não tiver acesso

#### 4. Backend: verificar permissão em todo endpoint protegido
Todo endpoint que retorna dados restritos deve chamar `check_module_permission` antes de processar:
```python
from permission_utils import check_module_permission

if not check_module_permission(user_id, 'module_id', 'can_view'):
    raise HTTPException(status_code=403, detail="Acesso negado")
```

#### 5. Novos campos em telas existentes
Ao adicionar um campo novo em uma página já existente:
- Verificar se o campo exige um novo nível de permissão (ex: `can_edit`)
- Se sim, adicionar a chave no `role_permissions.json` para todos os roles
- Nunca assumir que "quem vê, pode editar"

#### 6. Banco de Dados — Proibição de Alteração sem Confirmação Dupla

**O banco de dados é SOMENTE LEITURA por padrão.**

- **NUNCA** executar `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER` ou qualquer comando que modifique ou exclua dados sem autorização explícita
- Consultas `SELECT` são livres — use à vontade para investigar
- Migrações, correções ou limpezas de dados **não são escopo da IA** por padrão

**Se e somente se o usuário solicitar uma alteração no banco**, o protocolo obrigatório é:

**1ª confirmação** — Antes de qualquer coisa, informar detalhadamente:
```
⚠️ ATENÇÃO: Vou executar a seguinte operação no banco de dados:
- Tabela: [nome da tabela]
- Operação: [UPDATE / DELETE / etc.]
- Condição: [WHERE exato]
- Impacto estimado: [N linhas afetadas]
- SQL que será executado: [query completa]

Confirma que deseja prosseguir? (responda "sim" para continuar)
```

**2ª confirmação** — Após o "sim" do usuário, solicitar novamente:
```
⚠️ CONFIRMAÇÃO FINAL: Esta operação é irreversível.
Repita "CONFIRMO" para executar.
```

Somente após receber "CONFIRMO" na segunda etapa a operação pode ser executada.

---

### Checklist para Novas Páginas

Antes de considerar uma nova página concluída, confirmar:
- [ ] `module_id` definido e único
- [ ] Adicionado em todos os roles no `role_permissions.json` (padrão `false`)
- [ ] Rota protegida com guard no frontend (redirect se sem permissão)
- [ ] Endpoint backend valida permissão com `check_module_permission`
- [ ] Dados sensíveis filtrados no backend, não no frontend
- [ ] Usuário informado para configurar acesso na tela de Administração

---
*Note: This file is the ultimate authority on AI behavior in this repository. In case of conflict between the AI's prior knowledge and these rules, the rules in this file prevail.*

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
