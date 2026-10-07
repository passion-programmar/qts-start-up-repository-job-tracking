"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptCredential = encryptCredential;
exports.decryptCredential = decryptCredential;
const node_crypto_1 = __importDefault(require("node:crypto"));
const env_1 = require("../config/env");
const ALGO = 'aes-256-gcm';
const KEY = node_crypto_1.default.scryptSync(env_1.config.jwtSecret, 'qts-managed-credential', 32);
function encryptCredential(plaintext) {
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv(ALGO, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}
function decryptCredential(payload) {
    if (!payload)
        return null;
    try {
        const [ivB64, tagB64, dataB64] = payload.split(':');
        if (!ivB64 || !tagB64 || !dataB64)
            return null;
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const data = Buffer.from(dataB64, 'base64');
        const decipher = node_crypto_1.default.createDecipheriv(ALGO, KEY, new Uint8Array(iv));
        decipher.setAuthTag(new Uint8Array(tag));
        const decrypted = Buffer.concat([
            decipher.update(new Uint8Array(data)),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=credential-crypto.js.map