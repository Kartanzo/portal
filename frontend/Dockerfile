# Dockerfile padrao do frontend (usado pelo EasyPanel, que procura "Dockerfile").
# Embute o nginx.homolog.conf, que faz proxy de /api -> http://homolog-portal-back:8000.
# => o servico do BACKEND no EasyPanel precisa se chamar "homolog-portal-back"
#    (ou edite frontend/nginx.homolog.conf para o nome correto).

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

COPY nginx.homolog.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
