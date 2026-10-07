# QTS Job Tracking — Current System (June 2026)

Canonical reference for architecture after **one-step easy apply** fixes (extension **v1.13.25+**).

## Components

| Layer | Role |
|-------|------|
| **Chrome extension** (`extension/`) | Job detect, capture, auto-apply pipeline, Custom GPT handoff, form fill + PDF upload |
| **API server** (`server/`) | PostgreSQL/PGlite, jobs, candidates, application sessions/tasks, job sites |
| **Admin web** (`admin-web/`) | Admin, manager, bidder, caller panels (Next.js) |

## Roles

- **Admin** — full access, job sites, bidder admission, Custom GPT URLs, database records
- **Manager** — team bidders, candidates, jobs (scoped)
- **Bidder** — extension capture + auto-apply; web panel for candidates & jobs from admitted sites
- **Caller** — interviews only

## Job sites (admin → bidder)

1. Admin opens **Jobs → Job sites** and adds sources manually (`name`, `platform_key`, optional `url_host`).
2. `platform_key` must match the extension `source` when a job is saved (e.g. `justjoin`, `linkedin`).
3. Admin **admits** a bidder to a site with a **default candidate** (must belong to that bidder).
4. Bidder **Jobs** panel lists admitted sites + default candidate; jobs are matched by `source` or URL host.
5. Extension default candidate remains in `chrome.storage.local` (`qtsDefaultCandidateByBidder`); align with server admission in the web panel.

## One-step auto-apply (extension)

1. Bidder armed: logged in, auto-apply ON, default candidate selected.
2. Job page → detect toast (once per load) → scan form → fill profile fields.
3. Create application session + `task_<uuid>` on server.
4. Prewarm + pin Custom GPT tab → send **one** `PROCESS_TASK` (submit lock + chat confirmation).
5. GPT Actions: `getTaskContext` → `submitTaskPackage` → reply **"Confirmed."** only.
6. Extension polls server, uploads resume PDF, fills AI answers on job form.
7. Bidder reviews consent/terms and submits on the job site manually.

## Custom GPT

- Instructions: see `QTS-JOB-TRACKING-CUSTOM-GPT-GUIDE.md` §10.
- Final reply: **"Confirmed."** — no extension/upload narration.
- Actions OpenAPI: `docs/openapi/custom-gpt-application-actions.yaml`.

## Key API routes

| Route | Purpose |
|-------|---------|
| `POST /api/jobs/upsert` | Extension job capture |
| `POST /api/application-sessions` | Start apply session |
| `POST /api/application-tasks/:taskId/dispatch` | Register GPT task |
| `GET/POST /api/job-sites` | Job site registry (admin) |
| `POST /api/job-sites/:id/admit` | Admit bidder + default candidate |
| `GET /api/job-sites/my-admissions` | Bidder's admitted sites |

## Application sessions

- In-memory when `APPLICATION_SESSION_PERSIST_DB=false` (local dev).
- Task ID from session metadata (`publicTaskId`) — single ID end-to-end.

## Docs map

| Doc | Topic |
|-----|--------|
| `QTS-APPLICATION-WORKFLOW.md` | Full apply + GPT pipeline |
| `QTS-JOB-TRACKING-EXTENSION-GUIDE.md` | Extension install & capture |
| `QTS-JOB-TRACKING-CUSTOM-GPT-GUIDE.md` | GPT setup & instructions |
| `docs/JUSTJOIN-APPLICATION-FLOWS.md` | JustJoin templates |
| `BUILD.md` / `DEPLOY.md` | Run & deploy |
