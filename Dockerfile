# PlayProbe in a container: the built app plus a small Node.js server that
# serves it and, if enabled, the same CORS proxy as the Cloudflare deployment.
#
#   docker build -t playprobe .
#   docker run --rm -p 8080:8080 playprobe                  # http://localhost:8080
#   docker run --rm -p 8080:8080 -e PROXY_ENABLED=true \
#     -e PROXY_ALLOWED_HOSTS="*.akamaized.net" playprobe     # with the CORS proxy
#
# See README, "Run in a container".

# ---- build: the app (dist/) and the server bundle (dist-server/server.mjs)
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server

# ---- run: Node.js, the built app and one server file; no node_modules
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    PROXY_ENABLED=false \
    PROXY_ALLOWED_HOSTS= \
    PROXY_SEGMENTS=false
WORKDIR /app
COPY --from=build --chown=node:node /src/dist ./dist
COPY --from=build --chown=node:node /src/dist-server/server.mjs ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", "server.mjs"]
