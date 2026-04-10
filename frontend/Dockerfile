# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Use custom entrypoint to substitute only our env vars, preserving nginx vars like $uri
CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
