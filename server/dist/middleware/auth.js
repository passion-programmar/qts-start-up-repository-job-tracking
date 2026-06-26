"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAuthOrGptActionKey = requireAuthOrGptActionKey;
exports.requireAdmin = requireAdmin;
exports.requireAdminOrBidder = requireAdminOrBidder;
exports.requireAdminOrCaller = requireAdminOrCaller;
exports.requireAdminOrManager = requireAdminOrManager;
exports.requireAdminWrite = requireAdminWrite;
exports.requireAdminOrManagerWrite = requireAdminOrManagerWrite;
exports.requireAdminManagerOrBidder = requireAdminManagerOrBidder;
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
        req.bidderId = payload.bidderId != null ? Number(payload.bidderId) : null;
        req.bidderName = payload.bidderName ?? null;
        next();
    }
    catch {
        res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
    }
}
/** Accepts bidder/admin JWT or the static GPT_ACTION_API_KEY for Custom GPT Actions. */
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
        req.bidderId = payload.bidderId != null ? Number(payload.bidderId) : null;
        req.bidderName = payload.bidderName ?? null;
        next();
    }
    catch {
        res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
    }
}
function requireAdmin(req, res, next) {
    if (req.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Admin access required.' });
        return;
    }
    next();
}
function requireAdminOrBidder(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'bidder') {
        res.status(403).json({ success: false, message: 'Bidder access required.' });
        return;
    }
    next();
}
function requireAdminOrCaller(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'caller' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Caller access required.' });
        return;
    }
    next();
}
function requireAdminOrManager(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Manager access required.' });
        return;
    }
    next();
}
function requireAdminWrite(req, res, next) {
    if (req.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Only admins can modify or delete records.' });
        return;
    }
    next();
}
function requireAdminOrManagerWrite(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Admin or manager access required.' });
        return;
    }
    next();
}
function requireAdminManagerOrBidder(req, res, next) {
    if (req.role !== 'admin' && req.role !== 'manager' && req.role !== 'bidder') {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map