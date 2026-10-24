FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY server ./server
COPY public ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server/server.js"]
