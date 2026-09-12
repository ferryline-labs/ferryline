# syntax=docker/dockerfile:1
# Verified buildable (STEP 6): `docker build -f packages/relayer/Dockerfile .` from the repo root.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/sdk ./packages/sdk
COPY packages/relayer ./packages/relayer
RUN pnpm install --frozen-lockfile --filter ferryline-relayer...
RUN pnpm --filter ferryline-relayer... build
# --legacy: pnpm >= 10 refuses to `deploy` a workspace unless inject-workspace-packages=true is set
# repo-wide (see pnpm-workspace.yaml) — --legacy uses pnpm's pre-v10 deploy behavior (copying the
# workspace dependencies' built files directly) instead, scoped to just this one build step rather
# than changing how every other package in the workspace installs its own dependencies.
RUN pnpm --filter ferryline-relayer deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/main.js"]
