# syntax=docker/dockerfile:1
# Not yet exercised in CI. See the TASK 1-3 report before relying on it.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/relayer ./packages/relayer
RUN pnpm install --frozen-lockfile --filter ferryline-relayer...
RUN pnpm --filter ferryline-relayer... build
RUN pnpm --filter ferryline-relayer deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/main.js"]
