# Deploy QTS_Startup on Vercel and Neon

The public setup uses two Vercel projects and a Neon PostgreSQL database. The
API runs as Vercel Functions; using the public application does not require
`start-server.bat`, a local API, or a tunnel.

```text
Chrome/Edge extension ──┐
                       ├──► Vercel web app ──► Vercel API functions ──► Neon
Admin web app ─────────┘
```

The web app proxies `/api/*` requests to the API deployment. The extension uses
the public web app URL, so it follows the same proxy.

## 1. Create a Neon database

1. Create a PostgreSQL project at [Neon](https://neon.tech).
2. Copy its pooled connection string, including `sslmode=require`.
3. Keep the connection string private; configure it only as a Vercel secret.

## 2. Deploy the API to Vercel

1. Import this GitHub repository into Vercel as a new project.
2. Set **Root Directory** to `server`.
3. Add the following production environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled PostgreSQL connection string |
   | `DATABASE_SSL` | `true` |
   | `EMBEDDED_PG` | `false` |
   | `APPLICATION_SESSION_PERSIST_DB` | `true` |
   | `JWT_SECRET` | Unique random secret with at least 32 characters |
   | `ADMIN_USERNAME` | Initial Super account name |
   | `ADMIN_PASSWORD` | Strong initial Super account password |
   | `MANAGER_PASSWORD` | Strong seed password |
   | `ACCOUNT_PASSWORD` | Strong seed password |
   | `CALLER_PASSWORD` | Strong seed password |
   | `ADMIN_WEB_URL` | `https://YOUR-WEB-APP.vercel.app/login` |
   | `AUTO_OPEN_BROWSER` | `false` |
   | `HOST` | `0.0.0.0` |

   The four passwords are required by the API startup validation. Change the
   initial account passwords after the first login.

4. Deploy. The first API request initializes the Neon schema and seeds accounts.
5. Test `https://YOUR-API-PROJECT.vercel.app/api/health`.

The API stores application sessions, fields, and generated PDF documents in
Neon so they remain available when requests reach different function instances.
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

## 4. Configure the extension

Load the `extension/` folder as an unpacked extension in Chrome or Edge. Keep
the API server URL set to the public web app origin:

```text
https://YOUR-WEB-APP.vercel.app
```

Sign in with a Manager account and select its assigned Account team. Requests
are forwarded through the web app to the Vercel API and Neon.

## Cost and availability

Vercel and Neon offer free tiers, subject to their current quotas, execution
limits, and terms. This configuration avoids paying for a separate always-on
server, but free-tier quotas are not unlimited and may change.
