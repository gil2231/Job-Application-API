# Applyance browser worker. Microsoft's Playwright image ships Chromium and its
# system libraries for the Playwright version the worker uses (keep in step
# with playwright-core in apps/worker/package.json). Build from the repository root:
#   docker build -f docker/worker.Dockerfile -t applyance-worker .
FROM mcr.microsoft.com/playwright:v1.56.1-noble
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate && chown -R pwuser:pwuser /app
ENV NODE_ENV=production WORKER_HEADLESS=true
USER pwuser
CMD ["sh", "-c", "cd apps/worker && exec node_modules/.bin/tsx src/index.ts"]
