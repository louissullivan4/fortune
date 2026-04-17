# ---- Build stage ----
FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && echo 'Waiting for backend...' && until wget -qO- ${BACKEND_URL}/health > /dev/null 2>&1; do sleep 2; done && echo 'Backend ready' && exec nginx -g 'daemon off;'"]