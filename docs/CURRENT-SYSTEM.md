# QTS Job Tracking — Current System

## Production architecture

The public application runs as a Vercel web app and a Vercel API connected to
Neon PostgreSQL:

```text
Browser → Vercel web app → Vercel API → Neon
```

The public application does not use a local API, local database, Render, or a
Cloudflare tunnel. `start.bat` opens the deployed public application.

## Active database tables

The API retains only the new-schema tables:

- `categories`
- `users`
- `job_list`
- `bids`
- `interviews`
- `app_settings`

At startup, the API drops the retired legacy tables and their dependent objects
using PostgreSQL `CASCADE`. This permanently deletes their contents. The active
tables listed above are kept. Legacy tables are not recreated by migrations.

## Active workflows

- Super creates Admin users; Admins create Managers and Callers; Managers
  create Account profiles.
- Managers create and manage job listings, assigning categories and Account
  profiles.
- Bids and interviews use the active new-schema data model.
- Users sign in to the web app at the deployed Vercel URL.

## Retired workflows

The extension's Manager login uses the new-schema API. Its job capture,
Account selection, candidate tracking, job-site admissions, and Custom GPT
application/PDF workflows still depend on retired endpoints and are not
available until those workflows are refactored.

## Deployment

See [DEPLOY.md](../DEPLOY.md) for Vercel and Neon configuration. The Super
account is initialized from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
