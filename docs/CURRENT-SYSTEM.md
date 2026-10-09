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
- `custom_gpts`
- `manager_custom_gpt_assignments`

At startup, the API drops the retired legacy tables and their dependent objects
using PostgreSQL `CASCADE`. This permanently deletes their contents. The active
tables listed above are kept. Legacy tables are not recreated by migrations.

## Active workflows

- Super creates Admin users; Admins create Managers and Callers; Managers
  create Account profiles.
- Managers create and manage job listings, assigning categories and Account
  profiles. A job is stored once in `job_list`; each assigned Account has a
  separate ordered row in `job_account_assignments`.
- Managers can delete old job listings from their active list even when there
  is application history. The associated retry-blocking attempt rows are cleared;
  Bids and linked interview records remain as history.
- Bids and interviews use the active new-schema data model.
- Users sign in to the web app at the deployed Vercel URL.
- Each Manager manages only their own reusable application answers on the
  Manager Application Answers page. Super users cannot read or edit these
  Manager-owned answers.
- Super can configure the global application submission mode. It defaults to
  `manual`.
- Super manages the Custom GPT library on the People page and can assign one
  library GPT to multiple Managers. Each Manager has at most one assignment;
  the GPT URL is not shown in the Manager page or extension. The extension
  blocks its GPT Apply actions when no GPT is assigned and tells the Manager
  to contact an Admin.
- The extension popup's Apply action opens the assigned Custom GPT, then
  atomically claims the next available `todo` job/Account pair for that
  Manager from `job_list` and opens the saved Workable job URL. Jobs are
  ordered by the job-list order; Accounts follow their configured assignment
  order. An `in_progress` claim can be reclaimed after ten minutes without an
  attempt update. Get JD creates and updates jobs in this same Manager-owned
  list; Manager Apply does not use the legacy candidate/application-session
  pipeline.
- The browser extension processes assigned Accounts sequentially on supported
  Workable job pages. It fills the Account profile, PDF resume, and recognized
  Manager answers, then waits for review in Manual mode. A Bid is created only
  when Workable confirms submission, in the same transaction that closes the
  attempt. Auto mode submits only when required fields have known answers.
  Unknown required questions are marked Failed; CAPTCHA/security checks are
  never bypassed and require manual completion. An unclear submission result
  remains in Needs review and is not retried. Other job sites are not yet
  supported by this Manager Apply pipeline.
- The Manager Bid Status page shows each assigned Account's status and keeps
  past attempt history visible if an Account is later unassigned from a job.
- The existing Manager → Jobs table shows each job once and lists its assigned
  Accounts with each Account's individual application-attempt status.

## Retired workflows

The extension's Manager login uses the new-schema API. Super-managed Custom GPT
assignments are not yet connected to task-context retrieval or generated
application answers/documents in the new-schema job/Account workflow. Workable
is the first supported job-site form automation flow; other sites and the
retired Custom GPT application/PDF workflow are not part of that pipeline.

## Deployment

See [DEPLOY.md](../DEPLOY.md) for Vercel and Neon configuration. The Super
account is initialized from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
