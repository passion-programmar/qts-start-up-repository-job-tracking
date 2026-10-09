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
- `prompts`
- `manager_application_profiles`
- `manager_salary_answers`
- `manager_custom_application_answers`
- `account_application_profiles`
- `application_attempts`

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
- Managers and Super can manage country-scoped reusable application answers.
  These include work authorization, sponsorship, relocation, notice period,
  multiple salary entries, and custom question-and-answer entries.
- Super can configure the global application submission mode. It defaults to
  `manual`.
- The browser extension processes assigned Accounts sequentially on supported
  Workable job pages. It fills the Account profile, PDF resume, and recognized
  Manager answers, then waits for review in Manual mode. Auto mode submits only
  when required fields have known answers. Unknown required questions are
  marked Failed; CAPTCHA/security checks are never bypassed and require manual
  completion. An unclear submission result remains in Needs review and is not
  retried.
- The Manager Bid Status page shows each assigned Account's status and keeps
  past attempt history visible if an Account is later unassigned from a job.

## Retired workflows

The extension's Manager login uses the new-schema API. Workable is the first
supported job-site application flow; other sites and the retired Custom GPT
application/PDF workflow are not part of this implementation.

## Deployment

See [DEPLOY.md](../DEPLOY.md) for Vercel and Neon configuration. The Super
account is initialized from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
