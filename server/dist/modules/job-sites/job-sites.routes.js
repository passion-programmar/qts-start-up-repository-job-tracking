"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const JobSiteSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    platformKey: zod_1.z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Use letters, numbers, hyphen, underscore'),
    urlHost: zod_1.z.string().max(200).optional().nullable(),
    notes: zod_1.z.string().max(2000).optional().nullable(),
    isActive: zod_1.z.boolean().optional().default(true),
});
const AdmitSchema = zod_1.z.object({
    bidderId: zod_1.z.number().int().positive(),
    defaultCandidateId: zod_1.z.number().int().positive(),
});
function mapJobSite(row) {
    return {
        id: row.id,
        name: row.name,
        platform_key: row.platform_key,
        url_host: row.url_host,
        notes: row.notes,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        admission_count: row.admission_count != null ? Number(row.admission_count) : undefined,
        job_count: row.job_count != null ? Number(row.job_count) : undefined,
    };
}
async function validateBidderCandidate(bidderId, candidateId) {
    const row = await (0, connection_1.queryOne)(`SELECT id FROM candidates
     WHERE id = $1 AND bidder_id = $2 AND is_active = TRUE`, [candidateId, bidderId]);
    return Boolean(row);
}
router.get('/my-admissions', async (req, res) => {
    if (!(0, scope_1.isBidder)(req) || !req.bidderId) {
        res.status(403).json({ success: false, message: 'Bidder access required.' });
        return;
    }
    const rows = await (0, connection_1.queryAll)(`SELECT js.id, js.name, js.platform_key, js.url_host, js.notes, js.is_active,
            bjs.default_candidate_id, c.name AS default_candidate_name,
            bjs.admitted_at, bjs.is_active AS admission_active
     FROM bidder_job_sites bjs
     JOIN job_sites js ON js.id = bjs.job_site_id
     LEFT JOIN candidates c ON c.id = bjs.default_candidate_id
     WHERE bjs.bidder_id = $1 AND bjs.is_active = TRUE AND js.is_active = TRUE
     ORDER BY js.name ASC`, [req.bidderId]);
    res.json({ success: true, admissions: rows });
});
router.get('/', async (req, res) => {
    if ((0, scope_1.isBidder)(req) && req.bidderId) {
        const rows = await (0, connection_1.queryAll)(`SELECT js.*, bjs.default_candidate_id, c.name AS default_candidate_name
       FROM bidder_job_sites bjs
       JOIN job_sites js ON js.id = bjs.job_site_id
       LEFT JOIN candidates c ON c.id = bjs.default_candidate_id
       WHERE bjs.bidder_id = $1 AND bjs.is_active = TRUE
       ORDER BY js.name ASC`, [req.bidderId]);
        res.json({ success: true, jobSites: rows.map(mapJobSite) });
        return;
    }
    if (!(0, scope_1.isAdmin)(req)) {
        res.status(403).json({ success: false, message: 'Admin access required.' });
        return;
    }
    const rows = await (0, connection_1.queryAll)(`SELECT js.*,
            (SELECT COUNT(*)::int FROM bidder_job_sites bjs WHERE bjs.job_site_id = js.id AND bjs.is_active) AS admission_count,
            (SELECT COUNT(*)::int FROM jobs j
             WHERE LOWER(COALESCE(j.source, '')) = LOWER(js.platform_key)
                OR (js.url_host IS NOT NULL AND js.url_host <> '' AND j.url ILIKE '%' || js.url_host || '%')
            ) AS job_count
     FROM job_sites js
     ORDER BY js.name ASC`);
    res.json({ success: true, jobSites: rows.map(mapJobSite) });
});
router.post('/', auth_1.requireAdminWrite, async (req, res) => {
    const parsed = JobSiteSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid input.' });
        return;
    }
    const { name, platformKey, urlHost, notes, isActive } = parsed.data;
    const existing = await (0, connection_1.queryOne)('SELECT id FROM job_sites WHERE LOWER(platform_key) = LOWER($1)', [platformKey]);
    if (existing) {
        res.status(409).json({ success: false, message: 'A job site with this platform key already exists.' });
        return;
    }
    const row = await (0, connection_1.queryOne)(`INSERT INTO job_sites (name, platform_key, url_host, notes, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [name.trim(), platformKey.trim().toLowerCase(), urlHost?.trim() || null, notes?.trim() || null, isActive !== false]);
    logger_1.logger.info('Job site created', { id: row.id, platformKey });
    res.status(201).json({ success: true, jobSite: mapJobSite(row) });
});
router.put('/:id', auth_1.requireAdminWrite, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ success: false, message: 'Invalid job site id.' });
        return;
    }
    const parsed = JobSiteSchema.partial().safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid input.' });
        return;
    }
    const current = await (0, connection_1.queryOne)('SELECT * FROM job_sites WHERE id = $1', [id]);
    if (!current) {
        res.status(404).json({ success: false, message: 'Job site not found.' });
        return;
    }
    const data = parsed.data;
    if (data.platformKey) {
        const dup = await (0, connection_1.queryOne)('SELECT id FROM job_sites WHERE LOWER(platform_key) = LOWER($1) AND id <> $2', [data.platformKey, id]);
        if (dup) {
            res.status(409).json({ success: false, message: 'Platform key already in use.' });
            return;
        }
    }
    const row = await (0, connection_1.queryOne)(`UPDATE job_sites SET
       name = COALESCE($2, name),
       platform_key = COALESCE($3, platform_key),
       url_host = COALESCE($4, url_host),
       notes = COALESCE($5, notes),
       is_active = COALESCE($6, is_active),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`, [
        id,
        data.name?.trim() || null,
        data.platformKey?.trim().toLowerCase() || null,
        data.urlHost !== undefined ? (data.urlHost?.trim() || null) : null,
        data.notes !== undefined ? (data.notes?.trim() || null) : null,
        data.isActive,
    ]);
    res.json({ success: true, jobSite: mapJobSite(row) });
});
router.delete('/:id', auth_1.requireAdminWrite, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ success: false, message: 'Invalid job site id.' });
        return;
    }
    const { rowCount } = await (0, connection_1.execute)('DELETE FROM job_sites WHERE id = $1', [id]);
    if (!rowCount) {
        res.status(404).json({ success: false, message: 'Job site not found.' });
        return;
    }
    res.json({ success: true });
});
router.get('/:id/admissions', auth_1.requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const rows = await (0, connection_1.queryAll)(`SELECT bjs.id, bjs.bidder_id, b.name AS bidder_name,
            bjs.default_candidate_id, c.name AS default_candidate_name,
            bjs.admitted_at, bjs.is_active,
            a.username AS admitted_by_username
     FROM bidder_job_sites bjs
     JOIN bidders b ON b.id = bjs.bidder_id
     LEFT JOIN candidates c ON c.id = bjs.default_candidate_id
     LEFT JOIN admins a ON a.id = bjs.admitted_by
     WHERE bjs.job_site_id = $1
     ORDER BY b.name ASC`, [id]);
    res.json({ success: true, admissions: rows });
});
router.post('/:id/admit', auth_1.requireAdminWrite, async (req, res) => {
    const jobSiteId = Number(req.params.id);
    const parsed = AdmitSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid input.' });
        return;
    }
    const site = await (0, connection_1.queryOne)('SELECT id FROM job_sites WHERE id = $1', [jobSiteId]);
    if (!site) {
        res.status(404).json({ success: false, message: 'Job site not found.' });
        return;
    }
    const { bidderId, defaultCandidateId } = parsed.data;
    const bidder = await (0, connection_1.queryOne)('SELECT id FROM bidders WHERE id = $1 AND is_active = TRUE', [bidderId]);
    if (!bidder) {
        res.status(404).json({ success: false, message: 'Bidder not found.' });
        return;
    }
    if (!(await validateBidderCandidate(bidderId, defaultCandidateId))) {
        res.status(400).json({
            success: false,
            message: 'Default candidate must belong to the bidder and be active.',
        });
        return;
    }
    const row = await (0, connection_1.queryOne)(`INSERT INTO bidder_job_sites (bidder_id, job_site_id, default_candidate_id, admitted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (bidder_id, job_site_id) DO UPDATE SET
       default_candidate_id = EXCLUDED.default_candidate_id,
       admitted_by = EXCLUDED.admitted_by,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING *`, [bidderId, jobSiteId, defaultCandidateId, req.userId || null]);
    res.json({ success: true, admission: row });
});
router.delete('/:id/admit/:bidderId', auth_1.requireAdminWrite, async (req, res) => {
    const jobSiteId = Number(req.params.id);
    const bidderId = Number(req.params.bidderId);
    const { rowCount } = await (0, connection_1.execute)(`UPDATE bidder_job_sites SET is_active = FALSE, updated_at = NOW()
     WHERE job_site_id = $1 AND bidder_id = $2`, [jobSiteId, bidderId]);
    if (!rowCount) {
        res.status(404).json({ success: false, message: 'Admission not found.' });
        return;
    }
    res.json({ success: true });
});
exports.default = router;
//# sourceMappingURL=job-sites.routes.js.map