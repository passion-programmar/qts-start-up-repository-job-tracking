# Deploy QTS_Startup on Vercel and Neon

The public setup uses two Vercel projects and a Neon PostgreSQL database. The
API runs as Vercel Functions; using the public application does not require
`start-server.bat`, a local API, or a tunnel.

```text
Browser ──► Vercel web app ──► Vercel API functions ──► Neon
```

The web app proxies API requests to the API deployment. The deployed system
uses the new-schema tables only; the older extension, candidates, auto-apply,
and legacy account workflows are not part of this deployment.

## 1. Create a Neon database

1. Create a PostgreSQL project at [Neon](https://neon.tech).
2. Copy its pooled connection string, including `sslmode=require`.
3. Keep the connection string private; configure it only as a Vercel secret.

## 2. Deploy the API to Vercel

1. Import this GitHub repository into Vercel as a new project.
2. Set **Root Directory** to `server`.
   The included `server/vercel.json` selects Vercel's Express preset. Local
   database files, build output, and environment files are excluded from
   deployment uploads.
3. Add the following production environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled PostgreSQL connection string |
   | `DATABASE_SSL` | `true` |
   | `EMBEDDED_PG` | `false` |
   | `JWT_SECRET` | Unique random secret with at least 32 characters |
   | `ADMIN_USERNAME` | Initial Super account name |
   | `ADMIN_PASSWORD` | Strong initial Super account password |
   | `ADMIN_WEB_URL` | `https://YOUR-WEB-APP.vercel.app/login` |
   | `AUTO_OPEN_BROWSER` | `false` |
   | `HOST` | `0.0.0.0` |

   Only the initial Super account password is needed to seed the first login.
   Super creates Admin accounts; Admins create Managers and Callers; Managers
   create Account profiles, which do not have login passwords.

4. Deploy. The first API request initializes the Neon schema and seeds accounts.
5. Test `https://YOUR-API-PROJECT.vercel.app/api/health`.

On first startup, the API removes the retired legacy tables and keeps the
new-schema data tables (`categories`, `users`, `job_list`, `bids`, `interviews`,
and `app_settings`). This is irreversible for the retired-table data.
Use Neon's pooled connection string to keep database connections within the
provider's limits.

## 3. Deploy the web app to Vercel

1. Create another Vercel project from the same repository.
2. Set **Root Directory** to `admin-web`.
3. Set the production environment variable `API_URL` to the API project origin,
   for example `https://YOUR-API-PROJECT.vercel.app` (no trailing slash).
4. Deploy and test `https://YOUR-WEB-APP.vercel.app/api/health`.

The Next.js rewrite in `admin-web/next.config.ts` sends API traffic to the
separate API project.

## Cost and availability

Vercel and Neon offer free tiers, subject to their current quotas, execution
limits, and terms. This configuration avoids paying for a separate always-on
server, but free-tier quotas are not unlimited and may change.
