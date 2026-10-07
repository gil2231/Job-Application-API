# Applyance REST API (used by the browser extension and integrations). Build from the repository root:
#   docker build -f docker/api.Dockerfile -t applyance-api .
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["sh", "-c", "cd apps/api && API_PORT=${PORT:-4000} exec node_modules/.bin/tsx src/index.ts"]
