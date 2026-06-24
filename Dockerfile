# ── Stage 0: pnpm base
FROM node:20-alpine AS base
RUN npm install -g pnpm


# ── Stage 1: install all workspace deps (cached layer)
FROM base AS installer
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile


# ── Stage 2: build the React client
FROM installer AS client-builder

COPY client/ ./client/
RUN pnpm --filter=elo-rating-client build


# ── Stage 3: deploy server with prod deps only
FROM installer AS server-deploy

COPY server/ ./server/
RUN pnpm --filter=elo-rating-server deploy --prod --legacy /deploy


# ── Stage 4: production image
FROM node:20-alpine

WORKDIR /app/server

COPY --from=server-deploy /deploy ./
COPY --from=client-builder /app/client/dist /app/client/dist
COPY scripts/ /app/scripts/

RUN mkdir -p /app/images /app/previews

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
