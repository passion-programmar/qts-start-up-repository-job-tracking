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
- **Organize candidates** under account teams
- **Track applications and jobs** per candidate
- **Record interview progress** with caller accounts
- **View dashboards** for admins and managers

```text
Super   →  manages Admin accounts and system settings
Admin   →  manages Manager accounts
Manager →  manages Account teams and uses the extension
Account →  team and candidate scope (legacy role name: account)
Caller  →  logs interviews
```

---

## 2. Account hierarchy

Accounts are organized in a tree:

```text
Super
 │
 ├── Admin (login account; created by Super)
 │    │
 │    └── Manager (login account; created by Admin)
 │         │
 │         └── Account team (created and managed by Manager)
 │         │
 │         ├── Candidates    →  people applying for jobs
 │         └── Manager uses extension to capture jobs for this team
 │
 └── Caller accounts are managed by Admin or Super
```

### Key concepts

| Term | Meaning |
|------|---------|
| **Login account** | Username + password stored in the system (`admins` table) |
| **Role** | What the account can do: `super`, `admin`, `manager`, `account` (shown as Account), or `caller` |
| **Account team** | A team/company unit (e.g. "Team Alpha"), stored in the `accounts` table |
| **Account login** | A user account with the legacy role `account`, linked to one Account team |
| **Candidate** | A person your team applies for jobs on behalf of |

**Important:** `ADMIN_USERNAME` / `ADMIN_PASSWORD` seed the initial Super account. Super creates Admins; Admin creates Managers; Managers create Account teams. Only Managers sign into the extension and select an assigned Account team after login.

---

## 3. The five roles

### Super

| | |
|---|---|
| **Who** | System owner |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/admin` |
| **Created how** | Seeded from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `server/.env.cloud` on first API start |

**Can do:**
- Create, edit, and delete **Admin** accounts
- Full access to system settings and data

**Navigation (depends on UI mode):**
- Dashboard / Analytics / Overview
- Jobs
- People (managers + org tree)
- Interviews
- Settings

---

### Admin

Super creates, edits, and deletes Admin accounts. Admins create and manage Managers. System settings and Account team management are Super-only.

---

### Manager

| | |
|---|---|
| **Who** | Team lead for one or more Account teams |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/manager` |
| **Created how** | Admin creates in **People → + Add Manager** |

**Can do:**
- Create, edit, and delete **Account teams** assigned to themselves
- Add and edit **candidates** under their Accounts
- View jobs and interviews for their team's scope only
- Dashboard and analytics for their accounts
- Sign into the extension and select an assigned Account team after login

**Navigation:**
- Dashboard
- Jobs
- Accounts (org tree: account → candidates)
- Interviews

**Cannot do:**
- Create other managers
- Change global settings
- See other managers' accounts

---

### Account

| | |
|---|---|
| **Who** | Team identity and scope for candidates and captured jobs |
| **Login — web** | https://qts-job-tracking.vercel.app/login → legacy `/account` route |
| **Created how** | Manager creates an Account team and its username/password |

**Can do:**
- View jobs and candidates for the linked Account team

**Cannot do:**
- Sign into the extension (Managers sign in and select this team)
- Add or edit candidates
- See other Accounts' data

---

### Caller

| | |
|---|---|
| **Who** | Interview coordinator |
| **Login URL** | https://qts-job-tracking.vercel.app/login |
| **Panel** | `/caller` |
| **Created how** | Added as a login under an Account team (Caller role) |

**Can do:**
- Add and view **interview records**
- See interviews assigned to them

**Cannot do:**
- Use the Chrome extension for job capture
- Manage accounts or candidates
- Edit/delete interviews created by others (admin handles full edits)

---

## 4. Who logs in where

| Role | Web admin UI | Chrome extension |
|------|:------------:|:----------------:|
| Admin | Yes | No |
| Manager | Yes | No |
| Account | Yes (limited) | **Yes (primary)** |
| Caller | Yes | No |

### Web login

1. Open https://qts-job-tracking.vercel.app/login
2. Enter username and password
3. System redirects automatically:

| Role | After login |
|------|-------------|
| Super | `/admin` |
| Admin | `/admin` |
| Manager | `/manager` |
| Account | `/account` (legacy route) |
| Caller | `/caller` |

### Extension login (Managers only)

1. Open the QTS extension popup
2. **API Server URL:** `https://qts-job-tracking.vercel.app`
3. Enter your **Manager** username and password
4. After login, select an assigned **Account** team and candidate

---

## 5. First-time team setup

Follow this order when building a new team from scratch.

### Step 1 — Start the server

Run `start-server.bat` and wait until you see **QTS SERVER IS RUNNING**.  
(See setup guide for details.)

### Step 2 — Admin first login

1. Go to https://qts-job-tracking.vercel.app/login
2. Use credentials from `server/.env.cloud`:
   - `ADMIN_USERNAME` (default: `super`)
   - `ADMIN_PASSWORD` (your chosen password)

### Step 3 — Create managers

1. Admin → **People**
2. Click **+ Add Manager**
3. Enter username and password
4. Save

Repeat for each team lead.

### Step 4 — Manager sets up Account teams

1. Manager logs in at the web login URL
2. Go to **Accounts**
3. Click **+ Add Account**
4. Fill in:
   - Account team name (e.g. "John's Team")
   - Account login password
5. Save

### Step 5 — Manager adds candidates

Still in **Accounts**, under each organization:

1. Expand the account in the tree
2. **+ Add Candidate**
3. Enter name, email, stack, color, etc.
4. Save

Candidates must exist under the Account team before the Manager selects them in the extension.

### Step 6 — Manager uses the extension

1. Install extension: Chrome → `chrome://extensions` → Load unpacked → `extension/` folder
2. Open extension popup
3. API URL: `https://qts-job-tracking.vercel.app`
4. Log in with Manager username/password.
5. Choose an assigned Account team, then select the default candidate.
6. Browse a job posting → capture and assign to a candidate

### Step 7 — Optional: add callers

From the Account team (Manager or Admin):

1. Open account details
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

- Review account team performance on dashboard
- Add new candidates when team expands
- Create new account logins for new researchers
- Monitor jobs captured by accounts
- Review interview pipeline

### Account — daily

1. Open Chrome with extension loaded
2. Log in via extension (once per session)
3. Visit job postings on LinkedIn, Indeed, Glassdoor, etc.
4. Use extension to capture job details
5. Select candidate and save
6. Optionally check `/account/jobs` on web to review saved jobs

### Caller — daily

1. Log in at web URL
2. Open **Interviews**
3. Add or update interview records for candidates
4. Track stages and dates

---

## 7. Data access rules

Each role only sees data in their scope.

| Data | Super | Admin | Manager | Account | Caller |
|------|:-----:|:-----:|:-------:|:-------:|:------:|
| All jobs | All | All | Assigned teams | Own team | — |
| Candidates | All | All | Assigned teams | Own team (read) | — |
| Interviews | All | All | Assigned teams | — | Own records |
| System settings | Manage | Read | No | No | No |
| Create/edit Admins | Yes | No | No | No | No |
| Create/edit Managers | Yes | Yes | No | No | No |
| Create/edit Account teams | Yes | No | Yes (own) | No | No |
| Create/edit candidates | Yes | Yes | Yes (own teams) | No | No |
| Capture jobs (extension) | No | No | Yes | No | No |

**Scoping logic:**
- **Manager** → sees Account teams where `manager_id` = their account ID
- **Account** → sees data where `account_id` = its linked team
- **Caller** → sees interviews where `caller_user_id` = their account ID

---

## 8. Chrome extension usage

> **Full extension guide:** see **`QTS-JOB-TRACKING-EXTENSION-GUIDE.md`** for install, login, capture workflow, supported sites, and troubleshooting.

### Who should use it

**Managers only.** A Manager signs in, selects an assigned Account team after login, then chooses candidates from that team.

### Setup (once per user)

| Setting | Value |
|---------|-------|
| API Server URL | `https://qts-job-tracking.vercel.app` |
| Username | Manager login |
| Password | Manager password |

### Typical capture flow

1. Manager opens a job posting page (LinkedIn, Indeed, etc.)
2. Clicks the QTS extension icon
3. Extension extracts job title, company, URL, description
4. Manager selects which **candidate** this job is for
5. Saves — job appears in Super/Admin/Manager job lists

### Requirements

- `start-server.bat` must be running on the host PC
- Vercel health check must pass: `/api/health` returns online
- Manager must have an **active Account team** assigned

---

## 9. Common workflows

### Workflow A — New Account team is created

```text
Manager → Accounts → + Add Account
        → set Account username + password
        → + Add Candidate(s)
Manager → install extension → login → choose Account team → capture jobs
```

### Workflow B — New manager joins the company

```text
Admin   → People → + Add Manager
Manager → login → Accounts → build their teams
```

### Workflow C — Interview tracking starts for a candidate

```text
Manager → ensure candidate exists under account
Admin/Manager → add caller account under account (if needed)
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
- Super password is from `server/.env.cloud` → `ADMIN_PASSWORD`
- Admins are created by Super; Managers by Admin; Account teams by Managers

### Extension: "requires a Manager account"

- You logged in with an Account, Admin, Super, or Caller account
- Use your **Manager** username/password instead

### Extension: no Account teams assigned

- Ask Admin or Super to assign an Account team to your Manager
- Go to Manager → **Accounts** to create or manage your assigned teams

### Extension: Account team is inactive

- Ask Admin or Super to assign an active Account team

### Extension: "No Manager accounts exist yet"

- Create the Super → Admin → Manager hierarchy before using the extension

### Login page loads but login fails (502 / 530)

- API server is down → run `start-server.bat`
- Tunnel URL changed → run `sync-vercel-api-url.bat`
- Test: https://qts-job-tracking.vercel.app/api/health

### Manager cannot see any Account teams

- Account teams must be assigned to that Manager
- Manager or Super creates teams under **Accounts**

### Manager cannot see candidates in extension

- Manager must add candidates under the selected Account team first
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
│  Super    → People → create Admins → system controls        │
│  Admin    → People → create Managers                        │
│  Manager  → Accounts → teams, candidates, extension         │
│  Caller   → Interviews → track interview progress           │
├─────────────────────────────────────────────────────────────┤
│  Setup order: Super → Admin → Manager → Account team        │
│               → Candidates → Manager extension login        │
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

*Role model: Super / Admin / Manager / Account / Caller. Account data remains stored under the legacy account role.*
