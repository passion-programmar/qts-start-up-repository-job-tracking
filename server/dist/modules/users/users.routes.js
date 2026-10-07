"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const accounts_1 = require("../../services/accounts");
const credential_crypto_1 = require("../../utilities/credential-crypto");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireAdmin);
const UserSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(100),
    password: zod_1.z.string().min(1).max(200).optional(),
    role: zod_1.z.enum(['admin', 'manager', 'bidder', 'caller']),
    bidderId: zod_1.z.number().int().positive().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
});
router.get('/', async (req, res) => {
    const roleFilter = req.query.role;
    let query = `
    SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
    FROM admins a
    LEFT JOIN bidders b ON b.id = a.bidder_id`;
    const params = [];
    if (roleFilter) {
        query += ' WHERE a.role = $1';
        params.push(roleFilter);
    }
    query += ' ORDER BY a.username ASC';
    const users = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, users });
});
router.get('/:id', async (req, res) => {
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name, a.password_encrypted
     FROM admins a
     LEFT JOIN bidders b ON b.id = a.bidder_id
     WHERE a.id = $1`, [req.params.id]);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            bidder_id: user.bidder_id,
            bidder_name: user.bidder_name,
            created_at: user.created_at,
            is_active: user.is_active,
            password: (0, credential_crypto_1.decryptCredential)(user.password_encrypted),
        },
    });
});
router.post('/', async (req, res) => {
    const data = UserSchema.parse(req.body);
    if (!data.password) {
        res.status(400).json({ success: false, message: 'Password is required for new accounts.' });
        return;
    }
    if (data.role === 'bidder' && !data.bidderId) {
        res.status(400).json({
            success: false,
            message: 'Bidder accounts must be linked to a bidder organization.',
        });
        return;
    }
    if (await (0, accounts_1.usernameExists)(data.username)) {
        res.status(409).json({ success: false, message: 'Username already exists.' });
        return;
    }
    const row = await (0, accounts_1.createAccount)({
        username: data.username,
        password: data.password,
        role: data.role,
        bidderId: data.bidderId ?? null,
        isActive: data.isActive ?? true,
    });
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
     FROM admins a LEFT JOIN bidders b ON b.id = a.bidder_id WHERE a.id = $1`, [row.id]);
    logger_1.logger.info('User account created', { username: data.username, role: data.role });
    res.status(201).json({ success: true, user });
});
router.put('/:id', async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT id FROM admins WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    const data = UserSchema.parse(req.body);
    if (data.role === 'bidder' && !data.bidderId) {
        res.status(400).json({
            success: false,
            message: 'Bidder accounts must be linked to a bidder organization.',
        });
        return;
    }
    const fields = ['role = $1', 'bidder_id = $2', 'updated_at = NOW()'];
    const params = [data.role, data.bidderId ?? null];
    if (data.isActive !== undefined) {
        fields.push(`is_active = $${params.length + 1}`);
        params.push(data.isActive);
    }
    if (data.password) {
        await (0, accounts_1.updateAccountPassword)(parseInt(req.params.id, 10), data.password);
    }
    params.push(req.params.id);
    await (0, connection_1.execute)(`UPDATE admins SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
     FROM admins a LEFT JOIN bidders b ON b.id = a.bidder_id WHERE a.id = $1`, [req.params.id]);
    res.json({ success: true, user });
});
router.delete('/:id', async (req, res) => {
    if (req.userId === parseInt(req.params.id, 10)) {
        res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT username FROM admins WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM admins WHERE id = $1', [req.params.id]);
    logger_1.logger.info('User deleted', { id: req.params.id, username: existing.username });
    res.json({ success: true, message: 'User deleted.' });
});
exports.default = router;
//# sourceMappingURL=users.routes.js.map