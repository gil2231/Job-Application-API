# Applyance web app (Next.js). Build from the repository root:
#   docker build -f docker/web.Dockerfile -t applyance-web .
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @autoapply/web build && chown -R node:node apps/web/.next
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
# Migrations run before each deploy (see render.yaml preDeployCommand), not here.
CMD ["sh", "-c", "cd apps/web && exec node_modules/.bin/next start --port ${PORT:-3000}"]
