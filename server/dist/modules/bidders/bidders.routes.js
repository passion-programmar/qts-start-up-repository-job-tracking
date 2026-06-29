"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const accounts_1 = require("../../services/accounts");
const credential_crypto_1 = require("../../utilities/credential-crypto");
const logger_1 = require("../../utilities/logger");
const custom_gpt_url_1 = require("../../utilities/custom-gpt-url");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
async function canAccessBidder(req, bidderId) {
    if ((0, scope_1.isAdmin)(req))
        return true;
    if ((0, scope_1.isManager)(req) && req.userId) {
        const row = await (0, connection_1.queryOne)('SELECT id FROM bidders WHERE id = $1 AND manager_id = $2', [bidderId, req.userId]);
        return Boolean(row);
    }
    return false;
}
function requireAdminOrManagerRead(req, res, next) {
    if (!(0, scope_1.isAdmin)(req) && !(0, scope_1.isManager)(req)) {
        res.status(403).json({ success: false, message: 'Admin or manager access required.' });
        return;
    }
    next();
}
const BidderSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    notes: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().optional().default(true),
    managerId: zod_1.z.number().int().positive().optional().nullable(),
    password: zod_1.z.string().min(1).max(200).optional(),
    customGptUrl: zod_1.z.string().max(500).optional().nullable(),
});
function normalizeCustomGptUrlInput(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed)
        return null;
    const validated = (0, custom_gpt_url_1.validateCustomGptUrl)(trimmed);
    if (!validated.ok) {
        throw new Error(validated.message);
    }
    return validated.url;
}
const AccountSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(100),
    password: zod_1.z.string().min(1).max(200),
    role: zod_1.z.enum(['bidder', 'caller']),
    bidderId: zod_1.z.number().int().positive().optional().nullable(),
});
const AccountUpdateSchema = zod_1.z.object({
    password: zod_1.z.string().min(1).max(200),
});
function mapAccountRow(row) {
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        created_at: row.created_at,
        password: (0, credential_crypto_1.decryptCredential)(row.password_encrypted),
    };
}
async function getPrimaryBidderAccount(bidderId) {
    return (0, connection_1.queryOne)(`SELECT id, username, password_encrypted
     FROM admins
     WHERE bidder_id = $1 AND role = 'bidder'
     ORDER BY id ASC
     LIMIT 1`, [bidderId]);
}
async function getBidderAccount(bidderId, accountId) {
    return (0, connection_1.queryOne)('SELECT id, username, role FROM admins WHERE id = $1 AND bidder_id = $2', [accountId, bidderId]);
}
router.get('/', requireAdminOrManagerRead, async (req, res) => {
    const managerFilter = (0, scope_1.isManager)(req) && req.userId ? 'WHERE b.manager_id = $1' : '';
    const params = (0, scope_1.isManager)(req) && req.userId ? [req.userId] : [];
    const bidders = await (0, connection_1.queryAll)(`
    SELECT b.*,
      m.username AS manager_name,
      (SELECT COUNT(*)::int FROM admins a WHERE a.bidder_id = b.id) AS account_count,
      (SELECT COUNT(*)::int FROM candidates c WHERE c.bidder_id = b.id) AS candidate_count
    FROM bidders b
    LEFT JOIN admins m ON m.id = b.manager_id
    ${managerFilter}
    ORDER BY b.name ASC
  `, params);
    res.json({ success: true, bidders });
});
router.get('/:id', requireAdminOrManagerRead, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessBidder(req, id))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const bidder = await (0, connection_1.queryOne)(`SELECT b.*, m.username AS manager_name
     FROM bidders b
     LEFT JOIN admins m ON m.id = b.manager_id
     WHERE b.id = $1`, [id]);
    if (!bidder) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const accounts = await (0, connection_1.queryAll)(`SELECT id, username, role, created_at, password_encrypted
     FROM admins WHERE bidder_id = $1 ORDER BY username ASC`, [id]);
    const candidates = await (0, connection_1.queryAll)(`SELECT id, name, email, is_active FROM candidates WHERE bidder_id = $1 ORDER BY name ASC`, [id]);
    res.json({
        success: true,
        bidder,
        accounts: accounts.map(mapAccountRow),
        candidates,
    });
});
router.post('/', auth_1.requireAdminOrManager, async (req, res) => {
    const data = BidderSchema.parse(req.body);
    const managerId = (0, scope_1.isManager)(req) ? (req.userId ?? null) : (data.managerId ?? null);
    const username = data.name.trim();
    let customGptUrl = null;
    try {
        customGptUrl = normalizeCustomGptUrlInput(data.customGptUrl);
    }
    catch (error) {
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid Custom GPT URL.',
        });
        return;
    }
    if ((0, scope_1.isManager)(req) && !data.password) {
        res.status(400).json({ success: false, message: 'Password is required for the bidder login.' });
        return;
    }
    if (data.password) {
        if (await (0, accounts_1.usernameExists)(username)) {
            res.status(409).json({
                success: false,
                message: 'A login with this bidder name already exists. Choose a different name.',
            });
            return;
        }
    }
    const row = await (0, connection_1.queryOne)(`INSERT INTO bidders (name, notes, is_active, manager_id, custom_gpt_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [data.name, data.notes || null, data.isActive ?? true, managerId, customGptUrl]);
    if (data.password) {
        await (0, accounts_1.createAccount)({
            username,
            password: data.password,
            role: 'bidder',
            bidderId: row.id,
        });
    }
    const bidder = await (0, connection_1.queryOne)('SELECT * FROM bidders WHERE id = $1', [row.id]);
    logger_1.logger.info('Bidder created', { id: row.id, name: data.name, managerId, accountCreated: Boolean(data.password) });
    res.status(201).json({ success: true, bidder });
});
router.put('/:id', auth_1.requireAdminOrManager, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessBidder(req, id))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const data = BidderSchema.parse(req.body);
    const managerId = (0, scope_1.isManager)(req) ? (req.userId ?? null) : (data.managerId ?? null);
    let customGptUrl = null;
    try {
        customGptUrl = normalizeCustomGptUrlInput(data.customGptUrl);
    }
    catch (error) {
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid Custom GPT URL.',
        });
        return;
    }
    await (0, connection_1.execute)(`UPDATE bidders SET name = $1, notes = $2, is_active = $3, manager_id = $4, custom_gpt_url = $5, updated_at = NOW() WHERE id = $6`, [data.name, data.notes || null, data.isActive ?? true, managerId, customGptUrl, id]);
    const primaryAccount = await getPrimaryBidderAccount(id);
    if (primaryAccount) {
        if (primaryAccount.username !== data.name.trim()) {
            if (await (0, accounts_1.usernameExists)(data.name.trim())) {
                res.status(409).json({
                    success: false,
                    message: 'A login with this bidder name already exists. Choose a different name.',
                });
                return;
            }
            await (0, connection_1.execute)('UPDATE admins SET username = $1, updated_at = NOW() WHERE id = $2', [data.name.trim(), primaryAccount.id]);
        }
        if (data.password) {
            await (0, accounts_1.updateAccountPassword)(primaryAccount.id, data.password);
        }
    }
    const bidder = await (0, connection_1.queryOne)('SELECT * FROM bidders WHERE id = $1', [id]);
    res.json({ success: true, bidder });
});
router.delete('/:id', auth_1.requireAdminOrManager, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessBidder(req, id))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT name FROM bidders WHERE id = $1', [id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM admins WHERE bidder_id = $1', [id]);
    await (0, connection_1.execute)('UPDATE candidates SET bidder_id = NULL WHERE bidder_id = $1', [id]);
    await (0, connection_1.execute)('DELETE FROM bidders WHERE id = $1', [id]);
    logger_1.logger.info('Bidder deleted', { id, name: existing.name });
    res.json({ success: true, message: 'Bidder deleted.' });
});
router.post('/:id/accounts', auth_1.requireAdminOrManager, async (req, res) => {
    const bidderId = parseInt(req.params.id, 10);
    if (!(await canAccessBidder(req, bidderId))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const data = AccountSchema.parse(req.body);
    const linkedBidderId = data.role === 'bidder' ? (data.bidderId ?? bidderId) : data.bidderId ?? null;
    if (await (0, accounts_1.usernameExists)(data.username)) {
        res.status(409).json({ success: false, message: 'Username already exists.' });
        return;
    }
    const row = await (0, accounts_1.createAccount)({
        username: data.username,
        password: data.password,
        role: data.role,
        bidderId: linkedBidderId,
    });
    const account = await (0, connection_1.queryOne)('SELECT id, username, role, bidder_id, created_at FROM admins WHERE id = $1', [row.id]);
    logger_1.logger.info('Account created for bidder', { bidderId, username: data.username });
    res.status(201).json({ success: true, account });
});
router.put('/:id/accounts/:accountId', auth_1.requireAdminOrManager, async (req, res) => {
    const bidderId = parseInt(req.params.id, 10);
    const accountId = parseInt(req.params.accountId, 10);
    if (!(await canAccessBidder(req, bidderId))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const existing = await getBidderAccount(bidderId, accountId);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
    }
    const data = AccountUpdateSchema.parse(req.body);
    await (0, accounts_1.updateAccountPassword)(accountId, data.password);
    logger_1.logger.info('Account password updated', { bidderId, accountId, username: existing.username });
    res.json({ success: true, message: 'Password updated.' });
});
router.delete('/:id/accounts/:accountId', auth_1.requireAdminOrManager, async (req, res) => {
    const bidderId = parseInt(req.params.id, 10);
    const accountId = parseInt(req.params.accountId, 10);
    if (!(await canAccessBidder(req, bidderId))) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    const existing = await getBidderAccount(bidderId, accountId);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM admins WHERE id = $1', [accountId]);
    logger_1.logger.info('Account deleted for bidder', { bidderId, accountId, username: existing.username });
    res.json({ success: true, message: 'Account deleted.' });
});
exports.default = router;
//# sourceMappingURL=bidders.routes.js.map