"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
function requireSuper(req, res) {
    if (req.newSchemaUser?.role === 'super')
        return true;
    res.status(403).json({ success: false, message: 'Only Super can manage application settings.' });
    return false;
}
router.get('/', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const rows = await (0, connection_1.queryAll)('SELECT setting_name, setting_value FROM app_settings ORDER BY setting_name ASC');
    res.json({
        success: true,
        settings: Object.fromEntries(rows.map((row) => [row.setting_name, row.setting_value])),
    });
});
router.put('/', async (req, res) => {
    if (!requireSuper(req, res))
        return;
    const parsed = zod_1.z.object({
        settings: zod_1.z.record(zod_1.z.string().min(1), zod_1.z.string().max(10000)),
    }).safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data.settings).length === 0) {
        res.status(400).json({ success: false, message: 'Provide one or more valid settings.' });
        return;
    }
    for (const [name, value] of Object.entries(parsed.data.settings)) {
        await (0, connection_1.execute)(`INSERT INTO app_settings (setting_name, setting_value, updated_by, updated_date)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (setting_name) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by = EXCLUDED.updated_by,
           updated_date = NOW()`, [name.trim(), value, req.userId]);
    }
    res.json({ success: true, message: 'Settings saved.' });
});
exports.default = router;
//# sourceMappingURL=settings.routes.js.map