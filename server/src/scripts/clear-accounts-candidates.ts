import { initDb, closeDb } from '../database/connection';
import { clearAccountsAndCandidates } from '../database/reset-database';
import { logger } from '../utilities/logger';

async function main(): Promise<void> {
  await initDb();
  await clearAccountsAndCandidates();
  await closeDb();
  logger.info('All accounts and candidates removed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
