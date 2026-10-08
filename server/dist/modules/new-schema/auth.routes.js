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
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
const LoginSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(1).max(100),
    password: zod_1.z.string().min(1).max(200),
});
const ChangePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1).max(200),
    newPassword: zod_1.z.string().min(4).max(200),
});
const UpdateProfileSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1).max(200),
    username: zod_1.z.string().trim().min(1).max(100),
    name: zod_1.z.string().trim().min(1).max(200),
    newPassword: zod_1.z.string().min(4).max(200).optional(),
});
function createToken(user) {
    return jsonwebtoken_1.default.sign({
        schema: 'new',
        id: user.u_id,
        username: user.username,
        role: user.role,
    }, env_1.config.jwtSecret, { expiresIn: env_1.config.jwtExpiry });
}
router.post('/login', async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Username and password are required.' });
        return;
    }
    const user = await (0, connection_1.queryOne)(`WITH RECURSIVE user_tree AS (
       SELECT u_id, parent_user_id, blocked_date
       FROM users
       WHERE username = $1
       UNION
       SELECT parent.u_id, parent.parent_user_id, parent.blocked_date
       FROM users parent
       JOIN user_tree child ON child.parent_user_id = parent.u_id
     )
     SELECT u.u_id, u.username, u.role, u.password_hash,
            EXISTS (SELECT 1 FROM user_tree WHERE blocked_date IS NOT NULL) AS blocked
     FROM users u
     WHERE u.username = $1`, [parsed.data.username]);
    if (!user || user.role === 'account' || !user.password_hash || user.blocked ||
        !(await bcryptjs_1.default.compare(parsed.data.password, user.password_hash))) {
        logger_1.logger.warn('New-schema login failed', { username: parsed.data.username });
        res.status(401).json({ success: false, message: 'Invalid credentials or unavailable account.' });
        return;
    }
    const token = createToken(user);
    const decoded = jsonwebtoken_1.default.decode(token);
    logger_1.logger.info('New-schema login success', { username: user.username, role: user.role });
    res.json({
        success: true,
        token,
        expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
        id: user.u_id,
        username: user.username,
        role: user.role,
    });
});
router.get('/me', new_schema_auth_1.requireNewSchemaAuth, (req, res) => {
    const user = req.newSchemaUser;
    res.json({
        success: true,
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        parentUserId: user.parentUserId,
    });
});
router.post('/logout', new_schema_auth_1.requireNewSchemaAuth, (_req, res) => {
    res.json({ success: true, message: 'Logged out.' });
});
router.put('/change-password', new_schema_auth_1.requireNewSchemaAuth, async (req, res) => {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter your current password and a new password of at least 4 characters.' });
        return;
    }
    const user = await (0, connection_1.queryOne)('SELECT u_id, username, role, password_hash FROM users WHERE u_id = $1', [req.userId]);
    if (!user || !(await bcryptjs_1.default.compare(parsed.data.currentPassword, user.password_hash))) {
        res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(parsed.data.newPassword, 12);
    await (0, connection_1.execute)('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE u_id = $2', [passwordHash, user.u_id]);
    const updated = { ...user, must_change_password: false };
    const token = createToken(updated);
    const decoded = jsonwebtoken_1.default.decode(token);
    res.json({
        success: true,
        token,
        expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
        message: 'Password changed.',
    });
});
router.put('/me', new_schema_auth_1.requireNewSchemaAuth, async (req, res) => {
    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter your current password, username, and display name. New passwords must have at least 4 characters.' });
        return;
    }
    const user = await (0, connection_1.queryOne)('SELECT u_id, username, name, role, password_hash FROM users WHERE u_id = $1', [req.userId]);
    if (!user || !(await bcryptjs_1.default.compare(parsed.data.currentPassword, user.password_hash))) {
        res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        return;
    }
    const duplicate = await (0, connection_1.queryOne)('SELECT u_id FROM users WHERE username = $1 AND u_id <> $2', [parsed.data.username, user.u_id]);
    if (duplicate) {
        res.status(409).json({ success: false, message: 'That username is already in use.' });
        return;
    }
    const passwordHash = parsed.data.newPassword
        ? await bcryptjs_1.default.hash(parsed.data.newPassword, 12)
        : null;
    await (0, connection_1.execute)(`UPDATE users
     SET username = $1, name = $2,
         password_hash = COALESCE($3, password_hash),
         must_change_password = FALSE
     WHERE u_id = $4`, [parsed.data.username, parsed.data.name, passwordHash, user.u_id]);
    const updated = {
        u_id: user.u_id,
        username: parsed.data.username,
        role: user.role,
        must_change_password: false,
    };
    const token = createToken(updated);
    const decoded = jsonwebtoken_1.default.decode(token);
    res.json({
        success: true,
        token,
        expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
        username: parsed.data.username,
        name: parsed.data.name,
    });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map