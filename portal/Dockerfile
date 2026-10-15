FROM nginx:1.27-alpine
# Valores por defecto; docker-compose los sobrescribe por réplica
ENV PORT=8080 \
    REPLICA=portal \
    API_UPSTREAM=api:5000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1
