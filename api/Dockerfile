FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Los vouchers y el estado se montan como volúmenes en docker-compose
RUN mkdir -p vouchers data && chown -R node:node /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/salud || exit 1
CMD ["node", "src/server.js"]
