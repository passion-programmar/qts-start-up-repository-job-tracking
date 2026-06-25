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
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      linkedin_url TEXT,
      notes TEXT,
      color TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      normalized_url TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS candidate_jobs (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'applied')),
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (candidate_id, job_id)
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS bidders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS interview_processes (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
      candidate_name TEXT NOT NULL,
      caller_user_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      bidder_id INTEGER REFERENCES bidders(id) ON DELETE SET NULL,
      scheduled_date DATE,
      attend_date DATE,
      interview_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      position TEXT,
      company TEXT,
      job_url TEXT,
      resume TEXT,
      meeting_url TEXT,
      salary TEXT,
      stage TEXT,
      created_by_user_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await execute('CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)');
  await execute('CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(title)');
  await execute('CREATE INDEX IF NOT EXISTS idx_candidate_jobs_candidate ON candidate_jobs(candidate_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_candidate_jobs_job ON candidate_jobs(job_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_candidate_jobs_status ON candidate_jobs(status)');
  await execute('CREATE INDEX IF NOT EXISTS idx_candidate_jobs_applied_at ON candidate_jobs(applied_at)');

  await migrateSchema();
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
  if (!(await columnExists('admins', 'role'))) {
    await execute(`ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  }
  if (!(await columnExists('candidates', 'color'))) {
    await execute(`ALTER TABLE candidates ADD COLUMN color TEXT`);
  }
  if (!(await columnExists('admins', 'bidder_id'))) {
    await execute(`ALTER TABLE admins ADD COLUMN bidder_id INTEGER REFERENCES bidders(id) ON DELETE SET NULL`);
  }
  if (!(await columnExists('candidates', 'bidder_id'))) {
    await execute(`ALTER TABLE candidates ADD COLUMN bidder_id INTEGER REFERENCES bidders(id) ON DELETE SET NULL`);
  }
  if (!(await columnExists('candidates', 'stack'))) {
    await execute(`ALTER TABLE candidates ADD COLUMN stack TEXT`);
  }
  if (!(await columnExists('jobs', 'bidder_id'))) {
    await execute(`ALTER TABLE jobs ADD COLUMN bidder_id INTEGER REFERENCES bidders(id) ON DELETE SET NULL`);
  }
  if (!(await columnExists('jobs', 'created_by_user_id'))) {
    await execute(`ALTER TABLE jobs ADD COLUMN created_by_user_id INTEGER REFERENCES admins(id) ON DELETE SET NULL`);
  }
  if (!(await columnExists('bidders', 'manager_id'))) {
    await execute(`ALTER TABLE bidders ADD COLUMN manager_id INTEGER REFERENCES admins(id) ON DELETE SET NULL`);
  }
  if (!(await columnExists('admins', 'password_encrypted'))) {
    await execute(`ALTER TABLE admins ADD COLUMN password_encrypted TEXT`);
  }
  if (!(await columnExists('admins', 'is_active'))) {
    await execute(`ALTER TABLE admins ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  }

  await execute(`UPDATE admins SET role = 'bidder' WHERE role = 'user'`);

  await execute('CREATE INDEX IF NOT EXISTS idx_candidates_bidder ON candidates(bidder_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_jobs_bidder ON jobs(bidder_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_admins_bidder ON admins(bidder_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_bidders_manager ON bidders(manager_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_caller ON interview_processes(caller_user_id)');
  await execute('CREATE INDEX IF NOT EXISTS idx_interviews_bidder ON interview_processes(bidder_id)');
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
  const tables = ['bidders', 'admins', 'candidates', 'jobs', 'candidate_jobs', 'interview_processes', 'settings'] as const;
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
