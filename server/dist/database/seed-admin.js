"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedAdminOnly = seedAdminOnly;
exports.seedAdmin = seedAdmin;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const connection_1 = require("./connection");
const env_1 = require("../config/env");
const logger_1 = require("../utilities/logger");
const BCRYPT_ROUNDS = 12;
async function seedAdminOnly() {
    await ensureNewSchemaSuper();
}
async function ensureNewSchemaSuper() {
    const existingSuper = await (0, connection_1.queryOne)(`SELECT u_id FROM users WHERE role = 'super' ORDER BY u_id ASC LIMIT 1`);
    if (existingSuper)
        return;
    const existingUsername = await (0, connection_1.queryOne)('SELECT u_id FROM users WHERE username = $1', [env_1.config.adminUsername]);
    if (existingUsername) {
        throw new Error(`Cannot seed the new-schema Super account: username "${env_1.config.adminUsername}" is already used by a non-Super User.`);
    }
    if (!env_1.config.adminPassword) {
        throw new Error('ADMIN_PASSWORD is required to seed the new-schema Super account.');
    }
    const passwordHash = await bcryptjs_1.default.hash(env_1.config.adminPassword, BCRYPT_ROUNDS);
    await (0, connection_1.execute)(`INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ($1, $1, 'super', $2, NULL)`, [env_1.config.adminUsername, passwordHash]);
    logger_1.logger.info('New-schema Super account created', { username: env_1.config.adminUsername });
}
async function seedAdmin() {
    await seedAdminOnly();
}
//# sourceMappingURL=seed-admin.js.map