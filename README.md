# QTS_Startup v1.2.0

A Chrome/Edge extension with a local Node.js server for capturing job postings and tracking candidates, bidders, and interviews with **QTS_Startup**.

> **Requirements & planning:** see [REQUIREMENTS.md](REQUIREMENTS.md) for full product, technical, and feature requirements.  
> **Build & deploy:** see [BUILD.md](BUILD.md) for environment setup and operations.  
> **Extension (bidders):** see [QTS-JOB-TRACKING-EXTENSION-GUIDE.md](QTS-JOB-TRACKING-EXTENSION-GUIDE.md) for install, login, and job capture workflow.  
> **Performance:** see [QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md](QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md) for speed optimization (Vercel, extension, API).

## Features

- **Role-based web UI** — admin, manager, bidder, and caller panels
- **Chrome extension** — capture jobs from LinkedIn, Indeed, Greenhouse, and more
- **PostgreSQL** — embedded PGlite for local dev, or external PostgreSQL for production
- **Bidder organizations** — scoped candidates and jobs per bidder account
- **Interview tracking** — scheduled interviews with caller assignments

## Requirements

- Windows 10/11, macOS, or Linux
- Node.js 20 or newer
- Chrome, Edge, Brave, or another Chromium browser
- PostgreSQL 14+ (optional — embedded PGlite is used by default for local dev)

## Quick start

**Windows:** double-click `start.bat`

**macOS / Linux:**

```bash
chmod +x start.sh
./start.sh
```

**Or from the project root:**

```bash
npm install
npm start
```

This starts both:

- **QTS_Startup UI** on http://localhost:1027/login
- **API server** on http://localhost:1028/api

Press `Ctrl+C` in the terminal to stop both, or run `stop.bat` / `npm run stop`.

Default accounts (configured in `server/.env`):

| Role    | Username | Default password |
|---------|----------|------------------|
| Admin   | admin    | see `.env`       |
| Manager | manager  | user             |
| Bidder  | bidder   | user             |
| Caller  | caller   | user             |

The seeded bidder account is linked to the **Default Bidder** organization. Admins can create additional bidder orgs and accounts under **Admin → Bidders**.

## Manual start (separate terminals)

```bat
cd admin-web
npm install
npm run dev

cd ..\server
npm install
npm start
```

## Install the extension

Full step-by-step guide: **[QTS-JOB-TRACKING-EXTENSION-GUIDE.md](QTS-JOB-TRACKING-EXTENSION-GUIDE.md)**

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Log in with the bidder account from your manager (username and password from QTS).
5. Add candidates in QTS_Startup (admin or bidder panel).
6. Open a job listing in your browser and click the **QTS_Startup** extension icon.

## Panels

| Role    | URL prefix              | Access |
|---------|-------------------------|--------|
| Admin   | `/admin`                | Full CRUD, bidders, users, settings |
| Manager | `/manager`              | Team bidders, candidates, jobs, interviews (read-focused) |
| Bidder  | `/bidder`               | Add jobs/candidates, view own data |
| Caller  | `/caller`               | Add interview records, view own interviews |

## Database

Local development uses embedded PostgreSQL (PGlite) by default:

```env
EMBEDDED_PG=true
```

Data is stored in `server/data/pglite/`.

For external PostgreSQL:

```env
EMBEDDED_PG=false
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qts_startup
```

Start PostgreSQL with Docker:

```bat
docker compose up -d postgres
```

## Environment configuration

See `server/.env.example`. Key settings:

```env
PORT=1028
HOST=127.0.0.1
ADMIN_WEB_URL=http://localhost:1027/login
JWT_SECRET=replace-with-a-long-random-secret-change-this-in-production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password
```

## Docker (API only)

```bat
docker compose up -d
```

Runs the API on port 1028. Run the Next.js UI separately on port 1027 for full functionality.

## Windows .exe

```bat
build-exe.bat
```

Produces `release/QTS_Startup.exe` (API server). Requires PostgreSQL — set `DATABASE_URL` in a `.env` file next to the executable.

## Project structure

```text
QTS_Startup/
├── package.json        npm start / npm run stop
├── start.bat           Run server (Windows)
├── stop.bat            Stop server (Windows)
├── start.sh            Run server (macOS/Linux)
├── scripts/            setup + stop helpers
├── admin-web/          Next.js UI (port 1027)
├── server/             Express API (port 1028)
├── extension/          Chrome extension
├── docker-compose.yml
└── build-exe.bat
```

## Useful commands

```bash
npm install
npm start
npm run stop
npm run build
```
