# QTS_Startup — Requirements Document

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

**Version:** 1.2.0  
**Last updated:** 2026-06-24  
**Purpose:** Single reference for product, technical, and planned requirements. Use this document to analyze scope, prioritize work, and decide what to build next.

**Related docs:** [README.md](README.md) · [BUILD.md](BUILD.md) · [UPGRADE.md](UPGRADE.md) · [CHANGELOG.md](CHANGELOG.md)

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [Stakeholders & roles](#2-stakeholders--roles)
3. [Architecture requirements](#3-architecture-requirements)
4. [Infrastructure & deployment requirements](#4-infrastructure--deployment-requirements)
5. [Functional requirements — implemented](#5-functional-requirements--implemented)
6. [Functional requirements — gaps & defects](#6-functional-requirements--gaps--defects)
7. [Functional requirements — proposed](#7-functional-requirements--proposed)
8. [Non-functional requirements](#8-non-functional-requirements)
9. [Data model requirements](#9-data-model-requirements)
10. [Security requirements](#10-security-requirements)
11. [Extension requirements](#11-extension-requirements)
12. [Acceptance & verification](#12-acceptance--verification)
13. [Roadmap options](#13-roadmap-options)
14. [Decision log template](#14-decision-log-template)

---

## 1. Product overview

### 1.1 Vision

**QTS_Startup** is a local-first job capture and tracking system for teams that bid on jobs for multiple candidates. It connects:

- **Bidders** — capture jobs from the web and mark which candidates applied
- **Admins** — manage organizations, users, data, and settings
- **Callers** — record and track interview processes

### 1.2 Problem statement

Teams need to:

1. Save job postings from many ATS/career sites quickly
2. Track which candidate applied to which job
3. Scope data per bidder organization
4. Coordinate interview scheduling across callers
5. Run locally without cloud dependency (optional PostgreSQL for production)

### 1.3 System components

| Component | Technology | Port | Status |
|-----------|------------|------|--------|
| Web UI | Next.js 16 + React 19 | 1027 | Implemented |
| API | Node.js + Express + TypeScript | 1028 | Implemented |
| Extension | Chrome Manifest V3 | — | Implemented |
| Database | PGlite (dev) / PostgreSQL 14+ (prod) | 5432 | Implemented |

### 1.4 Out of scope (current version)

- Public SaaS multi-tenant hosting
- Mobile native apps
- Direct LinkedIn/Indeed API integrations
- Built-in email sending
- Resume file storage service (field exists on interviews; no upload pipeline)

---

## 2. Stakeholders & roles

### 2.1 Role definitions

| Role | Primary users | Access |
|------|---------------|--------|
| **Admin** | Team lead, operations | Full CRUD, bidders, users, settings, all data |
| **Bidder** | Job researchers / applicants | Add candidates & jobs (extension), view own scoped data |
| **Caller** | Interview coordinators | Add/view own interview records |

### 2.2 Account provisioning rules

| Rule ID | Requirement | Status |
|---------|-------------|--------|
| ACC-01 | Admin account seeded from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` | Implemented |
| ACC-02 | Caller account seeded from `CALLER_USERNAME` / `CALLER_PASSWORD` in `.env` | Implemented |
| ACC-03 | Bidder accounts **not** auto-seeded; admin must create under **Bidders** | Implemented |
| ACC-04 | Bidder account must link to an active bidder organization to log in | Implemented |
| ACC-05 | Extension login accepts **bidder role only** (`extension: true` on login API) | Implemented |
| ACC-06 | Default extension username pre-filled as `user` | Implemented |

### 2.3 Panel routes

| Role | Base URL | Pages |
|------|----------|-------|
| Admin | `/admin` | Dashboard, Candidates, Jobs, Bidders, Accounts, Interviews, Settings |
| Bidder | `/bidder` | Dashboard, Candidates, Jobs |
| Caller | `/caller` | Interviews |
| All | `/login` | Unified login → redirect by role |

---

## 3. Architecture requirements

### 3.1 Component diagram

```
Browser Extension (bidder)
        │
        ▼
Express API :1028 ◄──── Next.js UI :1027 (proxy /api/*)
        │
        ▼
PostgreSQL / PGlite
```

### 3.2 Integration rules

| Rule ID | Requirement | Status |
|---------|-------------|--------|
| ARCH-01 | UI proxies `/api/*` to API via Next.js rewrites | Implemented |
| ARCH-02 | Extension calls API directly at `http://localhost:1028` | Implemented |
| ARCH-03 | API and UI ports must align (`1028` / `1027`) | Implemented |
| ARCH-04 | JWT bearer auth on protected routes | Implemented |
| ARCH-05 | Bidder data scoped by `bidder_id` on candidates, jobs, interviews | Implemented |
| ARCH-06 | Caller interview data scoped by `caller_user_id` | Implemented |

### 3.3 Project structure

```text
QTS_Startup/
├── admin-web/          Next.js UI
├── server/             Express API
├── extension/          Chrome extension
├── docker-compose.yml
├── start-server.bat
├── stop-server.bat
├── build-exe.bat
└── release/            Windows API executable output
```

---

## 4. Infrastructure & deployment requirements

### 4.1 System requirements

| Category | Minimum | Recommended |
|----------|---------|-------------|
| OS | Windows 10/11, macOS 12+, Linux x64 | Windows 11 / Ubuntu LTS |
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB+ |
| Disk | 2 GB free | SSD, local NTFS (not OneDrive-synced) |
| Node.js | ≥ 20.0.0 | 20 or 22 LTS |
| Browser | Chromium (Chrome, Edge, Brave) | Latest Chrome |

### 4.2 Software prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| Node.js ≥ 20 | Yes | API + UI |
| npm | Yes | Dependencies |
| Docker | Optional | External PostgreSQL, API container |
| PostgreSQL 14+ | Optional (prod) | Production database |
| Git | Optional | Version control |

### 4.3 Port requirements

| Port | Service | Config location |
|------|---------|---------------|
| **1027** | Next.js UI | `admin-web/package.json` |
| **1028** | Express API | `server/.env` → `PORT` |
| **5432** | PostgreSQL | `DATABASE_URL` when `EMBEDDED_PG=false` |

**Critical:** Legacy `PORT=4000` breaks UI login (proxy expects `1028`).

### 4.4 Environment variables (server)

| Variable | Required (prod) | Default | Description |
|----------|-----------------|---------|-------------|
| `EMBEDDED_PG` | No | `true` | Embedded PGlite for local dev |
| `DATABASE_URL` | When external PG | — | PostgreSQL connection string |
| `DATABASE_SSL` | Cloud DB | `false` | SSL for managed Postgres |
| `PORT` | No | `1028` | API port |
| `HOST` | No | `127.0.0.1` | Bind address |
| `ADMIN_WEB_URL` | No | `http://localhost:1027/login` | Browser open URL |
| `JWT_SECRET` | **Yes** | — | Auth token secret |
| `JWT_EXPIRY` | No | `24h` | Token lifetime |
| `ADMIN_USERNAME` | No | `admin` | Seeded admin |
| `ADMIN_PASSWORD` | **Yes** | — | Admin password |
| `CALLER_USERNAME` | No | `caller` | Seeded caller |
| `CALLER_PASSWORD` | No | `caller` | Caller password |
| `AUTO_OPEN_BROWSER` | No | `true` | Open UI on API start |
| `NODE_ENV` | No | `development` | `production` for deploy |

### 4.5 Environment variables (admin-web)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://127.0.0.1:1028` | Rewrite target for `/api/*` |
| `NEXT_PUBLIC_API_URL` | empty | Leave empty for same-origin proxy |

### 4.6 Deployment modes

| Mode | Command | Includes UI | Includes API | Includes DB |
|------|---------|-------------|--------------|-------------|
| Local dev (Windows) | `start-server.bat` | Yes | Yes | PGlite (default) |
| Local dev (manual) | `npm run dev` + `node dist/server.js` | Yes | Yes | PGlite |
| Docker full | `docker compose up -d` | **No** | Yes | Postgres |
| Docker DB only | `docker compose up -d postgres` | — | — | Postgres |
| Windows .exe | `build-exe.bat` → `release/QTS_Startup.exe` | **No** | Yes | External Postgres required |

### 4.7 Build commands

| Goal | Command |
|------|---------|
| Start all (Windows) | `start-server.bat` |
| Stop all (Windows) | `stop-server.bat` |
| Build API | `cd server && npm run build` |
| Build UI | `cd admin-web && npm run build` |
| Typecheck API | `cd server && npm run check` |
| Typecheck UI | `cd admin-web && npx tsc --noEmit` |
| Windows exe | `build-exe.bat` |
| SQLite migration | `cd server && npm run migrate:sqlite` |

### 4.8 Platform constraints

| Constraint | Detail |
|------------|--------|
| Windows Next.js | Must use `--webpack` (Turbopack crashes on Windows) |
| .exe package | API only; UI and Postgres separate |
| Extension | Load unpacked; API on `localhost:1028` |

---

## 5. Functional requirements — implemented

Status legend: **Done** = shipped in v1.2.0

### 5.1 Authentication & authorization

| ID | Requirement | Role | Status |
|----|-------------|------|--------|
| AUTH-01 | Login with username/password; receive JWT | All | Done |
| AUTH-02 | `GET /api/auth/me` returns user, role, bidderId | All | Done |
| AUTH-03 | Logout endpoint (client clears token) | All | Done |
| AUTH-04 | Role-based redirect after login (`/admin`, `/bidder`, `/caller`) | All | Done |
| AUTH-05 | Extension login restricted to bidder + valid org | Bidder | Done |
| AUTH-06 | `GET /api/auth/extension-status` reports if bidder accounts exist | Extension | Done |
| AUTH-07 | Admin-only routes for bidders, users management | Admin | Done |
| AUTH-08 | Write operations (edit/delete) restricted to admin | Admin | Done |

### 5.2 Admin — dashboard

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-DASH-01 | Show total jobs, candidates, active candidates | Done |
| ADM-DASH-02 | Show applied candidate-job count | Done |
| ADM-DASH-03 | Show recent jobs list | Done |

### 5.3 Admin — candidates

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-CAND-01 | List/search candidates | Done |
| ADM-CAND-02 | Create candidate (name, email, phone, LinkedIn, notes, color, active) | Done |
| ADM-CAND-03 | Edit candidate | Done |
| ADM-CAND-04 | Activate/deactivate candidate | Done |
| ADM-CAND-05 | Delete candidate | Done |
| ADM-CAND-06 | View candidate job history | Done |

### 5.4 Admin — jobs

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-JOB-01 | List/search jobs | Done |
| ADM-JOB-02 | View job details with candidate statuses | Done |
| ADM-JOB-03 | Edit job (title, company, URL, source, description) | Done |
| ADM-JOB-04 | Toggle candidate status none/applied per job | Done |
| ADM-JOB-05 | Delete job | Done |
| ADM-JOB-06 | Open original job URL | Done |

### 5.5 Admin — bidders & accounts

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-BID-01 | CRUD bidder organizations | Done |
| ADM-BID-02 | View accounts and candidates per bidder org | Done |
| ADM-BID-03 | Create bidder/caller account under org | Done |
| ADM-USR-01 | CRUD all user accounts (admin, bidder, caller) | Done |

### 5.6 Admin — interviews

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-INT-01 | List all interviews | Done |
| ADM-INT-02 | Create interview record | Done |
| ADM-INT-03 | Edit interview record | Done |
| ADM-INT-04 | Delete interview record | Done |
| ADM-INT-05 | Fields: dates, time, timezone, candidate, position, company, job URL, resume, meeting URL, salary, stage | Done |

### 5.7 Admin — settings

| ID | Requirement | Status |
|----|-------------|--------|
| ADM-SET-01 | Edit server name, default source, token expiry (stored in DB) | Done |
| ADM-SET-02 | Database backup to `.sql` file | Done |

### 5.8 Bidder — web panel

| ID | Requirement | Status |
|----|-------------|--------|
| BID-DASH-01 | Dashboard with bid stats (today/week/month) | Done |
| BID-DASH-02 | Charts and recent applications | Done |
| BID-CAND-01 | Add candidates (own org scoped) | Done |
| BID-CAND-02 | View candidate job history | Done |
| BID-JOB-01 | View/search own jobs | Done |
| BID-JOB-02 | View job details and candidate statuses (read-only) | Done |

### 5.9 Caller — web panel

| ID | Requirement | Status |
|----|-------------|--------|
| CAL-INT-01 | List own interviews | Done |
| CAL-INT-02 | Add interview record | Done |
| CAL-INT-03 | View interview details (read-only modal) | Done |

### 5.10 Extension

| ID | Requirement | Status |
|----|-------------|--------|
| EXT-01 | Bidder sign-in (default username `user`) | Done |
| EXT-02 | Connection status indicator | Done |
| EXT-03 | Auto-extract job from current tab | Done |
| EXT-04 | Supported sites: LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workable, SmartRecruiters, Ashby, generic | Done |
| EXT-05 | Save new job with title, company, URL, description, source | Done |
| EXT-06 | Detect existing job by URL | Done |
| EXT-07 | Mark active candidates as none/applied | Done |
| EXT-08 | Lock applied status after save (cannot revert in extension) | Done |
| EXT-09 | Auto-open popup on job pages (background worker) | Done |
| EXT-10 | API default `http://localhost:1028` | Done |

### 5.11 API modules

| Module | Endpoints | Status |
|--------|-----------|--------|
| `/api/auth` | login, logout, me, extension-status, setup-status | Done |
| `/api/candidates` | CRUD, history, status | Done |
| `/api/jobs` | CRUD, by-url, stats, upsert, candidate statuses | Done |
| `/api/bidders` | CRUD, accounts | Done |
| `/api/users` | CRUD | Done |
| `/api/interviews` | CRUD, timezones meta | Done |
| `/api/settings` | get, put, backup | Done |
| `/api/health` | health check | Done |

---

## 6. Functional requirements — gaps & defects

**Priority:** Fix before adding major new features (recommended v1.2.1).

| ID | Requirement | Severity | Current behavior | Expected behavior |
|----|-------------|----------|------------------|-------------------|
| BUG-01 | Extension `storeToken` must persist auth token | **Critical** | `storeToken` function body broken in `popup.js` | Token saved to `chrome.storage.local` after login |
| BUG-02 | Bidder must update saved jobs via extension | **Critical** | Extension uses `PUT /jobs/:id` (admin-only) | Use `POST /jobs/upsert` for bidder create/update |
| BUG-03 | Admin assigns bidder when creating candidate | **High** | No bidder dropdown in admin candidate form | Admin selects bidder org; `bidder_id` set on create |
| BUG-04 | Interview form caller/bidder assignment | **High** | API supports fields; UI has no dropdowns | Admin selects caller and bidder on interview form |
| BUG-05 | Settings values applied at runtime | **Medium** | `server_name`, `token_expiration` saved but ignored | UI branding and JWT expiry read from settings DB |
| BUG-06 | Bidder candidate edit via web | **Medium** | Bidder PUT may fail silently | Clear UI: add-only for bidder, or allow scoped edit |
| BUG-07 | Caller edit own interviews | **Medium** | PUT admin-only | Caller can update own interview records |
| BUG-08 | Admin job create in web UI | **Low** | Jobs only via extension | Optional manual job entry for admin |
| BUG-09 | Backup restore | **Low** | Backup only; no restore UI | Import `.sql` or logical restore |
| BUG-10 | List pagination | **Low** | All records loaded at once | Paginated lists for jobs/candidates/interviews |
| BUG-11 | Token invalidation on logout | **Low** | JWT valid until expiry | Optional server-side denylist or shorter expiry |
| BUG-12 | `setup-status` endpoint used | **Low** | Endpoint exists, unused | First-run hint on login when no admin |

---

## 7. Functional requirements — proposed

Use **Priority** and **Effort** to decide. Mark your choices in [Section 14](#14-decision-log-template).

### 7.1 Priority 1 — Core workflow (recommended next)

| ID | Requirement | Priority | Effort | Value | Depends on |
|----|-------------|----------|--------|-------|------------|
| FEAT-01 | Job application pipeline statuses beyond none/applied (e.g. screened, interview, offer, hired, rejected) | P1 | Large | High | BUG-02 |
| FEAT-02 | Link interviews to candidate record (dropdown) instead of free text only | P1 | Medium | High | — |
| FEAT-03 | Auto-fill interview job/company from linked job | P1 | Medium | High | FEAT-02 |
| FEAT-04 | Bidder manual job entry in web UI (`/bidder/jobs`) | P1 | Medium | High | BUG-02 |
| FEAT-05 | Extension logout + show logged-in bidder name | P1 | Small | Medium | BUG-01 |
| FEAT-06 | Job notes and status change activity log | P1 | Medium | High | FEAT-01 |

### 7.2 Priority 2 — Admin & operations

| ID | Requirement | Priority | Effort | Value |
|----|-------------|----------|--------|-------|
| FEAT-07 | Admin create job in web UI | P2 | Medium | Medium |
| FEAT-08 | Bulk import candidates (CSV) | P2 | Medium | High |
| FEAT-09 | Bidder performance report (apps/day, conversion) | P2 | Large | High |
| FEAT-10 | Backup restore UI | P2 | Medium | Medium |
| FEAT-11 | Audit log (who changed what) | P2 | Large | High |
| FEAT-12 | Password change / admin reset password | P2 | Medium | Medium |
| FEAT-13 | Deactivate user accounts (soft delete) | P2 | Small | Medium |

### 7.3 Priority 3 — Caller experience

| ID | Requirement | Priority | Effort | Value |
|----|-------------|----------|--------|-------|
| FEAT-14 | Caller dashboard (upcoming interviews) | P3 | Medium | High |
| FEAT-15 | Caller edit own interviews | P3 | Small | High |
| FEAT-16 | Interview outcome field (passed/failed/rescheduled/no-show) | P3 | Small | Medium |
| FEAT-17 | Calendar week/month view for interviews | P3 | Large | Medium |

### 7.4 Priority 4 — Analytics & export

| ID | Requirement | Priority | Effort | Value |
|----|-------------|----------|--------|-------|
| FEAT-18 | Funnel analytics (applied → interview → offer) | P4 | Large | High |
| FEAT-19 | Company/source breakdown charts | P4 | Medium | Medium |
| FEAT-20 | Export jobs/candidates/interviews to CSV/Excel | P4 | Medium | High |
| FEAT-21 | Time-to-apply metrics | P4 | Medium | Medium |

### 7.5 Priority 5 — Production & platform

| ID | Requirement | Priority | Effort | Value |
|----|-------------|----------|--------|-------|
| FEAT-22 | Docker image includes Next.js UI | P5 | Medium | High |
| FEAT-23 | Versioned database migrations (not inline ALTER) | P5 | Large | High |
| FEAT-24 | Automated test suite (auth, scoping, API) | P5 | Large | High |
| FEAT-25 | Rate limiting and hardened production defaults | P5 | Medium | High |
| FEAT-26 | Single Windows installer (API + UI + health check) | P5 | Large | Medium |
| FEAT-27 | .exe bundle includes UI or documented release package | P5 | Large | Medium |

### 7.6 Priority 6 — Future / optional

| ID | Requirement | Priority | Effort | Value |
|----|-------------|----------|--------|-------|
| FEAT-28 | Email/Telegram interview reminders | P6 | Large | Medium |
| FEAT-29 | Resume file upload on candidates/interviews | P6 | Medium | Medium |
| FEAT-30 | JD parsing / candidate-job match score | P6 | X-Large | High |
| FEAT-31 | API keys for external tools | P6 | Medium | Medium |
| FEAT-32 | Mobile-friendly caller panel | P6 | Medium | Low |
| FEAT-33 | Integration with Resume Generator / JD Analysis tools | P6 | X-Large | High |

---

## 8. Non-functional requirements

| ID | Category | Requirement | Status |
|----|----------|-------------|--------|
| NFR-01 | Performance | API health responds < 500 ms locally | Met |
| NFR-02 | Performance | UI first load < 10 s on dev (webpack) | Met |
| NFR-03 | Scalability | Support 10+ bidders, 1000+ jobs (Postgres) | Assumed |
| NFR-04 | Scalability | Pagination required before 10k+ records | Not met |
| NFR-05 | Reliability | Embedded PGlite for zero-config local dev | Met |
| NFR-06 | Reliability | External Postgres for production | Met |
| NFR-07 | Maintainability | TypeScript on API and UI | Met |
| NFR-08 | Maintainability | Automated tests | **Not met** |
| NFR-09 | Usability | Role-based panels with read-only banners | Met |
| NFR-10 | Usability | One-click Windows start (`start-server.bat`) | Met |
| NFR-11 | Portability | Windows, macOS, Linux (Node) | Met |
| NFR-12 | Observability | Structured logger on API | Partial |
| NFR-13 | Observability | Audit trail | **Not met** |

---

## 9. Data model requirements

### 9.1 Tables

| Table | Purpose | Key fields |
|-------|---------|------------|
| `admins` | All user accounts | username, password_hash, role, bidder_id |
| `bidders` | Bidder organizations | name, notes, is_active |
| `candidates` | People applying | name, email, bidder_id, color, is_active |
| `jobs` | Job postings | title, company, url, normalized_url, description, bidder_id |
| `candidate_jobs` | Application status | candidate_id, job_id, status, applied_at |
| `interview_processes` | Interview tracking | candidate_name, caller_user_id, dates, stage, etc. |
| `settings` | Key-value config | key, value |

### 9.2 Data rules

| Rule ID | Requirement | Status |
|---------|-------------|--------|
| DATA-01 | Job URL unique (normalized) | Implemented |
| DATA-02 | Candidate-job pair unique | Implemented |
| DATA-03 | Bidder accounts require `bidder_id` on login | Implemented |
| DATA-04 | Candidate job status: `none` \| `applied` only | Implemented (limited) |
| DATA-05 | Delete bidder nullifies bidder_id on related rows (no cascade delete) | Implemented |
| DATA-06 | Interview `candidate_id` optional; name required | Implemented |

### 9.3 Proposed data changes

| Rule ID | Requirement | Linked feature |
|---------|-------------|----------------|
| DATA-P01 | Expand `candidate_jobs.status` enum for pipeline stages | FEAT-01 |
| DATA-P02 | Enforce `candidate_id` on interviews when candidate exists | FEAT-02 |
| DATA-P03 | `audit_log` table for changes | FEAT-11 |
| DATA-P04 | `users.is_active` for soft delete | FEAT-13 |

---

## 10. Security requirements

| ID | Requirement | Status |
|----|-------------|--------|
| SEC-01 | Passwords hashed with bcrypt | Implemented |
| SEC-02 | JWT signed with configurable secret | Implemented |
| SEC-03 | Role-based API authorization | Implemented |
| SEC-04 | Bidder/caller data scoping on queries | Implemented |
| SEC-05 | CORS restricted to localhost + chrome-extension | Implemented |
| SEC-06 | Change default JWT_SECRET before production | **Operator responsibility** |
| SEC-07 | HTTPS via reverse proxy in production | **Operator responsibility** |
| SEC-08 | Do not commit `.env` files | **Operator responsibility** |
| SEC-09 | Rate limiting on login/API | Not implemented |
| SEC-10 | Server-side session invalidation | Not implemented |

---

## 11. Extension requirements

### 11.1 Functional

| ID | Requirement | Status |
|----|-------------|--------|
| EXT-R01 | Connect to `http://localhost:1028` by default | Done |
| EXT-R02 | Bidder-only authentication | Done |
| EXT-R03 | Extract and save job from supported sites | Done |
| EXT-R04 | Show only active candidates for bidder scope | Done |
| EXT-R05 | Update existing job (bidder-safe path) | **Gap (BUG-02)** |
| EXT-R06 | Persist login token across sessions | **Gap (BUG-01)** |
| EXT-R07 | Logout control | Not implemented |
| EXT-R08 | Configurable server URL in UI | Not implemented (storage key exists) |

### 11.2 Installation

1. Load unpacked from `extension/` folder
2. API must run on port 1028
3. Admin creates bidder account before first login
4. Reload extension after code updates

---

## 12. Acceptance & verification

### 12.1 Smoke tests (after every build)

| # | Test | Expected |
|---|------|----------|
| 1 | `GET http://localhost:1028/api/health` | `success: true` |
| 2 | `GET http://localhost:1027/login` | Login page loads |
| 3 | `GET http://localhost:1027/api/health` | Proxied health OK |
| 4 | Admin login | Redirect to `/admin` |
| 5 | Bidder login (web) | Redirect to `/bidder` |
| 6 | Caller login | Redirect to `/caller` |
| 7 | Extension bidder login | Job section visible |
| 8 | Save job via extension | Job appears in bidder/admin jobs |
| 9 | `npm run check` (server) | Exit 0 |
| 10 | `npm run build` (admin-web) | Exit 0 |

### 12.2 Role acceptance scenarios

| Scenario | Steps | Pass criteria |
|----------|-------|---------------|
| Admin onboarding | Create bidder org → add account → add candidate | Bidder can log in to extension |
| Bidder capture | Extension login → open job page → save | Job saved with candidate statuses |
| Caller interview | Caller login → add interview | Record visible in admin and caller list |
| Scoping | Bidder A cannot see Bidder B candidates | API returns scoped data only |

---

## 13. Roadmap options

Pick one path or mix items à la carte.

### Option A — Stabilize first (recommended)

**Target:** v1.2.1 — 1–2 weeks

- BUG-01 through BUG-04
- EXT-R05, EXT-R06
- Smoke tests documented and run

### Option B — Workflow depth

**Target:** v1.3.0 — 3–4 weeks

- Option A +
- FEAT-01, FEAT-02, FEAT-03, FEAT-14, FEAT-15

### Option C — Operations & reporting

**Target:** v1.4.0 — 4–6 weeks

- Option B +
- FEAT-08, FEAT-11, FEAT-18, FEAT-20

### Option D — Production hardening

**Target:** v1.5.0 — 4–6 weeks

- FEAT-22, FEAT-23, FEAT-24, FEAT-25
- Docker full stack, CI pipeline

### Option E — Intelligence layer

**Target:** v2.0.0 — future

- FEAT-30, FEAT-33 (JD analysis, matching, external integrations)

---

## 14. Decision log template

Copy this section and fill in your choices.

### 14.1 Must-fix (yes/no)

| ID | Fix | Include? (Y/N) | Notes |
|----|-----|----------------|-------|
| BUG-01 | Extension storeToken | | |
| BUG-02 | Bidder job upsert | | |
| BUG-03 | Admin bidder picker on candidates | | |
| BUG-04 | Interview caller/bidder dropdowns | | |
| BUG-05 | Apply settings from DB | | |
| BUG-07 | Caller edit own interviews | | |

### 14.2 Features (yes/no/defer)

| ID | Feature | Include? | Phase | Notes |
|----|---------|----------|-------|-------|
| FEAT-01 | Pipeline statuses | | | |
| FEAT-02 | Interview ↔ candidate link | | | |
| FEAT-04 | Bidder web job entry | | | |
| FEAT-08 | CSV import | | | |
| FEAT-11 | Audit log | | | |
| FEAT-14 | Caller dashboard | | | |
| FEAT-18 | Funnel analytics | | | |
| FEAT-22 | Docker with UI | | | |
| FEAT-30 | JD match score | | | |

### 14.3 Deployment target

| Target | Selected? |
|--------|-----------|
| Local only (PGlite) | |
| Local + Docker Postgres | |
| LAN deployment | |
| Cloud VPS | |
| Windows .exe distribution | |

### 14.4 Notes / decisions

```text
Date:
Decision:
Rationale:
```

---

## Appendix A — Effort scale

| Size | Meaning |
|------|---------|
| Small | 1–2 days |
| Medium | 3–7 days |
| Large | 1–3 weeks |
| X-Large | 1+ months |

## Appendix B — Requirement status legend

| Status | Meaning |
|--------|---------|
| Done | Implemented in v1.2.0 |
| Gap | Known defect or incomplete wiring |
| Proposed | Not implemented; candidate for future |
| Operator | Depends on deployment configuration |

---

*End of requirements document — QTS_Startup v1.2.0*
