"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
dotenv_1.default.config({ path: node_path_1.default.join((0, paths_1.getAppRoot)(), '.env') });
function buildDatabaseUrl() {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }
    const user = process.env.PGUSER || 'postgres';
    const password = process.env.PGPASSWORD || 'postgres';
    const host = process.env.PGHOST || 'localhost';
    const port = process.env.PGPORT || '5432';
    const database = process.env.PGDATABASE || 'qts_startup';
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
}
exports.config = {
    port: parseInt(process.env.PORT || '1028', 10),
    host: process.env.HOST || '127.0.0.1',
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
    jwtExpiry: process.env.JWT_EXPIRY || '24h',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    managerUsername: process.env.MANAGER_USERNAME || 'manager',
    managerPassword: process.env.MANAGER_PASSWORD || 'user',
    bidderUsername: process.env.BIDDER_USERNAME || 'bidder',
    bidderPassword: process.env.BIDDER_PASSWORD || 'user',
    callerUsername: process.env.CALLER_USERNAME || 'caller',
    callerPassword: process.env.CALLER_PASSWORD || 'user',
    useEmbeddedPg: String(process.env.EMBEDDED_PG ?? 'true').toLowerCase() === 'true',
    pgliteDataPath: node_path_1.default.resolve((0, paths_1.getAppRoot)(), 'data', 'pglite'),
    databaseUrl: buildDatabaseUrl(),
    databaseSsl: String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true',
    databasePoolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
    backupsPath: node_path_1.default.resolve((0, paths_1.getAppRoot)(), 'backups'),
    nodeEnv: process.env.NODE_ENV || 'development',
    autoOpenBrowser: String(process.env.AUTO_OPEN_BROWSER || 'true').toLowerCase() === 'true',
    adminWebUrl: process.env.ADMIN_WEB_URL || 'http://localhost:1027/login',
};
//# sourceMappingURL=env.js.map