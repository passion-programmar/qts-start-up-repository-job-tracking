# QTS Job Tracking — Project Usage Guide (Accounts & Roles)

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

This guide explains **who uses the system**, **how accounts are organized**, and **how to set up your team** from first login to daily work.

For technical setup (server, Vercel, Neon), see **`QTS-JOB-TRACKING-PROJECT-SETUP-GUIDE.md`**.

---

## Table of contents

1. [What this system does](#1-what-this-system-does)
2. [Account hierarchy](#2-account-hierarchy)
3. [The four roles](#3-the-four-roles)
4. [Who logs in where](#4-who-logs-in-where)
5. [First-time team setup](#5-first-time-team-setup)
6. [Daily usage by role](#6-daily-usage-by-role)
7. [Data access rules](#7-data-access-rules)
8. [Chrome extension usage](#8-chrome-extension-usage)
9. [Common workflows](#9-common-workflows)
10. [Account troubleshooting](#10-account-troubleshooting)

---

## 1. What this system does

QTS Job Tracking helps a recruiting team:

- **Capture job postings** from job sites (LinkedIn, Indeed, etc.) via a Chrome extension
- **Organize candidates** under bidder teams
- **Track applications and jobs** per candidate
- **Record interview progress** with caller accounts
- **View dashboards** for admins and managers

```text
Admin  →  oversees entire platform
Manager  →  runs bidder teams
Bidder  →  captures jobs (extension + web)
Caller  →  logs interviews
```

---

## 2. Account hierarchy

Accounts are organized in a tree:

```text
Admin
 │
 ├── Manager (login account)
 │    │
 │    └── Bidder Organization (team/company name)
 │         │
 │         ├── Bidder login  →  uses Chrome extension to save jobs
 │         ├── Candidates    →  people applying for jobs
 │         └── Caller login  →  tracks interviews (optional)
 │
 └── Caller accounts may also appear in the admin People view
```

### Key concepts

| Term | Meaning |
|------|---------|
| **Login account** | Username + password stored in the system (`admins` table) |
| **Role** | What the account can do: `admin`, `manager`, `bidder`, or `caller` |
| **Bidder organization** | A team/company unit (e.g. "Team Alpha"). Not the same as a login. |
| **Bidder login** | A user account with role `bidder`, linked to one bidder organization |
| **Candidate** | A person your team applies for jobs on behalf of |

**Important:** A **bidder organization** must exist before a **bidder login** can sign in. The extension will reject logins that are not linked to an active organization.

---

## 3. The four roles

### Admin

| | |
|---|---|
| **Who** | Team lead, operations owner |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/admin` |
| **Created how** | Auto-created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `server/.env.cloud` on first API start |

**Can do:**
- See all jobs, candidates, interviews, and bidders
- Add and edit **managers** (People page)
- Change platform settings (UI mode, candidate stacks, backups)
- Full read/write on all data

**Navigation (depends on UI mode):**
- Dashboard / Analytics / Overview
- Jobs
- People (managers + org tree)
- Interviews
- Settings

---

### Manager

| | |
|---|---|
| **Who** | Team lead for one or more bidder groups |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/manager` |
| **Created how** | Admin creates in **People → + Add Manager** |

**Can do:**
- Create **bidder organizations** assigned to themselves
- Create **bidder login accounts** and passwords for each organization
- Add and edit **candidates** under their bidders
- View jobs and interviews for their team's scope only
- Dashboard and analytics for their bidders

**Navigation:**
- Dashboard
- Jobs
- Bidders (org tree: bidder → candidates)
- Interviews

**Cannot do:**
- Create other managers
- Change global settings
- See other managers' bidders

---

### Bidder

| | |
|---|---|
| **Who** | Job researcher — captures postings and applies for candidates |
| **Login — extension** | Chrome extension popup (primary workflow) |
| **Login — web** | https://qts-job-tracking.vercel.app/login → `/bidder` |
| **Created how** | Manager creates when adding a bidder organization (username + password) |

**Can do:**
- **Extension:** capture jobs from supported job sites, assign to candidates
- **Web:** view dashboard and jobs for their organization
- Add jobs via extension while browsing

**Cannot do:**
- Log into extension with admin/manager/caller accounts
- Add or edit candidates on web (manager handles candidates)
- See other bidders' data

---

### Caller

| | |
|---|---|
| **Who** | Interview coordinator |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/caller` |
| **Created how** | Added as a login account under a bidder organization (caller role) |

**Can do:**
- Add and view **interview records**
- See interviews assigned to them

**Cannot do:**
- Use the Chrome extension for job capture
- Manage bidders or candidates
- Edit/delete interviews created by others (admin handles full edits)

---

## 4. Who logs in where

| Role | Web admin UI | Chrome extension |
|------|:------------:|:----------------:|
| Admin | Yes | No |
| Manager | Yes | No |
| Bidder | Yes (limited) | **Yes (primary)** |
| Caller | Yes | No |

### Web login (all roles except extension-only bidders)

1. Open https://qts-job-tracking.vercel.app/login
2. Enter username and password
3. System redirects automatically:

| Role | After login |
|------|-------------|
| Admin | `/admin` |
| Manager | `/manager` |
| Bidder | `/bidder` |
| Caller | `/caller` |

### Extension login (bidders only)

1. Open the QTS extension popup
2. **API Server URL:** `https://qts-job-tracking.vercel.app`
3. Enter **bidder** username and password
4. If login fails: manager must create the bidder org + account first

---

## 5. First-time team setup

Follow this order when building a new team from scratch.

### Step 1 — Start the server

Run `start-server.bat` and wait until you see **QTS SERVER IS RUNNING**.  
(See setup guide for details.)

### Step 2 — Admin first login

1. Go to https://qts-job-tracking.vercel.app/login
2. Use credentials from `server/.env.cloud`:
   - `ADMIN_USERNAME` (default: `admin`)
   - `ADMIN_PASSWORD` (your chosen password)

### Step 3 — Create managers

1. Admin → **People**
2. Click **+ Add Manager**
3. Enter username and password
4. Save

Repeat for each team lead.

### Step 4 — Manager sets up bidder teams

1. Manager logs in at the web login URL
2. Go to **Bidders**
3. Click **+ Add Bidder** (or equivalent)
4. Fill in:
   - Organization name (e.g. "John's Team")
   - Bidder login username
   - Bidder login password
5. Save

### Step 5 — Manager adds candidates

Still in **Bidders**, under each organization:

1. Expand the bidder in the tree
2. **+ Add Candidate**
3. Enter name, email, stack, color, etc.
4. Save

Candidates must exist before bidders can assign jobs to them in the extension.

### Step 6 — Bidder uses the extension

1. Install extension: Chrome → `chrome://extensions` → Load unpacked → `extension/` folder
2. Open extension popup
3. API URL: `https://qts-job-tracking.vercel.app`
4. Login with bidder username/password
5. Browse a job posting → capture and assign to a candidate

### Step 7 — Optional: add callers

From the bidder organization (manager or admin):

1. Open bidder details
2. Add a **caller** login account
3. Caller logs in at web URL → **Interviews** → add interview records

---

## 6. Daily usage by role

### Admin — daily

- Check dashboard for team activity
- Add/remove managers as team grows
- Review all jobs and interviews
- Adjust settings if needed
- Ensure `start-server.bat` is running on the host PC

### Manager — daily

- Review bidder team performance on dashboard
- Add new candidates when team expands
- Create new bidder logins for new researchers
- Monitor jobs captured by bidders
- Review interview pipeline

### Bidder — daily

1. Open Chrome with extension loaded
2. Log in via extension (once per session)
3. Visit job postings on LinkedIn, Indeed, Glassdoor, etc.
4. Use extension to capture job details
5. Select candidate and save
6. Optionally check `/bidder/jobs` on web to review saved jobs

### Caller — daily

1. Log in at web URL
2. Open **Interviews**
3. Add or update interview records for candidates
4. Track stages and dates

---

## 7. Data access rules

Each role only sees data in their scope.

| Data | Admin | Manager | Bidder | Caller |
|------|:-----:|:-------:|:------:|:------:|
| All jobs | All | Own managers' bidders | Own org only | — |
| All candidates | All | Own managers' bidders | Own org (read) | — |
| All interviews | All | Own managers' bidders | — | Own records |
| All bidders | All | Assigned to self | Own org only | — |
| Settings | Yes | No | No | No |
| Create managers | Yes | No | No | No |
| Create bidder orgs | Yes | Yes (own) | No | No |
| Create candidates | Yes | Yes (own bidders) | No | No |
| Capture jobs (extension) | No | No | Yes | No |

**Scoping logic:**
- **Manager** → sees bidders where `manager_id` = their account ID
- **Bidder** → sees data where `bidder_id` = their linked organization
- **Caller** → sees interviews where `caller_user_id` = their account ID

---

## 8. Chrome extension usage

> **Full bidder guide:** see **`QTS-JOB-TRACKING-EXTENSION-GUIDE.md`** for install, login, capture workflow, supported sites, and troubleshooting.

### Who should use it

**Bidders only.** Admin, manager, and caller accounts are rejected at extension login.

### Setup (once per user)

| Setting | Value |
|---------|-------|
| API Server URL | `https://qts-job-tracking.vercel.app` |
| Username | Bidder login (from manager) |
| Password | Bidder password (from manager) |

### Typical capture flow

1. Bidder opens a job posting page (LinkedIn, Indeed, etc.)
2. Clicks the QTS extension icon
3. Extension extracts job title, company, URL, description
4. Bidder selects which **candidate** this job is for
5. Saves — job appears in admin/manager/bidder job lists

### Requirements

- `start-server.bat` must be running on the host PC
- Vercel health check must pass: `/api/health` returns online
- Bidder account must be linked to an **active** bidder organization

---

## 9. Common workflows

### Workflow A — New bidder researcher joins

```text
Manager → Bidders → + Add Bidder org
        → set username + password
        → + Add Candidate(s)
Bidder  → install extension → login → start capturing jobs
```

### Workflow B — New manager joins the company

```text
Admin   → People → + Add Manager
Manager → login → Bidders → build their teams
```

### Workflow C — Interview tracking starts for a candidate

```text
Manager → ensure candidate exists under bidder
Admin/Manager → add caller account under bidder (if needed)
Caller  → login → Interviews → + Add interview
```

### Workflow D — Admin reviews everything

```text
Admin → Dashboard (stats)
      → Jobs (all captured jobs)
      → People (manager tree)
      → Interviews (all records)
      → Settings (UI mode, stacks, backup)
```

### Workflow E — After PC restart

```text
1. stop-server.bat
2. start-server.bat
3. sync-vercel-api-url.bat  (if login fails)
4. All users continue at same web URL
```

---

## 10. Account troubleshooting

### "Invalid credentials" at web login

- Check username/password spelling
- Admin password is from `server/.env.cloud` → `ADMIN_PASSWORD`
- Other accounts are created in the People / Bidders UI

### Extension: "requires a bidder account"

- You logged in with admin, manager, or caller
- Use a **bidder** username/password instead

### Extension: "not linked to a bidder organization"

- Manager must create the bidder org and link the login
- Go to Manager → Bidders → create or edit the organization

### Extension: "bidder organization is inactive"

- Manager or admin must set the bidder org to **active**

### Extension: "No bidder accounts exist yet"

- No bidder org + login has been created
- Manager must complete Step 4 in [First-time team setup](#5-first-time-team-setup)

### Login page loads but login fails (502 / 530)

- API server is down → run `start-server.bat`
- Tunnel URL changed → run `sync-vercel-api-url.bat`
- Test: https://qts-job-tracking.vercel.app/api/health

### Manager cannot see any bidders

- Bidders must be assigned to that manager
- Admin creates bidders with a manager selected, or manager creates their own

### Bidder cannot see candidates in extension

- Manager must add candidates under that bidder organization first
- Candidate must be **active**

---

## Quick reference card

```text
┌─────────────────────────────────────────────────────────────┐
│  QTS JOB TRACKING — ACCOUNTS QUICK REFERENCE                │
├─────────────────────────────────────────────────────────────┤
│  Web login:  https://qts-job-tracking.vercel.app/login      │
│  Extension:  https://qts-job-tracking.vercel.app            │
├─────────────────────────────────────────────────────────────┤
│  Admin    → People → add managers → see everything          │
│  Manager  → Bidders → add teams, candidates, bidder logins│
│  Bidder   → Extension → capture jobs for candidates         │
│  Caller   → Interviews → track interview progress           │
├─────────────────────────────────────────────────────────────┤
│  Setup order: Admin → Manager → Bidder org → Candidates     │
│               → Bidder extension login → Jobs captured      │
└─────────────────────────────────────────────────────────────┘
```

---

## Related guides

| Guide | Purpose |
|-------|---------|
| `QTS-JOB-TRACKING-PROJECT-SETUP-GUIDE.md` | Install, deploy, start server, Vercel, Neon |
| `QTS-JOB-TRACKING-EXTENSION-GUIDE.md` | Chrome extension — install, login, capture jobs |
| `QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md` | Speed optimization — Vercel, extension, API |
| `BUILD.md` | Developer build reference |
| `REQUIREMENTS.md` | Full technical requirements |

---

*Last updated for QTS Job Tracking v1.2.0 — Admin / Manager / Bidder / Caller account model.*
