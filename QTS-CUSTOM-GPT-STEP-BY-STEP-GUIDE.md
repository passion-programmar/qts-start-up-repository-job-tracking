# QTS Custom GPT — Step-by-Step Guide

**Based on:** HTML comparison analysis, `QTS-CUSTOM-GPT-ERROR-REPORT.md`, extension v1.8.5  
**Custom GPT URL:** https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking  
**Audience:** Bidders and operators running one full application end-to-end

---

## What you need before starting

| Requirement | Why |
|-------------|-----|
| ChatGPT Plus (logged in) | Custom GPT + Actions need a paid account |
| `start-server.bat` running (window open) | API + tunnel must be live for GPT Actions |
| Extension **QTS_Startup v1.8.5+** reloaded | GPT handoff fixes are in recent versions |
| `GPT_ACTION_API_KEY` in `server/.env` | GPT Actions auth (separate from extension login) |
| Job application tab open | Extension fills the form here; GPT tab stays pinned |

**Important from HTML analysis:** Refreshing the ChatGPT page does **not** change the composer DOM. If typing fails, the cause is **live-page React handoff**, not missing selectors. Use the manual paste steps below when automation fails.

---

## Part A — One-time setup (do once)

### Step 1 — Start the server

1. Double-click `start-server.bat`.
2. Wait until you see **QTS SERVER IS RUNNING**.
3. **Do not close** that window.

Verify in browser:

```text
https://qts-job-tracking.vercel.app/api/health
```

Expected: `"status": "online"`

---

### Step 2 — Create GPT Action secret

1. Open `server/.env`.
2. Set (or update):

```env
GPT_ACTION_API_KEY=your_long_random_secret_here
```

3. Restart server: `stop-server.bat` → `start-server.bat`.

Copy the **same** value — you will paste it into ChatGPT in Step 4.

---

### Step 3 — Reload the Chrome extension

1. Open `chrome://extensions`.
2. Find **QTS_Startup** — version should be **1.8.5** or newer.
3. Click **Reload**.
4. Click **Clear all** on any old errors.

Extension API URL should point to:

```text
https://qts-job-tracking.vercel.app
```

(or your tunnel URL if configured in extension settings)

---

### Step 4 — Fix Custom GPT configuration (critical)

Your saved HTML showed `task_8` embedded in GPT config (OpenAPI examples + instructions). **Remove hardcoded `task_8`** — each real job uses a different task ID.

#### 4a. Open GPT builder

1. Go to: https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking  
2. Click the GPT name → **Edit GPT** (or Configure).

#### 4b. Update Instructions

Use dynamic task IDs only. Example trigger block:

```text
When the user message starts with PROCESS_TASK: task_<id>:
1. Extract the full taskId (e.g. task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92).
2. Call getTaskContext with that taskId.
3. Generate answers, resume JSON, cover letter JSON.
4. Call submitTaskPackage.
5. Call getTaskStatus to confirm ready.
```

**Remove:**
- `PROCESS_TASK: task_8` as a fixed instruction example
- Conversation starter button labeled `task_8`

#### 4c. Re-import OpenAPI Actions

1. In GPT editor → **Actions** → **Import from URL** or paste schema.
2. Use file: `docs/openapi/custom-gpt-application-actions.yaml`
3. In the schema, change any `example: task_8` to a UUID example, e.g.:

```yaml
example: task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92
```

4. **Authentication:** API Key / Bearer  
5. Paste the **same** value as `GPT_ACTION_API_KEY` from `server/.env`.

#### 4d. Save the GPT

Click **Save** / **Update** in the GPT builder.

---

### Step 5 — Pin the GPT tab once

1. Open the base GPT URL (no `/c/` in the path):

```text
https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking
```

2. Confirm you see **Ask anything** at the bottom and you are **logged in**.
3. Right-click tab → **Pin tab** (extension will also pin on first dispatch).

**Correct URL (fresh chat):**

```text
.../qts-job-tracking
```

**Wrong URL (old conversation — extension v1.8.5 should redirect away):**

```text
.../qts-job-tracking/c/6a3ea6a0-a1f4-83eb-91bf-c7cd349080a0
```

---

## Part B — Every new job application

### Step 6 — Open job and capture window

1. Open the job listing / application page (e.g. justjoin.it).
2. Open **QTS Capture** (extension popup or capture window).
3. Log in as bidder if needed.
4. Select the **candidate** (expand card → verify email, phone, LinkedIn).

---

### Step 7 — Start application

1. Click **Start Application** on the candidate card.
2. Extension scans the form and creates a **server session**.
3. Note the **Session ID** and **GPT task ID** shown in the extension.

Task ID format (new sessions after server restart):

```text
task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92
```

Legacy format may still appear:

```text
task_74
```

Both work if server is up to date — prefer UUID for new sessions.

---

### Step 8 — Confirm & fill

1. Review the field preview.
2. Click **Confirm & fill**.
3. Extension fills profile fields on the job page.
4. Extension registers the task and attempts GPT handoff.

**What should happen on the GPT tab:**

| Signal | Meaning |
|--------|---------|
| Orange banner: “QTS: extension connected…” | Injection is working |
| Orange banner: “opening fresh Custom GPT conversation…” | Left an old `/c/` chat (good) |
| Text `PROCESS_TASK: task_…` in **Ask anything** | Typing succeeded |
| Extension alert: “Press Enter…” | Typed but not sent — press **Enter** on GPT tab |
| Extension alert: “PROCESS_TASK sent…” | Message sent — wait for Actions |

**If composer stays empty** → go to **Part C (manual fallback)**. Do not wait more than ~1 minute.

---

### Step 9 — Send PROCESS_TASK (if not auto-sent)

On the **Custom GPT tab**:

1. Click inside **Ask anything**.
2. If text is already there → press **Enter**.
3. If empty → click **GPT task ID** in extension (copies to clipboard) → **Ctrl+V** → **Enter**.

**Do not click the white Voice button** when the box is empty — that starts voice, not send. After text appears, the button may change to Send.

---

### Step 10 — Approve GPT Actions

When ChatGPT shows **Allow** / **Always allow**:

1. Switch to the **pinned GPT tab**.
2. Click **Allow** (manual — extension will not auto-click).

GPT will call:

- `getTaskContext`
- `submitTaskPackage`
- `getTaskStatus`

---

### Step 11 — Wait for package ready

1. Return to **QTS Capture** on the job tab.
2. Watch pipeline status: **waiting for Custom GPT…**
3. Extension polls server until `ready` / `readyToApply`.

If stuck > 3 minutes:

- Check GPT tab for errors.
- Check server window for logs.
- In GPT, ask: “What error did the last Action return?”

---

### Step 12 — Apply GPT package to form

1. When ready, extension may auto-apply or show **Apply GPT package**.
2. Click if needed.
3. Extension fills AI answers and uploads resume PDF if generated.

---

### Step 13 — Manual review and submit

**You must do manually (by design):**

- Terms / privacy / GDPR checkboxes
- Marketing opt-in
- Signature / declarations
- Final **Submit / Apply** button

---

## Part C — Manual fallback (when automation fails)

Use this whenever the GPT composer stays empty or the popup shows a handoff error.

```
1. Extension → click GPT task ID        → copies PROCESS_TASK: task_…
2. GPT tab → base URL (no /c/ path)
3. Click "Ask anything"
4. Ctrl+V
5. Enter
6. Click Allow on Actions
7. Wait for ready in extension
8. Apply package / review form
```

This path is **reliable** because it does not depend on ProseMirror DOM automation.

---

## Part D — Verification checklist

### After setup (Part A)

- [ ] Health endpoint returns `online`
- [ ] Extension version ≥ 1.8.5
- [ ] GPT Actions auth matches `GPT_ACTION_API_KEY`
- [ ] No `task_8` in GPT instructions or conversation starters
- [ ] GPT tab at base URL, logged in

### After each application (Part B)

- [ ] Session ID created in extension
- [ ] Task ID is current session (not an old `task_8`)
- [ ] GPT tab URL has **no** `/c/...` during handoff (or was redirected)
- [ ] `PROCESS_TASK` message visible in GPT chat history
- [ ] Action approval clicked
- [ ] Server status becomes `ready`
- [ ] Form received answers / PDF upload

---

## Part E — Troubleshooting quick map

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Nothing in GPT composer | Live React handoff failed | Part C manual paste |
| Popup stuck “Sending…” | Old extension (< 1.8.3) | Reload extension |
| GPT uses wrong session | `task_8` in GPT config | Part A Step 4 |
| Action 401 | Key mismatch | Sync `.env` and GPT Action auth |
| Action 404 | Server not running / old build | Restart `start-server.bat` |
| Old job context in GPT | Reused `/c/` conversation | v1.8.5 forces fresh chat; or open base URL |
| Voice button instead of Send | Composer empty | Type/paste first, then Enter |
| “Extended” pill on composer | Normal for this GPT UI | Not a bug; paste still works |

---

## Part F — What the HTML analysis proved

Comparing your two downloaded `ChatGPT - QTS-Job-Tracking.html` files:

1. **Composer DOM is stable** — `#prompt-textarea` ProseMirror, `unified-composer`, “Ask anything” placeholder unchanged after refresh.
2. **`task_8` in the HTML file** comes from **GPT OpenAPI/instructions**, not from the extension typing.
3. **Empty composer shows “Start Voice”** — Send only appears after text is entered in the live app.
4. **Saved HTML cannot test injection** — always verify on live `chatgpt.com`.

So your fix path is: **correct GPT config + server up + extension v1.8.5 + manual paste fallback**, not chasing DOM changes on refresh.

---

## Related documents

| Document | Purpose |
|----------|---------|
| `QTS-CUSTOM-GPT-ERROR-REPORT.md` | Full error history and root causes |
| `QTS-APPLICATION-WORKFLOW.md` | Architecture and operating rules |
| `QTS-JOB-TRACKING-CUSTOM-GPT-GUIDE.md` | GPT builder and Actions detail |
| `docs/openapi/custom-gpt-application-actions.yaml` | Action schema to import |

---

## Minimal “first success” path (15 minutes)

1. `start-server.bat` → health OK  
2. Reload extension v1.8.5  
3. Fix GPT: remove `task_8`, set Action key  
4. Open job → Start Application → Confirm & fill  
5. If GPT empty: copy task ID → paste in GPT → Enter → Allow  
6. Wait for ready → apply package → review → submit manually  

That is the complete loop the project is designed for.
