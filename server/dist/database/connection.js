"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.closeDb = closeDb;
exports.getPool = getPool;
exports.queryAll = queryAll;
exports.queryOne = queryOne;
exports.execute = execute;
exports.dbQuery = dbQuery;
exports.withTransaction = withTransaction;
exports.backupDb = backupDb;
const pg_1 = require("pg");
const pglite_1 = require("@electric-sql/pglite");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const branding_1 = require("../config/branding");
const env_1 = require("../config/env");
const logger_1 = require("../utilities/logger");
let pool = null;
let pglite = null;
async function runQuery(sql, params = []) {
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
async function initDb() {
    if (env_1.config.useEmbeddedPg) {
        const dataDir = env_1.config.pgliteDataPath;
        if (!node_fs_1.default.existsSync(dataDir)) {
            node_fs_1.default.mkdirSync(dataDir, { recursive: true });
            logger_1.logger.info('Created embedded database directory', { path: dataDir });
        }
        pglite = new pglite_1.PGlite(dataDir);
        await pglite.waitReady;
        logger_1.logger.info('Embedded PostgreSQL ready (PGlite)', { path: dataDir });
        await runMigrations();
        return;
    }
    pool = new pg_1.Pool({
        connectionString: env_1.config.databaseUrl,
        ssl: env_1.config.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: env_1.config.databasePoolMax,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });
    pool.on('error', (error) => {
        logger_1.logger.error('Unexpected PostgreSQL pool error', error);
    });
    try {
        await pool.query('SELECT 1');
        logger_1.logger.info('PostgreSQL connected', { host: maskDatabaseUrl(env_1.config.databaseUrl) });
        await runMigrations();
    }
    catch (error) {
        await pool.end().catch(() => undefined);
        pool = null;
        throw formatConnectionError(error);
    }
}
async function closeDb() {
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
function getPool() {
    if (!pool) {
        throw new Error('External PostgreSQL pool is not active. Is EMBEDDED_PG enabled?');
    }
    return pool;
}
async function queryAll(sql, params = []) {
    const result = await runQuery(sql, params);
    return result.rows;
}
async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows[0] ?? null;
}
async function execute(sql, params = []) {
    const result = await runQuery(sql, params);
    return { rowCount: result.rowCount ?? 0 };
}
async function dbQuery(sql, params = []) {
    return runQuery(sql, params);
}
async function withTransaction(fn) {
    if (pglite) {
        return pglite.transaction(async (tx) => fn(tx));
    }
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
function formatConnectionError(error) {
    if (error instanceof Error && 'code' in error) {
        const code = String(error.code);
        if (code === 'ECONNREFUSED' || code === 'EACCES' || code === 'ENOTFOUND') {
            return new Error('Could not connect to PostgreSQL. Start PostgreSQL (e.g. docker compose up -d postgres) ' +
                'or set EMBEDDED_PG=true in server/.env for a local file-based database.');
        }
    }
    return error instanceof Error ? error : new Error(String(error));
}
function maskDatabaseUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.password)
            parsed.password = '****';
        return parsed.toString();
    }
    catch {
        return '[configured]';
    }
}
async function runMigrations() {
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
    await execute(`
    CREATE TABLE IF NOT EXISTS application_sessions (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      bidder_id INTEGER NOT NULL REFERENCES bidders(id) ON DELETE CASCADE,
      job_url TEXT NOT NULL,
      normalized_url TEXT,
      job_title TEXT,
      company TEXT,
      job_description TEXT,
      platform TEXT,
      current_step TEXT NOT NULL DEFAULT 'init',
      discovered_pages JSONB NOT NULL DEFAULT '[]',
      generated_answers JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'scanning', 'filling', 'awaiting_ai', 'completed', 'abandoned', 'error')),
      metadata JSONB NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await execute(`
    CREATE TABLE IF NOT EXISTS application_session_fields (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES application_sessions(id) ON DELETE CASCADE,
      stable_field_id TEXT NOT NULL,
      label TEXT,
      field_type TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      options JSONB,
      current_value TEXT,
      placeholder TEXT,
      section_heading TEXT,
      page_step TEXT,
      page_url TEXT,
      name_attr TEXT,
      autocomplete_attr TEXT,
      validation_message TEXT,
      selector_hints JSONB,
      field_fingerprint TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'unknown'
        CHECK (category IN ('candidate_profile', 'saved_answer', 'ai_generation', 'document_upload', 'unknown')),
      profile_key TEXT,
      saved_answer_key TEXT,
      document_slot TEXT,
      fill_value TEXT,
      fill_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (fill_status IN ('pending', 'filled', 'skipped', 'awaiting_answer', 'error', 'manual')),
      generated_answer TEXT,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, stable_field_id)
    )
  `);
    await execute(`
    CREATE TABLE IF NOT EXISTS candidate_saved_answers (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      answer_key TEXT NOT NULL,
      answer_value TEXT NOT NULL,
      approved BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (candidate_id, answer_key)
    )
  `);
    await execute('CREATE INDEX IF NOT EXISTS idx_app_sessions_candidate ON application_sessions(candidate_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_sessions_job ON application_sessions(job_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_sessions_bidder ON application_sessions(bidder_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON application_sessions(user_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_sessions_status ON application_sessions(status)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_session_fields_session ON application_session_fields(session_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_app_session_fields_category ON application_session_fields(category)');
    await execute('CREATE INDEX IF NOT EXISTS idx_candidate_saved_answers_candidate ON candidate_saved_answers(candidate_id)');
    await migrateSchema();
    logger_1.logger.info('Database migrations complete');
}
async function columnExists(table, column) {
    const row = await queryOne(`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists`, [table, column]);
    return Boolean(row?.exists);
}
async function migrateSchema() {
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
    if (!(await columnExists('bidders', 'custom_gpt_url'))) {
        await execute(`ALTER TABLE bidders ADD COLUMN custom_gpt_url TEXT`);
    }
    if (!(await columnExists('admins', 'password_encrypted'))) {
        await execute(`ALTER TABLE admins ADD COLUMN password_encrypted TEXT`);
    }
    if (!(await columnExists('admins', 'is_active'))) {
        await execute(`ALTER TABLE admins ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`);
    }
    if (!(await columnExists('application_session_fields', 'document_slot'))) {
        await execute(`ALTER TABLE application_session_fields ADD COLUMN document_slot TEXT`);
    }
    await execute(`
    ALTER TABLE application_session_fields
    DROP CONSTRAINT IF EXISTS application_session_fields_category_check
  `);
    await execute(`
    ALTER TABLE application_session_fields
    ADD CONSTRAINT application_session_fields_category_check
    CHECK (category IN ('candidate_profile', 'saved_answer', 'ai_generation', 'document_upload', 'unknown'))
  `);
    await execute(`UPDATE admins SET role = 'bidder' WHERE role = 'user'`);
    await execute('CREATE INDEX IF NOT EXISTS idx_candidates_bidder ON candidates(bidder_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_candidates_bidder_active ON candidates(bidder_id, is_active)');
    await execute('CREATE INDEX IF NOT EXISTS idx_jobs_bidder ON jobs(bidder_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_admins_bidder ON admins(bidder_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username)');
    await execute('CREATE INDEX IF NOT EXISTS idx_candidate_jobs_status_job ON candidate_jobs(status, job_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_bidders_manager ON bidders(manager_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_interviews_caller ON interview_processes(caller_user_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_interviews_bidder ON interview_processes(bidder_id)');
}
async function backupDb() {
    const backupDir = env_1.config.backupsPath;
    if (!node_fs_1.default.existsSync(backupDir)) {
        node_fs_1.default.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '-')
        .slice(0, 19);
    const destination = node_path_1.default.join(backupDir, `jobs-${timestamp}.sql`);
    if (!env_1.config.useEmbeddedPg) {
        try {
            await runPgDump(destination);
            return destination;
        }
        catch (error) {
            logger_1.logger.warn('pg_dump unavailable, using logical SQL backup', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    await runLogicalBackup(destination);
    return destination;
}
function runPgDump(destination) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)('pg_dump', ['--dbname', env_1.config.databaseUrl, '--file', destination, '--no-owner', '--no-acl'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => reject(error));
        child.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
        });
    });
}
async function runLogicalBackup(destination) {
    const tables = ['bidders', 'admins', 'candidates', 'jobs', 'candidate_jobs', 'interview_processes', 'settings', 'application_sessions', 'application_session_fields', 'candidate_saved_answers'];
    const lines = [
        `-- ${branding_1.APP_NAME} PostgreSQL logical backup`,
        `-- Generated: ${new Date().toISOString()}`,
        'BEGIN;',
    ];
    for (const table of tables) {
        const rows = await queryAll(`SELECT * FROM ${table}`);
        lines.push(`-- ${table}: ${rows.length} rows`);
        for (const row of rows) {
            const columns = Object.keys(row);
            const values = columns.map((col) => formatSqlValue(row[col]));
            lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`);
        }
    }
    lines.push('COMMIT;');
    node_fs_1.default.writeFileSync(destination, lines.join('\n'), 'utf8');
}
function formatSqlValue(value) {
    if (value === null || value === undefined)
        return 'NULL';
    if (typeof value === 'boolean')
        return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number')
        return String(value);
    if (value instanceof Date)
        return `'${value.toISOString()}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
}
//# sourceMappingURL=connection.js.map