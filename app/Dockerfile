# Build context = repo root (monorepo): docker build -f app/Dockerfile .
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
# All workspace manifests must exist for npm ci to resolve the workspace tree.
COPY app/package.json app/
COPY collector/package.json collector/
COPY infra/package.json infra/
RUN npm ci --workspace app

FROM public.ecr.aws/docker/library/node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
# package-lock.json lets Next infer the workspace root for standalone tracing.
COPY tsconfig.base.json package.json package-lock.json ./
COPY app ./app
# Workspace-nested deps (version conflicts get placed under app/node_modules).
COPY --from=deps /repo/app/node_modules ./app/node_modules
COPY collector/src/types.ts ./collector/src/types.ts
RUN cd app && npx next build

FROM public.ecr.aws/docker/library/node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
COPY --from=build /repo/app/public ./app/public
EXPOSE 3000
CMD ["node", "app/server.js"]
