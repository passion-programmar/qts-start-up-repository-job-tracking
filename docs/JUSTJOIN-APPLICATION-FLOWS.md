# justjoin.it Application Flow Analysis

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

This document describes how QTS Job Tracking detects and handles different apply flows on [justjoin.it](https://justjoin.it) job-offer pages.

## Analyzed page pattern

All native justjoin job offers use URLs like:

```
https://justjoin.it/job-offer/{company}-{title}--{city}-{stack}
```

Examples:

| Job | URL pattern | Typical flow |
|-----|-------------|--------------|
| comm1t Senior Backend (FastAPI) | `.../comm1t-senior-backend-engineer-fastapi--warszawa-java` | Modal |
| 7N Fullstack | `.../7n-sp-z-o-o--fullstack-developer-java-react--warszawa-java` | Modal |
| Vistulo Senior Java | `.../vistulo-senior-java-engineer-fx-trading-systems--warszawa-java` | Modal |
| DCG Backend Quarkus | `.../dcg-backend-developer-java-quarkus--wroclaw-java` | Modal |
| Future Processing Senior Java | `.../future-processing-senior-java-developer-gliwice-java-12865c73` | Modal |

## Flow types supported

### 1. Modal popup (most common on justjoin.it)

**No justjoin.it account required.** Bidders open the public job-offer page (full description visible), click **Apply**, and complete the in-page modal. QTS extension login is separate — that is your bidder account in QTS_Startup, not a justjoin.it account.

**Trigger:** User or extension clicks **Apply** on the job-offer page.

**What appears:** In-page dialog with:

- Name
- Email
- File upload (“Add document” / CV)
- GDPR consent checkbox
- Marketing opt-in checkbox
- Optional “Attach a message” checkbox (dynamic)
- reCAPTCHA

**Detection:** `role="dialog"` or `[aria-modal="true"]` with form inputs inside.

**Extension behavior:**

1. Click highest-scored Apply button (summary panel preferred)
2. Poll until fields stabilize
3. Optionally check “Attach a message” to reveal hidden fields
4. Scan all inputs in modal roots first
5. Show preview → user confirms → fill (never submit)

### 2. Single-page inline

Rare on justjoin native forms; more common on external ATS after redirect.

**Detection:** Form fields on page without modal wrapper.

### 3. Multi-step

**Detection:** `step N of M` text or `[aria-current="step"]`.

**Extension behavior:** Reports step info in discovery; does not auto-click Next (user confirms each step manually for now).

### 4. External redirect

**Trigger:** Apply `<a href>` points off justjoin.it (Greenhouse, Lever, company career site).

**Detection:** `detectExternalApplyLink()` before clicking.

**Extension behavior:** Warns bidder; does not follow redirect automatically. User opens external page and runs Start Application there.

### 5. Dynamic fields

**Example:** justjoin “Attach a message” checkbox reveals a textarea.

**Extension behavior:** During discovery, checks known toggles, re-scans after 500ms.

### 6. File uploads

**Detection:** `input[type="file"]`, labels like “Add document”, “CV”, “resume”.

**Classification:** `document_upload` → `resume` or `cover_letter`.

**Fill:** After Custom GPT `submitTaskPackage`, server builds PDF → extension uploads via `DataTransfer`.

### 7. Required questions & controls

| Control | Scanned as | Classified as |
|---------|------------|---------------|
| Text / email / phone | `text`, `email`, `tel` | `candidate_profile` |
| Textarea | `textarea` | `ai_generation` if narrative |
| Checkbox (GDPR, terms) | `checkbox` | `saved_answer` |
| File | `file` | `document_upload` |
| Select / radio | `select`, `radio` | `saved_answer` or `ai_generation` |

## Safety rules

- Extension **never** clicks final Submit / Send application
- Extension **never** solves reCAPTCHA
- User must **preview and confirm** before any fill
- User submits manually on justjoin.it

## Architecture

```
Start Application
  → DISCOVER_APPLICATION_FORM (content script)
      → justjoin-apply.js (platform adapter)
      → application-discovery.js (orchestrator)
      → form-scan.js (field scanner)
  → classify + match profile
  → Preview panel (popup)
  → User confirms
  → FILL_APPLICATION_FORM (confirmed fields only)
  → Save to server → GPT for AI/upload fields
```

## Key files

| File | Role |
|------|------|
| `extension/content/platforms/justjoin-apply.js` | justjoin-specific flow detection |
| `extension/content/application-discovery.js` | Discovery orchestrator |
| `extension/content/form-scan.js` | DOM scan + fill |
| `extension/shared/application-flow.js` | Flow type labels |
| `extension/popup/popup.js` | Preview UI + Start Application |
