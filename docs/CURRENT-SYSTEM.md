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
- `gpt_application_tasks`
- `gpt_application_task_documents`
- `custom_gpts`
- `manager_custom_gpt_assignments`

At startup, the API drops the retired legacy tables and their dependent objects
using PostgreSQL `CASCADE`. This permanently deletes their contents. The active
tables listed above are kept. Legacy tables are not recreated by migrations.

## Active workflows

- Super creates Admin users; Admins create Managers and Callers; Managers
  create Account profiles.
- Managers create and manage job listings, assigning categories and Account
  profiles. Each selected Account receives its own `job_list` row and
  `job_account_assignments` row for the same URL.
- Unchecking an Account removes only its `todo` job row. Non-`todo` rows are
  retained and reported to the Manager so application history is not erased.
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
- The extension popup's Apply action selects an available application handler,
  then atomically claims one compatible `todo` Account-specific job row,
  changes its status to `processing`, and opens the saved job URL. A confirmed application
  changes that row to `did`; an application failure changes it to `failed`
  and the extension continues with the next `todo` row.
- Workable is the first site-specific application handler. Each job row stores
  its application type, and the queue claims only types supported by an
  installed handler; additional site handlers can be added independently.
- The GPT-assisted Workable Apply workflow processes Account-specific job rows
  sequentially. It creates a site-neutral GPT task keyed by the
  job row, captures the job description and each application page,
  and sends the task to the Manager's assigned Custom GPT. The GPT can answer
  only from supplied Account and Manager facts; uncertain, consent, legal, and
  security-verification fields require manual review. Requested resumes and
  cover letters are stored with the application as generated PDFs. Safe
  Next/Continue steps may proceed automatically, but the final job-site Submit
  action always remains manual. Copied candidate/resume context is cleared when
  an application ends or after 30 days of inactivity. Other job sites are not
  yet supported by an application handler.
- A Bid is created when an application handler confirms submission and the row
  is changed to `did`. A row that is not `todo` cannot be removed by unchecking
  its Account.
- The Manager Bid Status and Jobs pages display each Account-specific job row
  and its `todo`, `processing`, `did`, or `failed` status.

## Retired workflows

The extension's Manager login uses the new-schema API. The retired
candidate/application-session and direct legacy GPT application/PDF workflows
are not part of the active Manager → Apply pipeline. Workable is the first
supported site-specific connector.

## Deployment

See [DEPLOY.md](../DEPLOY.md) for Vercel and Neon configuration. The Super
account is initialized from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
