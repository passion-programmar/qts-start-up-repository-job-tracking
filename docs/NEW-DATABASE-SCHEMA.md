# Proposed Job Tracking Database Schema

This document describes the new schema currently created by the database
initialization code in `server/src/database/connection.ts`. It is the target
model for the planned server and frontend rebuild.

The schema currently creates six tables: `users`, `bids`, `interviews`,
`job_list`, `categories`, and `app_settings`. The proposed `news` table is
deferred. These tables currently coexist with the legacy schema; the current
application still uses the legacy tables, and no existing data has been
migrated or deleted.

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
       │       │
       │       └──────────────┐
       ▼                      ▼
┌──────────────┐       ┌──────────────┐
│   job_list   │       │ app_settings │
│ manager u_id │       │ updated_by   │
└──────┬───────┘       └──────────────┘
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
| `url` | Text | Required and unique |
| `company` | Text | Required |
| `title` | Text | Required |
| `category_ids` | Integer array | Required; category IDs associated with the job; defaults to an empty array |
| `selected_account_u_ids` | Integer array | Required; selected Account User IDs eligible for the job; defaults to an empty array |
| `status` | Text | `processing`, `todo`, `did`, or `failed`; defaults to `todo` |
| `get_date` | Timestamp with time zone | Required; defaults to the creation time |

The current database only verifies that `u_id` exists. It does not verify that
the referenced User has the Manager role.

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

## Relationship details

- **Users → Users:** one parent User can have multiple child Users; each
  non-Super User has one parent.
- **Categories → Users:** one Category can be assigned to many Account
  profiles; each Account profile has exactly one Category.
- **Users (Manager) → Job List:** one Manager can create many jobs.
- **Job List → Bids:** one job can have bids from many Account profiles.
- **Users (Account) → Bids:** one Account profile can submit bids for many
  jobs, but only once per job.
- **Bids → Interviews:** one Bid can have multiple interview-stage records.
- **Users (Caller) → Interviews:** one Caller can be assigned to many
  interview records.
- **Users → App Settings:** one User may be recorded as the last updater of
  many settings.

## Array-based job assignments

To keep the proposed schema to the requested six tables, `job_list` stores
`category_ids` and `selected_account_u_ids` as PostgreSQL integer arrays
instead of using separate join tables. PostgreSQL can index these arrays with
GIN indexes, but it cannot enforce a foreign key for each array element.

Therefore, server code must validate that:

1. Every `category_ids` entry refers to an existing Category.
2. Every `selected_account_u_ids` entry refers to an existing Account User.
3. Selected Account profiles match the job's categories according to the
   application rules, unless the Manager intentionally overrides the initial
   category-based selection.

When deleting a Category or Account profile, the server must also remove or
update its ID in any affected job arrays. For stronger referential integrity,
the future design could replace these arrays with relationship tables, but
that would increase the number of tables.

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
- `/api/v2/bids` records automation-submitted bids for a selected Account using
  the owning Manager's authenticated session; it rejects unassigned Accounts
  and duplicate bids.
- `/api/v2/interviews` scopes reads to the caller or reporting hierarchy;
  Managers schedule/edit interviews and Callers submit only the outcome on
  their assigned interviews.
- `/api/v2/analytics` provides role-scoped bid and interview counts grouped by
  day, week, month, or year, with Manager and Account breakdowns for Admins and
  Super users.

The role-based frontend now uses the versioned APIs for login, first-login
password changes, staff and Account management, jobs, interviews, categories,
analytics, and personal profile settings. Callers see only assigned interviews
and can submit outcomes; Managers can manage their jobs, Account profiles,
interviews, and scoped analytics; Admins and Super users have scoped staff and
reporting views.

News and the Super-only system-settings UI are not yet migrated. The
`/api/v2/settings` API exists, but there is no corresponding frontend screen
yet. Legacy pages outside the migrated role routes may still use legacy APIs;
do not pass a new-schema identity to those endpoints, where a user ID could be
interpreted as a legacy `admins.id`. The old tables have not been dropped.
Before any destructive database replacement, confirm the backup and migration
strategy.
