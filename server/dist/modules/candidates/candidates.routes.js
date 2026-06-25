"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const candidate_colors_1 = require("../../config/candidate-colors");
const candidate_stacks_1 = require("../../config/candidate-stacks");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const optionalEmail = zod_1.z.union([zod_1.z.literal(''), zod_1.z.string().email()]).optional();
const CandidateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    email: optionalEmail,
    phone: zod_1.z.string().max(50).optional(),
    linkedinUrl: zod_1.z.union([zod_1.z.literal(''), zod_1.z.string().url()]).optional(),
    notes: zod_1.z.string().optional(),
    color: zod_1.z.string().optional().or(zod_1.z.literal('')).refine((value) => !value || (0, candidate_colors_1.isCandidateColor)(value), { message: 'Color must be one of the allowed palette values' }),
    stack: zod_1.z.union([zod_1.z.literal(''), zod_1.z.string().max(100)]).optional(),
    isActive: zod_1.z.boolean().optional().default(true),
    bidderId: zod_1.z.number().int().positive().optional().nullable(),
});
async function pickDefaultColor() {
    const row = await (0, connection_1.queryOne)('SELECT COUNT(*)::int AS count FROM candidates');
    return (0, candidate_colors_1.nextCandidateColor)(Number(row?.count ?? 0));
}
function parseCandidateBody(body, res) {
    const parsed = CandidateSchema.safeParse(body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            message: 'Validation error.',
            errors: parsed.error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            })),
        });
        return null;
    }
    return parsed.data;
}
async function resolveCandidateStack(stack, res) {
    if (!stack?.trim())
        return null;
    const canonical = await (0, candidate_stacks_1.resolveCanonicalStack)(stack);
    if (!canonical) {
        res.status(400).json({
            success: false,
            message: 'Invalid stack option. Add it under Settings → Candidate Stacks and save first.',
        });
        return undefined;
    }
    return canonical;
}
async function canAccessCandidate(req, id) {
    if ((0, scope_1.isAdmin)(req))
        return true;
    if ((0, scope_1.isManager)(req) && req.userId) {
        const row = await (0, connection_1.queryOne)(`SELECT c.id FROM candidates c
       JOIN bidders b ON b.id = c.bidder_id
       WHERE c.id = $1 AND b.manager_id = $2`, [id, req.userId]);
        return Boolean(row);
    }
    if (!(0, scope_1.isBidder)(req) || !req.bidderId)
        return false;
    const row = await (0, connection_1.queryOne)('SELECT id FROM candidates WHERE id = $1 AND bidder_id = $2', [id, req.bidderId]);
    return Boolean(row);
}
router.get('/', async (req, res) => {
    const search = req.query.search || '';
    const activeOnly = req.query.active === 'true';
    let query = 'SELECT c.*, b.name AS bidder_name FROM candidates c LEFT JOIN bidders b ON b.id = c.bidder_id';
    const params = [];
    const conditions = [];
    let paramIndex = 1;
    const scope = (0, scope_1.candidateBidderFilter)(req, 'c', paramIndex);
    if (scope.clause) {
        conditions.push(scope.clause);
        params.push(...scope.params);
        paramIndex = scope.nextIndex;
    }
    if (search) {
        const placeholder = `$${paramIndex++}`;
        conditions.push(`(c.name ILIKE ${placeholder} OR c.email ILIKE ${placeholder} OR c.notes ILIKE ${placeholder})`);
        params.push(`%${search}%`);
    }
    if (activeOnly) {
        conditions.push('c.is_active = TRUE');
    }
    if (conditions.length)
        query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY c.name ASC';
    const candidates = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, candidates });
});
router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessCandidate(req, id))) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const candidate = await (0, connection_1.queryOne)(`SELECT c.*, b.name AS bidder_name FROM candidates c
     LEFT JOIN bidders b ON b.id = c.bidder_id WHERE c.id = $1`, [id]);
    res.json({ success: true, candidate });
});
async function canManageBidder(req, bidderId) {
    if (!bidderId)
        return (0, scope_1.isAdmin)(req);
    if ((0, scope_1.isAdmin)(req))
        return true;
    if ((0, scope_1.isManager)(req) && req.userId) {
        const row = await (0, connection_1.queryOne)('SELECT id FROM bidders WHERE id = $1 AND manager_id = $2', [bidderId, req.userId]);
        return Boolean(row);
    }
    return false;
}
router.post('/', auth_1.requireAdminOrManagerWrite, async (req, res) => {
    const data = parseCandidateBody(req.body, res);
    if (!data)
        return;
    const stack = await resolveCandidateStack(data.stack, res);
    if (stack === undefined)
        return;
    const color = data.color || await pickDefaultColor();
    let bidderId;
    if ((0, scope_1.isAdmin)(req)) {
        bidderId = data.bidderId ?? null;
        if (!bidderId) {
            res.status(400).json({ success: false, message: 'Select a bidder organization for this candidate.' });
            return;
        }
    }
    else if ((0, scope_1.isManager)(req)) {
        bidderId = data.bidderId ?? null;
        if (!bidderId || !(await canManageBidder(req, bidderId))) {
            res.status(400).json({ success: false, message: 'Select a bidder from your team.' });
            return;
        }
    }
    else {
        bidderId = req.bidderId ?? null;
        if (!bidderId) {
            res.status(400).json({ success: false, message: 'Bidder account is not linked to an organization.' });
            return;
        }
    }
    const inserted = await (0, connection_1.queryOne)(`INSERT INTO candidates (name, email, phone, linkedin_url, notes, color, stack, is_active, bidder_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`, [
        data.name,
        data.email || null,
        data.phone || null,
        data.linkedinUrl || null,
        data.notes || null,
        color,
        stack,
        data.isActive ?? true,
        bidderId,
    ]);
    const candidate = await (0, connection_1.queryOne)('SELECT * FROM candidates WHERE id = $1', [inserted.id]);
    logger_1.logger.info('Candidate created', { name: data.name, bidderId });
    res.status(201).json({ success: true, candidate });
});
router.put('/:id', auth_1.requireAdminOrManagerWrite, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessCandidate(req, id))) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const data = parseCandidateBody(req.body, res);
    if (!data)
        return;
    const stack = await resolveCandidateStack(data.stack, res);
    if (stack === undefined)
        return;
    const color = data.color || existing.color || await pickDefaultColor();
    let bidderId = existing.bidder_id ?? null;
    if ((0, scope_1.isAdmin)(req)) {
        bidderId = data.bidderId ?? bidderId;
        if (!bidderId) {
            res.status(400).json({ success: false, message: 'Select a bidder organization for this candidate.' });
            return;
        }
    }
    else if ((0, scope_1.isManager)(req)) {
        bidderId = data.bidderId ?? bidderId;
        if (!bidderId || !(await canManageBidder(req, bidderId))) {
            res.status(400).json({ success: false, message: 'Select a bidder from your team.' });
            return;
        }
    }
    await (0, connection_1.execute)(`UPDATE candidates
     SET name = $1, email = $2, phone = $3, linkedin_url = $4, notes = $5, color = $6, stack = $7,
         is_active = $8, bidder_id = $9, updated_at = NOW()
     WHERE id = $10`, [
        data.name,
        data.email || null,
        data.phone || null,
        data.linkedinUrl || null,
        data.notes || null,
        color,
        stack,
        data.isActive ?? true,
        bidderId,
        req.params.id,
    ]);
    const candidate = await (0, connection_1.queryOne)('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    logger_1.logger.info('Candidate updated', { id: req.params.id });
    res.json({ success: true, candidate });
});
router.patch('/:id/status', auth_1.requireAdminOrManagerWrite, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessCandidate(req, id))) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const { isActive } = zod_1.z.object({ isActive: zod_1.z.boolean() }).parse(req.body);
    await (0, connection_1.execute)('UPDATE candidates SET is_active = $1, updated_at = NOW() WHERE id = $2', [isActive, req.params.id]);
    res.json({ success: true, message: `Candidate ${isActive ? 'activated' : 'deactivated'}.` });
});
router.delete('/:id', auth_1.requireAdminOrManagerWrite, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessCandidate(req, id))) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const existing = await (0, connection_1.queryOne)('SELECT name FROM candidates WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM candidates WHERE id = $1', [req.params.id]);
    logger_1.logger.info('Candidate deleted', { id: req.params.id, name: existing.name });
    res.json({ success: true, message: 'Candidate deleted.' });
});
router.get('/:id/jobs', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessCandidate(req, id))) {
        res.status(404).json({ success: false, message: 'Candidate not found.' });
        return;
    }
    const rows = await (0, connection_1.queryAll)(`SELECT j.*, cj.status, cj.applied_at
     FROM candidate_jobs cj
     JOIN jobs j ON j.id = cj.job_id
     WHERE cj.candidate_id = $1
     ORDER BY cj.updated_at DESC`, [id]);
    res.json({ success: true, jobs: rows });
});
exports.default = router;
//# sourceMappingURL=candidates.routes.js.map