# Deploy QTS_Startup on Vercel and Neon

The public setup uses two Vercel projects and a Neon PostgreSQL database. The
API runs as Vercel Functions; using the public application does not require
`start-server.bat`, a local API, or a tunnel.

```text
Browser ──► Vercel web app ──► Vercel API functions ──► Neon
```

The web app proxies API requests to the API deployment. The deployed system
uses the new-schema tables only. The extension supports the new Manager login,
job-posting capture, and Manager-triggered Scanner assistance on supported
application sites, including Workable. Scanner is limited to the visible step,
requires Manager review, and never navigates or submits the application. The
retired Manager Apply queue and Workable-specific application handler are not
part of this workflow.

Vercel deployment updates the web app and API only. The browser extension is a
separate deliverable; update or reload the unpacked extension from the
`extension` directory to use the latest capture and Scanner behavior.

## 1. Create a Neon database

1. Create a PostgreSQL project at [Neon](https://neon.tech).
2. Copy its pooled connection string, including `sslmode=require`.
3. Keep the connection string private; configure it only as a Vercel secret.

## 2. Deploy the API to Vercel

1. Import this GitHub repository into Vercel as a new project.
2. Set **Root Directory** to `server`.
   The included `server/vercel.json` selects Vercel's Express preset. Local
   database files, build output, and environment files are excluded from
   deployment uploads. Set the API Node.js runtime to 22.17 or newer (Node 22
   or 24) for the bundled Chromium renderer.
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
   | `APPLICATION_SESSION_PERSIST_DB` | `true` |
   | `GPT_ACTION_API_KEY` | A strong random secret shared only with the Custom GPT Action |
   | `CRON_SECRET` | A separate strong random secret for Vercel scheduled cleanup |

   Enable `APPLICATION_SESSION_PERSIST_DB=true` when application sessions and
   learned field policies must survive serverless invocations or server
   restarts. The default `false` keeps application sessions and their learning
   data in process memory; those sessions expire after four hours of inactivity
   and memory state is lost when the process exits.

   Only the initial Super account password is needed to seed the first login.
   Super creates Admin accounts; Admins create Managers and Callers; Managers
   create Account profiles, which do not have login passwords.

4. Deploy. The first API request initializes the Neon schema and seeds accounts.
5. Test `https://YOUR-API-PROJECT.vercel.app/api/health`.
6. Configure the Custom GPT Action using
   [docs/openapi/custom-gpt-application-actions.yaml](docs/openapi/custom-gpt-application-actions.yaml)
   and the same `GPT_ACTION_API_KEY` as Bearer authentication. The GPT
   instructions and setup checklist are in
   [docs/CUSTOM-GPT-SETUP.md](docs/CUSTOM-GPT-SETUP.md). Redeploy the API after
   changing either environment variable.

The QTS resume PDF endpoint renders the same FlowCV HTML, CSS, and embedded
fonts shown in the web preview using headless Chromium. The API deployment
includes the serverless Chromium binary; allow at least 512 MB of memory for
the API function so PDF rendering has enough room.

Before deploying a release that runs database migrations, create and verify a
recoverable production database backup. The first API request after deployment
removes retired legacy tables using `CASCADE`; this permanently deletes their
contents and dependent objects. The active tables retained include
`categories`, `users`, `job_list`, `bids`, `interviews`, `app_settings`,
`prompts`, Manager application-answer tables, Account application profiles,
Account-specific job rows, GPT application tasks, and generated task documents.
The API's daily cleanup cron requires `CRON_SECRET`.
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
