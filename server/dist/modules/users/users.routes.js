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
router.use(auth_1.requireAuth);
const UserSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(100),
    password: zod_1.z.string().min(1).max(200).optional(),
    role: zod_1.z.enum(['super', 'admin', 'manager', 'account', 'caller']),
    accountId: zod_1.z.number().int().positive().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
});
function canManageRole(actorRole, targetRole) {
    if (actorRole === 'super')
        return targetRole !== 'super';
    if (actorRole === 'admin')
        return targetRole === 'manager' || targetRole === 'caller';
    return false;
}
function requireUserManagement(req, res, targetRole) {
    if (req.role !== 'super' && req.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Admin access required.' });
        return false;
    }
    if (targetRole && !canManageRole(req.role, targetRole)) {
        res.status(403).json({ success: false, message: 'You cannot manage this account role.' });
        return false;
    }
    return true;
}
router.get('/', async (req, res) => {
    if (!requireUserManagement(req, res))
        return;
    const roleFilter = req.query.role;
    let query = `
    SELECT a.id, a.username, a.role, a.account_id, a.is_active, a.created_at, b.name AS account_name
    FROM admins a
    LEFT JOIN accounts b ON b.id = a.account_id`;
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
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.account_id, a.is_active, a.created_at, b.name AS account_name, a.password_encrypted
     FROM admins a
     LEFT JOIN accounts b ON b.id = a.account_id
     WHERE a.id = $1`, [req.params.id]);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    if (!requireUserManagement(req, res, user.role))
        return;
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            account_id: user.account_id,
            account_name: user.account_name,
            created_at: user.created_at,
            is_active: user.is_active,
            password: user.role === 'account' ? null : (0, credential_crypto_1.decryptCredential)(user.password_encrypted),
        },
    });
});
router.post('/', async (req, res) => {
    const data = UserSchema.parse(req.body);
    if (!requireUserManagement(req, res, data.role))
        return;
    if (!data.password) {
        res.status(400).json({ success: false, message: 'Password is required for new accounts.' });
        return;
    }
    if (data.role === 'account' && !data.accountId) {
        res.status(400).json({
            success: false,
            message: 'Account logins must be linked to an Account team.',
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
        accountId: data.accountId ?? null,
        isActive: data.isActive ?? true,
    });
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.account_id, a.is_active, a.created_at, b.name AS account_name
     FROM admins a LEFT JOIN accounts b ON b.id = a.account_id WHERE a.id = $1`, [row.id]);
    logger_1.logger.info('User account created', { username: data.username, role: data.role });
    res.status(201).json({ success: true, user });
});
router.put('/:id', async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT id, role FROM admins WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    const data = UserSchema.parse(req.body);
    if (existing.role === 'account' && data.password) {
        res.status(403).json({ success: false, message: 'Account passwords cannot be viewed or reset here.' });
        return;
    }
    if (!requireUserManagement(req, res, existing.role) ||
        (data.role !== existing.role && !requireUserManagement(req, res, data.role)))
        return;
    if (req.role !== 'super' && data.role === 'admin') {
        res.status(403).json({ success: false, message: 'Only Super can assign the Admin role.' });
        return;
    }
    if (data.role === 'account' && !data.accountId) {
        res.status(400).json({
            success: false,
            message: 'Account logins must be linked to an Account team.',
        });
        return;
    }
    const fields = ['role = $1', 'account_id = $2', 'updated_at = NOW()'];
    const params = [data.role, data.accountId ?? null];
    if (data.isActive !== undefined) {
        fields.push(`is_active = $${params.length + 1}`);
        params.push(data.isActive);
    }
    if (data.password) {
        await (0, accounts_1.updateAccountPassword)(parseInt(req.params.id, 10), data.password);
    }
    params.push(req.params.id);
    await (0, connection_1.execute)(`UPDATE admins SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    const user = await (0, connection_1.queryOne)(`SELECT a.id, a.username, a.role, a.account_id, a.is_active, a.created_at, b.name AS account_name
     FROM admins a LEFT JOIN accounts b ON b.id = a.account_id WHERE a.id = $1`, [req.params.id]);
    res.json({ success: true, user });
});
router.delete('/:id', async (req, res) => {
    if (req.userId === parseInt(req.params.id, 10)) {
        res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT username, role FROM admins WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    if (!requireUserManagement(req, res, existing.role))
        return;
    await (0, connection_1.execute)('DELETE FROM admins WHERE id = $1', [req.params.id]);
    logger_1.logger.info('User deleted', { id: req.params.id, username: existing.username });
    res.json({ success: true, message: 'User deleted.' });
});
exports.default = router;
//# sourceMappingURL=users.routes.js.map