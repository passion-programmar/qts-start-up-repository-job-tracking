/**
 * Migrate data from legacy SQLite (server/data/jobs.db) to PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-pg.mjs
 *   node scripts/migrate-sqlite-to-pg.mjs --sqlite path/to/jobs.db
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sqliteFlag = args.indexOf('--sqlite');
const sqlitePath = sqliteFlag >= 0
  ? args[sqliteFlag + 1]
  : path.resolve(__dirname, '../data/jobs.db');

const databaseUrl = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/qts_startup';

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath, { timeout: 5000 });
const pool = new pg.Pool({ connectionString: databaseUrl });

const tables = [
  {
    name: 'admins',
    columns: ['id', 'username', 'password_hash', 'role', 'created_at', 'updated_at'],
    optionalColumns: { role: 'admin' },
  },
  {
    name: 'candidates',
    columns: ['id', 'name', 'email', 'phone', 'linkedin_url', 'notes', 'color', 'is_active', 'created_at', 'updated_at'],
    boolColumns: ['is_active'],
    optionalColumns: { color: null },
  },
  {
    name: 'jobs',
    columns: ['id', 'title', 'company', 'url', 'normalized_url', 'description', 'source', 'created_at', 'updated_at'],
  },
  {
    name: 'candidate_jobs',
    columns: ['id', 'candidate_id', 'job_id', 'status', 'applied_at', 'created_at', 'updated_at'],
  },
  {
    name: 'settings',
    columns: ['key', 'value', 'updated_at'],
  },
];

function getSqliteColumns(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function resetSequences(client) {
  const serialTables = ['admins', 'candidates', 'jobs', 'candidate_jobs'];
  for (const table of serialTables) {
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 1),
        (SELECT MAX(id) IS NOT NULL FROM ${table})
      )
    `);
  }
}

async function migrateTable(client, table) {
  const sqliteCols = getSqliteColumns(table.name);
  const cols = table.columns.filter((col) => sqliteCols.includes(col) || table.optionalColumns?.[col] !== undefined);
  const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all();

  console.log(`Migrating ${table.name}: ${rows.length} rows`);

  for (const row of rows) {
    const values = cols.map((col) => {
      if (row[col] !== undefined) {
        if (table.boolColumns?.includes(col)) return Boolean(row[col]);
        return row[col];
      }
      return table.optionalColumns?.[col] ?? null;
    });

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const conflict = table.name === 'settings'
      ? 'ON CONFLICT (key) DO NOTHING'
      : 'ON CONFLICT (id) DO NOTHING';

    await client.query(
      `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders}) ${conflict}`,
      values
    );
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      await migrateTable(client, table);
    }
    await resetSequences(client);
    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

await main();
