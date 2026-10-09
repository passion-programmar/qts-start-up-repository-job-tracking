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
    CREATE TABLE IF NOT EXISTS job_account_assignments (
      job_account_assignment_id SERIAL PRIMARY KEY,
      j_id INTEGER NOT NULL REFERENCES job_list(j_id) ON DELETE CASCADE,
      account_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position > 0),
      UNIQUE (j_id, account_user_id),
      UNIQUE (j_id, position)
    )
  `);
    await withTransaction(async (tx) => {
        await tx.query('LOCK TABLE job_list IN ACCESS EXCLUSIVE MODE');
        const legacyColumn = await tx.query(`SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'job_list'
           AND column_name = 'selected_account_u_ids'
       ) AS has_legacy_column`);
        if (legacyColumn.rows[0].has_legacy_column) {
            const invalidAssignments = await tx.query(`SELECT COUNT(*)::int AS count
         FROM job_list job
         CROSS JOIN LATERAL unnest(
           COALESCE(job.selected_account_u_ids, ARRAY[]::INTEGER[])
         ) AS selected(account_user_id)
         LEFT JOIN users account ON account.u_id = selected.account_user_id
         WHERE account.u_id IS NULL
           OR account.role <> 'account'
           OR account.parent_user_id <> job.u_id`);
            const invalidCount = Number(invalidAssignments.rows[0].count);
            if (invalidCount > 0) {
                throw new Error(`Cannot migrate job Account assignments: ${invalidCount} legacy assignment(s) reference a missing or differently owned Account.`);
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
      job_status TEXT NOT NULL DEFAULT 'did'
        CHECK (job_status IN ('processing', 'todo', 'did', 'failed')),
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
      relocation_willing BOOLEAN,
      relocation_details TEXT,
      notice_period_value INTEGER CHECK (notice_period_value IS NULL OR notice_period_value >= 0),
      notice_period_unit TEXT CHECK (notice_period_unit IS NULL OR notice_period_unit IN ('days', 'weeks', 'months')),
      notice_period_text TEXT,
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (resume_content IS NULL OR octet_length(resume_content) <= 4194304),
      CHECK ((resume_content IS NULL) = (resume_file_name IS NULL))
    )
  `);
    await execute(`
    CREATE TABLE IF NOT EXISTS application_attempts (
      attempt_id SERIAL PRIMARY KEY,
      manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      j_id INTEGER NOT NULL REFERENCES job_list(j_id) ON DELETE RESTRICT,
      account_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'needs_review', 'submitted', 'failed')),
      failure_reason TEXT,
      manager_note TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (j_id, account_user_id)
    )
  `);
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
    await execute('CREATE INDEX IF NOT EXISTS idx_application_attempts_manager ON application_attempts(manager_user_id, updated_date DESC)');
    await migrateSchema();
    await execute(`
    INSERT INTO application_attempts (
      manager_user_id, j_id, account_user_id, status, submitted_at, started_at
    )
    SELECT b.manager_user_id, b.j_id, b.u_id, 'submitted', b.applied_date, b.applied_date
    FROM bids b
    JOIN job_list j ON j.j_id = b.j_id
    ON CONFLICT (j_id, account_user_id) DO NOTHING
  `);
    await execute(`
    DROP TABLE IF EXISTS
      bidders, bidder_job_sites, account_job_sites, job_sites,
      application_session_documents, application_session_fields, application_sessions,
      candidate_saved_answers, candidate_jobs, interview_processes,
      candidates, jobs, admins, accounts, settings
    CASCADE
  `);
    logger_1.logger.info('Legacy tables removed; new-schema data retained');
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
    await execute(`ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_status TEXT
    CHECK (job_status IN ('processing', 'todo', 'did', 'failed'))`);
    await execute(`
    UPDATE bids b SET
      manager_user_id = j.u_id,
      job_title = j.title,
      company = j.company,
      job_url = j.url,
      job_status = j.status
    FROM job_list j
    WHERE j.j_id = b.j_id AND (
      b.manager_user_id IS NULL OR b.job_title IS NULL OR b.company IS NULL
      OR b.job_url IS NULL OR b.job_status IS NULL
    )
  `);
    const incompleteBids = await queryOne(`SELECT count(*)::int AS count FROM bids
     WHERE manager_user_id IS NULL OR job_title IS NULL OR company IS NULL
       OR job_url IS NULL OR job_status IS NULL`);
    if (Number(incompleteBids?.count ?? 0) > 0) {
        throw new Error('Cannot migrate bids: one or more bid records have no matching job-list snapshot.');
    }
    await execute('ALTER TABLE bids ALTER COLUMN manager_user_id SET NOT NULL');
    await execute('ALTER TABLE bids ALTER COLUMN job_title SET NOT NULL');
    await execute('ALTER TABLE bids ALTER COLUMN company SET NOT NULL');
    await execute('ALTER TABLE bids ALTER COLUMN job_url SET NOT NULL');
    await execute("ALTER TABLE bids ALTER COLUMN job_status SET DEFAULT 'did'");
    await execute('ALTER TABLE bids ALTER COLUMN job_status SET NOT NULL');
    await execute('ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_j_id_fkey');
    await execute('CREATE INDEX IF NOT EXISTS idx_bids_manager ON bids(manager_user_id)');
    await execute('CREATE INDEX IF NOT EXISTS idx_bids_manager_url ON bids(manager_user_id, job_url)');
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
    const tables = [
        'categories', 'users', 'job_list', 'bids', 'interviews', 'app_settings', 'prompts',
        'custom_gpts', 'manager_custom_gpt_assignments',
        'manager_application_profiles', 'manager_salary_answers', 'manager_custom_application_answers',
        'account_application_profiles', 'application_attempts',
    ];
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