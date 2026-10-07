import { initDb, closeDb } from '../database/connection';
import { resetDatabaseKeepingAdminOnly } from '../database/reset-database';
import { seedAdminOnly } from '../database/seed-admin';
import { logger } from '../utilities/logger';

async function main(): Promise<void> {
  await initDb();
  await resetDatabaseKeepingAdminOnly();
  await seedAdminOnly();
  await closeDb();
  logger.info('Reset finished. Only the admin account remains.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
