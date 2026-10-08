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
    CREATE TABLE IF NOT EXISTS job_list (
      j_id SERIAL PRIMARY KEY,
      u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      url TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      category_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
      selected_account_u_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('processing', 'todo', 'did', 'failed')),
      get_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS bids (
      b_id SERIAL PRIMARY KEY,
      u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      j_id INTEGER NOT NULL REFERENCES job_list(j_id) ON DELETE RESTRICT,
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

  await execute('CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_users_role_parent ON users(role, parent_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_users_category ON users(category_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_manager ON job_list(u_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_categories ON job_list USING GIN(category_ids)');
  await execute('CREATE INDEX IF NOT EXISTS idx_job_list_selected_accounts ON job_list USING GIN(selected_account_u_ids)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_user ON bids(u_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(j_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_bid ON interviews(b_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_caller ON interviews(caller_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_outcome_date ON interviews(outcome, interview_date)');

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
  const tables = ['categories', 'users', 'job_list', 'bids', 'interviews', 'app_settings'] as const;
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
