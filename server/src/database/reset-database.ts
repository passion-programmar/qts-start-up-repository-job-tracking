import { execute } from './connection';
import { config } from '../config/env';
import { logger } from '../utilities/logger';

const SERIAL_TABLES = [
  'candidate_jobs',
  'interview_processes',
  'jobs',
  'candidates',
  'bidders',
  'admins',
] as const;

const BIDDER_CANDIDATE_TABLES = ['candidate_jobs', 'candidates', 'bidders'] as const;

async function resetSerialSequences(): Promise<void> {
  for (const table of SERIAL_TABLES) {
    await execute(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 1),
        (SELECT MAX(id) IS NOT NULL FROM ${table})
      )
    `);
  }
}

async function resetBidderCandidateSequences(): Promise<void> {
  for (const table of BIDDER_CANDIDATE_TABLES) {
    await execute(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 1),
        (SELECT MAX(id) IS NOT NULL FROM ${table})
      )
    `);
  }
}

/** Remove all bidder orgs, candidates, and bidder/caller login accounts. Keeps admin, managers, jobs, interviews. */
export async function clearBiddersAndCandidates(): Promise<void> {
  await execute('DELETE FROM candidates');
  await execute(`DELETE FROM admins WHERE role IN ('bidder', 'caller')`);
  await execute('DELETE FROM bidders');
  await resetBidderCandidateSequences();
  logger.info('Cleared all bidders and candidates');
}

export async function resetDatabaseKeepingAdminOnly(): Promise<void> {
  await execute('DELETE FROM candidate_jobs');
  await execute('DELETE FROM interview_processes');
  await execute('DELETE FROM jobs');
  await execute('DELETE FROM candidates');
  await execute('UPDATE bidders SET manager_id = NULL');
  await execute('DELETE FROM bidders');
  await execute('DELETE FROM settings');
  await execute(
    `DELETE FROM admins
     WHERE role <> 'admin' OR username <> $1`,
    [config.adminUsername]
  );
  await execute(
    `UPDATE admins SET bidder_id = NULL, updated_at = NOW()
     WHERE username = $1 AND role = 'admin'`,
    [config.adminUsername]
  );

  await resetSerialSequences();
  logger.info('Database reset complete — only admin account retained', {
    adminUsername: config.adminUsername,
  });
}
