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
- `job_account_assignments`
- `account_apply_runs`
- `bids`
- `interviews`
- `app_settings`
- `application_site_templates`
- `prompts`
- `manager_application_profiles`
- `manager_salary_answers`
- `manager_custom_application_answers`
- `account_application_profiles`
- `account_custom_application_answers`
- `gpt_application_tasks`
- `gpt_application_task_documents`
- `custom_gpts`
- `manager_custom_gpt_assignments`

Super users can browse and manage application-table records from the Admin
database screen. That browser excludes the migration ledger and password
hashes, and it shows only metadata for binary resume/document content.

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
- Each Manager manages reusable global application answers on the Manager
  Application Answers page. Each Account also has its own reusable Q&A entries
  in its Account profile; Account-specific answers take precedence over global
  answers when the application question matches. Super users cannot read or
  edit Manager-owned answers. Candidate-specific compensation, work
  authorization, sponsorship, education, referral, schedule, and availability
  questions require Account-specific answers or user confirmation; the Apply
  workflow does not use Manager-wide values or GPT inference for these fields.
- Managers can generate a resume PDF from JSON in the Manager PDFs page. The
  page offers QTS_Resume_1 (based on the supplied FlowCV resume reference),
  Classic ATS, and Compact templates with
  a preview. QTS_Resume_1 updates directly from valid JSON in the browser and
  uses that same HTML/CSS layout for US Letter printing or saving as PDF
  through the browser print dialog. Classic ATS and Compact PDFs are rendered
  by the API in memory and downloaded locally; QTS does not persist generated
  files. QTS_Resume_1 reuses the downloaded FlowCV resume markup and stylesheet,
  with the saved Zilla Slab font files, and updates its text from valid JSON.
  API-rendered PDF pages are displayed directly to a canvas with page
  navigation, zoom, and fit-width controls.
- Super can configure the global application submission mode. It defaults to
  `manual`.
- Super can manage Custom GPT assignments and reusable application profile
  data; these records remain available for future supported workflows.
- The Manager Apply queue and Workable-specific application handler are not
  shipped. Workable rows support job tracking and the same generic Manager
  Scanner flow as other supported sites; claim, application-context, and
  job-scoped GPT task routes accept Workable rows.
- Managers can explicitly click Scanner on supported application pages,
  including Workable, to scan the visible application step. Scanner first
  loads job details through
  the Get JD flow, lets the Manager choose an Account, then saves or updates
  the job and starts that Account's exact `todo` row before using its
  job-scoped GPT task. Scanner stores Manager-owned answer strategies separately from the
  shared structural template. Confirmed Profile Answer values are read from
  the selected Account; missing values can be entered for that application
  only. Confirmed Reusable Answers are saved to the Manager's existing
  reusable Q&A store. Matched Profile and Reusable fields can be filled on the
  current step after Manager confirmation.
- On first-time capture, Scanner automatically observes each visible step
  twice and reconciles its fields and bounded DOM/locator evidence, including
  weak class-name hints. Later unchanged steps use one observation and repeat
  the capture only when a meaningful change or uncertainty is detected.
  Disagreements are presented for Manager review; unresolved fields remain
  untouched. Scanner never treats class names alone as field identity. These
  checkpoints store structural evidence, not entered field values.
- Generated Answer fields and detected resume/cover-letter upload fields are
  sent to the selected job's Custom GPT task with the job description from
  Get JD; if it is missing there and on the task, Scanner asks the Manager to
  provide it. The Manager reviews/edits generated answers and confirms each
  document upload before Scanner fills the current step. Generated text and
  documents remain task-scoped; Scanner does not save them to reusable
  answers or Account profiles. Scanner does not advance pages or submit
  applications. A GPT task that is already active or closed cannot be
  overwritten. Scanner claims only the selected Account's exact `todo` row
  through the existing Apply-run lock; later step scans resume that same
  Scanner run rather than starting another one. These boundaries also apply to
  Workable.
- Generic read-only site-template discovery remains available to other
  extension users. It records structural field/step checkpoints only; it does
  not save typed answers, fill fields, navigate, or submit.
- Managers can continue to track application outcomes through their Jobs and
  Bids workflows. The row status and manual confirmation controls remain.
  Workable uses the generic Scanner rather than a site-specific handler.
- The Manager Bid Status and Jobs pages display each Account-specific job row
  and its `todo`, `processing`, `did`, or `failed` status. Managers can reset a
  `failed` row to `todo` from either page for tracking and cleanup. This does
  not start an application attempt; Scanner starts only after an explicit
  Manager action, and no Manager Apply queue is currently shipped.
- Extension discovery stores structural site-template drafts in
  `application_site_templates`. Manager-confirmed strategies are stored in
  `manager_application_template_rules`, scoped to the Manager and template;
  confirmed reusable Q&A remains in `manager_custom_application_answers`.
  Per-tab discovery checkpoints contain field mappings and observed step
  transitions, not raw DOM. Every scan uses the generic scanner; saved partial
  templates are revalidated against each page and never trigger automatic
  navigation. Manager Scanner filling is limited to confirmed Profile and
  Reusable answers on the visible step.
  Promotion is restricted to Super and requires two distinct observed steps,
  revalidated high-confidence stable field mappings, and explicit confirmation
  of authorized test conditions, manual review, and verification/security
  review. Changed active templates return to partial pending revalidation.
  Super users can review templates and submit evidence from Admin → Template
  Review. The authenticated `POST /api/application-templates/:id/validate`
  endpoint records a validation report; it returns `422` and leaves the
  template inactive when any criterion fails. The page and endpoint compare
  submitted evidence against the saved discovery checkpoint; they do not
  independently rescan or verify a live ATS page.

## Retired workflows

The extension's Manager login uses the new-schema API. The retired
candidate/application-session and direct legacy GPT application/PDF workflows
are not part of the active Manager workflow. The previous Workable-specific
application connector and Manager Apply controls are no longer shipped.
Workable job capture and the generic, confirmation-gated Scanner flow remain
supported.

## Deployment

See [DEPLOY.md](../DEPLOY.md) for Vercel and Neon configuration. The Super
account is initialized from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
