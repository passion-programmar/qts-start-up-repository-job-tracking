"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const CategorySchema = zod_1.z.object({
    categoryTitle: zod_1.z.string().trim().min(1).max(200),
});
router.get('/', async (_req, res) => {
    const categories = await (0, connection_1.queryAll)('SELECT category_id, category_title, created_date FROM categories ORDER BY category_title ASC');
    res.json({ success: true, categories });
});
router.post('/', async (req, res) => {
    if (req.newSchemaUser?.role !== 'super') {
        res.status(403).json({ success: false, message: 'Only Super can create categories.' });
        return;
    }
    const parsed = CategorySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter a category name.' });
        return;
    }
    const duplicate = await (0, connection_1.queryOne)('SELECT category_id FROM categories WHERE LOWER(category_title) = LOWER($1)', [parsed.data.categoryTitle]);
    if (duplicate) {
        res.status(409).json({ success: false, message: 'That category already exists.' });
        return;
    }
    const category = await (0, connection_1.queryOne)(`INSERT INTO categories (category_title) VALUES ($1)
     RETURNING category_id, category_title, created_date`, [parsed.data.categoryTitle]);
    res.status(201).json({ success: true, category });
});
router.put('/:id', async (req, res) => {
    if (req.newSchemaUser?.role !== 'super') {
        res.status(403).json({ success: false, message: 'Only Super can update categories.' });
        return;
    }
    const id = Number.parseInt(req.params.id, 10);
    const parsed = CategorySchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
        res.status(400).json({ success: false, message: 'Enter a valid category ID and name.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT category_id FROM categories WHERE category_id = $1', [id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Category not found.' });
        return;
    }
    const duplicate = await (0, connection_1.queryOne)('SELECT category_id FROM categories WHERE LOWER(category_title) = LOWER($1) AND category_id <> $2', [parsed.data.categoryTitle, id]);
    if (duplicate) {
        res.status(409).json({ success: false, message: 'That category already exists.' });
        return;
    }
    const category = await (0, connection_1.queryOne)(`UPDATE categories SET category_title = $1 WHERE category_id = $2
     RETURNING category_id, category_title, created_date`, [parsed.data.categoryTitle, id]);
    res.json({ success: true, category });
});
router.delete('/:id', async (req, res) => {
    if (req.newSchemaUser?.role !== 'super') {
        res.status(403).json({ success: false, message: 'Only Super can delete categories.' });
        return;
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: 'Invalid category ID.' });
        return;
    }
    const users = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM users WHERE category_id = $1', [id]);
    if (Number(users?.count ?? 0) > 0) {
        res.status(409).json({ success: false, message: 'This category is assigned to Account profiles and cannot be deleted.' });
        return;
    }
    await (0, connection_1.execute)('UPDATE job_list SET category_ids = array_remove(category_ids, $1)', [id]);
    const result = await (0, connection_1.execute)('DELETE FROM categories WHERE category_id = $1', [id]);
    if (!result.rowCount) {
        res.status(404).json({ success: false, message: 'Category not found.' });
        return;
    }
    res.json({ success: true, message: 'Category deleted.' });
});
exports.default = router;
//# sourceMappingURL=categories.routes.js.map