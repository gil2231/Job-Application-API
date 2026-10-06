# AutoApply

AutoApply imports the jobs you've saved, scores them against your Master Profile, and fills out ATS applications for you. A person stays in the loop for CAPTCHAs, MFA, and any question your profile can't answer.

## Ground rules the code enforces

- AutoApply never bypasses CAPTCHAs, MFA, logins or anti-bot protections. When automation hits one, the application moves to **Needs Attention** and waits for you.
- Applications are filled only from facts in your Master Profile and Answer Library. A question with no stored answer is sent to you; AutoApply never makes up an answer. AI drafts are only suggestions you approve, and generated resumes and cover letters are checked against your profile.
- Applications are submitted automatically only in `AUTO` mode, with auto-submit turned on in Rules, and only when every safety check passes. Otherwise they stop for your review.
- Automation is never run against real employers by default.

## Layout

```
apps/
  web/        Next.js 16 dashboard (App Router, server actions, SSE live updates)
  api/        Fastify REST API (/v1/me, /v1/dashboard, /v1/jobs, /v1/applications, /v1/tracker, /v1/extension)
  worker/     Playwright/BullMQ worker that fills applications, plus mock application pages for tests
  extension/  Applyance browser extension for Chrome, Edge and Brave (Manifest V3): save jobs, finish applications yourself
packages/
  database/   Prisma schema, migrations, repositories (all queries are scoped to the user)
  shared/     Enums, zod schemas, salary/URL parsing, standard questions, queue names
  automation/ Field classification and answer resolution, option matching, submit safety checks, retry policy
  ats-adapters/ Platform detection, ApplicationAdapter interface and registry, the shared form engine, and the
              Workday, Greenhouse, Lever, Ashby, SmartRecruiters and generic web form adapters
  queue/      BullMQ queue, Redis control and progress channels
  ai/         AI provider registry (Anthropic), job analysis, field mapping, answer drafts, resume and
              cover letter writing with truthfulness checks; every feature has a deterministic fallback
  matching/   Match score (0–100, weighted and explained) and the qualification rules engine
  ingestion/  Job sources (LinkedIn export, CSV, pasted URLs), public posting readers, dedup, analysis pipeline
  documents/  Local/S3 storage drivers, upload validation, PDF and Word rendering of generated documents
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

Other entry points: `pnpm dev:api` (port 4000) and `pnpm dev:worker` (the browser worker, below).

## Importing jobs

Jobs come in four ways, all from the Jobs page:

- **LinkedIn saved jobs.** On LinkedIn, Settings & Privacy → Data privacy → Get a copy of your data, with Jobs selected. Upload the archive (or the `Saved Jobs.csv` inside it). AutoApply never signs in to LinkedIn or reads its pages, so LinkedIn jobs arrive as title, company and link; paste the description on the job page to score them.
- **Pasted URLs.** Greenhouse, Lever, Ashby, SmartRecruiters and Workday links, and careers pages that publish schema.org `JobPosting` data, are filled in from the public posting. Fetches are SSRF-guarded (public addresses only, checked at connect time, size and time limits).
- **Add job** for a single posting, with an optional Fetch details.
- **Search job boards** finds open jobs by keyword on the companies' boards you list (Greenhouse, Lever and Ashby links such as `boards.greenhouse.io/acme`, `jobs.lever.co/acme` or `jobs.ashbyhq.com/acme`, up to 25 per search). It reads the public job board APIs those platforms publish for anyone; none of them offers a cross-company search, so you choose the companies. Keywords match job titles (optionally descriptions too), `"quotes"` match a phrase, and `-word` skips postings that mention it anywhere. You pick which results to add. The last search is remembered.

Duplicates are skipped by canonical URL (including the LinkedIn job id) and by company and title. Jobs you deleted, applied to or skipped are never re-added. Each import is listed on the Integrations page.

**Recommended** lists the saved jobs that mention the keywords you set there (roles, industries, skills), ranked half by how many keywords they mention (title hits count double) and half by match score. Jobs that broke one of your rules are left out. **Find more on job boards** opens a board search for any of your keywords.

The search box on the Jobs page looks in titles, companies, locations and descriptions, with the same `"phrase"` and `-word` syntax.

Every new job is analyzed (seniority, location and arrangement, pay, required and preferred qualifications, experience, education, skills, industry, sponsorship, travel, platform), scored against your Master Profile with the weights on the Rules page, and marked Qualified, Not Qualified or Needs Details. On the Rules page, **Include keywords** require a job to mention at least one of them and **Exclude keywords** skip any job that mentions one. Analysis uses the AI provider when `AI_PROVIDER` and its key are set, and the built-in deterministic analyzer otherwise, so it works without a key. Changing your profile or rules re-scores waiting jobs without re-analyzing them.

## Running applications

Choose **Apply** on the Jobs page (the arrow next to it picks Manual, Review or Auto mode for that batch; otherwise your default mode from Rules is used), or **Apply to all qualified**. Applications are queued, and the worker (`pnpm dev:worker`) picks them up.

- **Manual** fills the form and stops. You submit it yourself and mark it submitted (with a visible browser, AutoApply notices the submission).
- **Review** fills the form and stops for you to approve. **Approve & submit** in Needs Attention lets AutoApply submit it.
- **Auto** submits only when every check passes: auto-submit is on in Rules, the site is supported, every required field was mapped confidently, every answer is allowed to be sent without review, nothing contradicts your profile, and there's no CAPTCHA. Otherwise it stops for review and says why.

The worker stops before leaving any page that has a question it isn't sure about, so nothing you haven't approved is sent. Approved answers are reused when the application resumes, and **Remember this answer** saves them to your Answer Library. CAPTCHAs, MFA and sign-ins always go to Needs Attention. With `WORKER_HEADLESS=false` the worker opens a real browser window and keeps the page open, so you can finish the check there and it carries on by itself. Otherwise the [browser extension](#browser-extension) opens the application in your own browser with your answers filled in.

The dashboard shows each running application's steps live (server-sent events), and Pause, Resume, Pause after current and Stop now take effect immediately. Daily and concurrency limits from Rules are enforced when the worker claims an application. Postgres holds the state; a crashed worker's applications return to the queue when its lease runs out.

By default the worker only opens `localhost` and `127.0.0.1`. To run against real employer sites, set `AUTOMATION_ALLOW_ALL_HOSTS=true` (private and internal addresses stay blocked). LinkedIn Easy Apply is never automated.

### AI

AI is optional. Two providers are built in: Claude (`AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`) and OpenAI (`AI_PROVIDER=openai` with `OPENAI_API_KEY`). Set the provider and its key in `.env`, or set the key and choose the provider in **Settings → AI**; `AI_MODEL` (or the Model box in Settings) overrides the default model. Without a provider, the built-in tools do everything below except write new text. The same checks apply whichever provider writes the text.

- **Field mapping.** The built-in rules map each form field to your Master Profile first. Only fields they aren't sure about go to the model, which can answer only with a field from the fixed profile schema. A field only AI recognized gets at most 85% confidence, a disagreement between the two gets 40%, and anything under your review threshold (Settings) waits for you.
- **Answers.** A required question with no saved answer gets a suggestion: a saved answer to a similarly worded question (never across different places, numbers or negations), else an AI draft built from your profile and saved answers. AI drafts always wait for your approval and are never auto-submitted. Questions about work authorization, sponsorship, demographics, pay, availability, relocation, travel or consent are never drafted.
- **Tailored resume and cover letter.** On a job's page, **Tailor resume** orders your own bullets and skills for that job (AI picks them when it's on and may write a short summary); **Write cover letter** writes a letter from your profile. Every figure, skill, credential and employer in AI-written text must appear in your profile, or the text is replaced by the template version and the page says why. Review and edit either one, download it as PDF or Word, and **Approve for this job** to have that job's application upload it instead of your default.

### Supported platforms

Each application's platform is detected from its link, and again from the page once it opens, so a Greenhouse or Lever board embedded on an employer's careers site is handled by the right adapter. All adapters share one form engine (labels first, then names, stable ids, ARIA and DOM paths, never coordinates) and differ only in what each site does:

| Platform | What the adapter handles |
| --- | --- |
| Greenhouse | The `#application_form` under the posting, typeahead dropdowns for questions and the EEOC section, the city search, and the hidden resume input behind Attach |
| Lever | The posting's Apply link, one Full name field, `✱` required markers and `.application-label` questions. Lever rewrites fields from the uploaded resume, so they're reset to your profile, and fields it filled that your profile doesn't cover are cleared |
| Ashby | The Application tab of a single-page app, Yes/No answer buttons, the location search, and an in-place confirmation. The Autofill from resume upload is skipped |
| Workday | Apply, then Apply Manually (never Autofill with Resume or Use My Last Application), the candidate sign-in (always yours to do, then reused), the step-by-step flow with Save and Continue, list buttons for dropdowns, and the final Review page |
| SmartRecruiters | I'm interested, form fields built from web components inside shadow DOM, the confirm-email field. Apply with LinkedIn or Indeed is never pressed |
| Other web forms | Any HTML application form |

Adding an ATS is one class that describes the site (its buttons, where questions are labelled, which ids are stable) plus a `register()` call in `packages/ats-adapters/src/defaults.ts`.

### Mock application pages

`pnpm --filter @autoapply/worker mock-site` serves local test forms at http://127.0.0.1:4100: a simple form, multi-page, dropdowns, checkboxes, file uploads, conditional questions, validation errors, CAPTCHA and sign-in walls, and unknown fields. It also imitates each supported ATS's form structure (Greenhouse, Lever with and without an hCaptcha on submit, Ashby, Workday with its sign-in, SmartRecruiters); the index page links to all of them. Add one as a job (for example `http://127.0.0.1:4100/simple`) to watch the whole flow without touching a real site. The worker tests and `pnpm test:e2e` use these pages.

### Worker settings

| Variable | Default | |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | `2` | Applications one worker runs at once (each user's own limit still applies) |
| `WORKER_HEADLESS` | `true` | `false` opens a visible browser you can finish checks in |
| `WORKER_INTERACTIVE_WAIT_MS` | `900000` | How long a visible browser waits for you before releasing the application |
| `WORKER_LEASE_MS` | `90000` | Lease length; a crashed worker's applications are requeued after it |
| `WORKER_SCHEDULER_INTERVAL_MS` | `5000` | How often the scheduler looks for due applications |
| `WORKER_NAVIGATION_TIMEOUT_MS` | `30000` | Page load timeout |
| `AUTOMATION_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hosts the worker may open |
| `AUTOMATION_ALLOW_ALL_HOSTS` | `false` | Allow public employer sites |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | | Chromium to launch, if not Playwright's own |

## Browser extension

The Applyance extension (`apps/extension`) works in Chrome, Edge, Brave and other Chromium browsers.

- **Save job.** Click the toolbar icon (or press Alt+Shift+A) on a job's page and choose **Save job**, or right-click a page or a link and choose **Save this job to Applyance**. The job lands on the Jobs page and is scored like any other. On LinkedIn the extension saves only the link and never reads the page, exactly as if you had pasted it; paste the description in Applyance to score it. Elsewhere it uses the page's job posting data, then the public posting a pasted link would get, then the page's heading and text (select the description first to save just that).
- **Finish in my browser.** The popup lists the applications that need you, with the count on the toolbar icon. **Finish in my browser** opens one in a new tab of your own browser and fills in the answers Applyance has, worked out exactly as the worker would (Master Profile, Answer Library, answers you approved), including your resume. Questions it has no answer for are outlined on the page and listed in a small panel. You solve any CAPTCHA and press the site's Submit button yourself; when the site shows its confirmation, Applyance records the application as submitted (or press **I submitted it**).
- **Sign-ins.** For an application stopped at a sign-in or verification code, sign in on the page yourself and press **Continue in Applyance**. The extension sends that site's cookies to Applyance, which saves them encrypted (they appear under Settings, Saved application sign-ins) and puts the application back in the queue, so the worker carries on signed in.

The extension never solves a CAPTCHA, never reads or types a password, never presses Submit, and never opens or fills LinkedIn pages. It asks Chrome for access to each application's site when you choose **Finish in my browser**, and reads a page for **Save job** only when you click it.

**Install (development).** In Chrome open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick the `apps/extension` folder. Then in Applyance open **Settings, Browser extension**, choose **Create code**, and type the code into the extension's popup. The code works once, for 10 minutes; the extension gets its own key, which only opens the extension's routes (`/v1/extension/*`) and can be disconnected from Settings. The server address defaults to `http://localhost:4000` (`pnpm dev:api`); set `API_PUBLIC_URL` to show a different one in Settings.

`content/page-scripts.js` is generated from the worker's own page scans (`packages/ats-adapters/src/form/dom-scripts.ts`) so both read forms the same way: run `pnpm --filter @autoapply/extension build` after changing them (a test fails until you do). The extension's tests load it into Chromium against the real API.

## Flightpath: tracking every application

**Flightpath** (in the sidebar) follows each application from the queue to the final answer, as a board or a table:

Queued → Processing → Needs you / Failed → **Submitted** → Responded → Interviewing → Offer → Accepted, Rejected or Withdrawn

- Up to Submitted, the automation moves applications. After that you do: drag a card to another column, or use its **Move to** menu (also on the table and on the application page). Moving a card back corrects a mistake, and the dashboard funnel follows.
- Moving an application that wasn't sent yet past Submitted means you applied yourself. You're asked to confirm, and automation stops for it. Failed cards can be dropped on Queued to retry, and skipped ones queued again from the table.
- Every move is recorded on the application's timeline and activity log.
- On an application's page, **Add interview** records each round (type, date and time in your time zone, length, link or address, interviewers, notes). The first round moves the application to Interviewing, and scheduled rounds show on the board, the table and the dashboard.
- The dashboard's stage counts, funnel, response, interview and offer rates, days to first reply, and upcoming interviews come from the same stages and update live.

Stages aren't stored separately: Flightpath derives them from the application's automation status and the outcome you set (`packages/shared/src/tracker.ts`), so the worker and the board always agree. Each application also keeps the first time it reached Responded, Interviewing and Offer, which is what the funnel and rates count.

**Email and other integrations.** Replies can't be read yet, so post-submit stages are set by you. An integration plugs in by implementing `StageSignalProvider` (`packages/shared/src/tracker.ts`) and handing its signals to `recordStageSignal` (`packages/database`). That matches the signal to one sent application, applies it only when the provider is confident and the move is forward, ignores repeats, and otherwise leaves a note on the timeline for you to act on, so an integration never overwrites what you set.

The REST API exposes the same operations: `GET /v1/tracker/board`, `GET /v1/tracker/applications`, `PATCH /v1/applications/:id/stage`, and interview rounds under `/v1/applications/:id/interviews` and `/v1/interviews/:id`.

## Admin panel

`/admin` is for the owner of the Applyance service. It shows every user (when they joined, when they were last active, their jobs, submitted and failed applications), failures grouped by cause and by site, applications that have waited on their user for more than 3 days, and whether the worker is running. It never shows anyone's Master Profile, resumes, cover letters, answers, salary or work authorization. Plans and payments appear once billing is connected.

Only admins see it; everyone else gets a 404. Roles can't be changed from inside the app. Sign up with your email first, then run this against the database you want (your `.env`, or set `DATABASE_URL` for production):

```bash
pnpm admin:grant you@example.com     # make an account an admin
pnpm admin:revoke you@example.com    # take it away
```

Reload the app and **Admin** appears at the bottom of the sidebar. Each time an admin opens a user's page, it's written to the audit log.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test        # unit and integration tests (needs Postgres)
pnpm test:e2e    # Playwright browser tests against the dev server, then with the real worker and mock pages
```

## Security

- Passwords are hashed with argon2id. Accounts lock for 15 minutes after 5 failed sign-ins.
- Sessions live in the database, which stores only a SHA-256 hash of each token. The cookie is httpOnly, SameSite=Lax, and `__Host-` prefixed in production.
- The browser extension connects with a one-time code that lasts 10 minutes and gets its own token (only its SHA-256 hash is stored). That token opens only the extension's routes, and changing your password disconnects it.
- Sensitive answers (demographics, sponsorship) and browser session state are encrypted with AES-256-GCM.
- Every mutation is checked for authorization, validated with zod, rate-limited, and written to the audit log (Settings → Security log).
- Uploads are checked against their file signature (magic bytes) and capped at 10 MB.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auth, database, Master Profile, documents, Answer Library, dashboard, Jobs/Applications/Needs Attention, rules, settings | Done |
| 2 | LinkedIn saved-jobs import (user-authorized path only), job analysis, matching, rule evaluation | Done |
| 3 | Queue and controls, Playwright worker, generic form automation, human intervention flow, live progress | Done |
| 4 | ATS adapters (Workday, Greenhouse, Lever, Ashby, SmartRecruiters) and platform detection | Done |
| 5 | AI field mapping, answer drafting, resume/cover-letter generation | Done |
| 6 | Analytics, retries, real-time hardening | Next |
| — | Flightpath application tracker: stages after submission, interview rounds, board and table, dashboard metrics | Done |
| — | Browser extension: save jobs from any site, finish CAPTCHAs and sign-ins in your own browser | Done |
