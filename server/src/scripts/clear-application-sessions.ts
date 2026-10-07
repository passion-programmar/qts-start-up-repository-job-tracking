import { initDb, closeDb } from '../database/connection';
import { clearApplicationSessionRecords } from '../database/reset-database';
import { logger } from '../utilities/logger';

async function main(): Promise<void> {
  await initDb();
  const removed = await clearApplicationSessionRecords();
  await closeDb();
  logger.info('Application session tables cleared.', removed);
  console.log(
    `Removed ${removed.sessions} session(s), ${removed.fields} field row(s), ${removed.savedAnswers} saved answer(s).`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
