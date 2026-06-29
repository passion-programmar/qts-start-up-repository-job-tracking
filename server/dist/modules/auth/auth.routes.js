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
const candidate_stacks_1 = require("../../config/candidate-stacks");
const auth_1 = require("../../middleware/auth");
const roles_1 = require("../../lib/roles");
const logger_1 = require("../../utilities/logger");
const custom_gpt_url_1 = require("../../utilities/custom-gpt-url");
const router = (0, express_1.Router)();
const LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
    extension: zod_1.z.boolean().optional().default(false),
});
async function validateBidderAccount(user) {
    const role = (0, roles_1.normalizeRole)(user.role);
    if (role !== 'bidder')
        return { error: null, bidderName: null };
    if (!user.bidder_id) {
        return {
            error: 'This account is not linked to a bidder organization. Ask your admin to create it in QTS_Startup.',
            bidderName: null,
        };
    }
    const bidder = await (0, connection_1.queryOne)(`SELECT b.is_active, b.name, b.manager_id,
            m.is_active AS manager_is_active,
            m.username AS manager_username
     FROM bidders b
     LEFT JOIN admins m ON m.id = b.manager_id AND m.role = 'manager'
     WHERE b.id = $1`, [user.bidder_id]);
    if (!bidder) {
        return {
            error: 'Bidder organization not found. Ask your admin to set up your account in QTS_Startup.',
            bidderName: null,
        };
    }
    if (!bidder.is_active) {
        return {
            error: 'This bidder organization is inactive. Contact your admin.',
            bidderName: null,
        };
    }
    if (bidder.manager_id != null && bidder.manager_is_active !== true) {
        const managerLabel = bidder.manager_username || 'manager';
        return {
            error: `Your manager (${managerLabel}) is inactive. Contact your admin.`,
            bidderName: null,
        };
    }
    return { error: null, bidderName: bidder.name ?? null };
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
        const bidderCheck = await validateBidderAccount(user);
        if (bidderCheck.error) {
            logger_1.logger.warn('Login failed: bidder account not ready', { username });
            res.status(403).json({ success: false, message: bidderCheck.error });
            return;
        }
        const bidderName = bidderCheck.bidderName;
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            username: user.username,
            role,
            bidderId: user.bidder_id,
            bidderName,
        }, env_1.config.jwtSecret, { expiresIn: env_1.config.jwtExpiry });
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
    if ((0, roles_1.normalizeRole)(req.role) === 'bidder') {
        const bidderCheck = await validateBidderAccount({
            role: req.role || 'bidder',
            bidder_id: req.bidderId ?? null,
        });
        if (bidderCheck.error) {
            res.status(403).json({ success: false, message: bidderCheck.error });
            return;
        }
    }
    res.json({
        success: true,
        username: req.username,
        id: req.userId,
        role: req.role || 'bidder',
        bidderId: req.bidderId ?? null,
        bidderName: req.bidderName ?? null,
    });
});
router.get('/extension-bootstrap', auth_1.requireAuth, async (req, res) => {
    const role = (0, roles_1.normalizeRole)(req.role);
    const bidderId = req.bidderId != null ? Number(req.bidderId) : null;
    if (role !== 'bidder' || !bidderId) {
        res.status(403).json({
            success: false,
            message: 'The extension requires a bidder account linked to a bidder organization.',
        });
        return;
    }
    const bidderCheck = await validateBidderAccount({
        role: req.role || 'bidder',
        bidder_id: bidderId,
    });
    if (bidderCheck.error) {
        res.status(403).json({ success: false, message: bidderCheck.error });
        return;
    }
    const [candidates, stacks, bidderRow] = await Promise.all([
        (0, connection_1.queryAll)(`SELECT c.*, b.name AS bidder_name
       FROM candidates c
       LEFT JOIN bidders b ON b.id = c.bidder_id
       WHERE c.is_active = TRUE AND c.bidder_id = $1
       ORDER BY c.name ASC`, [bidderId]),
        (0, candidate_stacks_1.getCandidateStacks)(),
        (0, connection_1.queryOne)('SELECT custom_gpt_url FROM bidders WHERE id = $1', [bidderId]),
    ]);
    const customGpt = (0, custom_gpt_url_1.resolveCustomGptConfig)(bidderRow?.custom_gpt_url);
    res.json({
        success: true,
        user: {
            id: req.userId,
            username: req.username,
            role: req.role,
            bidderId,
            bidderName: req.bidderName ?? null,
        },
        candidates,
        stacks,
        customGpt,
    });
});
router.get('/extension-status', async (_req, res) => {
    const row = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count
    FROM admins a
    INNER JOIN bidders b ON b.id = a.bidder_id
    LEFT JOIN admins m ON m.id = b.manager_id AND m.role = 'manager'
    WHERE a.role = 'bidder'
      AND b.is_active = TRUE
      AND (b.manager_id IS NULL OR m.is_active = TRUE)
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