# AutoApply

AutoApply imports the jobs you've saved, scores them against your Master Profile, and fills out ATS applications for you. A person stays in the loop for CAPTCHAs, MFA, and any question your profile can't answer.

## Ground rules the code enforces

- AutoApply never bypasses CAPTCHAs, MFA, logins or anti-bot protections. When automation hits one, the application moves to **Needs Attention** and waits for you.
- Applications are filled only from facts in your Master Profile and Answer Library. A question with no stored answer is sent to you; AutoApply never makes up an answer.
- Applications are submitted automatically only when an automation rule is set to `AUTO` **and** you've turned on auto-submit in Settings. Otherwise they stop at review.
- Automation is never run against real employers by default.

## Layout

```
apps/
  web/        Next.js 16 dashboard (App Router, server actions, SSE live updates)
  api/        Fastify REST API (/v1/me, /v1/dashboard, /v1/jobs, /v1/applications)
  worker/     Playwright/BullMQ worker (heartbeat only in Phase 1)
packages/
  database/   Prisma schema, migrations, repositories (all queries are scoped to the user)
  shared/     Enums, zod schemas, salary/URL parsing, standard questions, queue names
  automation/ Failure classification, retry policy, field-locator strategy
  ats-adapters/ Platform detection, ApplicationAdapter interface, registry
  ai/         AI provider registry (Anthropic), job analysis with a deterministic fallback
  matching/   Match score (0–100, weighted and explained) and the qualification rules engine
  ingestion/  Job sources (LinkedIn export, CSV, pasted URLs), public posting readers, dedup, analysis pipeline
  documents/  Local/S3 storage drivers, upload validation
```

## Getting started

Requirements: Node 22+, pnpm 10, and Docker (or local Postgres 16 and Redis 7).

```bash
pnpm install
cp .env.example .env
# Set DATA_ENCRYPTION_KEY to the output of: openssl rand -base64 32
docker compose up -d          # postgres, redis, minio
pnpm db:deploy                # apply migrations
pnpm dev                      # http://localhost:3000
```

Create the `autoapply_test` database once for the integration tests:

```bash
docker compose exec postgres createdb -U autoapply autoapply_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:deploy
```

Other entry points: `pnpm dev:api` (port 4000) and `pnpm dev:worker`.

## Importing jobs

Jobs come in three ways, all from the Jobs page:

- **LinkedIn saved jobs.** On LinkedIn, Settings & Privacy → Data privacy → Get a copy of your data, with Jobs selected. Upload the archive (or the `Saved Jobs.csv` inside it). AutoApply never signs in to LinkedIn or reads its pages, so LinkedIn jobs arrive as title, company and link; paste the description on the job page to score them.
- **Pasted URLs.** Greenhouse, Lever, Ashby, SmartRecruiters and Workday links, and careers pages that publish schema.org `JobPosting` data, are filled in from the public posting. Fetches are SSRF-guarded (public addresses only, checked at connect time, size and time limits).
- **Add job** for a single posting, with an optional Fetch details.

Duplicates are skipped by canonical URL (including the LinkedIn job id) and by company and title. Jobs you deleted, applied to or skipped are never re-added. Each import is listed on the Integrations page.

Every new job is analyzed (seniority, location and arrangement, pay, required and preferred qualifications, experience, education, skills, industry, sponsorship, travel, platform), scored against your Master Profile with the weights on the Rules page, and marked Qualified, Not Qualified or Needs Details. Analysis uses the AI provider when `AI_PROVIDER` and its key are set, and the built-in deterministic analyzer otherwise, so it works without a key. Changing your profile or rules re-scores waiting jobs without re-analyzing them.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test        # unit and integration tests (needs Postgres)
pnpm test:e2e    # Playwright browser tests against the dev server
```

## Security

- Passwords are hashed with argon2id. Accounts lock for 15 minutes after 5 failed sign-ins.
- Sessions live in the database, which stores only a SHA-256 hash of each token. The cookie is httpOnly, SameSite=Lax, and `__Host-` prefixed in production.
- Sensitive answers (demographics, sponsorship) and browser session state are encrypted with AES-256-GCM.
- Every mutation is checked for authorization, validated with zod, rate-limited, and written to the audit log (Settings → Security log).
- Uploads are checked against their file signature (magic bytes) and capped at 10 MB.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auth, database, Master Profile, documents, Answer Library, dashboard, Jobs/Applications/Needs Attention, rules, settings | Done |
| 2 | LinkedIn saved-jobs import (user-authorized path only), job analysis, matching, rule evaluation | Done |
| 3 | Playwright worker, generic form automation, human intervention flow | Next |
| 4 | ATS adapters (Greenhouse, Lever, Ashby, Workday, …) | |
| 5 | AI field mapping, answer drafting, resume/cover-letter generation | |
| 6 | Analytics, retries, real-time hardening | |
