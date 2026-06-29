import dotenv from 'dotenv';
import path from 'node:path';
import { getAppRoot } from './paths';

dotenv.config({ path: path.join(getAppRoot(), '.env') });

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'postgres';
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  const database = process.env.PGDATABASE || 'qts_startup';
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);

  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
}

export const config = {
  port: parseInt(process.env.PORT || '1028', 10),
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  managerUsername: process.env.MANAGER_USERNAME || 'manager',
  managerPassword: process.env.MANAGER_PASSWORD || 'user',
  bidderUsername: process.env.BIDDER_USERNAME || 'bidder',
  bidderPassword: process.env.BIDDER_PASSWORD || 'user',
  callerUsername: process.env.CALLER_USERNAME || 'caller',
  callerPassword: process.env.CALLER_PASSWORD || 'user',
  useEmbeddedPg: String(process.env.EMBEDDED_PG ?? 'true').toLowerCase() === 'true',
  pgliteDataPath: path.resolve(getAppRoot(), 'data', 'pglite'),
  databaseUrl: buildDatabaseUrl(),
  databaseSsl: String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true',
  databasePoolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  backupsPath: path.resolve(getAppRoot(), 'backups'),
  nodeEnv: process.env.NODE_ENV || 'development',
  autoOpenBrowser:
    String(process.env.AUTO_OPEN_BROWSER || 'true').toLowerCase() === 'true',
  adminWebUrl: process.env.ADMIN_WEB_URL || 'http://localhost:1027/login',
  /** Static Bearer secret for Custom GPT Actions (not OpenAI key, not JWT). */
  gptActionApiKey: process.env.GPT_ACTION_API_KEY || '',
  /** When false, application sessions/fields live in server memory only (cleared after TTL). */
  applicationSessionPersistDb:
    String(process.env.APPLICATION_SESSION_PERSIST_DB || 'false').toLowerCase() === 'true',
};
