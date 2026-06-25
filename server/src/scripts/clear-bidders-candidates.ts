import { initDb, closeDb } from '../database/connection';
import { clearBiddersAndCandidates } from '../database/reset-database';
import { logger } from '../utilities/logger';

async function main(): Promise<void> {
  await initDb();
  await clearBiddersAndCandidates();
  await closeDb();
  logger.info('All bidders and candidates removed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
