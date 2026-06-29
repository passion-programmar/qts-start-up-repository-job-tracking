"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("../database/connection");
const reset_database_1 = require("../database/reset-database");
const logger_1 = require("../utilities/logger");
async function main() {
    await (0, connection_1.initDb)();
    const removed = await (0, reset_database_1.clearApplicationSessionRecords)();
    await (0, connection_1.closeDb)();
    logger_1.logger.info('Application session tables cleared.', removed);
    console.log(`Removed ${removed.sessions} session(s), ${removed.fields} field row(s), ${removed.savedAnswers} saved answer(s).`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
//# sourceMappingURL=clear-application-sessions.js.map