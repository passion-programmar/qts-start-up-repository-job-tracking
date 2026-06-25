# QTS Job Tracking — Full Setup Guide

Use this guide to build and run the project from scratch on a new PC.

**Your production setup (free, no credit card):**

```text
Chrome Extension  ──┐
Admin Web UI      ├──▶  Vercel (UI only)  ──▶  Cloudflare tunnel  ──▶  API on your PC  ──▶  Neon PostgreSQL
                    │
              start-server.bat keeps API + tunnel alive
```

| Part | Where it runs | Cost |
|------|----------------|------|
| Admin UI | Vercel | Free |
| API | Your Windows PC | Free |
| Public API URL | Cloudflare quick tunnel | Free |
| Database | Neon | Free |

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Get the code](#2-get-the-code)
3. [Install dependencies](#3-install-dependencies)
4. [Database — Neon PostgreSQL](#4-database--neon-postgresql)
5. [API config — server/.env.cloud](#5-api-config--serverenvcloud)
6. [Deploy Admin UI — Vercel](#6-deploy-admin-ui--vercel)
7. [Vercel CLI login (one-time)](#7-vercel-cli-login-one-time)
8. [Start the server (daily)](#8-start-the-server-daily)
9. [Chrome extension](#9-chrome-extension)
10. [Local development (optional)](#10-local-development-optional)
11. [Daily workflow cheat sheet](#11-daily-workflow-cheat-sheet)
12. [Troubleshooting](#12-troubleshooting)
13. [Important files](#13-important-files)

---

## 1. Prerequisites

Install on the PC that will run the API:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 20 LTS or 22 LTS | https://nodejs.org/ |
| **Git** | Latest | https://git-scm.com/ (optional) |

Verify:

```bat
node -v
npm -v
```

Accounts needed (all free):

| Service | Purpose | Sign up |
|---------|---------|---------|
| **Neon** | PostgreSQL database | https://neon.tech |
| **Vercel** | Host admin web UI | https://vercel.com |
| **Cloudflare** | Tunnel (auto via `cloudflared`) | No account needed for quick tunnel |

---

## 2. Get the code

Clone or copy the project folder, e.g.:

```text
C:\job-capture-system\
```

Folder structure (key parts):

```text
job-capture-system/
├── start-server.bat          ← main entry (production)
├── stop-server.bat
├── sync-vercel-api-url.bat   ← fix login after tunnel URL changes
├── server/                   ← Express API
├── admin-web/                ← Next.js UI (deployed to Vercel)
├── extension/                ← Chrome extension
├── scripts/
│   ├── start-cloud-tunnel.ps1
│   └── sync-vercel-api-url.ps1
└── logs/                     ← all runtime logs go here
```

---

## 3. Install dependencies

Open **Command Prompt** in the project folder and run:

```bat
cd C:\path\to\job-capture-system

npm install
cd server
npm ci
cd ..\admin-web
npm ci
cd ..
```

Or use the setup script:

```bat
npm run setup
```

This installs root, server, and admin-web packages. The first `start-server.bat` run also installs the local Vercel CLI if missing.

---

## 4. Database — Neon PostgreSQL

1. Go to https://neon.tech → **New project**
2. Copy the connection string (`DATABASE_URL`), e.g.:

```text
postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require
```

3. Keep this for the next step.

Neon is always online. The API on your PC connects to it over the internet.

---

## 5. API config — server/.env.cloud

Create `server/.env.cloud` (this file is **not** committed to git).

Copy from the example:

```bat
copy server\.env.cloud.example server\.env.cloud
```

Edit `server/.env.cloud`:

```env
EMBEDDED_PG=false
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.neon.tech/neondb?sslmode=require
DATABASE_SSL=true
DATABASE_POOL_MAX=10

PORT=1028
HOST=127.0.0.1
NODE_ENV=production
AUTO_OPEN_BROWSER=false

JWT_SECRET=use-a-long-random-string-here
JWT_EXPIRY=24h

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-admin-password
MANAGER_USERNAME=manager
MANAGER_PASSWORD=user
BIDDER_USERNAME=bidder
BIDDER_PASSWORD=user
CALLER_USERNAME=caller
CALLER_PASSWORD=user

ADMIN_WEB_URL=https://qts-job-tracking.vercel.app/login
```

Replace:

- `DATABASE_URL` — your Neon connection string
- `JWT_SECRET` — long random string
- `ADMIN_PASSWORD` — your admin login password
- `ADMIN_WEB_URL` — your Vercel app URL + `/login`

When `start-server.bat` runs, it copies `.env.cloud` → `.env` automatically.

---

## 6. Deploy Admin UI — Vercel

### First-time Vercel project

1. Push code to GitHub (or import folder)
2. Go to https://vercel.com → **Add New Project**
3. Import the repository
4. Set **Root Directory** to: `admin-web`
5. Add environment variable:

| Name | Value |
|------|-------|
| `API_URL` | `http://127.0.0.1:1028` (placeholder — updated by sync script) |

6. Deploy

After deploy you get a URL like: `https://qts-job-tracking.vercel.app`

Update `ADMIN_WEB_URL` in `server/.env.cloud` to match.

### How Vercel connects to your API

`admin-web/next.config.ts` rewrites `/api/*` to `process.env.API_URL`.  
When you start the server, `start-server.bat` syncs `API_URL` to your current Cloudflare tunnel URL and redeploys.

---

## 7. Vercel CLI login (one-time)

The start script uses a **local** Vercel CLI (not `npx`) at `node_modules\.bin\vercel.cmd`.

Log in once:

```bat
cd C:\path\to\job-capture-system
npx vercel login
```

Or after `npm install`:

```bat
node_modules\.bin\vercel.cmd login
```

Link the project to your Vercel app (run inside `admin-web`):

```bat
cd admin-web
..\node_modules\.bin\vercel.cmd link
```

Select your team and project (`qts-job-tracking`).

---

## 8. Start the server (daily)

### Production start

**Double-click** `start-server.bat` from File Explorer (recommended).

Or from Command Prompt:

```bat
start-server.bat
```

What it does:

1. Stops any old API/tunnel
2. Starts API on `http://localhost:1028`
3. Starts Cloudflare quick tunnel (new public HTTPS URL each restart)
4. Syncs tunnel URL to Vercel `API_URL` and redeploys
5. Keeps running until you close the window or press Ctrl+C

**Wait ~2 minutes** for Vercel sync. Window must show:

```text
============================================
  QTS SERVER IS RUNNING
============================================
```

**Do not close this window** while users need access.

### Stop the server

```bat
stop-server.bat
```

### Fix login after restart

Each restart gets a **new tunnel URL**. If login fails:

1. Keep `start-server.bat` window **open**
2. Run `sync-vercel-api-url.bat`
3. Wait ~2 minutes
4. Test: https://qts-job-tracking.vercel.app/api/health

### Health checks

| URL | Expected |
|-----|----------|
| http://127.0.0.1:1028/api/health | `{"success":true,"status":"online"}` |
| https://qts-job-tracking.vercel.app/api/health | Same (proves Vercel → tunnel → API works) |

---

## 9. Chrome extension

### Load extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder

### Configure API URL

Default is already set to your Vercel URL:

```text
https://qts-job-tracking.vercel.app
```

In the extension login popup, **API Server URL** should be the Vercel URL (no `/api/health`).

Each bidder logs in with credentials created by a manager in the admin panel.

### Reload after code changes

On `chrome://extensions` → click **Reload** on the extension.

---

## 10. Local development (optional)

For development on one PC without Vercel/tunnel:

```bat
start.bat
```

| Service | URL |
|---------|-----|
| Admin UI | http://localhost:1027/login |
| API | http://localhost:1028/api/health |

Uses embedded PostgreSQL (`EMBEDDED_PG=true` in `server/.env`).

Stop:

```bat
stop.bat
```

Extension API URL for local dev: `http://localhost:1028`

---

## 11. Daily workflow cheat sheet

```text
MORNING / PC STARTUP
────────────────────
1. Double-click start-server.bat
2. Wait ~2 minutes
3. Check https://qts-job-tracking.vercel.app/api/health
4. If 502/530 → run sync-vercel-api-url.bat
5. Login: https://qts-job-tracking.vercel.app/login

DURING THE DAY
──────────────
• Keep start-server.bat window OPEN
• Extension URL: https://qts-job-tracking.vercel.app

EVENING / SHUTDOWN
──────────────────
• Closing start-server.bat stops API + tunnel
• Login will not work until you start again

AFTER RESTART
─────────────
• New tunnel URL every time
• start-server.bat auto-syncs Vercel (or run sync-vercel-api-url.bat)
```

---

## 12. Troubleshooting

### start-server.bat closes immediately

- Run from **File Explorer** double-click, not Cursor terminal
- Check `logs\start-server-last.log`

### START FAILED

| Log file | What it shows |
|----------|----------------|
| `logs\start-server-last.log` | Full startup transcript |
| `logs\api-cloud.err-*.log` | API crash reason (newest file) |
| `logs\tunnel-cloud.err-*.log` | Tunnel issues |

Common fixes:

```bat
stop-server.bat
cd server
rmdir /s /q node_modules
npm ci
cd ..
start-server.bat
```

### Login page loads but login fails (502 / 530)

- API or tunnel is down → run `start-server.bat`
- Vercel has old tunnel URL → run `sync-vercel-api-url.bat`
- Test: https://qts-job-tracking.vercel.app/api/health

### "Server already running" but login fails

API may be up without tunnel. Run:

```bat
stop-server.bat
start-server.bat
sync-vercel-api-url.bat
```

### Vercel sync failed

```bat
npm install vercel@54.17.1 --save-dev
sync-vercel-api-url.bat
```

### API: Cannot find module 'debug'

Corrupted `server/node_modules`. Fix:

```bat
cd server
rmdir /s /q node_modules
npm ci
cd ..
start-server.bat
```

### CORS / login errors with Vercel

Ensure `ADMIN_WEB_URL` in `server/.env.cloud` matches your Vercel URL. Rebuild API if needed:

```bat
cd server
npm run build
cd ..
```

---

## 13. Important files

| File | Purpose |
|------|---------|
| `start-server.bat` | Start API + tunnel + Vercel sync |
| `stop-server.bat` | Stop everything |
| `sync-vercel-api-url.bat` | Update Vercel after tunnel URL change |
| `server/.env.cloud` | Production secrets (Neon, passwords) |
| `tunnel-url.txt` | Current public tunnel URL |
| `logs/` | All log files |
| `admin-web/` | Next.js UI (Vercel root) |
| `extension/` | Chrome extension source |

### Scripts reference

| Script | When to use |
|--------|-------------|
| `start-server.bat` | Production — every day |
| `stop-server.bat` | Stop server |
| `sync-vercel-api-url.bat` | Login broken after restart |
| `start.bat` | Local dev only |
| `start-cloud-tunnel.bat` | Tunnel only, no Vercel sync |

---

## Rebuild from scratch checklist

Use this when setting up on a **new PC**:

- [ ] Install Node.js 20+
- [ ] Copy/clone project folder
- [ ] `npm install` + `npm ci` in `server/` and `admin-web/`
- [ ] Create Neon database, copy `DATABASE_URL`
- [ ] Create `server/.env.cloud` from example
- [ ] Deploy `admin-web` to Vercel (root dir = `admin-web`)
- [ ] `vercel login` + `vercel link` in admin-web
- [ ] Double-click `start-server.bat`, wait 2 min
- [ ] Verify `/api/health` on Vercel URL
- [ ] Load `extension/` in Chrome
- [ ] Login as admin, create manager/bidder accounts

---

## URLs (your deployment)

| What | URL |
|------|-----|
| Admin login | https://qts-job-tracking.vercel.app/login |
| Extension API URL | https://qts-job-tracking.vercel.app |
| Local API (dev) | http://localhost:1028 |
| Local UI (dev) | http://localhost:1027 |

Replace with your own Vercel URL if you deploy a new project.

---

*Last updated for QTS Job Tracking v1.2.0 — PC + Cloudflare tunnel + Vercel + Neon setup.*
