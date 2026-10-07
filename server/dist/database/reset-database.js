"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearBiddersAndCandidates = clearBiddersAndCandidates;
exports.clearApplicationSessionRecords = clearApplicationSessionRecords;
exports.resetDatabaseKeepingAdminOnly = resetDatabaseKeepingAdminOnly;
const connection_1 = require("./connection");
const env_1 = require("../config/env");
const logger_1 = require("../utilities/logger");
const SERIAL_TABLES = [
    'candidate_jobs',
    'interview_processes',
    'jobs',
    'candidates',
    'bidders',
    'admins',
];
const BIDDER_CANDIDATE_TABLES = ['candidate_jobs', 'candidates', 'bidders'];
async function resetSerialSequences() {
    for (const table of SERIAL_TABLES) {
        await (0, connection_1.execute)(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 1),
        (SELECT MAX(id) IS NOT NULL FROM ${table})
      )
    `);
    }
}
async function resetBidderCandidateSequences() {
    for (const table of BIDDER_CANDIDATE_TABLES) {
        await (0, connection_1.execute)(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 1),
        (SELECT MAX(id) IS NOT NULL FROM ${table})
      )
    `);
    }
}
/** Remove all bidder orgs, candidates, and bidder/caller login accounts. Keeps admin, managers, jobs, interviews. */
async function clearBiddersAndCandidates() {
    await (0, connection_1.execute)('DELETE FROM candidates');
    await (0, connection_1.execute)(`DELETE FROM admins WHERE role IN ('bidder', 'caller')`);
    await (0, connection_1.execute)('DELETE FROM bidders');
    await resetBidderCandidateSequences();
    logger_1.logger.info('Cleared all bidders and candidates');
}
/** Remove ephemeral apply-flow rows (sessions, fields, saved answers). Jobs/candidates are kept. */
async function clearApplicationSessionRecords() {
    const sessions = Number((await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM application_sessions'))?.count ?? 0);
    const fields = Number((await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM application_session_fields'))?.count ?? 0);
    const savedAnswers = Number((await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM candidate_saved_answers'))?.count ?? 0);
    await (0, connection_1.execute)('TRUNCATE application_session_fields, application_sessions, candidate_saved_answers RESTART IDENTITY CASCADE');
    logger_1.logger.info('Cleared application session tables', { sessions, fields, savedAnswers });
    return { sessions, fields, savedAnswers };
}
async function resetDatabaseKeepingAdminOnly() {
    await (0, connection_1.execute)('DELETE FROM candidate_jobs');
    await (0, connection_1.execute)('DELETE FROM interview_processes');
    await (0, connection_1.execute)('DELETE FROM jobs');
    await (0, connection_1.execute)('DELETE FROM candidates');
    await (0, connection_1.execute)('UPDATE bidders SET manager_id = NULL');
    await (0, connection_1.execute)('DELETE FROM bidders');
    await (0, connection_1.execute)('DELETE FROM settings');
    await (0, connection_1.execute)(`DELETE FROM admins
     WHERE role <> 'admin' OR username <> $1`, [env_1.config.adminUsername]);
    await (0, connection_1.execute)(`UPDATE admins SET bidder_id = NULL, updated_at = NOW()
     WHERE username = $1 AND role = 'admin'`, [env_1.config.adminUsername]);
    await resetSerialSequences();
    logger_1.logger.info('Database reset complete — only admin account retained', {
        adminUsername: env_1.config.adminUsername,
    });
}
//# sourceMappingURL=reset-database.js.map