# Dockerfile padrao do frontend (usado pelo EasyPanel, que procura "Dockerfile").
#
# O backend e configuravel pela env API_BACKEND (default abaixo). No EasyPanel, defina
# API_BACKEND com o hostname interno do seu servico de backend + porta, ex.:
#   API_BACKEND=portal-projeto_backend:8000
# O nginx resolve o backend em runtime (resolver), entao NAO crasha se o nome estiver
# errado/indisponivel — apenas responde 502 em /api ate acertar.

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html

# Template processado por envsubst no boot (-> /etc/nginx/conf.d/default.conf)
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Default; sobrescreva no EasyPanel com o nome real do servico de backend.
ENV API_BACKEND=homolog-portal-back:8000

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
