# QTS Job Tracking — Extension Usage Guide

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

**File:** `QTS-JOB-TRACKING-EXTENSION-GUIDE.md`  
**For:** Managers who capture job postings on behalf of an Account team
**Requires:** Chrome (or Chromium-based browser), Manager account, assigned Account team, server running

Related guides:
- `QTS-JOB-TRACKING-PROJECT-SETUP-GUIDE.md` — install server & deploy
- `QTS-JOB-TRACKING-PROJECT-GUIDE.md` — accounts & roles (who creates your login)
- `QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md` — speed optimization (Vercel, extension, API)

---

## Table of contents

1. [What the extension does](#1-what-the-extension-does)
2. [Before you start](#2-before-you-start)
3. [Install the extension](#3-install-the-extension)
4. [First login](#4-first-login)
5. [How to open the capture window](#5-how-to-open-the-capture-window)
6. [Capture a job step by step](#6-capture-a-job-step-by-step)
7. [Candidate list & Applied toggle](#7-candidate-list--applied-toggle)
8. [Supported job sites](#8-supported-job-sites)
9. [Daily workflow](#9-daily-workflow)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What the extension does

The **QTS_Startup** Chrome extension lets **Managers** capture job postings for a team while browsing:

- Reads job **title**, **company**, **URL**, and **description** from the page
- Lets you mark which **candidates** you applied for
- Saves everything to the QTS database (visible to manager and admin)

```text
Job site (LinkedIn, Indeed, etc.)
        │
        ▼  Click extension icon
Capture window opens
        │
        ▼  Select candidates → Save Job
Database (via Vercel → your PC API)
```

**Only Manager accounts** can sign into the extension. After signing in, choose an assigned Account team and candidate. Admin, Account, and Caller accounts cannot sign into the extension.

---

## 2. Before you start

Checklist:

| Requirement | Who sets it up |
|-------------|----------------|
| `start-server.bat` running on host PC | Admin / IT |
| Account team assigned to your Manager account | Admin / Super |
| At least one **active candidate** under the Account team | Manager |
| Extension loaded in Chrome | You (one-time) |

Ask your manager for:
- **Username**
- **Password**
- Confirm server is online

Quick test (open in browser):

```text
https://qts-job-tracking.vercel.app/api/health
```

Should show: `"status":"online"`

---

## 3. Install the extension

One-time setup per Chrome profile.

1. Open Chrome → go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`extension`** folder from the project:

```text
job-capture-system\extension\
```

5. Pin the extension (click puzzle icon → pin **QTS_Startup**)

You should see the QTS icon in the toolbar.

---

## 4. First login

1. Make sure you are on a normal web page (or click the extension icon)
2. The capture window opens → **Account Sign In** screen
3. Fill in:

| Field | Value |
|-------|-------|
| **Username** | From your manager (account login) |
| **Password** | From your manager |

4. Click **Log In**

The extension always connects to **https://qts-job-tracking.vercel.app** — no server URL to configure.

After login you stay signed in until you click **Log out** in the session bar.

---

## 5. How to open the capture window

### Method A — Click extension icon (main way)

1. Open a **job posting page** in Chrome (LinkedIn, Indeed, etc.)
2. Click the **QTS_Startup** icon in the toolbar
3. A popup window opens with the job form

### Method B — Auto-detect

On supported sites, the extension may detect job pages when you navigate. You can still click the icon to open the form.

### Refresh

Click **↻ Refresh** at the bottom to re-read the current tab and clear unsaved changes.

---

## 6. Capture a job step by step

### Step 1 — Open a job listing

Go to any job detail page, for example:
- LinkedIn job view
- Indeed job page
- Glassdoor, Greenhouse, Lever, Workable, Ashby, etc.

### Step 2 — Open the extension

Click the QTS icon. The form fills automatically when extraction works.

### Step 3 — Check job fields

| Field | Required | Notes |
|-------|:--------:|-------|
| Job Title | Yes | Auto-filled when possible |
| Company | Yes | Auto-filled when possible |
| URL | Yes | Current page URL |
| Description | No | Auto-filled when possible; you can edit |

If fields are empty, type them manually.

### Step 4 — Mark candidates

Scroll to the **Candidates** section:

- Each card is a person your team applies for
- Toggle **APPLIED** / **NOT APPLIED** for each candidate on this job
- Use **stack filter** or **search** to find candidates quickly
- Click a candidate row to expand details (email, phone, LinkedIn)

### Step 5 — Save

Click **Save Job** at the bottom.

- First save → **Job saved!**
- Same URL again → shows **Update Job** (updates existing record)

### Step 6 — Confirm

Status bar shows:
- **Source** (e.g. linkedin, indeed)
- **New** or **Saved**
- Count of **Applied** / **Not applied** candidates

Manager and admin can see the job in the web dashboard under **Jobs**.

---

## 7. Candidate list & Applied toggle

### If you see "No active candidates"

Your manager must add candidates first:

```text
Manager → Accounts → your organization → + Add Candidate
```

You cannot save meaningful candidate assignments until candidates exist.

### Applied vs Not applied

| Toggle | Meaning |
|--------|---------|
| **APPLIED** | This candidate was applied to for this job |
| **NOT APPLIED** | Not applied (or not yet) |

After a job is saved, some applied states may be **locked** to prevent accidental removal.

### Filters

- **All stacks** — filter by tech stack (Java, Python, etc.)
- **Search name** — filter by candidate name

---

## 8. Supported job sites

The extension has dedicated extractors for:

| Site / type | Examples |
|-------------|----------|
| LinkedIn | `linkedin.com` job pages |
| Indeed | `indeed.com` |
| Glassdoor | `glassdoor.com` |
| ATS boards | Greenhouse, Lever, Workable, SmartRecruiters, Ashby |
| Generic | Other `http://` and `https://` job pages (best-effort) |

If auto-extract fails, you can still **enter fields manually** and save.

---

## 9. Daily workflow

```text
START OF DAY
────────────
1. Confirm admin started start-server.bat (or ask if login fails)
2. Open Chrome with extension pinned

FOR EACH JOB
────────────
1. Open job posting in a tab
2. Click QTS extension icon
3. Verify title / company / URL / description
4. Mark APPLIED for relevant candidates
5. Click Save Job
6. Move to next job posting

END OF DAY
──────────
• Optional: Log out from extension session bar
• Jobs are already in the system for manager review
```

---

## 10. Troubleshooting

### Cannot connect to the server

**Message:** `Cannot connect to the server` or `Check that it is running`

**Fix:**
1. Ask admin to run `start-server.bat` and keep window open
2. Test: https://qts-job-tracking.vercel.app/api/health
3. If 502/530 → admin runs `sync-vercel-api-url.bat`

---

### Login failed / Invalid credentials

- Use your **Manager** username and password
- Passwords are case-sensitive
- Ask manager to reset your password

---

### Extension requires a Manager account

You tried to log in with an Account, Admin, Super, or Caller account.

**Fix:** Use your **Manager** username and password, then choose an assigned Account team.

---

### No Account teams assigned

**Message:** No active Account teams are assigned to your Manager account

**Fix:** Ask an Admin or Super to assign an Account team to your Manager account.

---

### No Manager accounts exist yet

**Fix:** Super creates an Admin; then Admin → **People** → creates a Manager.

---

### No active candidates

**Fix:** Manager adds candidates under the selected Account team before you can assign them.

---

### Fields not auto-filled

1. Click **↻ Refresh**
2. If still empty, fill **Title**, **Company**, **URL** manually
3. Some sites block extraction — manual entry still works

---

### Job already saved

Yellow notice: **This job is already saved in the database**

- Form loads existing data
- Button changes to **Update Job**
- Adjust candidates and click **Update Job**

---

### Save failed / duplicate URL

Another account may have saved the same URL, or validation failed. Read the red error message at the top of the form.

---

## Quick reference card

```text
┌────────────────────────────────────────────────────────────┐
│  QTS EXTENSION — ACCOUNT QUICK REFERENCE                      │
├────────────────────────────────────────────────────────────┤
│  API URL:    https://qts-job-tracking.vercel.app           │
│  Login:      Account username + password (from manager)     │
├────────────────────────────────────────────────────────────┤
│  1. Open job page in Chrome                                │
│  2. Click QTS extension icon                               │
│  3. Check title / company / URL                            │
│  4. Toggle APPLIED per candidate                           │
│  5. Click Save Job                                         │
├────────────────────────────────────────────────────────────┤
│  Server down? → tell admin to run start-server.bat         │
│  No candidates? → ask manager to add them                  │
└────────────────────────────────────────────────────────────┘
```

---

*QTS Job Tracking Extension v1.3.6 — Account capture workflow*
