# Portal de Chamado — EMPRESA Data Portal

Sistema corporativo completo para gerenciamento de tickets de suporte, planejamento estratégico, acompanhamento de implementações e relatórios financeiros da empresa EMPRESA.

---

## Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19.2.3 + TypeScript 5.8.2 |
| Build Tool | Vite 6.2.0 |
| Roteamento | React Router DOM 7.12.0 (HashRouter) |
| Estilização | Tailwind CSS |
| Gráficos | Recharts 3.6.0 |
| 3D (Login) | Three.js + React Three Fiber |
| Exportação | jsPDF + XLSX |
| Backend | Python + FastAPI |
| Servidor ASGI | Uvicorn |
| Banco de Dados | PostgreSQL |
| ORM | psycopg2 (queries SQL diretas) |
| Autenticação | passlib (pbkdf2_sha256 / bcrypt) |
| Agendamento | APScheduler |
| ML (previsão) | scikit-learn (HistGradientBoostingRegressor) |
| Email | Gmail SMTP (smtplib) |
| Analytics | Google BigQuery |

---

## Pré-requisitos

- **Node.js** >= 18
- **Python** >= 3.9
- **PostgreSQL** >= 14
- Conta Gmail com App Password habilitada
- (Opcional) Credenciais Google Cloud para BigQuery

---

## Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz do projeto (frontend) e configure as variáveis do backend:

### Backend (`cred.json` ou variáveis de ambiente)

```json
{
  "DB_HOST": "localhost",
  "DB_NAME": "empresa_portal",
  "DB_USER": "postgres",
  "DB_PASSWORD": "sua_senha",
  "DB_PORT": "5432",
  "DB_SCHEMA": "portal_chamado",
  "GMAIL_USER": "seu@gmail.com",
  "GMAIL_PASSWORD": "app_password_aqui",
  "FRONTEND_URL": "http://localhost:3000",
  "API_URL": "http://localhost:8002"
}
```

Ou via variáveis de ambiente do sistema com os mesmos nomes acima, além de:

```
GOOGLE_APPLICATION_CREDENTIALS=caminho/para/service-account.json
```

### Frontend (`.env.local`)

```
VITE_API_URL=http://localhost:8002
```

---

## Como Rodar Localmente

### 1. Banco de Dados

```bash
# Criar tabelas no PostgreSQL
python create_tables.py
```

### 2. Backend

```bash
# Instalar dependências Python
pip install -r requirements.txt

# Iniciar servidor FastAPI na porta 8002
uvicorn backend_app:app --host 0.0.0.0 --port 8002 --reload
```

### 3. Frontend

```bash
# Instalar dependências Node.js
npm install

# Iniciar servidor de desenvolvimento na porta 3000
npm run dev
```

Acesse: `http://localhost:3000`

---

## Build para Produção

```bash
# Frontend
npm run build
# Saída gerada em /dist

# Backend (via Docker)
docker-compose up --build
```

---

## Estrutura de Pastas

```
Portal de chamado/
├── backend/                        # Aplicação Python/FastAPI
│   ├── backend_app.py              # Entry point FastAPI
│   ├── db_utils.py                 # Conexão com PostgreSQL
│   ├── permission_utils.py         # Controle de permissões
│   ├── requirements.txt            # Dependências Python
│   ├── role_permissions.json       # Permissões padrão por role
│   ├── importation_cache.json      # Cache de cálculos de importação
│   ├── cred.json                   # Credenciais locais (não commitado)
│   ├── Dockerfile                  # Imagem Docker do backend
│   ├── core/                       # Módulos principais
│   ├── modulo/                     # Módulos de negócio
│   ├── schemas/                    # Schemas Pydantic
│   └── uploads/                    # Arquivos enviados pelos usuários
│
├── frontend/                       # Aplicação React/TypeScript
│   ├── App.tsx                     # Rotas e estrutura principal
│   ├── app_api.ts                  # Cliente HTTP centralizado
│   ├── index.tsx                   # Entry point React
│   ├── types.ts                    # Interfaces e enums TypeScript
│   ├── constants.ts                # Constantes da aplicação
│   ├── components/                 # Componentes React
│   │   ├── Financeiro/             # Módulo financeiro
│   │   └── *.tsx                   # Demais componentes
│   ├── contexts/                   # Context API providers
│   ├── hooks/                      # Custom React hooks
│   ├── utils/                      # Funções utilitárias
│   ├── assets/                     # Imagens e mídia estática
│   ├── Dockerfile.frontend         # Imagem Docker do frontend
│   └── nginx.conf                  # Configuração Nginx (produção)
│
├── docs/                           # Documentação
│   ├── frontend.md                 # Documentação do frontend
│   └── backend.md                  # Documentação do backend
│
├── docker-compose.yml              # Orquestração Docker
└── build_and_push.ps1              # Script de build e deploy
```

---

## Módulos do Sistema

| Módulo | Descrição |
|--------|-----------|
| **Tickets** | Abertura, acompanhamento e resolução de chamados de suporte |
| **Planejamento Estratégico** | Planos de ação com KPIs, ROI, orçamento e cronograma |
| **Implementação** | Acompanhamento de implementações com kanban e timeline |
| **Financeiro** | Relatórios orçado vs realizado, DRE e plano de contas |
| **Importação** | Upload de dados via Excel com previsão de demanda via ML |
| **Administração** | Gestão de usuários, setores e permissões por role |

---

## Versão

`v1.7.2`

---

## Documentação Detalhada

- [Frontend](./docs/frontend.md) — Arquitetura, componentes, rotas, permissões
- [Backend](./docs/backend.md) — API REST, banco de dados, integrações
