FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN sed -i 's|deb.debian.org/debian|mirrors.cloud.tencent.com/debian|g; s|security.debian.org/debian-security|mirrors.cloud.tencent.com/debian-security|g' /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY vendor/mediasoup-worker /opt/echodeck/mediasoup-worker
RUN chmod 755 /opt/echodeck/mediasoup-worker
ENV MEDIASOUP_WORKER_BIN=/opt/echodeck/mediasoup-worker
RUN npm ci --workspace @echodeck/server --include-workspace-root=false
COPY apps/server apps/server
RUN npm run build --workspace @echodeck/server && npm prune --omit=dev --workspace @echodeck/server

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/public ./apps/server/public
COPY --from=build /opt/echodeck/mediasoup-worker /opt/echodeck/mediasoup-worker
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=127.0.0.1 PORT=17920 DATABASE_PATH=/app/data/echodeck.db UPLOAD_PATH=/app/data/uploads MEDIASOUP_PORT=17921 MEDIASOUP_WORKER_BIN=/opt/echodeck/mediasoup-worker
EXPOSE 17920/tcp 17921/tcp 17921/udp
CMD ["node","apps/server/dist/index.js"]
