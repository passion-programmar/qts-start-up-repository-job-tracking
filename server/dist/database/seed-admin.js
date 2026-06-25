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
async function ensureUser(username, password, role, bidderId = null) {
    if (!password) {
        logger_1.logger.warn(`No password configured for ${username}, skipping account seed`);
        return 0;
    }
    const existing = await (0, connection_1.queryOne)('SELECT id, password_hash, role, bidder_id, password_encrypted FROM admins WHERE username = $1', [username]);
    const passwordHash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
    const passwordEncrypted = (0, credential_crypto_1.encryptCredential)(password);
    if (existing) {
        const needsHashMigration = !existing.password_hash.startsWith('$2');
        const needsRoleUpdate = existing.role !== role;
        const needsBidderUpdate = existing.bidder_id !== bidderId;
        const passwordMatches = await bcryptjs_1.default.compare(password, existing.password_hash);
        const needsPasswordUpdate = !passwordMatches;
        const needsEncryptedBackfill = !existing.password_encrypted;
        if (needsHashMigration || needsRoleUpdate || needsBidderUpdate || needsPasswordUpdate || needsEncryptedBackfill) {
            const nextHash = needsHashMigration || needsPasswordUpdate
                ? passwordHash
                : existing.password_hash;
            const nextEncrypted = needsPasswordUpdate || needsEncryptedBackfill
                ? passwordEncrypted
                : existing.password_encrypted;
            await (0, connection_1.execute)(`UPDATE admins SET password_hash = $1, password_encrypted = $2, role = $3, bidder_id = $4, updated_at = NOW() WHERE id = $5`, [nextHash, nextEncrypted, role, bidderId, existing.id]);
            logger_1.logger.info('User account updated', { username, role });
        }
        return existing.id;
    }
    const row = await (0, connection_1.queryOne)('INSERT INTO admins (username, password_hash, password_encrypted, role, bidder_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, passwordHash, passwordEncrypted, role, bidderId]);
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
    await ensureUser(env_1.config.adminUsername, env_1.config.adminPassword, 'admin', null);
    await ensureDefaultSettings();
}
async function seedAdmin() {
    await seedAdminOnly();
}
//# sourceMappingURL=seed-admin.js.map