"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("../database/connection");
const reset_database_1 = require("../database/reset-database");
const logger_1 = require("../utilities/logger");
async function main() {
    await (0, connection_1.initDb)();
    await (0, reset_database_1.clearBiddersAndCandidates)();
    await (0, connection_1.closeDb)();
    logger_1.logger.info('All bidders and candidates removed.');
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
//# sourceMappingURL=clear-bidders-candidates.js.map