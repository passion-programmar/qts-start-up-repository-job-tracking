import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { APP_NAME } from '../config/branding';
import { config } from '../config/env';
import { logger } from '../utilities/logger';

export interface DbQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

let pool: Pool | null = null;
let pglite: PGlite | null = null;

async function runQuery(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[]; rowCount?: number | null }> {
  if (pglite) {
    const result = await pglite.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
  if (!pool) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  const result = await pool.query(sql, params);
  return { rows: result.rows, rowCount: result.rowCount };
}

export async function initDb(): Promise<void> {
  if (config.useEmbeddedPg) {
    const dataDir = config.pgliteDataPath;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info('Created embedded database directory', { path: dataDir });
    }

    pglite = new PGlite(dataDir);
    await pglite.waitReady;
    logger.info('Embedded PostgreSQL ready (PGlite)', { path: dataDir });
    await runMigrations();
    return;
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (error) => {
    logger.error('Unexpected PostgreSQL pool error', error);
  });

  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected', { host: maskDatabaseUrl(config.databaseUrl) });
    await runMigrations();
  } catch (error) {
    await pool.end().catch(() => undefined);
    pool = null;
    throw formatConnectionError(error);
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (pglite) {
    await pglite.close();
    pglite = null;
  }
}

/** @deprecated Use queryAll/queryOne or pass DbQueryable to transactions. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('External PostgreSQL pool is not active. Is EMBEDDED_PG enabled?');
  }
  return pool;
}

export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await runQuery(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  const result = await runQuery(sql, params);
  return { rowCount: result.rowCount ?? 0 };
}

export async function dbQuery(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[]; rowCount?: number | null }> {
  return runQuery(sql, params);
}

export async function withTransaction<T>(
  fn: (client: DbQueryable) => Promise<T>
): Promise<T> {
  if (pglite) {
    return pglite.transaction(async (tx) => fn(tx as DbQueryable));
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client as DbQueryable);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function formatConnectionError(error: unknown): Error {
  if (error instanceof Error && 'code' in error) {
    const code = String((error as NodeJS.ErrnoException).code);
    if (code === 'ECONNREFUSED' || code === 'EACCES' || code === 'ENOTFOUND') {
      return new Error(
        'Could not connect to PostgreSQL. Start PostgreSQL (e.g. docker compose up -d postgres) ' +
        'or set EMBEDDED_PG=true in server/.env for a local file-based database.'
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '[configured]';
  }
}

async function runMigrations(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS categories (
      category_id SERIAL PRIMARY KEY,
      category_title TEXT NOT NULL UNIQUE,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      u_id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super', 'admin', 'manager', 'caller', 'account')),
      password_hash TEXT,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      parent_user_id INTEGER REFERENCES users(u_id) ON DELETE RESTRICT,
      email TEXT,
      address TEXT,
      sex TEXT,
      birthday DATE,
      phone TEXT,
      country TEXT,
      city TEXT,
      blocked_date TIMESTAMPTZ,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE RESTRICT,
      CHECK (
        (role = 'super' AND parent_user_id IS NULL) OR
        (role <> 'super' AND parent_user_id IS NOT NULL)
      ),
      CHECK (
        (role = 'account' AND password_hash IS NULL AND category_id IS NOT NULL
          AND email IS NOT NULL AND address IS NOT NULL AND sex IS NOT NULL
          AND birthday IS NOT NULL AND phone IS NOT NULL AND country IS NOT NULL AND city IS NOT NULL) OR
        (role <> 'account' AND password_hash IS NOT NULL AND category_id IS NULL)
      )
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS custom_gpts (
      custom_gpt_id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      gpt_id TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS manager_custom_gpt_assignments (
      manager_user_id INTEGER PRIMARY KEY REFERENCES users(u_id) ON DELETE CASCADE,
      custom_gpt_id INTEGER NOT NULL REFERENCES custom_gpts(custom_gpt_id) ON DELETE RESTRICT,
      assigned_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
      assigned_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS job_list (
      j_id SERIAL PRIMARY KEY,
      u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      url TEXT NOT NULL,
      application_type TEXT NOT NULL DEFAULT 'unknown',
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      category_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('processing', 'todo', 'did', 'failed')),
      get_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute('ALTER TABLE job_list ADD COLUMN IF NOT EXISTS application_type TEXT NOT NULL DEFAULT \'unknown\'');
  await execute(`
    UPDATE job_list
    SET application_type = CASE
      WHEN url ~* '^https?://[^/]*[.]workable[.]com/([^?]*?/)?j/[^/?#]+'
        THEN 'workable'
      ELSE regexp_replace(
        split_part(split_part(split_part(lower(url), '://', 2), '/', 1), ':', 1),
        '^www[.]',
        ''
      )
    END
    WHERE application_type = 'unknown'
  `);
  await execute('ALTER TABLE job_list DROP CONSTRAINT IF EXISTS job_list_url_key');
  await execute(`
    CREATE TABLE IF NOT EXISTS job_account_assignments (
      job_account_assignment_id SERIAL PRIMARY KEY,
      j_id INTEGER NOT NULL REFERENCES job_list(j_id) ON DELETE CASCADE,
      account_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position > 0),
      UNIQUE (j_id, account_user_id),
      UNIQUE (j_id, position)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS account_apply_runs (
      account_user_id INTEGER PRIMARY KEY REFERENCES users(u_id) ON DELETE CASCADE,
      manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE CASCADE,
      run_id UUID NOT NULL,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await withTransaction(async (tx) => {
    await tx.query('LOCK TABLE job_list IN ACCESS EXCLUSIVE MODE');
    const legacyColumn = await tx.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'job_list'
           AND column_name = 'selected_account_u_ids'
       ) AS has_legacy_column`
    );
    if ((legacyColumn.rows[0] as { has_legacy_column: boolean }).has_legacy_column) {
      const invalidAssignments = await tx.query(
        `SELECT COUNT(*)::int AS count
         FROM job_list job
         CROSS JOIN LATERAL unnest(
           COALESCE(job.selected_account_u_ids, ARRAY[]::INTEGER[])
         ) AS selected(account_user_id)
         LEFT JOIN users account ON account.u_id = selected.account_user_id
         WHERE account.u_id IS NULL
           OR account.role <> 'account'
           OR account.parent_user_id <> job.u_id`
      );
      const invalidCount = Number((invalidAssignments.rows[0] as { count: number }).count);
      if (invalidCount > 0) {
        throw new Error(
          `Cannot migrate job Account assignments: ${invalidCount} legacy assignment(s) reference a missing or differently owned Account.`
        );
      }
      await tx.query(`
        INSERT INTO job_account_assignments (j_id, account_user_id, position)
        SELECT DISTINCT ON (job.j_id, selected.account_user_id)
               job.j_id, selected.account_user_id, selected.position::int
        FROM job_list job
        CROSS JOIN LATERAL unnest(
          COALESCE(job.selected_account_u_ids, ARRAY[]::INTEGER[])
        ) WITH ORDINALITY AS selected(account_user_id, position)
        ORDER BY job.j_id, selected.account_user_id, selected.position
        ON CONFLICT (j_id, account_user_id) DO NOTHING
      `);
      await tx.query('DROP INDEX IF EXISTS idx_job_list_selected_accounts');
      await tx.query('ALTER TABLE job_list DROP COLUMN selected_account_u_ids');
    }
  });

  await execute(`
    CREATE TABLE IF NOT EXISTS bids (
      b_id SERIAL PRIMARY KEY,
      u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      j_id INTEGER NOT NULL,
      manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      job_title TEXT NOT NULL,
      company TEXT NOT NULL,
      job_url TEXT NOT NULL,
      resume_path TEXT NOT NULL,
      applied_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (u_id, j_id)
    )
  `);
  await execute('ALTER TABLE bids ADD COLUMN IF NOT EXISTS resume_path TEXT');

  await execute(`
    CREATE TABLE IF NOT EXISTS interviews (
      i_id SERIAL PRIMARY KEY,
      b_id INTEGER NOT NULL REFERENCES bids(b_id) ON DELETE CASCADE,
      interview_time TIME NOT NULL,
      interview_date DATE NOT NULL,
      caller_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      interviewer TEXT NOT NULL,
      step TEXT NOT NULL CHECK (step IN ('intro', 'tech-1', 'tech-2', 'final')),
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'did', 'failed', 'respond_waiting')),
      outcome TEXT CHECK (outcome IN ('good', 'bad', 'normal')),
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      comment TEXT
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_name TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_country TEXT');
  await execute(`
    CREATE TABLE IF NOT EXISTS manager_application_profiles (
      manager_user_id INTEGER PRIMARY KEY REFERENCES users(u_id) ON DELETE CASCADE,
      authorized_to_work BOOLEAN,
      authorization_status TEXT,
      sponsorship_required BOOLEAN,
      authorization_expires_on DATE,
      relocation_willing BOOLEAN DEFAULT FALSE,
      relocation_details TEXT,
      notice_period_value INTEGER CHECK (notice_period_value IS NULL OR notice_period_value >= 0),
      notice_period_unit TEXT CHECK (notice_period_unit IS NULL OR notice_period_unit IN ('days', 'weeks', 'months')),
      notice_period_text TEXT,
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS qts_schema_migrations (
      migration_key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await withTransaction(async (tx) => {
    const migration = await tx.query(
      `INSERT INTO qts_schema_migrations (migration_key)
       VALUES ('20261010_manager_global_profile_scope')
       ON CONFLICT (migration_key) DO NOTHING
       RETURNING migration_key`
    );
    if (!migration.rows.length) return;
    await tx.query(`
      UPDATE manager_application_profiles
      SET authorization_expires_on = NULL,
          relocation_details = NULL,
          relocation_willing = FALSE
    `);
  });
  await execute(`
    CREATE TABLE IF NOT EXISTS manager_salary_answers (
      salary_answer_id SERIAL PRIMARY KEY,
      manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE CASCADE,
      currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      minimum_amount NUMERIC(14, 2),
      maximum_amount NUMERIC(14, 2),
      pay_period TEXT NOT NULL CHECK (pay_period IN ('hour', 'day', 'week', 'month', 'year')),
      answer_text TEXT,
      CHECK (minimum_amount IS NULL OR minimum_amount >= 0),
      CHECK (maximum_amount IS NULL OR maximum_amount >= 0),
      CHECK (minimum_amount IS NULL OR maximum_amount IS NULL OR maximum_amount >= minimum_amount)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS manager_custom_application_answers (
      custom_answer_id SERIAL PRIMARY KEY,
      manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS account_application_profiles (
      account_user_id INTEGER PRIMARY KEY REFERENCES users(u_id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      resume_file_name TEXT,
      resume_content BYTEA,
      education JSONB NOT NULL DEFAULT '[]'::jsonb,
      work_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
      custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (resume_content IS NULL OR octet_length(resume_content) <= 4194304),
      CHECK ((resume_content IS NULL) = (resume_file_name IS NULL))
    )
  `);
  await execute(`
    ALTER TABLE account_application_profiles
    ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await execute(`
    ALTER TABLE account_application_profiles
    ADD COLUMN IF NOT EXISTS resume_pdf_template TEXT NOT NULL DEFAULT 'qts_resume_2'
      CHECK (resume_pdf_template IN ('qts_resume_1', 'qts_resume_2', 'qts_resume_3', 'classic', 'compact'))
  `);
  await execute(`
    ALTER TABLE account_application_profiles
    ADD COLUMN IF NOT EXISTS cover_letter_pdf_template TEXT NOT NULL DEFAULT 'qts_cover_letter_1'
      CHECK (cover_letter_pdf_template IN ('qts_cover_letter_1'))
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS gpt_application_tasks (
      task_id TEXT PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES job_list(j_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'waiting_for_page'
        CHECK (status IN ('waiting_for_page', 'waiting_for_gpt', 'ready', 'failed', 'completed')),
      page_number INTEGER NOT NULL DEFAULT 0 CHECK (page_number >= 0),
      task_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      package JSONB NOT NULL DEFAULT '{}'::jsonb,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      resume_text TEXT,
      resume_text_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS gpt_application_task_documents (
      task_id TEXT NOT NULL REFERENCES gpt_application_tasks(task_id) ON DELETE CASCADE,
      document_type TEXT NOT NULL CHECK (document_type IN ('resume', 'cover_letter')),
      file_name TEXT NOT NULL,
      content BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (task_id, document_type)
    )
  `);
  await execute(`
    ALTER TABLE gpt_application_tasks
    ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await execute(`
    ALTER TABLE gpt_application_tasks
    ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES job_list(j_id) ON DELETE CASCADE
  `);
  await migrateAccountSpecificJobRows();
  await execute(`
    INSERT INTO account_application_profiles (account_user_id, first_name, last_name)
    SELECT u.u_id,
           split_part(trim(u.name), ' ', 1),
           COALESCE(NULLIF(substr(trim(u.name), length(split_part(trim(u.name), ' ', 1)) + 2), ''), split_part(trim(u.name), ' ', 1))
    FROM users u
    WHERE u.role = 'account'
    ON CONFLICT (account_user_id) DO NOTHING
  `);
  await execute(`
    INSERT INTO app_settings (setting_name, setting_value)
    VALUES ('application_submission_mode', 'manual')
    ON CONFLICT (setting_name) DO NOTHING
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS prompts (
      prompt_id SERIAL PRIMARY KEY,
      prompt_name TEXT NOT NULL UNIQUE,
      prompt_content TEXT NOT NULL,
      created_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute('CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_users_role_parent ON users(role, parent_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_users_category ON users(category_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_manager ON job_list(u_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_categories ON job_list USING GIN(category_ids)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_account_assignments_account ON job_account_assignments(account_user_id, j_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_user ON bids(u_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(j_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_bid ON interviews(b_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_caller ON interviews(caller_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_outcome_date ON interviews(outcome, interview_date)');
  await execute('CREATE INDEX IF NOT EXISTS idx_manager_salary_answers_manager ON manager_salary_answers(manager_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_manager_custom_answers_manager ON manager_custom_application_answers(manager_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_account_application_profiles_account ON account_application_profiles(account_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_manager_url ON job_list(u_id, url)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_queue_type_status ON job_list(u_id, application_type, status, get_date)');
  await execute('CREATE INDEX IF NOT EXISTS idx_gpt_application_tasks_resume_expiry ON gpt_application_tasks(resume_text_expires_at) WHERE resume_text IS NOT NULL');

  await migrateSchema();
  await execute(`
    DROP TABLE IF EXISTS
      bidders, bidder_job_sites, account_job_sites, job_sites,
      application_session_documents, application_session_fields, application_sessions,
      candidate_saved_answers, candidate_jobs, interview_processes,
      candidates, jobs, admins, accounts, settings
    CASCADE
  `);
  logger.info('Legacy tables removed; new-schema data retained');
  logger.info('Database migrations complete');
}

async function migrateAccountSpecificJobRows(): Promise<void> {
  await withTransaction(async (tx) => {
    const attemptTable = await tx.query(
      `SELECT to_regclass('public.application_attempts') IS NOT NULL AS exists`
    );
    const hasAttempts = Boolean((attemptTable.rows[0] as { exists: boolean }).exists);
    const taskAttemptColumn = await tx.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gpt_application_tasks'
           AND column_name = 'attempt_id'
       ) AS exists`
    );
    const hasTaskAttemptColumn = Boolean((taskAttemptColumn.rows[0] as { exists: boolean }).exists);

    if (hasAttempts) {
      await tx.query(
        `WITH missing AS (
           SELECT attempt.j_id, attempt.account_user_id
           FROM application_attempts attempt
           JOIN users account ON account.u_id = attempt.account_user_id
             AND account.role = 'account'
           WHERE NOT EXISTS (
             SELECT 1 FROM job_account_assignments assignment
             WHERE assignment.j_id = attempt.j_id
               AND assignment.account_user_id = attempt.account_user_id
           )
         ), numbered AS (
           SELECT missing.j_id, missing.account_user_id,
                  COALESCE((
                    SELECT MAX(existing.position)
                    FROM job_account_assignments existing WHERE existing.j_id = missing.j_id
                  ), 0) + ROW_NUMBER() OVER (
                    PARTITION BY missing.j_id ORDER BY missing.account_user_id
                  ) AS position
           FROM missing
         )
         INSERT INTO job_account_assignments (j_id, account_user_id, position)
         SELECT j_id, account_user_id, position::int FROM numbered
         ON CONFLICT (j_id, account_user_id) DO NOTHING`
      );
    }

    const assignedJobs = await tx.query(
      `SELECT job.j_id, job.u_id, job.url, job.application_type, job.company, job.title, job.category_ids,
              job.status, job.get_date, assignment.job_account_assignment_id,
              assignment.account_user_id
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       ORDER BY job.j_id, assignment.position, assignment.job_account_assignment_id`
    );
    const rows = assignedJobs.rows as Array<{
      j_id: number;
      u_id: number;
      url: string;
      application_type: string;
      company: string;
      title: string;
      category_ids: number[];
      status: string;
      get_date: Date | string;
      job_account_assignment_id: number;
      account_user_id: number;
    }>;
    let currentJobId = -1;
    let keptFirstAccount = false;
    for (const row of rows) {
      if (Number(row.j_id) !== currentJobId) {
        currentJobId = Number(row.j_id);
        keptFirstAccount = false;
      }
      if (!keptFirstAccount) {
        keptFirstAccount = true;
        continue;
      }
      const inserted = await tx.query(
        `INSERT INTO job_list (u_id, url, application_type, company, title, category_ids, status, get_date)
         VALUES ($1, $2, $3, $4, $5, $6::int[], $7, $8)
         RETURNING j_id`,
        [
          row.u_id, row.url, row.application_type, row.company,
          row.title, row.category_ids, row.status, row.get_date,
        ]
      );
      const newJobId = Number((inserted.rows[0] as { j_id: number }).j_id);
      await tx.query(
        `UPDATE job_account_assignments
         SET j_id = $1, position = 1
         WHERE job_account_assignment_id = $2`,
        [newJobId, row.job_account_assignment_id]
      );
      await tx.query(
        'UPDATE bids SET j_id = $1 WHERE j_id = $2 AND u_id = $3',
        [newJobId, row.j_id, row.account_user_id]
      );
      if (hasAttempts) {
        await tx.query(
          'UPDATE application_attempts SET j_id = $1 WHERE j_id = $2 AND account_user_id = $3',
          [newJobId, row.j_id, row.account_user_id]
        );
      }
    }

    if (hasAttempts) {
      await tx.query(
        `UPDATE job_list job
         SET status = CASE
           WHEN attempt.status = 'submitted' THEN 'did'
           WHEN attempt.status = 'failed' THEN 'failed'
           ELSE 'processing'
         END
         FROM application_attempts attempt
         WHERE attempt.j_id = job.j_id
           AND attempt.account_user_id = (
             SELECT assignment.account_user_id
             FROM job_account_assignments assignment
             WHERE assignment.j_id = job.j_id
             LIMIT 1
           )`
      );
    }
    await tx.query(
      `UPDATE job_list job SET status = 'did'
       FROM bids bid
       JOIN job_account_assignments assignment
         ON assignment.j_id = bid.j_id AND assignment.account_user_id = bid.u_id
       WHERE job.j_id = bid.j_id AND job.status <> 'failed'`
    );

    if (hasTaskAttemptColumn) {
      if (!hasAttempts) {
        throw new Error('GPT tasks still reference application attempts, but the attempt table is missing.');
      }
      await tx.query(
        `UPDATE gpt_application_tasks task
         SET job_id = attempt.j_id
         FROM application_attempts attempt
         WHERE task.attempt_id = attempt.attempt_id AND task.job_id IS NULL`
      );
      await tx.query(
        `UPDATE gpt_application_tasks
         SET task_context = jsonb_set(
           task_context,
           '{jobContext,jobId}',
           to_jsonb(job_id),
           true
         )
         WHERE task_context->'jobContext' IS NOT NULL`
      );
      const orphanedTasks = await tx.query(
        'SELECT COUNT(*)::int AS count FROM gpt_application_tasks WHERE job_id IS NULL'
      );
      const orphanedCount = Number((orphanedTasks.rows[0] as { count: number }).count);
      if (orphanedCount) {
        throw new Error(`Cannot migrate ${orphanedCount} GPT task(s) without a matching Account job row.`);
      }
      await tx.query('ALTER TABLE gpt_application_tasks DROP CONSTRAINT IF EXISTS gpt_application_tasks_attempt_id_fkey');
      await tx.query('ALTER TABLE gpt_application_tasks DROP CONSTRAINT IF EXISTS gpt_application_tasks_attempt_id_key');
      await tx.query('ALTER TABLE gpt_application_tasks DROP COLUMN attempt_id');
    }
    await tx.query('ALTER TABLE gpt_application_tasks ALTER COLUMN job_id SET NOT NULL');
    await tx.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_gpt_application_tasks_job_id ON gpt_application_tasks(job_id)'
    );
    if (hasAttempts) {
      await tx.query('DROP TABLE application_attempts');
    }
  });
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists`,
    [table, column]
  );
  return Boolean(row?.exists);
}

async function migrateSchema(): Promise<void> {
  if (!(await columnExists('users', 'must_change_password'))) {
    await execute(`ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE`);
  }
  if (!(await columnExists('bids', 'resume_path'))) {
    await execute(`ALTER TABLE bids ADD COLUMN resume_path TEXT`);
  }
  if (!(await columnExists('interviews', 'outcome'))) {
    await execute(`ALTER TABLE interviews ADD COLUMN outcome TEXT CHECK (outcome IN ('good', 'bad', 'normal'))`);
  }
  await execute('ALTER TABLE bids ADD COLUMN IF NOT EXISTS manager_user_id INTEGER REFERENCES users(u_id) ON DELETE RESTRICT');
  await execute('ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_title TEXT');
  await execute('ALTER TABLE bids ADD COLUMN IF NOT EXISTS company TEXT');
  await execute('ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_url TEXT');
  await execute(`
    UPDATE bids b SET
      manager_user_id = j.u_id,
      job_title = j.title,
      company = j.company,
      job_url = j.url
    FROM job_list j
    WHERE j.j_id = b.j_id AND (
      b.manager_user_id IS NULL OR b.job_title IS NULL OR b.company IS NULL
      OR b.job_url IS NULL
    )
  `);
  const incompleteBids = await queryOne<{ count: number | string }>(
    `SELECT count(*)::int AS count FROM bids
     WHERE manager_user_id IS NULL OR job_title IS NULL OR company IS NULL
       OR job_url IS NULL`
  );
  if (Number(incompleteBids?.count ?? 0) > 0) {
    throw new Error('Cannot migrate bids: one or more bid records have no matching job-list snapshot.');
  }
  await execute('ALTER TABLE bids ALTER COLUMN manager_user_id SET NOT NULL');
  await execute('ALTER TABLE bids ALTER COLUMN job_title SET NOT NULL');
  await execute('ALTER TABLE bids ALTER COLUMN company SET NOT NULL');
  await execute('ALTER TABLE bids ALTER COLUMN job_url SET NOT NULL');
  await execute('ALTER TABLE bids DROP COLUMN IF EXISTS job_status');
  await execute('ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_j_id_fkey');
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO bids (
         u_id, j_id, manager_user_id, job_title, company, job_url, resume_path
       )
       SELECT assignment.account_user_id, job.j_id, job.u_id, job.title, job.company,
              job.url, 'account-profile:' || assignment.account_user_id::text
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.status = 'did'
       ON CONFLICT (u_id, j_id) DO NOTHING`
    );
    await tx.query(
      `DELETE FROM job_list job
       WHERE job.status = 'did'
         AND EXISTS (
           SELECT 1 FROM job_account_assignments assignment
           WHERE assignment.j_id = job.j_id
         )`
    );
  });
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_manager ON bids(manager_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_manager_url ON bids(manager_user_id, job_url)');
}

export async function backupDb(): Promise<string> {
  const backupDir = config.backupsPath;
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19);
  const destination = path.join(backupDir, `jobs-${timestamp}.sql`);

  if (!config.useEmbeddedPg) {
    try {
      await runPgDump(destination);
      return destination;
    } catch (error) {
      logger.warn('pg_dump unavailable, using logical SQL backup', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await runLogicalBackup(destination);
  return destination;
}

function runPgDump(destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pg_dump',
      ['--dbname', config.databaseUrl, '--file', destination, '--no-owner', '--no-acl'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
    });
  });
}

async function runLogicalBackup(destination: string): Promise<void> {
  const tables = [
    'categories', 'users', 'job_list', 'job_account_assignments', 'bids', 'interviews', 'app_settings', 'prompts',
    'custom_gpts', 'manager_custom_gpt_assignments',
    'manager_application_profiles', 'manager_salary_answers', 'manager_custom_application_answers',
    'account_application_profiles',
    'gpt_application_tasks', 'gpt_application_task_documents',
  ] as const;
  const lines: string[] = [
    `-- ${APP_NAME} PostgreSQL logical backup`,
    `-- Generated: ${new Date().toISOString()}`,
    'BEGIN;',
  ];

  for (const table of tables) {
    const rows = await queryAll<Record<string, unknown>>(`SELECT * FROM ${table}`);
    lines.push(`-- ${table}: ${rows.length} rows`);
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((col) => formatSqlValue(row[col]));
      lines.push(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`
      );
    }
  }

  lines.push('COMMIT;');
  fs.writeFileSync(destination, lines.join('\n'), 'utf8');
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
