"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("../database/connection");
const reset_database_1 = require("../database/reset-database");
const seed_admin_1 = require("../database/seed-admin");
const logger_1 = require("../utilities/logger");
async function main() {
    await (0, connection_1.initDb)();
    await (0, reset_database_1.resetDatabaseKeepingAdminOnly)();
    await (0, seed_admin_1.seedAdminOnly)();
    await (0, connection_1.closeDb)();
    logger_1.logger.info('Reset finished. Only the admin account remains.');
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
//# sourceMappingURL=reset-db.js.map