import { initDb } from '../database/connection';
import { seedAdmin } from '../database/seed-admin';
import { config } from '../config/env';

let initialization: Promise<void> | null = null;

function validateServerlessEnvironment(): void {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'ADMIN_PASSWORD',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required Vercel environment variables: ${missing.join(', ')}`);
  }
  if (config.useEmbeddedPg) {
    throw new Error('Set EMBEDDED_PG=false for the Vercel API deployment.');
  }
  if (config.jwtSecret.length < 32 || config.jwtSecret === 'change-this-secret') {
    throw new Error('JWT_SECRET must be a unique secret with at least 32 characters.');
  }
  if (!config.applicationSessionPersistDb) {
    throw new Error('Set APPLICATION_SESSION_PERSIST_DB=true for the Vercel API deployment.');
  }
}

async function initialize(): Promise<void> {
  validateServerlessEnvironment();
  await initDb();
  await seedAdmin();
}

export function ensureServerlessDatabaseReady(): Promise<void> {
  if (!initialization) {
    initialization = initialize().catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
