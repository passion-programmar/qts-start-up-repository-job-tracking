# QTS Custom GPT + Extension + Server — Error Report

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

**File:** `QTS-CUSTOM-GPT-ERROR-REPORT.md`  
**Generated:** 2025-06-25  
**Extension version:** v1.8.5  
**Custom GPT:** [QTS Job Tracking](https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking)  
**Scope:** Errors and failures observed **before** and **after** implementing the Custom GPT workflow (`PROCESS_TASK` → GPT Actions → server → extension fill)

Related docs:
- `QTS-APPLICATION-WORKFLOW.md` — target architecture and operating rules
- `QTS-JOB-TRACKING-CUSTOM-GPT-GUIDE.md` — GPT setup and Actions
- `docs/openapi/custom-gpt-application-actions.yaml` — Action API schema

---

## 1. Executive summary

| Layer | Before GPT workflow | After GPT workflow | Current status |
|-------|---------------------|--------------------|----------------|
| **Server (core)** | Port mismatch, Vercel UI-only deploy | Task routes, UUID task IDs, GPT Action auth | Mostly stable when `start-server.bat` is running |
| **Extension (job capture)** | MV3 inline handlers, script injection crashes | Application sessions, form scan/fill, GPT dispatch | Job flow works; GPT handoff still fragile |
| **Custom GPT (config)** | N/A | Wrong GPT URL, `task_8` starter, Action 404/401 | Configurable; depends on operator setup |
| **GPT handoff (typing)** | N/A | **Primary blocker** — composer automation fails intermittently | Partially fixed v1.7.8–v1.8.5; manual paste still required sometimes |

**Bottom line:** The **server task + GPT Actions** path is designed and largely implemented. The **extension → ChatGPT composer** step remains **experimental** (as documented in `QTS-APPLICATION-WORKFLOW.md` §2.3). Most user-visible “nothing happened” reports trace to handoff failure, not missing server routes.

---

## 2. Architecture timeline

### 2.1 Before Custom GPT workflow (pre ~v1.5.0)

```text
Extension  →  Server (jobs, candidates, application sessions)
                ↑
           No GPT Actions layer
           No PROCESS_TASK protocol
           No pinned GPT tab manager
```

**Capabilities that existed:**
- Job capture, candidate toggles, save/update jobs
- Application session creation, form scan, profile fill
- AI fields stored on server with `awaiting_ai` status

**What did not exist:**
- `POST /api/application-tasks/{taskId}/dispatch`
- `GET /api/application-tasks/{taskId}/context` (for GPT)
- `POST /api/application-tasks/{taskId}/package` (from GPT)
- Extension handoff to ChatGPT composer
- Poll-and-apply GPT package to job form

### 2.2 After Custom GPT workflow (v1.5.0 → v1.8.5)

```text
Job tab (active)
    ↓
Extension creates session + taskId on server
    ↓
Pinned Custom GPT tab (background)
    ↓  PROCESS_TASK: task_<uuid>
Custom GPT → GPT Actions → Server
    ↓
Extension polls status → fills form + uploads PDFs
```

**Implemented:**
- Application task API routes (`application-tasks.routes.ts`)
- Public UUID task IDs (`task_<uuid>`) + legacy `task_<number>` alias
- `GPT_ACTION_API_KEY` separate from bidder JWT
- Pinned GPT tab reuse (`ensureCustomGptTab`)
- Handoff scripts (`chatgpt-handoff.js`, `chatgpt-main-handoff.js`, `chatgpt-composer-handoff.js`)
- Synchronous dispatch (v1.8.3+), fresh-chat detection (v1.8.5)

**Still experimental / incomplete:**
- Reliable automatic typing into ChatGPT ProseMirror composer
- Multi-step page-by-page loop (workflow §14)
- Guaranteed send without manual Enter

---

## 3. Errors by layer

### 3.1 Infrastructure & deployment (pre- and post-workflow)

| # | Symptom | Root cause | Fix / mitigation | Status |
|---|---------|------------|------------------|--------|
| I-1 | Admin UI stuck on “Loading…” | API port `4000` vs UI proxy `1028` | Set `PORT=1028` in `server/.env` | Fixed |
| I-2 | Next.js dev crash on Windows | Turbopack instability | Use `next dev --webpack` | Fixed |
| I-3 | Vercel deploy: UI loads, login fails | UI-only deploy; API at `127.0.0.1:1028` unreachable from cloud | Run `start-server.bat` + Cloudflare tunnel; set `API_URL` on Vercel | By design |
| I-4 | `start-server.bat` appears frozen at “Updating Vercel…” | `npm` prompted `y/n` for Vercel CLI install | Non-interactive install in batch script | Fixed |
| I-5 | Git merge conflict on push | Remote README vs local README | Resolved merge; use PAT for GitHub auth | Operational |
| I-6 | Neon/Render DB setup confusion | Postgres vs SQLite local | Documented in setup guides | Operational |

---

### 3.2 Server — before application tasks

| # | Symptom | Root cause | Fix / mitigation | Status |
|---|---------|------------|------------------|--------|
| S-1 | Saved candidate status lost on reload | Tab URL ≠ extracted job URL on lookup | Try both URLs when loading job | Fixed |
| S-2 | Bidder cannot update jobs | Extension used admin-only `PUT /api/jobs/:id` | Use `POST /api/jobs/upsert` | Fixed |
| S-3 | `candidate_jobs.status` null shown wrong | SQL returned null instead of `'none'` | `COALESCE(cj.status, 'none')` | Fixed |

---

### 3.3 Server — Custom GPT workflow era

| # | Symptom | Root cause | Fix / mitigation | Status |
|---|---------|------------|------------------|--------|
| S-4 | GPT Action `404` on `/api/application-tasks/task_8/context` | Server not rebuilt/restarted; routes not loaded; Vercel proxy without local API | `stop-server.bat` → `start-server.bat`; verify health endpoint | Fixed when server restarted |
| S-5 | GPT Action `401 Unauthorized` | `GPT_ACTION_API_KEY` mismatch between `.env` and GPT Action auth | Use identical secret in both places; restart server | Config-dependent |
| S-6 | GPT cannot reach API | Action URL points to localhost; tunnel down | Keep `start-server.bat` + tunnel running; use public HTTPS URL in OpenAPI | Operational |
| S-7 | Predictable `task_8` IDs | Early design used `task_{sessionId}` only | UUID via `createPublicTaskId()`; legacy alias retained | Partially fixed — restart server + new sessions needed |
| S-8 | `resume JSON is required` on package submit | GPT omitted resume object for upload field | GPT instructions + context `fileFields` | GPT prompt issue |
| S-9 | Package saved but PDF missing | Renderer/filesystem failure | Check `server/data/application-documents`, logs, permissions | Operational |
| S-10 | `waiting_for_gpt` stuck forever | GPT never called Actions (handoff failed) | Manual `PROCESS_TASK`; fix handoff; click Allow | Depends on handoff |

**Task ID formats (current):**

| Format | Example | Notes |
|--------|---------|-------|
| Legacy numeric | `task_74` | Maps to `application_sessions.id = 74` |
| Public UUID | `task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92` | Preferred for new sessions |
| Wrong starter | `task_8` in GPT conversation starter | Hardcoded in Custom GPT config — confusing for session ≠ 8 |

---

### 3.4 Extension — before GPT handoff

| # | Symptom | Root cause | Fix / mitigation | Status |
|---|---------|------------|------------------|--------|
| E-1 | Save Job button dead | MV3 blocks inline `onclick` | `addEventListener` in `popup.js` | Fixed |
| E-2 | “Unknown error fetching script” | Global content script on all URLs | Scoped injection; removed broad content script | Fixed (v1.2.3+) |
| E-3 | Service worker importScripts failure | `importScripts` on some paths | Restored modular imports with error handling | Fixed |
| E-4 | Background extract empty | SW called extractors without injection | Inject extractor scripts before extract | Fixed |
| E-5 | Missing extension icon | `bidder-logo.png` referenced but absent | Added assets | Fixed |
| E-6 | Auto-extract on `chrome://` pages | No protocol guard | `restrictedPageMessage()` + guards | Fixed |

---

### 3.5 Extension — Custom GPT handoff (main blocker)

Observed during integration testing (sessions #76–#78+):

| # | Symptom | Root cause | Fix attempted | Status |
|---|---------|------------|---------------|--------|
| G-1 | **Nothing happens** after Confirm & fill | GPT tab opens but no text in composer | Multiple handoff strategies added | **Ongoing** |
| G-2 | Popup stuck: “Sending PROCESS_TASK to Custom GPT…” | `async: true` dispatch; MV3 service worker terminated before handoff completed | Synchronous dispatch (v1.8.3) | Fixed |
| G-3 | No orange QTS banner on GPT tab | Script injection failed or wrong tab/frame | `forceQtsGptBanner` via `allFrames` (v1.8.2+) | Improved |
| G-4 | Empty “Ask anything” composer | Wrong DOM target; isolated world events ignored by React | MAIN world injection + ProseMirror module (v1.8.4+) | Improved |
| G-5 | Conversation URL `/c/...` reused | `isCustomGptUrl()` true for `/c/uuid` → skipped fresh chat | `needsFreshGptConversation()` → navigate to base URL (v1.8.5) | Fixed |
| G-6 | Send never fires | Voice button shown when empty (`aria-label="Start Voice"`) | Skip voice button; wait for Send (v1.8.5) | Improved |
| G-7 | `Receiving end does not exist` | Content script not loaded before `sendMessage` | Polling + `executeScript` fallbacks | Mitigated |
| G-8 | Misleading “dispatched” success | UI updated before handoff finished | Await dispatch result; `applyGptDispatchResult()` | Fixed (v1.8.3) |
| G-9 | `#prompt-textarea` inner `<p>` placeholder | ProseMirror structure; parent is contenteditable | Target `div#prompt-textarea.ProseMirror` + placeholder click | Fixed (v1.8.4+) |
| G-10 | Hidden `textarea.wcDTda_fallbackTextarea` ignored | Automation focused visible ProseMirror only | React native value setter on fallback textarea (v1.8.5) | Improved |

**Example failing URL (user report):**

```text
https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking/c/6a3ea6a0-a1f4-83eb-91bf-c7cd349080a0
         └─ Custom GPT base (correct)                    └─ old conversation (should not reuse)
```

**Correct handoff target URL:**

```text
https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking
```

---

### 3.6 Custom GPT configuration errors

| # | Symptom | Root cause | Fix / mitigation | Status |
|---|---------|------------|------------------|--------|
| C-1 | Wrong GPT linked in extension | Old GPT ID in code/docs | Updated to `g-6a3dc5525fac819198dccf1c216e3fc0` in `custom-gpt.js` | Fixed |
| C-2 | `PROCESS_TASK: task_8` in GPT Instructions / starter | Copy-paste from early docs; session 8 hardcoded | Remove starter; use dynamic `PROCESS_TASK: <uuid>` per session | **User action required** |
| C-3 | GPT calls wrong task | Reused conversation carries old context | Fresh conversation per application (now enforced in extension v1.8.5) | Improved |
| C-4 | Action approval blocks pipeline | ChatGPT requires manual Allow | Extension notifies; never auto-clicks Allow (by design) | By design |
| C-5 | OpenAPI server URL wrong | Points to Vercel without tunnel | Use `https://qts-job-tracking.vercel.app` only when PC API + tunnel running | Operational |

---

## 4. Before vs after comparison

### 4.1 What worked before GPT workflow

- Job listing capture and save
- Candidate applied/none tracking
- Application session creation
- Form discovery and profile field fill on justjoin.it
- Storing AI-pending fields on server

### 4.2 What broke or regressed during GPT integration

| Area | Regression | Notes |
|------|------------|-------|
| User expectations | Assumed fully automatic GPT trigger | Workflow doc marks composer insert as **experimental** |
| Popup UX | Long “Sending…” with no feedback | Fixed v1.8.3 (sync + loading state) |
| GPT tab state | Old conversations reused | Fixed v1.8.5 (force base URL) |
| Task ID clarity | `task_74` vs UUID confusion | Server supports both; UI should show UUID for new sessions |

### 4.3 What works after GPT workflow (when configured correctly)

| Step | Component | Status |
|------|-----------|--------|
| Create application session | Extension + server | ✅ |
| Register dispatch (`POST .../dispatch`) | Extension + server | ✅ |
| Open/pin GPT tab | Extension SW | ✅ |
| GPT `getTaskContext` | Custom GPT + server | ✅ (if Actions auth + server up) |
| GPT `submitTaskPackage` | Custom GPT + server | ✅ |
| Server PDF render | Server | ✅ |
| Extension poll + apply package | Extension SW | ✅ (when package ready) |
| Auto-type `PROCESS_TASK` in composer | Extension → ChatGPT DOM | ⚠️ Experimental |

---

## 5. Error phases in handoff (debug reference)

Extension stores debug hints in `chrome.storage.local`:

| Key | Meaning |
|-----|---------|
| `qtsLastGptHandoffDebug` | Last handoff attempt result (`phase`, `via`, `pageUrl`) |
| `qtsLastProcessTaskPrompt` | Last `PROCESS_TASK` string |
| `qtsLastGptBannerError` | Orange banner injection failed |
| `qtsLastGptHandoffToastError` | Toast injection failed |

**Handoff phases (`phase` field):**

| Phase | Meaning |
|-------|---------|
| `no_editor` | Composer not found (page loading, not logged in, wrong tab) |
| `insert_failed` | Editor found but text did not stick in React/ProseMirror |
| `typed_needs_enter` | Text visible; send button not clicked — user presses Enter |
| `typed_and_sent` | Success |
| `no_module` | `chatgpt-composer-handoff.js` not injected in page |
| `login_required` | ChatGPT login screen |

---

## 6. Open issues (as of v1.8.5)

| Priority | Issue | Owner |
|----------|-------|-------|
| **P0** | Composer automation still unreliable on live ChatGPT UI | Extension |
| **P1** | Remove `task_8` conversation starter from Custom GPT config | Operator |
| **P1** | Confirm server restarted so new sessions get UUID `taskId` | Operator |
| **P2** | Multi-step application page loop not implemented | Extension |
| **P2** | Popup state lost if closed mid-workflow | Extension (orchestration in SW) |
| **P3** | Vercel-only deploy cannot run full pipeline | Infrastructure |

---

## 7. Manual fallback procedure (reliable path)

When automatic handoff fails:

1. Ensure `start-server.bat` is running and health check is online.
2. In extension, click **GPT task ID** (copies `PROCESS_TASK: task_…` to clipboard).
3. Open pinned GPT tab at **base URL** (no `/c/...` path).
4. Click **Ask anything** → **Ctrl+V** → **Enter**.
5. When ChatGPT shows Action dialog → click **Allow**.
6. Wait for extension poll / click **Apply GPT package** if needed.
7. Review form; submit manually.

---

## 8. Verification checklist

### Server
- [ ] `https://qts-job-tracking.vercel.app/api/health` → `online`
- [ ] `GPT_ACTION_API_KEY` set in `server/.env`
- [ ] `GET /api/application-tasks/{taskId}/context` returns 200 with GPT key (not 401/404)

### Custom GPT
- [ ] URL matches `extension/shared/custom-gpt.js` `CUSTOM_GPT_URL`
- [ ] OpenAPI imported from `docs/openapi/custom-gpt-application-actions.yaml`
- [ ] Action auth uses same key as `GPT_ACTION_API_KEY`
- [ ] No hardcoded `task_8` starter (use dynamic PROCESS_TASK only)

### Extension
- [ ] Version **v1.8.5** in `chrome://extensions`
- [ ] Reload extension after each update
- [ ] Confirm & fill → GPT tab navigates to **base** URL (not `/c/...`)
- [ ] Orange QTS banner appears on GPT tab during handoff

---

## 9. Version history (GPT handoff fixes)

| Version | Change |
|---------|--------|
| v1.5.0 | Initial PROCESS_TASK dispatch, task routes, pinned tab |
| v1.7.8 | ProseMirror `execCommand`, composer wait polling |
| v1.7.9 | SW polling; async dispatch (later reverted) |
| v1.8.0 | Honest dispatch status messages |
| v1.8.1 | MAIN world inline handoff; footer exclusion removed |
| v1.8.2 | ISOLATED-first; position-based composer; clipboard on confirm |
| v1.8.3 | **Synchronous dispatch** (fixes eternal “Sending…”) |
| v1.8.4 | `chatgpt-composer-handoff.js`; MAIN world ProseMirror targeting |
| v1.8.5 | **Fresh chat** on `/c/` URLs; fallback textarea; skip voice button |

---

## 10. Recommendations

1. **Treat composer automation as assist, not guarantee** — keep clipboard copy + manual paste documented for bidders.
2. **Remove `task_8` from Custom GPT** conversation starters and instructions examples; use `task_<uuid>` only.
3. **Always restart server** after pulling task-route changes.
4. **Monitor `qtsLastGptHandoffDebug`** in extension storage when debugging handoff.
5. **Complete page-by-page workflow** (§14 in `QTS-APPLICATION-WORKFLOW.md`) as separate milestone — do not block GPT Actions on composer automation.

---

*This report consolidates issues from development sessions, user testing (sessions #76–#78), and `QTS-APPLICATION-WORKFLOW.md` troubleshooting §17.*
