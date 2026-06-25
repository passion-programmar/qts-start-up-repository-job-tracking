# Deploy guide (free tier)

Repo: https://github.com/passion-programmar/qts-start-up-repository-job-tracking

## 1. Push code to GitHub

Merge conflict is already resolved locally. You only need to authenticate once.

### Option A — Git Bash script (fastest)

```bash
export GITHUB_TOKEN=ghp_your_token_here
bash scripts/push-github.sh
```

Create token: https://github.com/settings/tokens (classic, **repo** scope)

### Option B — GitHub Desktop

1. Install https://desktop.github.com/
2. File → Add local repository → select this folder
3. Publish repository / Push origin

---

## 2. Neon (PostgreSQL, free)

1. https://neon.tech → New project
2. Copy `DATABASE_URL` (with `?sslmode=require`)

---

## 3. Render (API, free)

1. https://render.com → New → **Blueprint**
2. Connect repo `qts-start-up-repository-job-tracking`
3. Uses `render.yaml` in repo root
4. Set secret env vars when prompted:
   - `DATABASE_URL` = Neon connection string
   - `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `BIDDER_PASSWORD`, `CALLER_PASSWORD`
   - `ADMIN_WEB_URL` = `https://YOUR-APP.vercel.app/login` (after Vercel deploy)
5. Note API URL: `https://qts-api.onrender.com` (or your service name)

Test: `https://YOUR-API.onrender.com/api/health`

---

## 4. Vercel (UI, free)

1. https://vercel.com → Import GitHub repo
2. **Root Directory:** `admin-web`
3. **Environment variable:**
   ```
   API_URL=https://YOUR-API.onrender.com
   ```
4. Deploy

Test: `https://YOUR-APP.vercel.app/api/health`

Update Render `ADMIN_WEB_URL` to your Vercel login URL.

---

## 5. Extension (all users)

- Load unpacked: `extension/` folder
- **API Server URL:** `https://YOUR-APP.vercel.app` (no `/api/health`)
- Each user logs in with their bidder account

---

## Architecture

```
Extensions + Admin → Vercel → Render API → Neon Postgres
```
