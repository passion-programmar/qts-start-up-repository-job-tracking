# QTS_Startup — Build Requirements & Recommendations

This document describes everything needed to build, run, and deploy **QTS_Startup v1.2.0**. Use it as the primary reference for developers and operators.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [System requirements](#system-requirements)
3. [Software prerequisites](#software-prerequisites)
4. [Project structure](#project-structure)
5. [Ports and networking](#ports-and-networking)
6. [Environment configuration](#environment-configuration)
7. [Build & run — local development](#build--run--local-development)
8. [Build & run — production](#build--run--production)
9. [Build — Windows executable](#build--windows-executable)
10. [Build — Docker](#build--docker)
11. [Chrome extension setup](#chrome-extension-setup)
12. [Accounts, roles, and first-time setup](#accounts-roles-and-first-time-setup)
13. [Verification checklist](#verification-checklist)
14. [Troubleshooting](#troubleshooting)
15. [Recommendations](#recommendations)

---

## Architecture overview

QTS_Startup is a three-part system:

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Chrome          │     │ Next.js UI           │     │ Express API     │
│ Extension       │────▶│ admin-web/           │────▶│ server/         │
│ extension/      │     │ http://localhost:1027│     │ :1028/api       │
└─────────────────┘     └──────────────────────┘     └────────┬────────┘
        │                        │                            │
        └────────────────────────┴────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ PostgreSQL              │
                    │ PGlite (embedded) or    │
                    │ external Postgres       │
                    └─────────────────────────┘
```

| Component | Technology | Default port | Purpose |
|-----------|------------|--------------|---------|
| Web UI | Next.js 16 + React 19 | **1027** | Admin, bidder, and caller panels |
| API | Node.js + Express + TypeScript | **1028** | REST API, auth, database |
| Extension | Chrome Manifest V3 | — | Capture jobs from job sites |
| Database | PGlite or PostgreSQL 14+ | 5432 (external) | Persistent storage |

The UI proxies `/api/*` requests to the API server via Next.js rewrites. The extension talks to the API directly at `http://localhost:1028`.

---

## System requirements

### Minimum (local development)

| Resource | Requirement |
|----------|-------------|
| OS | Windows 10/11, macOS 12+, or Linux (x64) |
| CPU | 2 cores |
| RAM | 4 GB (8 GB recommended) |
| Disk | 2 GB free (includes `node_modules` and database) |
| Network | Localhost only; internet needed for `npm install` |

### Recommended (comfortable development)

| Resource | Recommendation |
|----------|----------------|
| RAM | 8 GB+ |
| Disk | SSD; avoid synced folders (OneDrive, Dropbox) for the repo |
| Node.js | 20 LTS or 22 LTS |

### Production / Docker

| Resource | Recommendation |
|----------|----------------|
| RAM | 2 GB+ for API + Postgres |
| Postgres | PostgreSQL 14+ (16 recommended) |
| TLS | Reverse proxy (nginx, Caddy) in front of UI and API |

---

## Software prerequisites

### Required

| Tool | Version | Used for |
|------|---------|----------|
| **Node.js** | **≥ 20.0.0** | API and UI build/runtime |
| **npm** | Comes with Node | Dependency install |
| **Chromium browser** | Latest Chrome, Edge, or Brave | Extension |

Verify installation:

```bat
node -v
npm -v
```

Expected: `v20.x` or `v22.x` for Node.

### Optional

| Tool | Version | Used for |
|------|---------|----------|
| Docker Desktop | Latest | External PostgreSQL, full stack deploy |
| Git | Latest | Version control |
| `pkg` (via npm) | Bundled in server devDependencies | Windows `.exe` build |

### Not required for local dev

- External PostgreSQL (embedded PGlite is the default)
- Global TypeScript install (`npx` / local `node_modules` are used)

---

## Project structure

```text
QTS_Startup/
├── admin-web/              Next.js web UI (port 1027)
│   ├── src/app/            Routes: /login, /admin, /bidder, /caller
│   ├── src/components/     Shared panel views
│   ├── .env.local          UI → API proxy target (optional)
│   └── package.json
├── server/                 Express API (port 1028)
│   ├── src/                TypeScript source
│   ├── dist/               Compiled output (after build)
│   ├── data/pglite/        Embedded DB files (created at runtime)
│   ├── .env                Local config (create from .env.example)
│   └── package.json
├── extension/              Chrome extension (load unpacked)
├── package.json            npm start / npm run stop
├── scripts/                setup + stop helpers
├── docker-compose.yml      Postgres + API container
├── build-exe.bat           Package Windows API executable
└── release/                Output for .exe distribution
```

---

## Ports and networking

| Port | Service | Must match |
|------|---------|------------|
| **1027** | Next.js UI | `admin-web` dev/start scripts |
| **1028** | Express API | `server/.env` → `PORT=1028` |
| **5432** | PostgreSQL | Only when `EMBEDDED_PG=false` |

**Critical:** The UI proxies API calls to `http://127.0.0.1:1028` (see `admin-web/next.config.ts` and `admin-web/.env.local`). If `server/.env` uses a different port (e.g. legacy `PORT=4000`), login and all panel data will fail.

Extension default API URL: `http://localhost:1028` (hardcoded in `extension/popup/api-client.js`).

---

## Environment configuration

### Server (`server/.env`)

Create from the template:

```bat
copy server\.env.example server\.env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDED_PG` | No | `true` | Use embedded PGlite; set `false` for external Postgres |
| `DATABASE_URL` | When `EMBEDDED_PG=false` | — | PostgreSQL connection string |
| `DATABASE_SSL` | No | `false` | Set `true` for managed cloud databases |
| `DATABASE_POOL_MAX` | No | `10` | Connection pool size |
| `PORT` | No | `1028` | API listen port |
| `HOST` | No | `127.0.0.1` | Bind address (`0.0.0.0` for LAN/Docker) |
| `ADMIN_WEB_URL` | No | `http://localhost:1027/login` | Opened on server start when auto-open is enabled |
| `AUTO_OPEN_BROWSER` | No | `true` | Open browser when API starts |
| `NODE_ENV` | No | `development` | `production` for deploy |
| `JWT_SECRET` | **Yes (prod)** | — | Long random secret for auth tokens |
| `JWT_EXPIRY` | No | `24h` | Token lifetime |
| `ADMIN_USERNAME` | No | `admin` | Seeded admin account |
| `ADMIN_PASSWORD` | **Yes** | — | Admin password (seeded on first start) |
| `CALLER_USERNAME` | No | `caller` | Seeded caller account |
| `CALLER_PASSWORD` | No | `caller` | Caller password |

**Note:** Bidder accounts are **not** auto-seeded. An admin must create them in the web UI under **Admin → Bidders**.

### Web UI (`admin-web/.env.local`)

Optional; defaults work for local dev:

```env
API_URL=http://127.0.0.1:1028
NEXT_PUBLIC_API_URL=
```

Leave `NEXT_PUBLIC_API_URL` empty so the browser uses same-origin `/api` requests (proxied by Next.js).

---

## Build & run — local development

### Option A — One command (recommended)

1. Install Node.js 20+.
2. From the project root:

```bash
npm install
npm start
```

This:

- Installs `admin-web` and `server` dependencies if missing
- Creates `server/.env` from `.env.example` if missing
- Migrates legacy `PORT=4000` → `PORT=1028`
- Starts Next.js UI (port **1027**) and API (port **1028**) in one terminal

3. Open http://localhost:1027/login

To stop: press `Ctrl+C`, or run `npm run stop` from another terminal.

### Option B — Manual (separate terminals)

**Terminal 1 — API**

```bat
cd server
npm install
copy .env.example .env
npm run build
node dist/server.js
```

**Terminal 2 — UI**

```bat
cd admin-web
npm install
npm run dev
```

### Development scripts reference

| Location | Command | Purpose |
|----------|---------|---------|
| `server/` | `npm run build` | Compile TypeScript → `dist/` |
| `server/` | `npm start` | Build + run API |
| `server/` | `npm run dev` | Build + run with `--watch` |
| `server/` | `npm run check` | Typecheck without emit |
| `admin-web/` | `npm run dev` | Dev server (webpack, port 1027) |
| `admin-web/` | `npm run build` | Production build |
| `admin-web/` | `npm run start` | Serve production build |

### First-time database

With `EMBEDDED_PG=true` (default):

- No manual DB setup
- Data stored in `server/data/pglite/`
- Tables and seed accounts created on first API start

With external PostgreSQL:

```bat
docker compose up -d postgres
```

Then in `server/.env`:

```env
EMBEDDED_PG=false
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qts_startup
```

---

## Build & run — production

### API

```bat
cd server
npm ci
npm run build
set NODE_ENV=production
node dist/server.js
```

### UI

```bat
cd admin-web
npm ci
npm run build
npm run start
```

Set `API_URL` at build time if the API is not on `127.0.0.1:1028`:

```bat
set API_URL=https://api.yourdomain.com
npm run build
```

For production, also set in `server/.env`:

```env
NODE_ENV=production
HOST=0.0.0.0
AUTO_OPEN_BROWSER=false
JWT_SECRET=<long-random-secret>
EMBEDDED_PG=false
DATABASE_URL=<your-postgres-url>
DATABASE_SSL=true
```

---

## Build — Windows executable

Packages **API only** (not the Next.js UI).

### Requirements

- Windows 10/11
- Node.js 20+ on the **build machine**
- ~500 MB free disk for build artifacts

### Steps

```bat
build-exe.bat
```

Output:

| Path | Description |
|------|-------------|
| `release/QTS_Startup.exe` | Standalone API server (~58 MB) |
| `release/extension/` | Chrome extension copy |
| `release/.env.example` | Config template |

### Running the .exe

1. Start PostgreSQL (`docker compose up -d postgres` or cloud DB).
2. Copy `release/.env.example` → `release/.env` and set `DATABASE_URL`, `JWT_SECRET`, passwords.
3. Run `QTS_Startup.exe` (keep console open).
4. Run the Next.js UI separately (`admin-web`) or deploy a built UI elsewhere.
5. Load `release/extension` in Chrome.

**End users** of the `.exe` do not need Node.js; they **do** need PostgreSQL.

---

## Build — Docker

### Postgres only (local dev with external DB)

```bat
docker compose up -d postgres
```

### Full stack (API + Postgres)

```bat
docker compose up -d
```

This builds and runs:

- `qts-startup-postgres` on port 5432
- `qts-startup-app` (API) on port 1028

The Next.js UI is **not** included in Docker. Run `admin-web` separately or deploy it to a static/Node host.

### Build API image only

```bat
docker build -t qts-startup-server ./server
```

---

## Chrome extension setup

1. Start the API on port **1028**.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the `extension/` folder.
5. Open the extension popup on a job page.
6. Sign in with a **bidder** account (default username pre-filled: `user`).

### Extension requirements

- API reachable at `http://localhost:1028`
- A bidder account created by admin (**Admin → Bidders → Add account**)
- Account must be linked to an active bidder organization
- Extension login sends `extension: true`; only **bidder** role is accepted

### Supported job sites

LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workable, SmartRecruiters, Ashby, and generic career pages (JSON-LD heuristics).

---

## Accounts, roles, and first-time setup

### Seeded on first API start

| Role | Username | Password source |
|------|----------|-----------------|
| Admin | `admin` | `ADMIN_PASSWORD` in `.env` |
| Caller | `caller` | `CALLER_PASSWORD` in `.env` |

### Created by admin (not seeded)

| Role | How to create | Used by |
|------|---------------|---------|
| Bidder | **Admin → Bidders** → create org → add account | Web `/bidder` panel + Chrome extension |

### Recommended first-time workflow

1. Start servers (`npm start`).
2. Log in as **admin** at http://localhost:1027/login.
3. Create a **Bidder** organization under **Bidders**.
4. Add a bidder account (e.g. username `user`, password of your choice).
5. Add **candidates** under **Candidates** (assign to bidder if admin).
6. Load the extension and sign in as the bidder.
7. Visit a job posting and save via the extension.

---

## Verification checklist

Run these after a fresh build:

| Check | Command / URL | Expected |
|-------|---------------|----------|
| API health | http://localhost:1028/api/health | `{"success":true,"status":"online",...}` |
| UI loads | http://localhost:1027/login | Login form renders |
| API via proxy | http://localhost:1027/api/health | Same health JSON |
| Admin login | UI login with admin credentials | Redirect to `/admin` |
| Typecheck API | `cd server && npm run check` | Exit 0 |
| Typecheck UI | `cd admin-web && npx tsc --noEmit` | Exit 0 |
| Production UI build | `cd admin-web && npm run build` | Completes without error |

---

## Troubleshooting

### UI stuck on “Loading…” or login fails

**Cause:** API port mismatch.

- Confirm `server/.env` has `PORT=1028`.
- Confirm API is running: `http://localhost:1028/api/health`.
- Confirm `admin-web/.env.local` has `API_URL=http://127.0.0.1:1028`.

### Next.js dev server crashes on Windows

**Cause:** Turbopack instability on Windows.

**Fix:** Use webpack (already configured):

```json
"dev": "next dev -p 1027 --webpack"
```

If issues persist, delete `admin-web/.next` and restart.

### Port already in use

```bash
npm run stop
```

Or find and stop the process using ports 1027 / 1028.

### Extension: “No bidder accounts exist”

An admin must create a bidder org and account before extension login works.

### Extension: admin/caller cannot log in

By design. Extension accepts **bidder** accounts only. Use the web UI for admin/caller.

### PowerShell blocks `npm`

If `npm` is blocked by execution policy, use **Command Prompt** or adjust your PowerShell execution policy.

### Legacy SQLite data

See `UPGRADE.md` for migrating `server/data/jobs.db` to PostgreSQL.

---

## Recommendations

### Security

1. **Change `JWT_SECRET`** before any network exposure — use 32+ random characters.
2. **Change default passwords** (`ADMIN_PASSWORD`, `CALLER_PASSWORD`) immediately.
3. **Do not expose** the API directly to the public internet without HTTPS and a reverse proxy.
4. **Use `HOST=127.0.0.1`** for local-only development.
5. **Set `DATABASE_SSL=true`** for cloud-managed PostgreSQL.
6. **Never commit** `server/.env` to version control.

### Development

1. **Use `npm start`** from the project root for the least friction.
2. **Keep the repo on a local NTFS path** — avoid OneDrive/Dropbox synced folders (causes Next.js `.next` file locking).
3. **Use embedded PGlite** (`EMBEDDED_PG=true`) for fastest local setup.
4. **Run API and UI in separate terminals** when debugging to see logs clearly.
5. **Reload the extension** after code changes (`chrome://extensions` → Reload).

### Production

1. **Use external PostgreSQL** — do not rely on PGlite or embedded DB in production.
2. **Set `AUTO_OPEN_BROWSER=false`** on servers.
3. **Deploy UI and API** behind HTTPS (e.g. nginx reverse proxy).
4. **Back up the database** regularly via **Admin → Settings** or `pg_dump`.
5. **Pin Node.js version** (20 or 22 LTS) in your deployment environment.
6. **Run `npm ci`** instead of `npm install` in CI/CD for reproducible builds.

### Windows-specific

1. **Prefer webpack over Turbopack** for Next.js on Windows (already configured).
2. **Use `npm run stop`** before restarting to avoid port conflicts.
3. **For `.exe` distribution:** bundle PostgreSQL instructions or use Docker for end users.
4. **Add Windows Defender exclusion** for the project folder if `.next` builds are slow or fail with `EBUSY`.

### Extension / workflow

1. **Create bidder accounts** before rolling out the extension to users.
2. **Use username `user`** as the standard bidder account name if you rely on the extension default.
3. **Scope candidates per bidder** so each extension user only sees their own list.
4. **Train admins** to create bidders under **Bidders**, not generic **Users**, for correct org linkage.

### Upgrades

- Read `UPGRADE.md` before upgrading from SQLite or older port configurations.
- After pulling updates: `npm install` in both `server/` and `admin-web/`, then rebuild.
- If login breaks after upgrade, verify `PORT=1028` in `server/.env`.

---

## Quick reference

| Goal | Command |
|------|---------|
| Start everything | `npm start` |
| Stop everything | `npm run stop` |
| Dev UI | `cd admin-web && npm run dev` |
| Dev API | `cd server && npm run dev` |
| Build all | `cd server && npm run build` then `cd admin-web && npm run build` |
| Windows .exe | `build-exe.bat` |
| Docker stack | `docker compose up -d` |
| Migrate SQLite | `cd server && npm run migrate:sqlite` |

---

*QTS_Startup v1.2.0 — see also [README.md](README.md), [REQUIREMENTS.md](REQUIREMENTS.md), and [UPGRADE.md](UPGRADE.md).*
