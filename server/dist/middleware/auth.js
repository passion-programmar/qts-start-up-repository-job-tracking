"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAuthOrGptActionKey = requireAuthOrGptActionKey;
exports.requireAdmin = requireAdmin;
exports.requireSuper = requireSuper;
exports.requireAdminOrAccount = requireAdminOrAccount;
exports.requireAdminOrCaller = requireAdminOrCaller;
exports.requireAdminOrManager = requireAdminOrManager;
exports.requireAdminWrite = requireAdminWrite;
exports.requireAdminOrManagerWrite = requireAdminOrManagerWrite;
exports.requireAdminManagerOrAccount = requireAdminManagerOrAccount;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const roles_1 = require("../lib/roles");
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.config.jwtSecret);
        req.userId = payload.id;
        req.username = payload.username;
        req.adminId = payload.id;
        req.adminUsername = payload.username;
        req.role = (0, roles_1.normalizeRole)(payload.role);
        req.accountId = payload.accountId != null ? Number(payload.accountId) : null;
        req.accountName = payload.accountName ?? null;
        req.extensionAccountScope = payload.extensionAccountScope === true;
        next();
    }
    catch {
        res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
    }
}
/** Accepts account/admin JWT or the static GPT_ACTION_API_KEY for Custom GPT Actions. */
function requireAuthOrGptActionKey(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return;
    }
    const token = header.slice(7);
    if (env_1.config.gptActionApiKey && token === env_1.config.gptActionApiKey) {
        req.gptServiceAuth = true;
        req.role = 'admin';
        next();
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.config.jwtSecret);
        req.userId = payload.id;
        req.username = payload.username;
        req.adminId = payload.id;
        req.adminUsername = payload.username;
        req.role = (0, roles_1.normalizeRole)(payload.role);
        req.accountId = payload.accountId != null ? Number(payload.accountId) : null;
        req.accountName = payload.accountName ?? null;
        req.extensionAccountScope = payload.extensionAccountScope === true;
        next();
    }
    catch {
        res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
    }
}
function requireAdmin(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super') {
        res.status(403).json({ success: false, message: 'Admin access required.' });
        return;
    }
    next();
}
function requireSuper(req, res, next) {
    if (req.role !== 'super') {
        res.status(403).json({ success: false, message: 'Super access required.' });
        return;
    }
    next();
}
function requireAdminOrAccount(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'account' &&
        !(req.role === 'manager' && req.extensionAccountScope && req.accountId)) {
        res.status(403).json({ success: false, message: 'Account access required.' });
        return;
    }
    next();
}
function requireAdminOrCaller(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'caller' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Caller access required.' });
        return;
    }
    next();
}
function requireAdminOrManager(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Manager access required.' });
        return;
    }
    next();
}
function requireAdminWrite(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super') {
        res.status(403).json({ success: false, message: 'Only admins can modify or delete records.' });
        return;
    }
    next();
}
function requireAdminOrManagerWrite(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Admin or manager access required.' });
        return;
    }
    next();
}
function requireAdminManagerOrAccount(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager' && req.role !== 'account') {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map