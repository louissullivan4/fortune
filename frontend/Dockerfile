# ---- Build stage ----
FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./

COPY . .
RUN npm ci && npm run build

# ---- Production stage ----
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]