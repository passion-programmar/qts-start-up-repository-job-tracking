# Apply Method Detection — Study Guide

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

This document explains how QTS classifies job apply flows across sites, and how the extension detects the method **when a job page opens** (before Start Application).

## Apply method taxonomy

| Apply method | Meaning | Example |
|--------------|---------|---------|
| `easy_apply` | Click **Apply** → in-page modal/overlay, usually guest apply (no job-board account) | [justjoin.it 7N Fullstack](https://justjoin.it/job-offer/7n-sp-z-o-o--fullstack-developer-java-react--warszawa-java) |
| `single_step` | All fields on **one page** after Apply (inline form) | Some ATS career pages |
| `multi_step` | **Wizard** — step N of M, Next buttons | LinkedIn Easy Apply (multi-screen), Greenhouse multi-page |
| `external_redirect` | Apply **leaves** the job board (employer ATS / career site) | justjoin job with off-site Apply `<a href>` |
| `unknown` | Not enough signals yet | New site, or Apply not clicked |

### Flow type vs apply method

- **Flow type** (`modal`, `inline_single`, `multi_step`, …) — DOM shape *right now*
- **Apply method** (`easy_apply`, `single_step`, …) — strategy the extension uses

On **page load** (before Apply is clicked), the extension uses URL + Apply button + template rules to **predict** the method. After discovery, flow type may refine (e.g. modal opens → confirms `easy_apply`).

## Canonical example: justjoin Easy Apply

**URL pattern:** `https://justjoin.it/job-offer/{company}-{title}--{city}-{stack}`

**Reference job:** [7N Fullstack Developer (Java+React)](https://justjoin.it/job-offer/7n-sp-z-o-o--fullstack-developer-java-react--warszawa-java)

| Signal | Value on page load |
|--------|-------------------|
| Platform | `justjoin` |
| Template | `justjoin_easy_apply` |
| Apply method | `easy_apply` |
| Anticipated flow | `modal` |
| Guest apply | Yes (no justjoin.it login) |
| Native Apply button | Yes (summary panel) |
| External Apply link | No |

**After clicking Apply** (modal like “You apply for”):

- Header: **You apply for** + job title + company logo
- Fields: First and last name, Email, Add document (PDF/DOCX), message toggle, terms checkboxes
- Extension selects template **`justjoin_easy_apply`** with score **500** (definitive)
- `detectionMode: modal_open`, `formOpen: true`

Modal fingerprint signals:

| Signal | DOM text / element |
|--------|-------------------|
| `youApplyForModal` | “You apply for” / “Aplikujesz na” |
| `applyModalConfirmed` | name + email + Add document + file input |
| `applyModalScore` | ≥ 120 → confirmed |

A page watcher (`apply-modal-watch.js`) re-runs detection when the modal opens.

- Single screen (not multi-step wizard)
- reCAPTCHA — manual only

## Detection pipeline (page open)

```
job page load / tab switch / SPA navigation
  → maybeDetectApplyMethodOnOpen()     [service worker — always, silent]
  → detect apply template

auto-apply armed (Start on job pages):
  → autoDetectJob → maybeStartAutoApplicationPipeline
      → check default candidate already applied? (GET /api/jobs/by-url)
          → if applied: skip pipeline
          → if job not saved (404): continue apply
      → detect template → fill name/email → session → GPT → resume upload
```

## Registered templates (justjoin.it)

| Template ID | Apply method | Priority | When |
|-------------|--------------|----------|------|
| `justjoin_external_apply` | `external_redirect` | 200 | Off-site Apply `<a href>` |
| `justjoin_easy_apply` | `easy_apply` | 100 | Native job-offer page |

## Studying a new job site

1. Open a job listing URL in Chrome with the extension loaded.
2. Click the extension icon → check **Apply method** in the job summary.
3. Note in your study sheet:
   - Platform hostname
   - Apply method detected
   - Whether Apply opens modal vs new tab vs inline form
   - Step count (if wizard)
   - Login required?
   - File upload fields?
4. Add a template under `extension/content/platforms/templates/` when ready.

## Key files

| File | Role |
|------|------|
| `extension/shared/application-flow.js` | Apply method taxonomy + `resolveApplyMethod()` |
| `extension/content/apply-template-detector.js` | Page-load detection orchestrator |
| `extension/content/platforms/templates/justjoin-easy-apply.js` | Canonical easy_apply template |
| `extension/background/service-worker.js` | `maybeDetectApplyMethodOnOpen()` on navigation |
| `docs/JUSTJOIN-APPLICATION-FLOWS.md` | justjoin flow details |
