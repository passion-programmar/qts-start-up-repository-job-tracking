# QTS Job Tracking — Current System (June 2026)

Canonical reference for architecture after **one-step easy apply** fixes (extension **v1.13.25+**).

## Database model transition

The database initialization now creates the proposed `users`, `bids`, `interviews`,
`job_list`, `categories`, and `app_settings` tables alongside the existing schema.
See [NEW-DATABASE-SCHEMA.md](./NEW-DATABASE-SCHEMA.md) for the tables, fields,
relationships, and integrity notes.
`app_settings` is temporary naming to avoid colliding with the legacy `settings`
table still used by the current server. The News table is deferred.

This is a schema-only first phase: the existing server and frontend still use the
legacy tables, which are intentionally retained so the current application keeps
working. No existing rows are copied or deleted yet. Do not remove the legacy
tables until the server/frontend migration and data conversion are implemented
and verified. Job category IDs and selected Account user IDs are stored as
integer arrays in `job_list`; application code must validate those IDs and
role-specific assignments (Manager for jobs, Account for bids, Caller for
interviews).

## Components

| Layer | Role |
|-------|------|
| **Chrome extension** (`extension/`) | Job detect, capture, auto-apply pipeline, Custom GPT handoff, form fill + PDF upload |
| **API server** (`server/`) | PostgreSQL/PGlite, jobs, candidates, application sessions/tasks, job sites |
| **Admin web** (`admin-web/`) | Admin, manager, account, caller panels (Next.js) |

## Roles

- **Admin** — full access, job sites, account admission, Custom GPT URLs, database records
- **Manager** — team accounts, candidates, jobs (scoped)
- **Account** — extension capture + auto-apply; web panel for candidates & jobs from admitted sites
- **Caller** — interviews only

## Job sites (admin → account)

1. Admin opens **Jobs → Job sites** and adds sources manually (`name`, `platform_key`, optional `url_host`).
2. `platform_key` must match the extension `source` when a job is saved (e.g. `justjoin`, `linkedin`).
3. Admin **admits** an Account team to a site with a **default candidate** (must belong to that team).
4. Account **Jobs** panel lists admitted sites + default candidate; jobs are matched by `source` or URL host.
5. Extension default candidate remains in `chrome.storage.local` (`qtsDefaultCandidateByAccount`); align with server admission in the web panel.

## One-step auto-apply (extension)

1. Account armed: logged in, auto-apply ON, default candidate selected.
2. Job page → detect toast (once per load) → scan form → fill profile fields.
3. Create application session + `task_<uuid>` on server.
4. Prewarm + pin Custom GPT tab → send **one** `PROCESS_TASK` (submit lock + chat confirmation).
5. GPT Actions: `getTaskContext` → `submitTaskPackage` → reply **"Confirmed."** only.
6. Extension polls server, uploads resume PDF, fills AI answers on job form.
7. Account reviews consent/terms and submits on the job site manually.

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
| `POST /api/job-sites/:id/admit` | Admit account + default candidate |
| `GET /api/job-sites/my-admissions` | Account's admitted sites |

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
