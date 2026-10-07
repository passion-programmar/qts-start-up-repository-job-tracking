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
async function validateAccountLogin(user) {
    const role = (0, roles_1.normalizeRole)(user.role);
    if (role !== 'account')
        return { error: null, accountName: null };
    if (!user.account_id) {
        return {
            error: 'This Account login is not linked to an Account team. Ask your admin to create it in QTS_Startup.',
            accountName: null,
        };
    }
    const account = await (0, connection_1.queryOne)(`SELECT b.is_active, b.name, b.manager_id,
            m.is_active AS manager_is_active,
            m.username AS manager_username
     FROM accounts b
     LEFT JOIN admins m ON m.id = b.manager_id AND m.role = 'manager'
     WHERE b.id = $1`, [user.account_id]);
    if (!account) {
        return {
            error: 'Account team not found. Ask your admin to set it up in QTS_Startup.',
            accountName: null,
        };
    }
    if (!account.is_active) {
        return {
            error: 'This Account team is inactive. Contact your admin.',
            accountName: null,
        };
    }
    if (account.manager_id != null && account.manager_is_active !== true) {
        const managerLabel = account.manager_username || 'manager';
        return {
            error: `Your manager (${managerLabel}) is inactive. Contact your admin.`,
            accountName: null,
        };
    }
    return { error: null, accountName: account.name ?? null };
}
router.post('/login', async (req, res) => {
    try {
        const { username, password, extension } = LoginSchema.parse(req.body);
        const user = await (0, connection_1.queryOne)('SELECT id, username, password_hash, role, account_id FROM admins WHERE username = $1', [username]);
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
        if (extension && role !== 'manager') {
            logger_1.logger.warn('Extension login rejected: not a manager', { username, role });
            res.status(403).json({
                success: false,
                message: 'Only Manager accounts can sign in to the extension.',
            });
            return;
        }
        const accountCheck = await validateAccountLogin(user);
        if (accountCheck.error) {
            logger_1.logger.warn('Login failed: Account login not ready', { username });
            res.status(403).json({ success: false, message: accountCheck.error });
            return;
        }
        const accountName = accountCheck.accountName;
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            username: user.username,
            role,
            accountId: user.account_id,
            accountName,
        }, env_1.config.jwtSecret, { expiresIn: env_1.config.jwtExpiry });
        const decoded = jsonwebtoken_1.default.decode(token);
        const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
        logger_1.logger.info('Login success', { username, role });
        res.json({
            success: true,
            token,
            expiresAt,
            id: user.id,
            username: user.username,
            role,
            accountId: user.account_id,
            accountName,
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
    if ((0, roles_1.normalizeRole)(req.role) === 'account') {
        const accountCheck = await validateAccountLogin({
            role: req.role || 'account',
            account_id: req.accountId ?? null,
        });
        if (accountCheck.error) {
            res.status(403).json({ success: false, message: accountCheck.error });
            return;
        }
    }
    res.json({
        success: true,
        username: req.username,
        id: req.userId,
        role: req.role || 'account',
        accountId: req.accountId ?? null,
        accountName: req.accountName ?? null,
    });
});
router.get('/extension-bootstrap', auth_1.requireAuth, async (req, res) => {
    const role = (0, roles_1.normalizeRole)(req.role);
    if (role !== 'manager' || !req.userId) {
        res.status(403).json({
            success: false,
            message: 'Only Manager accounts can use the extension.',
        });
        return;
    }
    const teams = await (0, connection_1.queryAll)('SELECT id, name FROM accounts WHERE manager_id = $1 AND is_active = TRUE ORDER BY name ASC', [req.userId]);
    const requestedAccountId = Number(req.query.accountId ?? req.accountId ?? 0);
    const selectedTeam = requestedAccountId > 0
        ? teams.find((team) => team.id === requestedAccountId)
        : null;
    if (requestedAccountId > 0 && !selectedTeam) {
        res.status(403).json({ success: false, message: 'That Account team is not assigned to your Manager account.' });
        return;
    }
    const stacks = await (0, candidate_stacks_1.getCandidateStacks)();
    if (!selectedTeam) {
        res.json({
            success: true,
            user: {
                id: req.userId,
                username: req.username,
                role,
                accountId: null,
                accountName: null,
            },
            teams,
            candidates: [],
            stacks,
        });
        return;
    }
    const [candidates, accountRow] = await Promise.all([
        (0, connection_1.queryAll)(`SELECT c.*, b.name AS account_name
       FROM candidates c
       LEFT JOIN accounts b ON b.id = c.account_id
       WHERE c.is_active = TRUE AND c.account_id = $1
       ORDER BY c.name ASC`, [selectedTeam.id]),
        (0, connection_1.queryOne)('SELECT custom_gpt_url FROM accounts WHERE id = $1', [selectedTeam.id]),
    ]);
    const customGpt = (0, custom_gpt_url_1.resolveCustomGptConfig)(accountRow?.custom_gpt_url);
    const token = jsonwebtoken_1.default.sign({
        id: req.userId,
        username: req.username,
        role,
        accountId: selectedTeam.id,
        accountName: selectedTeam.name,
        extensionAccountScope: true,
    }, env_1.config.jwtSecret, { expiresIn: env_1.config.jwtExpiry });
    const decoded = jsonwebtoken_1.default.decode(token);
    res.json({
        success: true,
        token,
        expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
        user: {
            id: req.userId,
            username: req.username,
            role,
            accountId: selectedTeam.id,
            accountName: selectedTeam.name,
        },
        candidates,
        stacks,
        customGpt,
        teams,
    });
});
router.get('/extension-status', async (_req, res) => {
    const row = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count
    FROM admins m
    INNER JOIN accounts b ON b.manager_id = m.id AND b.is_active = TRUE
    WHERE m.role = 'manager' AND m.is_active = TRUE
  `);
    res.json({
        success: true,
        hasManagerAccounts: (row?.count ?? 0) > 0,
    });
});
router.get('/setup-status', async (_req, res) => {
    const admin = await (0, connection_1.queryOne)('SELECT id FROM admins LIMIT 1');
    res.json({ success: true, initialized: !!admin });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map