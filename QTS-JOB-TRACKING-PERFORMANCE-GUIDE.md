# QTS Job Tracking — Performance & Optimization Guide

**File:** `QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md`  
**For:** Admins, developers, and anyone tuning speed on Vercel, the extension, and the API  
**Related:** `QTS-JOB-TRACKING-PROJECT-SETUP-GUIDE.md`, `QTS-JOB-TRACKING-EXTENSION-GUIDE.md`

---

## Table of contents

1. [Why it feels slow](#1-why-it-feels-slow)
2. [Request chain today](#2-request-chain-today)
3. [Latency budget](#3-latency-budget)
4. [Bottlenecks by layer](#4-bottlenecks-by-layer)
5. [Optimizations ranked by impact](#5-optimizations-ranked-by-impact)
6. [Quick wins (code)](#6-quick-wins-code)
7. [Long-term architecture](#7-long-term-architecture)
8. [Recommended roadmap](#8-recommended-roadmap)
9. [What is NOT the problem](#9-what-is-not-the-problem)

---

## 1. Why it feels slow

Slowness is **mostly architectural**, not because Vercel or the extension UI is poorly built.

In the current production setup:

```text
Extension / Admin UI
    → Vercel (https://qts-job-tracking.vercel.app)
        → Cloudflare quick tunnel (*.trycloudflare.com)
            → Your Windows PC API (localhost:1028)
                → Neon PostgreSQL
```

Every API call crosses **4–5 network hops**. At ~100–300ms per hop, a single action can cost **0.5–1.5 seconds**. The extension often makes **5–7 calls** when it opens.

| Component | Role | Speed impact |
|-----------|------|--------------|
| **Vercel** | Hosts admin web UI only; proxies `/api/*` to `API_URL` | Adds 1 hop per request |
| **Cloudflare tunnel** | Exposes your PC to the internet | Adds 1 hop; URL changes on restart |
| **Local PC API** | Real Express server + business logic | Must stay on 24/7 |
| **Neon** | PostgreSQL database | Usually fine if region matches API |

**Key insight:** Vercel does not run your API. Your PC does. Until the API lives on a stable cloud host, every user waits on tunnel + PC latency.

---

## 2. Request chain today

### Extension popup — authenticated open

```text
1. GET  /api/health
2. GET  /api/auth/me
3. GET  /api/candidates?active=true
4. GET  /api/settings/candidate-stacks
5. GET  /api/jobs/by-url?url=...     (sometimes twice)
6. Content script extraction         (if job not saved yet)
────────────────────────────────────────────────────────
Typical total: 3–7 seconds (tunnel + Vercel mode)
```

**Code references:**
- Init waterfall: `extension/popup/popup.js` — `DOMContentLoaded` → `checkConnection` → `checkAuth` → `loadAll`
- API client (hardcoded Vercel): `extension/popup/api-client.js` — `DEFAULT_SERVER`
- Vercel proxy: `admin-web/next.config.ts` — rewrites `/api/*` to `API_URL`

### Extension — login

```text
1. POST /api/auth/login        (bcrypt + bidder validation + JWT)
2. loadAll()                   (same chain as above)
```

### Extension — save job

```text
1. POST /api/jobs/upsert
   → lookup job by URL
   → access check
   → upsert job
   → upsertCandidateStatuses (N+1 loop — see below)
   → getJobWithCandidates
```

### Admin web (Vercel)

```text
Browser → Vercel Next.js → rewrite → tunnel → PC API → Neon
```

Dashboard also calls `/api/jobs/stats`, which runs **~12 separate SQL queries** in one handler (`server/src/modules/jobs/jobs.routes.ts`).

---

## 3. Latency budget

Estimated times in **current** setup (Vercel + tunnel + PC):

| Action | Approx. time |
|--------|--------------|
| Extension open (authenticated) | **3–7 s** |
| Login + load workspace | **2–5 s** |
| Save job (30 candidates) | **1–3 s** |
| Job page auto-extract | **1–2 s** |
| Admin dashboard load | **2–6 s** |

### Targets after optimization

| Setup | Extension open | Save (30 candidates) |
|-------|----------------|----------------------|
| Current (Vercel + tunnel + PC) | 3–7 s | 1–3 s |
| Tunnel only + code fixes | 2–4 s | 0.5–1 s |
| **Cloud API + code fixes** | **< 1 s** | **< 0.5 s** |

---

## 4. Bottlenecks by layer

### 4.1 Architecture / network (critical)

| Issue | Location | Effect |
|-------|----------|--------|
| Double proxy (Vercel → tunnel) | `extension/popup/api-client.js`, `admin-web/next.config.ts` | +100–400 ms per request |
| Ephemeral tunnel URL | `scripts/start-cloud-tunnel.ps1`, `sync-vercel-api-url.bat` | Redeploy + downtime on restart |
| PC must stay awake | `start-server.bat` | Full outage if window closes |
| Extension cannot bypass Vercel | `api-client.js` returns fixed Vercel URL | Extra hop always |

### 4.2 Server / database (high)

| Issue | Location | Effect |
|-------|----------|--------|
| **N+1 on save** — 2 queries per candidate | `server/src/modules/jobs/jobs.routes.ts` → `upsertCandidateStatuses` | 30 candidates ≈ 60 queries |
| **12 queries** on `/api/jobs/stats` | `server/src/modules/jobs/jobs.routes.ts` | Slow admin dashboard |
| **3 sequential queries** on `/api/jobs/by-url` | Same file | Slow job lookup |
| **`getJobWithCandidates`** loads all active candidates per job | Same file | Heavy on large teams |
| **Duplicate bidder queries** on login | `server/src/modules/auth/auth.routes.ts` | +50–150 ms |
| **`/api/auth/me` hits DB** for bidder name every time | Same file | +1 query per session check |
| Migrations on every server start | `server/src/database/connection.ts` | Slower cold start |

**N+1 pattern (worst save-path bottleneck):**

```text
For each active candidate:
  1. SELECT existing candidate_jobs row
  2. INSERT ... ON CONFLICT UPDATE
→ 2N database round trips per save
```

### 4.3 Extension client (high)

| Issue | Location | Effect |
|-------|----------|--------|
| Sequential init (health → auth → load) | `extension/popup/popup.js` | Extra round trips |
| Up to 2 sequential `getJobByUrl` calls | `extension/popup/popup.js` | Duplicate lookup |
| Separate stacks endpoint | `loadCandidates()` | Extra HTTP call |
| `ensureServerUrl()` writes storage every open | `extension/popup/api-client.js` | Minor I/O |

### 4.4 Content extraction (high)

| Issue | Location | Effect |
|-------|----------|--------|
| 5 sequential `executeScript` injections | `extension/background/service-worker.js` | 200–500 ms |
| **700 ms** artificial delay before detect | `AUTO_DETECT_DELAY_MS = 700` | Fixed wait |
| Re-injects all scripts on every extract | Same file | Repeat cost |

### 4.5 Admin web / Vercel (medium)

| Issue | Location | Effect |
|-------|----------|--------|
| No edge caching on API rewrites | `admin-web/next.config.ts` | Full round-trip every call |
| Auth + settings waterfall on load | `AuthProvider`, `AdminUiModeProvider` | 2+ API calls |
| Health poll every 30 s | `PanelShell.tsx` | Background load |
| Heavy stats on dashboard | `DashboardView.tsx` | 12 DB queries behind proxy |

---

## 5. Optimizations ranked by impact

### Tier 1 — Architecture (largest real-world gain)

#### 1. Deploy API to a stable cloud host

**Problem:** PC + tunnel + Vercel sync is slow and fragile.

**Fix:** Deploy `server/` to Render, Railway, or Fly.io with Neon. The repo includes `render.yaml` as a starting blueprint.

```text
Extension  →  https://your-api.onrender.com
Admin UI   →  Vercel (API_URL = same cloud API)
Database   →  Neon (same region as API, e.g. US East)
```

**Gain:** Extension open **3–7 s → < 1 s** in many cases. No `start-server.bat` required for daily use.

**Steps:**
1. Connect GitHub repo to Render → Blueprint → `render.yaml`
2. Set `DATABASE_URL`, `ADMIN_PASSWORD`, `JWT_SECRET` in Render dashboard
3. Copy Render URL → Vercel env `API_URL` → redeploy admin web
4. Update extension `DEFAULT_SERVER` or read cloud URL from config

---

#### 2. Remove Vercel middle hop for extension

**Problem:** Extension → Vercel → tunnel → PC (3 hops before API).

**Fix:** Extension calls API URL **directly** (cloud API or tunnel URL from `tunnel-url.txt`).

**Gain:** ~100–400 ms **per request** × 5–7 calls = **0.5–2 s** on popup open.

---

#### 3. Use a named / persistent tunnel (if staying on PC)

**Problem:** Quick tunnel URL changes every `start-server.bat` restart.

**Fix:** Cloudflare named tunnel with fixed hostname, or skip tunnel entirely once API is on Render.

**Gain:** No `sync-vercel-api-url.bat` redeploy wait (~1–2 min) after restarts.

---

### Tier 2 — Server database (biggest code-level gain)

#### 4. Bulk upsert for `candidate_jobs`

Replace per-candidate loop with:
- One `SELECT` for existing applied locks
- One `INSERT ... SELECT FROM candidates WHERE is_active` + `ON CONFLICT DO UPDATE`

**File:** `server/src/modules/jobs/jobs.routes.ts` → `upsertCandidateStatuses`

**Gain:** 60 queries → 2 for 30 candidates. Save **0.5–2 s** faster.

---

#### 5. Add `GET /api/extension/bootstrap`

Single response:

```json
{
  "user": { "username", "bidderId", "bidderName", "role" },
  "candidates": [ ... ],
  "stacks": [ ... ]
}
```

**Gain:** 3 HTTP round trips → 1 (~300–800 ms saved on open).

---

#### 6. Merge `/api/jobs/by-url` into one SQL query

Combine: URL lookup + access check + candidate statuses.

**Gain:** 3 DB round trips → 1.

---

#### 7. Optimize `/api/jobs/stats`

Replace 12 separate queries with CTEs or one aggregate query. Optional: cache 30–60 s in memory.

**Gain:** Faster admin dashboard.

---

#### 8. Put `bidderName` in JWT

Skip DB lookup in `/api/auth/me`.

**File:** `server/src/modules/auth/auth.routes.ts`

**Gain:** ~50–150 ms per session check.

---

### Tier 3 — Extension client

| # | Action | Gain |
|---|--------|------|
| 9 | `Promise.all([health(), me(), bootstrap])` on init | ~1 RTT |
| 10 | Cache candidates in `chrome.storage.local` (5 min TTL) | Skip 2 calls on reopen |
| 11 | Deduplicate URLs before `getJobByUrl` | 1 RTT saved often |
| 12 | Remove `ensureServerUrl()` write on every open | Minor I/O |

---

### Tier 4 — Content extraction

| # | Action | File | Gain |
|---|--------|------|------|
| 13 | Inject all extractor files in **one** `executeScript` | `service-worker.js` | 200–500 ms |
| 14 | Track injected tabs — skip re-injection | `service-worker.js` | Repeat savings |
| 15 | Reduce `AUTO_DETECT_DELAY_MS` (700 → 200) or detect on `DOMContentLoaded` | `service-worker.js` | Up to 500 ms |

---

### Tier 5 — Admin web

| # | Action | Gain |
|---|--------|------|
| 16 | Merge auth + settings into one bootstrap call | 1 RTT |
| 17 | Pause health poll when tab hidden | Less background load |
| 18 | Lazy-load dashboard stats (skeleton first) | Perceived speed |

---

## 6. Quick wins (code)

Implementable without changing hosting:

| Priority | Task | Effort | Impact | File(s) |
|----------|------|--------|--------|---------|
| 1 | Bulk upsert `candidate_jobs` | Medium | High on save | `server/src/modules/jobs/jobs.routes.ts` |
| 2 | Single `executeScript` for all extractors | Low | Medium on extract | `extension/background/service-worker.js` |
| 3 | Parallel init (`Promise.all`) | Low | Medium on open | `extension/popup/popup.js` |
| 4 | Dedupe URLs before `getJobByUrl` | Low | Low–medium | `extension/popup/popup.js` |
| 5 | `bidderName` in JWT | Low | Low per `/me` | `server/src/modules/auth/auth.routes.ts` |
| 6 | Combine by-url SQL | Medium | Medium | `server/src/modules/jobs/jobs.routes.ts` |
| 7 | `GET /api/extension/bootstrap` | Medium | High on open | New route + popup |
| 8 | Candidate cache (5 min TTL) | Medium | Medium on reopen | `extension/popup/popup.js` |

### Implemented in this repo (no new cloud host)

These code optimizations are already applied — restart `start-server.bat` and reload the extension to use them:

| Optimization | Status |
|--------------|--------|
| Bulk upsert on job save (N+1 → 2 queries) | Done |
| `GET /api/auth/extension-bootstrap` (1 call vs 3) | Done |
| JWT includes `bidderName` — `/me` skips DB | Done |
| Login: single bidder query (not two) | Done |
| `/api/jobs/by-url` access check merged | Done |
| Extension: parallel startup + candidate cache (5 min) | Done |
| Extension: dedupe job URL lookups | Done |
| Extension: in-memory auth token cache | Done |
| Extractors: single injection + tab cache + 250ms detect | Done |

**To apply:** run `stop-server.bat` → `start-server.bat`, then reload extension in `chrome://extensions`.

---

## 7. Long-term architecture

### Recommended production topology

```text
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│ Chrome Extension│────▶│ Cloud API (Render)   │────▶│ Neon Postgres│
└─────────────────┘     │ fixed HTTPS URL      │     └─────────────┘
                        └──────────────────────┘
┌─────────────────┐              ▲
│ Vercel Admin UI │──────────────┘  (API_URL rewrite)
└─────────────────┘

Local PC: dev only (localhost:1028) — optional start-server.bat
```

### Render deploy (from this repo)

1. Open [Render Dashboard](https://render.com) → **New** → **Blueprint**
2. Connect repo: `qts-start-up-repository-job-tracking`
3. Uses `render.yaml` — service `qts-api`, `rootDir: server`
4. Set secrets:
   - `DATABASE_URL` — Neon connection string
   - `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, etc.
5. After deploy, copy service URL (e.g. `https://qts-api.onrender.com`)
6. Vercel → Environment → `API_URL` = that URL → redeploy
7. Extension → set `DEFAULT_SERVER` to same URL (or keep Vercel proxy)

### Region alignment

| Service | Recommended region |
|---------|-------------------|
| Neon database | US East (or nearest to users) |
| Render API | Same as Neon |
| Vercel | Auto (edge for static UI) |

Mismatch (e.g. API in US, DB in EU) adds **50–150 ms** per query.

---

## 8. Recommended roadmap

### Phase A — Quick code wins (1–2 days)

- [ ] Parallel API calls in extension popup
- [ ] Bulk upsert for candidate save
- [ ] Single-shot script injection + lower detect delay
- [ ] JWT includes `bidderName`

**Expected:** Noticeably faster save and extract; moderate improvement on open.

---

### Phase B — API consolidation (2–3 days)

- [ ] `GET /api/extension/bootstrap`
- [ ] Merge `/api/jobs/by-url` queries
- [ ] Optimize `/api/jobs/stats`
- [ ] Extension candidate cache (TTL)

**Expected:** Extension open **~30–50% faster** even on tunnel setup.

---

### Phase C — Cloud API (best long-term)

- [ ] Deploy `server/` to Render via `render.yaml`
- [ ] Point Vercel `API_URL` to Render
- [ ] Extension uses cloud API directly
- [ ] Retire tunnel for production (keep PC for local dev)

**Expected:** Extension open **< 1 s**; no `start-server.bat` for daily ops.

---

## 9. What is NOT the problem

| Myth | Reality |
|------|---------|
| "Vercel is slow" | Vercel UI is fast; **API proxy + tunnel** is slow |
| "Neon is slow" | Neon is fine when API is in the same region |
| "Extension UI/CSS" | Negligible vs network + DB |
| "Need a bigger PC" | Network hops matter more than CPU for API calls |
| "More Vercel redeploys" | Redeploy only needed when `API_URL` changes (tunnel restart) |

---

## Quick reference card

```text
┌────────────────────────────────────────────────────────────┐
│  QTS PERFORMANCE — ROOT CAUSE                               │
├────────────────────────────────────────────────────────────┤
│  Slow because: Extension → Vercel → Tunnel → PC → Neon    │
│  Not because: Vercel UI or extension CSS                  │
├────────────────────────────────────────────────────────────┤
│  #1 fix: Deploy API to Render + fixed API_URL               │
│  #2 fix: Bulk upsert on job save (N+1 loop)                 │
│  #3 fix: Bootstrap endpoint + parallel extension calls      │
├────────────────────────────────────────────────────────────┤
│  Current open time:  3–7 seconds                            │
│  Target open time:   < 1 second (cloud API)                 │
└────────────────────────────────────────────────────────────┘
```

---

## Related guides

| Guide | Purpose |
|-------|---------|
| `QTS-JOB-TRACKING-PROJECT-SETUP-GUIDE.md` | Install, deploy, tunnel, Vercel, Neon |
| `QTS-JOB-TRACKING-PROJECT-GUIDE.md` | Accounts, roles, workflows |
| `QTS-JOB-TRACKING-EXTENSION-GUIDE.md` | Extension install and capture |
| `render.yaml` | Render Blueprint for cloud API |
| `BUILD.md` | Developer build reference |

---

*QTS Job Tracking — Performance guide for Vercel, extension, and API optimization.*
