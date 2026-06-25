"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAccount = createAccount;
exports.updateAccountPassword = updateAccountPassword;
exports.usernameExists = usernameExists;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const connection_1 = require("../database/connection");
const credential_crypto_1 = require("../utilities/credential-crypto");
const BCRYPT_ROUNDS = 12;
async function createAccount(input) {
    const hash = await bcryptjs_1.default.hash(input.password, BCRYPT_ROUNDS);
    const encrypted = (0, credential_crypto_1.encryptCredential)(input.password);
    const isActive = input.isActive ?? true;
    return (0, connection_1.queryOne)(`INSERT INTO admins (username, password_hash, password_encrypted, role, bidder_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [input.username, hash, encrypted, input.role, input.bidderId ?? null, isActive]);
}
async function updateAccountPassword(accountId, password) {
    const hash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
    const encrypted = (0, credential_crypto_1.encryptCredential)(password);
    await (0, connection_1.execute)('UPDATE admins SET password_hash = $1, password_encrypted = $2, updated_at = NOW() WHERE id = $3', [hash, encrypted, accountId]);
}
async function usernameExists(username) {
    const row = await (0, connection_1.queryOne)('SELECT id FROM admins WHERE username = $1', [username]);
    return Boolean(row);
}
//# sourceMappingURL=accounts.js.map