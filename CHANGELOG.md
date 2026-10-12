# Changelog

## QTS_Startup

### 1.13.28 — 2026-10-12

- **Manager PDFs:** Accept one application JSON object with shared candidate/job details and separate resume and cover-letter content to generate both PDFs together.

### 1.13.27 — 2026-10-11

- **Manager PDFs:** Assign resume and cover-letter templates per Account, then save both PDFs together in a timestamped job folder with duplicate-application checks.

### 1.13.26 — 2026-10-11

- **Manager PDFs:** Match pasted `candidate.fullName` to an Account, load and save each Account's default resume template, and generate QTS cover-letter previews and PDFs.

### 1.13.25 — 2026-06-29

- **Job sites:** Admin → Jobs → Job sites — manually add sources (`platform_key`, URL host).
- **Account admission:** Admin admits account per site with default candidate; account Jobs panel lists sites + jobs.
- **Extension:** Fix duplicate `PROCESS_TASK` send (submit lock, no re-insert fallback).
- **Custom GPT:** Final reply **"Confirmed."** only (update GPT instructions).
- **Docs:** [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) canonical architecture reference.

### 1.2.5

- Extension opens a **dedicated capture window** on icon click (no toolbar `default_popup`).
- Capture window reuses one instance, docks beside the browser, and switches job tabs without a full reload when possible.
- Job extraction always targets the source job tab, not the capture window.

### 1.2.0

- Next.js admin UI with role-based panels (admin, account, caller)
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
