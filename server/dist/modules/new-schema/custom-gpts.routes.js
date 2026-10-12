"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const custom_gpt_url_1 = require("../../utilities/custom-gpt-url");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const CustomGptSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(200),
    url: zod_1.z.string().trim().min(1).max(500),
});
function requireSuper(req, res) {
    if (req.newSchemaUser?.role === 'super')
        return true;
    res.status(403).json({ success: false, message: 'Only Super can manage Custom GPT assignments.' });
    return false;
}
router.get('/', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const customGpts = await (0, connection_1.queryAll)(`SELECT custom_gpt_id AS id, name, url, gpt_id, created_date, updated_date
     FROM custom_gpts
     ORDER BY name ASC, custom_gpt_id ASC`);
    const assignments = await (0, connection_1.queryAll)(`SELECT assignment.manager_user_id AS "managerId",
            manager.name AS "managerName",
            assignment.custom_gpt_id AS "customGptId"
     FROM manager_custom_gpt_assignments assignment
     JOIN users manager ON manager.u_id = assignment.manager_user_id
     WHERE manager.role = 'manager'
     ORDER BY manager.name ASC, manager.u_id ASC`);
    res.json({ success: true, customGpts, assignments });
});
router.post('/', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const parsed = CustomGptSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter a name and a valid Custom GPT URL.' });
        return;
    }
    const validated = (0, custom_gpt_url_1.validateCustomGptUrl)(parsed.data.url);
    if (!validated.ok) {
        res.status(400).json({ success: false, message: validated.message });
        return;
    }
    const duplicate = await (0, connection_1.queryOne)('SELECT custom_gpt_id FROM custom_gpts WHERE gpt_id = $1', [validated.id]);
    if (duplicate) {
        res.status(409).json({ success: false, message: 'That Custom GPT is already in the library.' });
        return;
    }
    const customGpt = await (0, connection_1.queryOne)(`INSERT INTO custom_gpts (name, url, gpt_id, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING custom_gpt_id AS id, name, url, gpt_id, created_date, updated_date`, [parsed.data.name, validated.url, validated.id, req.newSchemaUser.id]);
    res.status(201).json({ success: true, customGpt });
});
router.put('/:id/assignments', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const customGptId = Number.parseInt(req.params.id, 10);
    const parsed = zod_1.z.object({
        managerIds: zod_1.z.array(zod_1.z.number().int().positive()).max(500),
    }).safeParse(req.body);
    if (!Number.isSafeInteger(customGptId) || customGptId <= 0 || !parsed.success) {
        res.status(400).json({ success: false, message: 'Provide a valid Custom GPT ID and Manager list.' });
        return;
    }
    const managerIds = [...new Set(parsed.data.managerIds)];
    const customGpt = await (0, connection_1.queryOne)('SELECT custom_gpt_id FROM custom_gpts WHERE custom_gpt_id = $1', [customGptId]);
    if (!customGpt) {
        res.status(404).json({ success: false, message: 'Custom GPT not found.' });
        return;
    }
    if (managerIds.length) {
        const managers = await (0, connection_1.queryAll)(`SELECT u_id FROM users WHERE role = 'manager' AND u_id = ANY($1::int[])`, [managerIds]);
        if (managers.length !== managerIds.length) {
            res.status(400).json({ success: false, message: 'One or more selected users are not Managers.' });
            return;
        }
    }
    await (0, connection_1.withTransaction)(async (tx) => {
        if (managerIds.length) {
            await tx.query(`DELETE FROM manager_custom_gpt_assignments
         WHERE custom_gpt_id = $1 AND NOT (manager_user_id = ANY($2::int[]))`, [customGptId, managerIds]);
        }
        else {
            await tx.query('DELETE FROM manager_custom_gpt_assignments WHERE custom_gpt_id = $1', [customGptId]);
        }
        for (const managerId of managerIds) {
            await tx.query(`INSERT INTO manager_custom_gpt_assignments
           (manager_user_id, custom_gpt_id, assigned_by, assigned_date)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (manager_user_id) DO UPDATE SET
           custom_gpt_id = EXCLUDED.custom_gpt_id,
           assigned_by = EXCLUDED.assigned_by,
           assigned_date = NOW()`, [managerId, customGptId, req.newSchemaUser.id]);
        }
    });
    res.json({ success: true, message: 'Manager assignments saved.' });
});
router.delete('/:id', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const customGptId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(customGptId) || customGptId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid Custom GPT ID.' });
        return;
    }
    const customGpt = await (0, connection_1.queryOne)('SELECT custom_gpt_id FROM custom_gpts WHERE custom_gpt_id = $1', [customGptId]);
    if (!customGpt) {
        res.status(404).json({ success: false, message: 'Custom GPT not found.' });
        return;
    }
    const assigned = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM manager_custom_gpt_assignments WHERE custom_gpt_id = $1', [customGptId]);
    if (Number(assigned?.count || 0) > 0) {
        res.status(409).json({ success: false, message: 'Unassign this Custom GPT from all Managers before deleting it.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM custom_gpts WHERE custom_gpt_id = $1', [customGptId]);
    res.json({ success: true, message: 'Custom GPT removed.' });
});
exports.default = router;
//# sourceMappingURL=custom-gpts.routes.js.map