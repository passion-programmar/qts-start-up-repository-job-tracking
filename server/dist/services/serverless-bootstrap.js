"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureServerlessDatabaseReady = ensureServerlessDatabaseReady;
const connection_1 = require("../database/connection");
const seed_admin_1 = require("../database/seed-admin");
const env_1 = require("../config/env");
let initialization = null;
function validateServerlessEnvironment() {
    const required = [
        'DATABASE_URL',
        'JWT_SECRET',
        'ADMIN_PASSWORD',
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
        throw new Error(`Missing required Vercel environment variables: ${missing.join(', ')}`);
    }
    if (env_1.config.useEmbeddedPg) {
        throw new Error('Set EMBEDDED_PG=false for the Vercel API deployment.');
    }
    if (env_1.config.jwtSecret.length < 32 || env_1.config.jwtSecret === 'change-this-secret') {
        throw new Error('JWT_SECRET must be a unique secret with at least 32 characters.');
    }
}
async function initialize() {
    validateServerlessEnvironment();
    await (0, connection_1.initDb)();
    await (0, seed_admin_1.seedAdmin)();
}
function ensureServerlessDatabaseReady() {
    if (!initialization) {
        initialization = initialize().catch((error) => {
            initialization = null;
            throw error;
        });
    }
    return initialization;
}
//# sourceMappingURL=serverless-bootstrap.js.map