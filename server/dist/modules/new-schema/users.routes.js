"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const staffCreateSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(1).max(100),
    password: zod_1.z.string().min(4).max(200),
    role: zod_1.z.enum(['admin', 'manager', 'caller']),
});
const accountProfileSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(200),
    email: zod_1.z.string().email(),
    address: zod_1.z.string().trim().min(1).max(500),
    sex: zod_1.z.string().trim().min(1).max(50),
    birthday: zod_1.z.string().date(),
    phone: zod_1.z.string().trim().min(1).max(50),
    country: zod_1.z.string().trim().min(1).max(100),
    city: zod_1.z.string().trim().min(1).max(100),
    categoryId: zod_1.z.number().int().positive(),
});
const staffUpdateSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(1).max(100).optional(),
    name: zod_1.z.string().trim().min(1).max(200).optional(),
    temporaryPassword: zod_1.z.string().min(4).max(200).optional(),
});
const accountUpdateSchema = accountProfileSchema.partial().extend({
    name: zod_1.z.string().trim().min(1).max(200).optional(),
});
const staffColumns = `
  u_id, username, name, role, parent_user_id, (blocked_date IS NULL) AS is_active,
  blocked_date, must_change_password
`;
const accountColumns = `
  u_id, username, name, role, parent_user_id, email, address, sex,
  birthday, phone, country, city, category_id, blocked_date
`;
function canCreateRole(actorRole, targetRole) {
    if (actorRole === 'super')
        return targetRole === 'admin';
    if (actorRole === 'admin')
        return targetRole === 'manager' || targetRole === 'caller';
    return actorRole === 'manager' && targetRole === 'account';
}
function canManageRole(actorRole, targetRole) {
    if (actorRole === 'super')
        return targetRole === 'admin';
    if (actorRole === 'admin')
        return targetRole === 'manager' || targetRole === 'caller';
    return actorRole === 'manager' && targetRole === 'account';
}
async function getTarget(userId) {
    return (0, connection_1.queryOne)('SELECT u_id, role, parent_user_id FROM users WHERE u_id = $1', [userId]);
}
async function canManageTarget(actor, target, operation) {
    if (!actor)
        return false;
    if (operation === 'block' && actor.role === 'super' &&
        (target.role === 'admin' || target.role === 'manager'))
        return true;
    return canManageRole(actor.role, target.role) && target.parent_user_id === actor.id;
}
router.get('/', async (req, res) => {
    const actor = req.newSchemaUser;
    const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
    let query;
    let params;
    if (actor.role === 'super') {
        query = `SELECT ${staffColumns} FROM users WHERE role IN ('admin', 'manager')`;
        params = [];
    }
    else {
        query = `SELECT ${staffColumns} FROM users WHERE parent_user_id = $1`;
        params = [actor.id];
    }
    if (roleFilter) {
        query += ` AND role = $${params.length + 1}`;
        params.push(roleFilter);
    }
    query += ' ORDER BY name ASC, u_id ASC';
    const users = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, users });
});
router.get('/callers', async (req, res) => {
    const actor = req.newSchemaUser;
    if (actor.role !== 'manager' || !actor.parentUserId) {
        res.status(403).json({ success: false, message: 'Only Managers can list their assigned Callers.' });
        return;
    }
    const callers = await (0, connection_1.queryAll)(`SELECT u_id, username, name, role
     FROM users
     WHERE role = 'caller' AND parent_user_id = $1 AND blocked_date IS NULL
     ORDER BY name ASC`, [actor.parentUserId]);
    res.json({ success: true, callers });
});
router.get('/accounts', async (req, res) => {
    const actor = req.newSchemaUser;
    if (actor.role !== 'super' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Manager access required.' });
        return;
    }
    const query = actor.role === 'super'
        ? `SELECT ${accountColumns} FROM users WHERE role = 'account' ORDER BY name ASC`
        : actor.role === 'admin'
            ? `SELECT ${accountColumns} FROM users
         WHERE role = 'account' AND parent_user_id IN (
           SELECT u_id FROM users WHERE role = 'manager' AND parent_user_id = $1
         )
         ORDER BY name ASC`
            : `SELECT ${accountColumns} FROM users
         WHERE role = 'account' AND parent_user_id = $1
         ORDER BY name ASC`;
    const accounts = await (0, connection_1.queryAll)(query, actor.role === 'super' ? [] : [actor.id]);
    res.json({ success: true, accounts });
});
router.post('/', async (req, res) => {
    const actor = req.newSchemaUser;
    const role = req.body?.role;
    if (!role || !canCreateRole(actor.role, role)) {
        res.status(403).json({ success: false, message: 'You cannot create this account role.' });
        return;
    }
    if (role === 'account') {
        const parsed = accountProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, message: 'Complete all required Account profile fields.' });
            return;
        }
        const data = parsed.data;
        const category = await (0, connection_1.queryOne)('SELECT category_id FROM categories WHERE category_id = $1', [data.categoryId]);
        if (!category) {
            res.status(400).json({ success: false, message: 'Select an existing category.' });
            return;
        }
        const username = `account-${(0, node_crypto_1.randomUUID)()}`;
        const row = await (0, connection_1.queryOne)(`INSERT INTO users (
        username, name, role, password_hash, parent_user_id,
        email, address, sex, birthday, phone, country, city, category_id
      ) VALUES ($1, $2, 'account', NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING u_id`, [
            username, data.name, actor.id, data.email, data.address, data.sex,
            data.birthday, data.phone, data.country, data.city, data.categoryId,
        ]);
        const account = await (0, connection_1.queryOne)(`SELECT ${accountColumns} FROM users WHERE u_id = $1`, [row.u_id]);
        logger_1.logger.info('New-schema Account profile created', { id: row.u_id, managerId: actor.id });
        res.status(201).json({ success: true, account });
        return;
    }
    const parsed = staffCreateSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.role !== role) {
        res.status(400).json({ success: false, message: 'Enter a username and temporary password of at least 4 characters.' });
        return;
    }
    const data = parsed.data;
    const duplicate = await (0, connection_1.queryOne)('SELECT u_id FROM users WHERE username = $1', [data.username]);
    if (duplicate) {
        res.status(409).json({ success: false, message: 'That username is already in use.' });
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(data.password, 12);
    const row = await (0, connection_1.queryOne)(`INSERT INTO users (username, name, role, password_hash, must_change_password, parent_user_id)
     VALUES ($1, $2, $3, $4, FALSE, $5)
     RETURNING u_id`, [data.username, data.username, data.role, passwordHash, actor.id]);
    const user = await (0, connection_1.queryOne)(`SELECT ${staffColumns} FROM users WHERE u_id = $1`, [row.u_id]);
    logger_1.logger.info('New-schema user created', { id: row.u_id, role, parentUserId: actor.id });
    res.status(201).json({ success: true, user });
});
router.put('/:id', async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid user ID.' });
        return;
    }
    const target = await getTarget(userId);
    if (!target || !(await canManageTarget(req.newSchemaUser, target, 'crud'))) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    if (target.role === 'account') {
        const parsed = accountUpdateSchema.safeParse(req.body);
        if (!parsed.success || Object.keys(parsed.data).length === 0) {
            res.status(400).json({ success: false, message: 'Provide valid Account profile fields to update.' });
            return;
        }
        const data = parsed.data;
        const assignments = [];
        const values = [];
        const columns = {
            name: 'name',
            email: 'email',
            address: 'address',
            sex: 'sex',
            birthday: 'birthday',
            phone: 'phone',
            country: 'country',
            city: 'city',
            categoryId: 'category_id',
        };
        for (const [key, column] of Object.entries(columns)) {
            const value = data[key];
            if (value !== undefined) {
                assignments.push(`${column} = $${values.length + 1}`);
                values.push(value);
            }
        }
        if (data.categoryId !== undefined) {
            const category = await (0, connection_1.queryOne)('SELECT category_id FROM categories WHERE category_id = $1', [data.categoryId]);
            if (!category) {
                res.status(400).json({ success: false, message: 'Select an existing category.' });
                return;
            }
        }
        values.push(userId);
        await (0, connection_1.execute)(`UPDATE users SET ${assignments.join(', ')} WHERE u_id = $${values.length}`, values);
        const account = await (0, connection_1.queryOne)(`SELECT ${accountColumns} FROM users WHERE u_id = $1`, [userId]);
        res.json({ success: true, account });
        return;
    }
    const parsed = staffUpdateSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
        res.status(400).json({ success: false, message: 'Provide a valid username, name, or temporary password.' });
        return;
    }
    const data = parsed.data;
    if (data.username) {
        const duplicate = await (0, connection_1.queryOne)('SELECT u_id FROM users WHERE username = $1 AND u_id <> $2', [data.username, userId]);
        if (duplicate) {
            res.status(409).json({ success: false, message: 'That username is already in use.' });
            return;
        }
    }
    const assignments = [];
    const values = [];
    if (data.username !== undefined) {
        assignments.push(`username = $${values.length + 1}`);
        values.push(data.username);
    }
    if (data.name !== undefined) {
        assignments.push(`name = $${values.length + 1}`);
        values.push(data.name);
    }
    if (data.temporaryPassword) {
        assignments.push(`password_hash = $${values.length + 1}`);
        values.push(await bcryptjs_1.default.hash(data.temporaryPassword, 12));
        assignments.push('must_change_password = FALSE');
    }
    values.push(userId);
    await (0, connection_1.execute)(`UPDATE users SET ${assignments.join(', ')} WHERE u_id = $${values.length}`, values);
    const user = await (0, connection_1.queryOne)(`SELECT ${staffColumns} FROM users WHERE u_id = $1`, [userId]);
    res.json({ success: true, user });
});
router.patch('/:id/block', async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const parsed = zod_1.z.object({ blocked: zod_1.z.boolean() }).safeParse(req.body);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !parsed.success) {
        res.status(400).json({ success: false, message: 'Provide a valid user ID and blocked value.' });
        return;
    }
    const target = await getTarget(userId);
    if (!target || !(await canManageTarget(req.newSchemaUser, target, 'block'))) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    if (target.role !== 'admin' && target.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only Admin or Manager accounts can be blocked.' });
        return;
    }
    await (0, connection_1.execute)('UPDATE users SET blocked_date = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE u_id = $2', [parsed.data.blocked, userId]);
    res.json({ success: true, blocked: parsed.data.blocked });
});
router.delete('/:id', async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid user ID.' });
        return;
    }
    const target = await getTarget(userId);
    if (!target || !(await canManageTarget(req.newSchemaUser, target, 'crud'))) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
    }
    const children = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM users WHERE parent_user_id = $1', [userId]);
    if (Number(children?.count ?? 0) > 0) {
        res.status(409).json({ success: false, message: 'Reassign or delete this user’s child profiles before deleting the user.' });
        return;
    }
    if (target.role === 'account') {
        const bids = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM bids WHERE u_id = $1', [userId]);
        if (Number(bids?.count ?? 0) > 0) {
            res.status(409).json({ success: false, message: 'This Account has bid history and cannot be deleted.' });
            return;
        }
        await (0, connection_1.execute)('UPDATE job_list SET selected_account_u_ids = array_remove(selected_account_u_ids, $1)', [userId]);
    }
    else if (target.role === 'manager') {
        const jobs = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM job_list WHERE u_id = $1', [userId]);
        if (Number(jobs?.count ?? 0) > 0) {
            res.status(409).json({ success: false, message: 'This Manager owns jobs and cannot be deleted.' });
            return;
        }
    }
    else if (target.role === 'caller') {
        const interviews = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM interviews WHERE caller_user_id = $1', [userId]);
        if (Number(interviews?.count ?? 0) > 0) {
            res.status(409).json({ success: false, message: 'This Caller has assigned interviews and cannot be deleted.' });
            return;
        }
    }
    await (0, connection_1.execute)('DELETE FROM users WHERE u_id = $1', [userId]);
    logger_1.logger.info('New-schema user deleted', { id: userId, role: target.role });
    res.json({ success: true, message: 'User deleted.' });
});
exports.default = router;
//# sourceMappingURL=users.routes.js.map