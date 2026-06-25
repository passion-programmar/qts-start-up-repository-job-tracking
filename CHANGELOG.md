# Changelog

## QTS_Startup

### 1.2.5

- Extension opens a **dedicated capture window** on icon click (no toolbar `default_popup`).
- Capture window reuses one instance, docks beside the browser, and switches job tabs without a full reload when possible.
- Job extraction always targets the source job tab, not the capture window.

### 1.2.0

- Next.js admin UI with role-based panels (admin, bidder, caller)
- PostgreSQL with embedded PGlite for local dev
- Ports: UI `1027`, API `1028`

### 1.1.0 — 2026-06-24

- Open QTS_Startup automatically when the server starts.
- Redirect the server root to the admin dashboard.
- Add full candidate status editing to job details.
- Add candidate job-history viewing.
- Add accurate dashboard statistics.
- Use Node.js built-in SQLite instead of `better-sqlite3`.
- Use pure-JavaScript `bcryptjs` instead of native Argon2.
- Remove the Windows Python and Visual Studio build-tool requirement.
- Add a Windows `start-server.bat` launcher.
- Make `npm start` compile TypeScript before starting.
