import { execute, queryOne } from './connection';
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

/** Remove ephemeral apply-flow rows (sessions, fields, saved answers). Jobs/candidates are kept. */
export async function clearApplicationSessionRecords(): Promise<{
  sessions: number;
  fields: number;
  savedAnswers: number;
}> {
  const sessions = Number((await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM application_sessions'))?.count ?? 0);
  const fields = Number((await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM application_session_fields'))?.count ?? 0);
  const savedAnswers = Number((await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM candidate_saved_answers'))?.count ?? 0);

  await execute(
    'TRUNCATE application_session_fields, application_sessions, candidate_saved_answers RESTART IDENTITY CASCADE'
  );

  logger.info('Cleared application session tables', { sessions, fields, savedAnswers });
  return { sessions, fields, savedAnswers };
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
