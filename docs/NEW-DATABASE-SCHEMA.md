# Proposed Job Tracking Database Schema

This document describes the new schema currently created by the database
initialization code in `server/src/database/connection.ts`. It is the target
model for the planned server and frontend rebuild.

The active new schema creates `users`, `bids`, `interviews`, `job_list`,
`categories`, `app_settings`, `prompts`, Manager application-answer tables,
Account application profiles, and Account-specific job rows. Each job row is
assigned to one Account and its status tracks the application lifecycle.
Startup removes the retired legacy tables after migrations complete. The
current public application uses the new schema.

## Relationship overview

```text
                         ┌──────────────┐
                         │  categories  │
                         │ category_id  │
                         └──────┬───────┘
                                │ one category per Account user
                                ▼
┌───────────────────┐     ┌─────────────┐
│       users       │────▶│    users    │
│ parent_user_id    │     │ category_id │
└──────┬───────┬────┘     └─────────────┘
       │       ├──────────────┐
       ▼       ▼              ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   job_list   │       │ app_settings │       │   prompts    │
│ manager u_id │       │ updated_by   │       │ audit users   │
└──────┬───────┘       └──────────────┘       └──────────────┘
       │ 1
       │
       │ many
       ▼
┌──────────────┐       ┌──────────────┐
│     bids     │──────▶│  interviews  │
│ Account u_id │ 1   * │ caller_user_id│
│    j_id      │       │              │
└──────────────┘       └──────────────┘
```

The arrows represent foreign-key references. The category and selected Account
assignments on `job_list` are integer arrays, not foreign keys; see
[Array-based job assignments](#array-based-job-assignments).

## Tables

### `users`

Stores all system identities, including Super, Admin, Manager, Caller, and
Account profiles. An Account profile represents a candidate and does not sign
in.

| Column | Type | Rules and purpose |
|---|---|---|
| `u_id` | Integer | Primary key, generated automatically |
| `username` | Text | Required and unique; sign-in identifier |
| `name` | Text | Required display name |
| `role` | Text | Required; `super`, `admin`, `manager`, `caller`, or `account` |
| `password_hash` | Text | Required for non-Account roles; must be `NULL` for Account |
| `must_change_password` | Boolean | Required; set for staff accounts given a temporary password and cleared after they change it; defaults to `false` |
| `parent_user_id` | Integer | References `users.u_id`; `NULL` for Super, required for all other roles |
| `email` | Text | Required for Account; nullable for other roles |
| `address` | Text | Required for Account; nullable for other roles |
| `sex` | Text | Required for Account; nullable for other roles |
| `birthday` | Date | Required for Account; nullable for other roles |
| `phone` | Text | Required for Account; nullable for other roles |
| `country` | Text | Required for Account; nullable for other roles |
| `managed_country` | Text | Optional country managed by a Manager; used to scope that Manager's reusable application answers |
| `city` | Text | Required for Account; nullable for other roles |
| `blocked_date` | Timestamp with time zone | `NULL` means not blocked; when blocked, stores the block time |
| `category_id` | Integer | Required for Account, references `categories.category_id`; must be `NULL` for other roles |

The parent relationship models the reporting/ownership hierarchy: Super has no
parent; Admins, Managers, Callers, and Accounts have a parent User. The
database enforces whether the parent is present, but role-specific hierarchy
rules (for example, only Admins creating Callers) must be enforced by the
server.

The intended access hierarchy is Super → Admin → Manager → Account. Managers
own the Account profiles they create. Callers are created by Admins and may
only view interviews assigned to them and submit an outcome for those
interviews. Admins manage their own Managers and Callers; Super manages Admins,
categories, and application settings. These are API authorization rules, not
database constraints.

Admin, Manager, and Caller accounts are created with temporary passwords and
must change those passwords after signing in. Account profiles do not
authenticate and have no password.

The schema prevents hard-deleting a User while the User is referenced as a
parent, Manager on a job, bidder, or interview caller. Blocking a User is
represented with `blocked_date` so that blocked profiles remain available for
review rather than being deleted.

### `categories`

Stores the job/profile categories used to match job listings with candidate
profiles.

| Column | Type | Rules and purpose |
|---|---|---|
| `category_id` | Integer | Primary key, generated automatically |
| `category_title` | Text | Required and globally unique (for example, `AI Engineer` and `AI/ML Engineer` are separate categories) |
| `created_date` | Timestamp with time zone | Required; defaults to the creation time |

Each Account User has one category through `users.category_id`. A job may have
multiple categories through `job_list.category_ids`.

### `job_list`

Stores jobs created by Managers. Account profiles are selected for each job,
initially based on category matching and then adjustable by the Manager.

| Column | Type | Rules and purpose |
|---|---|---|
| `j_id` | Integer | Primary key, generated automatically |
| `u_id` | Integer | Required foreign key to `users.u_id`; intended to identify the Manager who added the job |
| `url` | Text | Required; may repeat for separate Account rows |
| `application_type` | Text | Required; inferred from the URL and used to select a compatible application handler |
| `company` | Text | Required |
| `title` | Text | Required |
| `category_ids` | Integer array | Required; category IDs associated with the job; defaults to an empty array |
| `status` | Text | `processing`, `todo`, `did`, or `failed`; defaults to `todo` |
| `get_date` | Timestamp with time zone | Required; defaults to the creation time |

The current database only verifies that `u_id` exists. It does not verify that
the referenced User has the Manager role.

### `job_account_assignments`

Stores the Account relationship for each Account-specific job row. Each
`job_list` row has exactly one assignment; the Manager-facing API groups rows
with the same URL when displaying or editing a multi-Account job.

| Column | Type | Rules and purpose |
|---|---|---|
| `job_account_assignment_id` | Integer | Primary key, generated automatically |
| `j_id` | Integer | Required foreign key to `job_list.j_id`; assignments are removed with their job |
| `account_user_id` | Integer | Required foreign key to `users.u_id`; assignments are removed with their Account |
| `position` | Integer | Required positive value that preserves the Manager's Account selection order |

The `(j_id, account_user_id)` pair and `(j_id, position)` are each unique. The
job row's status is the application state, and the Manager Jobs table displays
each Account-specific row and its current status.

### `account_apply_runs`

Stores the active extension Apply run for an Account. A Manager can have only
one active run for an Account at a time, even across extension windows and
devices. Successful claims refresh the run's activity timestamp; a run with no
activity for 24 hours can be replaced once the Account has no `processing` job.

| Column | Type | Rules and purpose |
|---|---|---|
| `account_user_id` | Integer | Primary key and foreign key to `users.u_id`; enforces one run per Account |
| `manager_user_id` | Integer | Required foreign key to the owning Manager |
| `run_id` | UUID | Identifies one extension Apply sequence |
| `last_activity_at` | Timestamp with time zone | Updated during claims and job status changes; used to expire abandoned runs |

### `bids`

Records an Account user's application/bid on a job. Job details are not copied
into this table; they can be read by joining `bids` to `job_list`.

| Column | Type | Rules and purpose |
|---|---|---|
| `b_id` | Integer | Primary key, generated automatically |
| `u_id` | Integer | Required foreign key to `users.u_id`; intended to identify the Account User |
| `j_id` | Integer | Required foreign key to `job_list.j_id` |
| `resume_path` | Text | Required file path/reference for the resume |
| `applied_date` | Timestamp with time zone | Required; defaults to the creation time |

`UNIQUE (u_id, j_id)` allows many Accounts to bid on the same job and allows
each Account to bid on many jobs, but prevents the same Account from bidding
on the same job more than once. The database currently does not verify that
`u_id` has the Account role.

The Jobs page displays each bid's `resume_path` as plain text.

### `interviews`

Stores individual interview-stage records for a Bid. Multiple rows for one Bid
form the interview tree (for example, intro → tech-1 → tech-2 → final). Each
stage is a separate record with its own schedule and result.

| Column | Type | Rules and purpose |
|---|---|---|
| `i_id` | Integer | Primary key, generated automatically |
| `b_id` | Integer | Required foreign key to `bids.b_id` |
| `interview_time` | Time | Required |
| `interview_date` | Date | Required |
| `caller_user_id` | Integer | Required foreign key to `users.u_id`; intended to identify a Caller |
| `interviewer` | Text | Required interviewer name, stored as plain text |
| `step` | Text | Required; `intro`, `tech-1`, `tech-2`, or `final` |
| `status` | Text | `todo`, `did`, `failed`, or `respond_waiting`; defaults to `todo` |
| `outcome` | Text | Optional Caller/Manager assessment: `good`, `bad`, or `normal`; `NULL` means no outcome submitted |
| `created_date` | Timestamp with time zone | Required; defaults to the creation time |
| `comment` | Text | Optional Manager comment |

The database allows multiple interview rows for the same Bid, including
multiple rows for the same step. If the product should allow only one row per
stage, that uniqueness rule must be added later.

The Account User and job associated with an Interview can be retrieved through
`interviews.b_id` → `bids` → `users` and `job_list`; `u_id` is intentionally
not duplicated in `interviews`.

### `app_settings`

Stores application-wide key/value settings. Only Super is intended to manage
these values; that permission is enforced by the server, not by the table.

| Column | Type | Rules and purpose |
|---|---|---|
| `setting_name` | Text | Primary key; identifies the setting |
| `setting_value` | Text | Required value |
| `updated_by` | Integer | Optional foreign key to the User who last updated it; cleared if that User is deleted |
| `created_date` | Timestamp with time zone | Required; defaults to creation time |
| `updated_date` | Timestamp with time zone | Required; defaults to creation time and should be updated when the value changes |

This table is named `app_settings` to avoid a collision with the legacy
`settings` table while both schemas coexist.

### `prompts`

Stores reusable prompt templates. Super users can create, edit, and delete
prompts through the Super-only database management screen.

| Column | Type | Rules and purpose |
|---|---|---|
| `prompt_id` | Integer | Primary key, generated automatically |
| `prompt_name` | Text | Required and unique name for the prompt |
| `prompt_content` | Text | Required prompt template content; limited to 50,000 characters by the management API |
| `created_by` | Integer | Optional foreign key to the User who created it; cleared if that User is deleted |
| `updated_by` | Integer | Optional foreign key to the User who last updated it; cleared if that User is deleted |
| `created_date` | Timestamp with time zone | Required; defaults to the creation time |
| `updated_date` | Timestamp with time zone | Required; defaults to the creation time and updated when the prompt changes |

The table stores prompt content only; consuming these prompts in automation
is outside the scope of this schema change.

### Manager application answers

`manager_application_profiles` stores a Manager's shared country-level
answers for work authorization, authorization status and expiry, sponsorship,
relocation, and notice period. `manager_salary_answers` stores multiple
entries per Manager with a three-letter currency code, optional minimum and
maximum amounts, pay period, and optional reusable text. Currency values are
not converted automatically. `manager_custom_application_answers` stores
Manager-defined reusable employer questions, answers, and topics.

Managers can edit their own data; Super can manage any Manager's data.
Dependent rows are deleted if their Manager is deleted. The global
`application_submission_mode` setting is seeded as `manual`. The browser
extension consumes it for supported Workable application forms. CAPTCHA is
never bypassed; uncertain form fields remain for manual review.

### Account application profiles

`account_application_profiles` stores each Account's first and last name,
durable PDF resume bytes and filename, structured education records, and
structured work-experience records. Resume uploads are limited to PDF files up
to 4 MB. Resume content is stored in PostgreSQL so it persists across Vercel
deployments.

### Account-specific job rows

Every Manager/job URL/Account combination has one `job_list` row and one
`job_account_assignments` row. The `job_list.status` value is the application
source of truth: `todo` → `processing` → `did` on confirmed submission, or
`failed` when an application fails. A Manager can reset `failed` → `todo` to
retry a row after addressing the cause; resets are rejected while its Account
has an active Apply run and discard the failed GPT task so the retry starts
cleanly. `application_type` identifies the site
handler; Workable is the first supported type, and unsupported types stay
queued until a compatible handler is available. Claiming a row is transactional.
The GPT task references the Account-specific `job_list.j_id` directly; there is
no separate application-attempt record.

When a Manager updates the selected Accounts for a saved URL, newly selected
Accounts receive `todo` rows. Unchecked `todo` rows are deleted. Unchecked rows
in any other status are retained and reported to the Manager. Manager and
Super job deletion is scoped to an individual Account-specific row, and its
associated Bids/interviews follow the corresponding deletion policy.

## Relationship details

- **Users → Users:** one parent User can have multiple child Users; each
  non-Super User has one parent.
- **Categories → Users:** one Category can be assigned to many Account
  profiles; each Account profile has exactly one Category.
- **Users (Manager) → Job List:** one Manager can create many
  Account-specific job rows. A URL may have separate rows for different
  Accounts, but not duplicate rows for the same Account.
- **Job List → Bids:** one job can have bids from many Account profiles.
- **Users (Account) → Bids:** one Account profile can submit bids for many
  jobs, but only once per job.
- **Bids → Interviews:** one Bid can have multiple interview-stage records.
- **Users (Caller) → Interviews:** one Caller can be assigned to many
  interview records.
- **Users → App Settings:** one User may be recorded as the last updater of
  many settings.
- **Users → Prompts:** one User may create or update many prompts.

## Job assignments and categories

Account assignments use `job_account_assignments` rather than an Account ID
array on `job_list`. Each job row has exactly one assigned Account, referenced
by a foreign-key-constrained relationship row. The `position` column remains
for compatibility with earlier assignments.

The API continues accepting `selectedAccountUserIds` as a list when a Manager
saves or edits a job. It validates ownership and category matching, then
creates or synchronizes one job row and one assignment row per selected
Account in a transaction. The `selected_account_u_ids` property in grouped
job-check responses is derived from those relationship rows for compatibility;
it is no longer a database column.

`category_ids` remains an integer array. Server code validates that every
category exists and that selected Accounts match the job categories unless
the Manager intentionally overrides the initial category-based selection.
On startup, the schema migration copies existing Account IDs and their order
from `job_list.selected_account_u_ids` into `job_account_assignments`, splits
legacy multi-Account jobs into Account-specific job rows, moves matching Bid
and GPT task references, then removes the old attempt table and
`selected_account_u_ids` column.

## Useful queries

Retrieve a Bid with its Account and job details:

```sql
SELECT
  b.b_id,
  account.u_id AS account_u_id,
  account.name AS account_name,
  j.j_id,
  j.url,
  j.company,
  j.title,
  b.resume_path,
  b.applied_date
FROM bids AS b
JOIN users AS account ON account.u_id = b.u_id
JOIN job_list AS j ON j.j_id = b.j_id
WHERE b.b_id = $1;
```

Retrieve a Bid's interview stages in display order:

```sql
SELECT
  i.*,
  caller.name AS caller_name
FROM interviews AS i
JOIN users AS caller ON caller.u_id = i.caller_user_id
WHERE i.b_id = $1
ORDER BY
  CASE i.step
    WHEN 'intro' THEN 1
    WHEN 'tech-1' THEN 2
    WHEN 'tech-2' THEN 3
    WHEN 'final' THEN 4
  END,
  i.interview_date,
  i.interview_time;
```

## Current implementation boundary

The schema is created alongside the legacy tables by database initialization.
The legacy server and frontend continue to use the legacy tables. A first
versioned API slice now uses the proposed tables without changing or deleting
legacy data:

- `POST /api/v2/auth/login`, `GET /api/v2/auth/me`, and the password/profile
  update routes authenticate against `users`.
- `/api/v2/users` provisions Super → Admin → Manager/Caller → Account
  ownership; Account profiles have no password or login.
- `/api/v2/categories` and `/api/v2/settings` apply Super-only writes.
- `/api/v2/jobs` lets Managers manage their own jobs and selected Account
  profiles; Admins can read jobs owned by their Managers and Super can read all.
- `/api/v2/jobs/apply-accounts` returns each active Account's total and `did`
  row counts, plus queue availability and active-run state.
- `/api/v2/jobs/claim-next` accepts the selected Account, Apply run ID, and the
  extension's supported application types; it serializes claims per Account
  and atomically claims the next matching `todo` Account-specific row, setting
  it to `processing`. A confirmed
  submission sets the row to `did` and creates its Bid; failure sets it to
  `failed`.
- `/api/v2/jobs/apply-runs/release` releases an Apply run after a startup error
  when no job for that Account remains in `processing`.
- `PATCH /api/v2/jobs/:id/status` lets the extension close a `processing` row
  as `did` or `failed`, and lets its Manager reset a `failed` row to `todo`.
  Other manual status transitions are rejected.
- `/api/v2/gpt-application-tasks/jobs/:jobId` creates or resumes the GPT task
  directly from the processing job row and its one assigned Account.
- `/api/v2/manager-application-profile` is Manager-only and reads or writes
  only the authenticated Manager's reusable application answers. Super users
  cannot select another Manager's profile.
- `/api/v2/bids` exposes role-scoped Bid records and rejects unassigned
  Accounts and duplicate Bids.
- `/api/v2/interviews` scopes reads to the caller or reporting hierarchy;
  Managers schedule/edit interviews and Callers submit only the outcome on
  their assigned interviews.
- `/api/v2/analytics` provides role-scoped bid and interview counts grouped by
  day, week, month, or year, with Manager and Account breakdowns for Admins and
  Super users.
- `/api/v2/database` provides Super-only browsing and record management for an
  explicit allowlist of business tables, including prompts, with search and
  pagination. Credential hashes and application-session data are deliberately
  excluded.

The role-based frontend now uses the versioned APIs for login, first-login
password changes, staff and Account management, jobs, interviews, categories,
analytics, and personal profile settings. Callers see only assigned interviews
and can submit outcomes; Managers can manage their jobs, Account profiles,
interviews, and scoped analytics; Admins and Super users have scoped staff and
reporting views.
For the extension's Manager workflow, Get JD saves Account-specific rows to
`/api/v2/jobs`. Apply prompts the Manager to select one Account, shows each
Account's total rows and `did` count, and claims only that Account's supported
`todo` rows using `/api/v2/jobs/claim-next`; it does not use
application-attempt or legacy candidate/session records.
Workable is the first supported site-specific handler for this automated
application flow. Other application types can be added without changing the
Account-specific job-row/status model.

News and the Super-only system-settings UI are not yet migrated. The
`/api/v2/settings` API exists, but there is no corresponding frontend screen
yet. Legacy pages outside the migrated role routes may still use legacy APIs;
do not pass a new-schema identity to those endpoints, where a user ID could be
interpreted as a legacy `admins.id`. The old tables have not been dropped.
Before any destructive database replacement, confirm the backup and migration
strategy.
