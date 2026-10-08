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
const credential_crypto_1 = require("../utilities/credential-crypto");
const candidate_stacks_1 = require("../config/candidate-stacks");
const BCRYPT_ROUNDS = 12;
async function ensureUser(username, password, role, accountId = null) {
    if (!password) {
        logger_1.logger.warn(`No password configured for ${username}, skipping account seed`);
        return 0;
    }
    const existing = await (0, connection_1.queryOne)('SELECT id, password_hash, role, account_id, password_encrypted FROM admins WHERE username = $1', [username]);
    const passwordHash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
    const passwordEncrypted = (0, credential_crypto_1.encryptCredential)(password);
    if (existing) {
        const needsHashMigration = !existing.password_hash.startsWith('$2');
        const needsRoleUpdate = existing.role !== role;
        const needsAccountUpdate = existing.account_id !== accountId;
        const passwordMatches = await bcryptjs_1.default.compare(password, existing.password_hash);
        const needsPasswordUpdate = needsHashMigration && !passwordMatches;
        const needsEncryptedBackfill = !existing.password_encrypted && passwordMatches;
        if (needsHashMigration || needsRoleUpdate || needsAccountUpdate || needsPasswordUpdate || needsEncryptedBackfill) {
            const nextHash = needsHashMigration || needsPasswordUpdate
                ? passwordHash
                : existing.password_hash;
            const nextEncrypted = needsPasswordUpdate || needsEncryptedBackfill
                ? passwordEncrypted
                : existing.password_encrypted;
            await (0, connection_1.execute)(`UPDATE admins SET password_hash = $1, password_encrypted = $2, role = $3, account_id = $4, updated_at = NOW() WHERE id = $5`, [nextHash, nextEncrypted, role, accountId, existing.id]);
            logger_1.logger.info('User account updated', { username, role });
        }
        return existing.id;
    }
    const row = await (0, connection_1.queryOne)('INSERT INTO admins (username, password_hash, password_encrypted, role, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, passwordHash, passwordEncrypted, role, accountId]);
    logger_1.logger.info('User account created', { username, role });
    return row.id;
}
async function ensureDefaultSettings() {
    const existing = await (0, connection_1.queryOne)('SELECT key FROM settings WHERE key = $1', ['admin_ui_mode']);
    if (!existing) {
        await (0, connection_1.execute)(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())`, ['admin_ui_mode', 'mode1']);
        logger_1.logger.info('Default setting created', { key: 'admin_ui_mode', value: 'mode1' });
    }
    const stacks = await (0, connection_1.queryOne)('SELECT key FROM settings WHERE key = $1', [candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY]);
    if (!stacks) {
        await (0, connection_1.execute)(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())`, [candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY, (0, candidate_stacks_1.serializeCandidateStacks)([...candidate_stacks_1.DEFAULT_CANDIDATE_STACKS])]);
        logger_1.logger.info('Default setting created', { key: candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY });
    }
}
async function seedAdminOnly() {
    const existingSuper = await (0, connection_1.queryOne)(`SELECT id, username FROM admins WHERE role = 'super' ORDER BY id ASC LIMIT 1`);
    if (existingSuper) {
        if (env_1.config.adminUsername === 'super' && existingSuper.username === 'admin') {
            await (0, connection_1.execute)(`UPDATE admins SET username = $1, updated_at = NOW()
         WHERE username = $2 AND role = 'super'`, ['super', 'admin']);
            existingSuper.username = 'super';
        }
        await ensureUser(existingSuper.username, env_1.config.adminPassword, 'super', null);
    }
    else {
        await ensureUser(env_1.config.adminUsername, env_1.config.adminPassword, 'super', null);
    }
    await ensureNewSchemaSuper();
    await ensureDefaultSettings();
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