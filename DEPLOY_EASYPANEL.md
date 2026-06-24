# Deploy no EasyPanel — Portal (demo com dados dummy 2026)

São **3 componentes**: 1 Postgres + 1 app Backend + 1 app Frontend (sim, front e back são **apps separados**).

---

## 1. Postgres
Crie um serviço de **Postgres** no EasyPanel (ou use um banco gerenciado). Anote:
- host interno, porta (5432), nome do banco, usuário, senha.
- O app cria as tabelas sozinho no 1º start (não precisa rodar SQL na mão).

## 2. App Backend
- **Source:** este repositório, pasta `backend/` (Dockerfile: `backend/Dockerfile`).
- **Porta interna:** `8000`.
- **Nome do serviço:** use **`homolog-portal-back`** (importante — ver passo 3).
- **Variáveis de ambiente (obrigatórias):**

| Variável | Valor |
|---|---|
| `DB_HOST` | host interno do Postgres |
| `DB_PORT` | `5432` |
| `DB_NAME` | nome do banco |
| `DB_USER` | usuário do Postgres |
| `DB_PASSWORD` | senha do Postgres |
| `DB_SCHEMA` | `portal_chamado` |
| `SEED_DUMMY` | `1` |

- **Opcionais** (pode deixar em branco / não criar — o app roda sem elas, pois removemos as fontes externas):
  `GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_SA_JSON`,
  `WAHA_API_KEY`, `WAHA_API_URL`, `WAHA_SESSION`, `WAHA_COUNTRY_CODE`, `WAHA_TIMEOUT_SECONDS`,
  `GMAIL_USER`, `GMAIL_PASSWORD`, `EQUIP_CRYPTO_KEY`, `FRONTEND_URL`, `API_URL`.

> Não existe `DATABASE_URL` única — a conexão é montada a partir das 6 variáveis `DB_*`.

## 3. App Frontend
- **Source:** este repositório, pasta `frontend/`, usando o Dockerfile **`Dockerfile.homolog.frontend`**.
  - Esse Dockerfile embute o `nginx.homolog.conf`, que faz proxy de `/api` → **`http://homolog-portal-back:8000`**.
- **Porta interna:** `80`.
- **Sem variáveis de ambiente** (o front fala com o back via `/api`, resolvido pelo nginx).
- Aponte o **domínio público** do EasyPanel para este app (frontend).

### ⚠️ O ponto que mais quebra o deploy
O nome do serviço do backend **precisa bater** com o upstream do nginx do frontend:
- Se o backend se chama `homolog-portal-back` → use `Dockerfile.homolog.frontend` (já aponta pra lá). ✅ (recomendado)
- Se você nomear o backend diferente → edite `frontend/nginx.homolog.conf` (linhas `proxy_pass`) pro nome correto e rebuild o front.
- Front e back devem estar no **mesmo projeto/rede interna** do EasyPanel pra um achar o outro pelo nome.

---

## 4. Primeiro acesso
No 1º start, o backend cria as tabelas, popula os dados dummy de 2026 e cria o admin.
- **Login:** `admin`
- **Senha:** `Senha123!`

## 5. Depois de validar
- Para **parar de popular** (ex.: produção real), remova a variável `SEED_DUMMY` e suba um banco limpo. O seed é idempotente (não duplica se rodar de novo).

---

> Observação: o seed/bootstrap foi validado por compilação/import, **não** contra um Postgres real.
> Se algo falhar no 1º start, mande o log do backend que ajustamos (provavelmente alguma coluna
> de tabela reconstruída do código).
