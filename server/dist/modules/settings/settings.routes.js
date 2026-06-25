"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const connection_2 = require("../../database/connection");
const logger_1 = require("../../utilities/logger");
const candidate_stacks_1 = require("../../config/candidate-stacks");
const ADMIN_UI_MODES = new Set(['mode1', 'mode2', 'mode3']);
function sanitizeSettings(settings) {
    const next = { ...settings };
    if (next.admin_ui_mode && !ADMIN_UI_MODES.has(next.admin_ui_mode)) {
        delete next.admin_ui_mode;
    }
    return next;
}
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/', async (_req, res) => {
    const rows = await (0, connection_1.queryAll)('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows)
        settings[row.key] = row.value;
    res.json({ success: true, settings });
});
router.get('/candidate-stacks', async (_req, res) => {
    const stacks = await (0, candidate_stacks_1.getCandidateStacks)();
    res.json({ success: true, stacks });
});
router.put('/candidate-stacks', auth_1.requireAdmin, async (req, res) => {
    const parsed = zod_1.z.object({ stacks: zod_1.z.array(zod_1.z.string()) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Stacks must be a list of names.' });
        return;
    }
    const sanitized = (0, candidate_stacks_1.sanitizeCandidateStacksInput)(parsed.data.stacks);
    if (!sanitized.length) {
        res.status(400).json({ success: false, message: 'At least one stack option is required.' });
        return;
    }
    try {
        const saved = await (0, candidate_stacks_1.saveCandidateStacks)(sanitized);
        res.json({ success: true, stacks: saved, message: 'Candidate stacks saved.' });
    }
    catch (err) {
        logger_1.logger.error('Failed to save candidate stacks', err);
        res.status(500).json({ success: false, message: 'Could not save candidate stacks.' });
    }
});
router.put('/', auth_1.requireAdmin, async (req, res) => {
    const parsed = zod_1.z.object({ settings: zod_1.z.record(zod_1.z.string()) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid settings payload.' });
        return;
    }
    const sanitized = sanitizeSettings(parsed.data.settings);
    if (sanitized[candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY] !== undefined) {
        const stacks = (0, candidate_stacks_1.sanitizeCandidateStacksInput)((0, candidate_stacks_1.parseCandidateStacks)(sanitized[candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY]));
        if (!stacks.length) {
            res.status(400).json({ success: false, message: 'At least one stack option is required.' });
            return;
        }
        try {
            await (0, candidate_stacks_1.saveCandidateStacks)(stacks);
        }
        catch (err) {
            logger_1.logger.error('Failed to save candidate stacks via settings', err);
            res.status(500).json({ success: false, message: 'Could not save candidate stacks.' });
            return;
        }
        sanitized[candidate_stacks_1.CANDIDATE_STACKS_SETTING_KEY] = (0, candidate_stacks_1.serializeCandidateStacks)(stacks);
    }
    await (0, connection_1.withTransaction)(async (client) => {
        for (const [key, value] of Object.entries(sanitized)) {
            await client.query(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, value]);
        }
    });
    res.json({ success: true, message: 'Settings saved.' });
});
router.post('/backup', auth_1.requireAdmin, async (_req, res) => {
    try {
        const dest = await (0, connection_2.backupDb)();
        logger_1.logger.info('Database backup created', { dest });
        res.json({ success: true, message: 'Backup created.', path: dest });
    }
    catch (err) {
        logger_1.logger.error('Backup failed', err);
        res.status(500).json({ success: false, message: 'Backup failed.' });
    }
});
exports.default = router;
//# sourceMappingURL=settings.routes.js.map