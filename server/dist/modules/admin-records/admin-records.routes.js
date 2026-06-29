"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const logger_1 = require("../../utilities/logger");
const admin_records_registry_1 = require("./admin-records.registry");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireAdmin);
const ListQuerySchema = zod_1.z.object({
    q: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: zod_1.z.coerce.number().int().min(0).optional().default(0),
});
const UpdateBodySchema = zod_1.z.record(zod_1.z.unknown());
function sanitizeRow(category, row) {
    const sanitized = { ...row };
    delete sanitized.password_hash;
    delete sanitized.password_encrypted;
    return sanitized;
}
function listColumnKeys(category) {
    return category.columns.filter((column) => column.list).map((column) => column.key);
}
function editableColumnKeys(category) {
    return category.columns.filter((column) => column.editable).map((column) => column.key);
}
function serializeValue(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'object')
        return JSON.stringify(value, null, 2);
    return value;
}
function parseIncomingValue(category, key, value) {
    const column = category.columns.find((item) => item.key === key);
    if (!column)
        return value;
    if (column.type === 'boolean') {
        if (value === 'true' || value === true)
            return true;
        if (value === 'false' || value === false)
            return false;
        return Boolean(value);
    }
    if (column.type === 'number') {
        if (value === '' || value === null || value === undefined)
            return null;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid number for ${key}.`);
        }
        return parsed;
    }
    if (column.type === 'json') {
        if (value === '' || value === null || value === undefined)
            return null;
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            }
            catch {
                throw new Error(`Invalid JSON for ${key}.`);
            }
        }
        return value;
    }
    if (value === null || value === undefined)
        return null;
    return String(value);
}
router.get('/categories', async (_req, res) => {
    const countSql = admin_records_registry_1.RECORD_CATEGORIES.map((category) => `SELECT '${category.id}' AS id, COUNT(*)::int AS count FROM ${category.table}`).join(' UNION ALL ');
    const countRows = await (0, connection_1.queryAll)(countSql);
    const countMap = new Map(countRows.map((row) => [row.id, row.count]));
    const categories = admin_records_registry_1.RECORD_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        description: category.description,
        count: countMap.get(category.id) ?? 0,
        columns: category.columns,
    }));
    res.json({ success: true, categories });
});
router.get('/:category', async (req, res) => {
    const category = (0, admin_records_registry_1.getRecordCategory)(req.params.category);
    if (!category) {
        res.status(404).json({ success: false, message: 'Unknown record category.' });
        return;
    }
    const query = ListQuerySchema.parse(req.query);
    const params = [];
    let whereSql = '';
    if (query.q?.trim()) {
        const clauses = category.searchColumns.map((column) => {
            params.push(`%${query.q.trim()}%`);
            return `CAST(${column} AS TEXT) ILIKE $${params.length}`;
        });
        whereSql = `WHERE ${clauses.join(' OR ')}`;
    }
    const listColumns = listColumnKeys(category);
    const selectColumns = listColumns.length ? listColumns.join(', ') : '*';
    const listParams = [...params, query.limit, query.offset];
    const rows = await (0, connection_1.queryAll)(`SELECT ${selectColumns}, COUNT(*) OVER()::int AS total_count
     FROM ${category.table}
     ${whereSql}
     ORDER BY ${category.orderBy}
     LIMIT $${listParams.length - 1}
     OFFSET $${listParams.length}`, listParams);
    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
    const records = rows.map((row) => {
        const { total_count: _totalCount, ...record } = row;
        return sanitizeRow(category, record);
    });
    res.json({
        success: true,
        category: {
            id: category.id,
            label: category.label,
            description: category.description,
            primaryKey: category.primaryKey,
            columns: category.columns,
        },
        records,
        total,
        limit: query.limit,
        offset: query.offset,
    });
});
router.get('/:category/:id', async (req, res) => {
    const category = (0, admin_records_registry_1.getRecordCategory)(req.params.category);
    if (!category) {
        res.status(404).json({ success: false, message: 'Unknown record category.' });
        return;
    }
    const row = await (0, connection_1.queryOne)(`SELECT * FROM ${category.table} WHERE ${category.primaryKey} = $1`, [req.params.id]);
    if (!row) {
        res.status(404).json({ success: false, message: 'Record not found.' });
        return;
    }
    const record = sanitizeRow(category, row);
    for (const column of category.columns) {
        if (column.type === 'json' && record[column.key] != null) {
            record[column.key] = serializeValue(record[column.key]);
        }
    }
    res.json({ success: true, record });
});
router.put('/:category/:id', async (req, res) => {
    const category = (0, admin_records_registry_1.getRecordCategory)(req.params.category);
    if (!category) {
        res.status(404).json({ success: false, message: 'Unknown record category.' });
        return;
    }
    const body = UpdateBodySchema.parse(req.body ?? {});
    const editableKeys = editableColumnKeys(category);
    const updates = [];
    const params = [];
    for (const key of editableKeys) {
        if (!(key in body))
            continue;
        if (category.primaryKey === key)
            continue;
        try {
            params.push(parseIncomingValue(category, key, body[key]));
            updates.push(`${key} = $${params.length}`);
        }
        catch (error) {
            res.status(400).json({
                success: false,
                message: error instanceof Error ? error.message : 'Invalid field value.',
            });
            return;
        }
    }
    if (!updates.length) {
        res.status(400).json({ success: false, message: 'No editable fields provided.' });
        return;
    }
    if (category.table === 'admins' && req.params.id === String(req.userId)) {
        if ('is_active' in body && body.is_active === false) {
            res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
            return;
        }
        if ('role' in body && body.role !== 'admin') {
            res.status(400).json({ success: false, message: 'You cannot change your own role.' });
            return;
        }
    }
    params.push(req.params.id);
    const updated = await (0, connection_1.queryOne)(`UPDATE ${category.table}
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE ${category.primaryKey} = $${params.length}
     RETURNING *`, params);
    if (!updated) {
        res.status(404).json({ success: false, message: 'Record not found.' });
        return;
    }
    logger_1.logger.info('Admin record updated', {
        category: category.id,
        id: req.params.id,
        adminId: req.userId,
    });
    res.json({ success: true, record: sanitizeRow(category, updated) });
});
router.delete('/:category/:id', async (req, res) => {
    const category = (0, admin_records_registry_1.getRecordCategory)(req.params.category);
    if (!category) {
        res.status(404).json({ success: false, message: 'Unknown record category.' });
        return;
    }
    if (category.table === 'admins' && req.params.id === String(req.userId)) {
        res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        return;
    }
    const deleted = await (0, connection_1.queryOne)(`DELETE FROM ${category.table} WHERE ${category.primaryKey} = $1 RETURNING ${category.primaryKey}`, [req.params.id]);
    if (!deleted) {
        res.status(404).json({ success: false, message: 'Record not found.' });
        return;
    }
    logger_1.logger.info('Admin record deleted', {
        category: category.id,
        id: req.params.id,
        adminId: req.userId,
    });
    res.json({ success: true, message: 'Record deleted.' });
});
router.get('/', (_req, res) => {
    res.json({
        success: true,
        categories: (0, admin_records_registry_1.listRecordCategoryIds)(),
    });
});
exports.default = router;
//# sourceMappingURL=admin-records.routes.js.map