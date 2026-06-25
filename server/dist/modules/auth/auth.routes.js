"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const env_1 = require("../../config/env");
const auth_1 = require("../../middleware/auth");
const roles_1 = require("../../lib/roles");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
const LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
    extension: zod_1.z.boolean().optional().default(false),
});
async function validateBidderAccount(user) {
    const role = (0, roles_1.normalizeRole)(user.role);
    if (role !== 'bidder')
        return null;
    if (!user.bidder_id) {
        return 'This account is not linked to a bidder organization. Ask your admin to create it in QTS_Startup.';
    }
    const bidder = await (0, connection_1.queryOne)('SELECT is_active FROM bidders WHERE id = $1', [user.bidder_id]);
    if (!bidder) {
        return 'Bidder organization not found. Ask your admin to set up your account in QTS_Startup.';
    }
    if (!bidder.is_active) {
        return 'This bidder organization is inactive. Contact your admin.';
    }
    return null;
}
router.post('/login', async (req, res) => {
    try {
        const { username, password, extension } = LoginSchema.parse(req.body);
        const user = await (0, connection_1.queryOne)('SELECT id, username, password_hash, role, bidder_id FROM admins WHERE username = $1', [username]);
        if (!user) {
            logger_1.logger.warn('Login failed: unknown username', { username });
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            logger_1.logger.warn('Login failed: wrong password', { username });
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
            return;
        }
        const role = (0, roles_1.normalizeRole)(user.role);
        if (extension && role !== 'bidder') {
            logger_1.logger.warn('Extension login rejected: not a bidder', { username, role });
            res.status(403).json({
                success: false,
                message: 'The extension requires a bidder account. Use QTS_Startup web for admin or caller access.',
            });
            return;
        }
        const bidderError = await validateBidderAccount(user);
        if (bidderError) {
            logger_1.logger.warn('Login failed: bidder account not ready', { username });
            res.status(403).json({ success: false, message: bidderError });
            return;
        }
        let bidderName = null;
        if (user.bidder_id) {
            const bidder = await (0, connection_1.queryOne)('SELECT name FROM bidders WHERE id = $1', [user.bidder_id]);
            bidderName = bidder?.name ?? null;
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, role, bidderId: user.bidder_id }, env_1.config.jwtSecret, { expiresIn: env_1.config.jwtExpiry });
        logger_1.logger.info('Login success', { username, role });
        res.json({
            success: true,
            token,
            username: user.username,
            role,
            bidderId: user.bidder_id,
            bidderName,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            res.status(400).json({ success: false, message: 'Username and password are required.' });
        }
        else {
            throw err;
        }
    }
});
router.post('/logout', auth_1.requireAuth, (req, res) => {
    logger_1.logger.info('Logout', { username: req.username });
    res.json({ success: true, message: 'Logged out.' });
});
router.get('/me', auth_1.requireAuth, async (req, res) => {
    let bidderName = null;
    if (req.bidderId) {
        const bidder = await (0, connection_1.queryOne)('SELECT name FROM bidders WHERE id = $1', [req.bidderId]);
        bidderName = bidder?.name ?? null;
    }
    res.json({
        success: true,
        username: req.username,
        id: req.userId,
        role: req.role || 'bidder',
        bidderId: req.bidderId ?? null,
        bidderName,
    });
});
router.get('/extension-status', async (_req, res) => {
    const row = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count
    FROM admins a
    INNER JOIN bidders b ON b.id = a.bidder_id
    WHERE a.role = 'bidder' AND b.is_active = TRUE
  `);
    res.json({
        success: true,
        hasBidderAccounts: (row?.count ?? 0) > 0,
    });
});
router.get('/setup-status', async (_req, res) => {
    const admin = await (0, connection_1.queryOne)('SELECT id FROM admins LIMIT 1');
    res.json({ success: true, initialized: !!admin });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map