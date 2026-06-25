"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const normalize_url_1 = require("../../utilities/normalize-url");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
const CandidateStatusSchema = zod_1.z.object({
    candidateId: zod_1.z.number().int().positive(),
    status: zod_1.z.enum(['none', 'applied']),
});
const JobSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    company: zod_1.z.string().min(1).max(300),
    url: zod_1.z.string().url(),
    description: zod_1.z.string().max(50000).optional().default(''),
    source: zod_1.z.string().max(100).optional(),
    candidateStatuses: zod_1.z.array(CandidateStatusSchema).optional().default([]),
});
async function getJobWithCandidates(jobId, req) {
    const job = await (0, connection_1.queryOne)('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!job)
        return null;
    let candidateQuery = `
    SELECT c.id AS candidate_id, c.name, COALESCE(cj.status, 'none') AS status, cj.applied_at
    FROM candidates c
    LEFT JOIN candidate_jobs cj ON cj.candidate_id = c.id AND cj.job_id = $1
    WHERE c.is_active = TRUE`;
    const params = [jobId];
    if (req && (0, scope_1.isBidder)(req) && req.bidderId) {
        candidateQuery += ' AND c.bidder_id = $2';
        params.push(req.bidderId);
    }
    candidateQuery += ' ORDER BY c.name ASC';
    const candidateStatuses = await (0, connection_1.queryAll)(candidateQuery, params);
    return { ...job, candidateStatuses };
}
async function upsertCandidateStatuses(jobId, statuses, client, bidderId) {
    const exec = async (sql, params) => {
        if (client)
            return client.query(sql, params);
        return (0, connection_1.dbQuery)(sql, params);
    };
    let activeSql = 'SELECT id FROM candidates WHERE is_active = TRUE';
    const activeParams = [];
    if (bidderId) {
        activeSql += ' AND bidder_id = $1';
        activeParams.push(bidderId);
    }
    const activeResult = await exec(activeSql, activeParams);
    const activeCandidates = activeResult.rows;
    if (!activeCandidates.length)
        return;
    const activeIds = activeCandidates.map((c) => c.id);
    const statusMap = new Map(statuses.map((s) => [s.candidateId, s.status]));
    const existingResult = await exec(`SELECT candidate_id, status, applied_at
     FROM candidate_jobs
     WHERE job_id = $1 AND candidate_id = ANY($2::int[])`, [jobId, activeIds]);
    const existingMap = new Map(existingResult.rows.map((row) => [row.candidate_id, { status: row.status, applied_at: row.applied_at }]));
    const now = new Date().toISOString();
    const candidateIds = [];
    const statusesOut = [];
    const appliedAts = [];
    for (const c of activeCandidates) {
        const existing = existingMap.get(c.id);
        const requested = statusMap.get(c.id) || 'none';
        let status = requested;
        let appliedAt = requested === 'applied' ? now : null;
        if (existing?.status === 'applied') {
            status = 'applied';
            appliedAt = existing.applied_at;
        }
        candidateIds.push(c.id);
        statusesOut.push(status);
        appliedAts.push(appliedAt);
    }
    await exec(`INSERT INTO candidate_jobs (candidate_id, job_id, status, applied_at)
     SELECT cid, $2, st, at
     FROM unnest($1::int[], $3::text[], $4::timestamptz[]) AS u(cid, st, at)
     ON CONFLICT (candidate_id, job_id) DO UPDATE SET
       status = EXCLUDED.status,
       applied_at = EXCLUDED.applied_at,
       updated_at = NOW()`, [candidateIds, jobId, statusesOut, appliedAts]);
}
router.get('/', auth_1.requireAuth, async (req, res) => {
    const search = req.query.search || '';
    const company = req.query.company || '';
    const status = req.query.status || '';
    let query = `
    SELECT j.*, COALESCE(app.applied_count, 0)::int AS applied_count
    FROM jobs j
    LEFT JOIN (
      SELECT job_id, COUNT(*)::int AS applied_count
      FROM candidate_jobs
      WHERE status = 'applied'
      GROUP BY job_id
    ) app ON app.job_id = j.id
  `;
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    if (search) {
        const placeholder = `$${paramIndex++}`;
        conditions.push(`(j.title ILIKE ${placeholder} OR j.company ILIKE ${placeholder})`);
        params.push(`%${search}%`);
    }
    if (company) {
        conditions.push(`j.company ILIKE $${paramIndex++}`);
        params.push(`%${company}%`);
    }
    if (status === 'applied') {
        conditions.push('COALESCE(app.applied_count, 0) > 0');
    }
    const scope = (0, scope_1.jobBidderFilter)(req, 'j', paramIndex);
    if (scope.clause) {
        conditions.push(scope.clause);
        params.push(...scope.params);
        paramIndex = scope.nextIndex;
    }
    if (conditions.length)
        query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY j.created_at DESC';
    const jobs = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, jobs });
});
router.get('/by-url', auth_1.requireAuth, async (req, res) => {
    const raw = req.query.url;
    if (!raw) {
        res.status(400).json({ success: false, message: 'URL parameter required.' });
        return;
    }
    const norm = (0, normalize_url_1.normalizeUrl)(raw);
    const scope = (0, scope_1.jobBidderFilter)(req, 'j', 2);
    let accessQuery = 'SELECT j.* FROM jobs j WHERE j.normalized_url = $1';
    const accessParams = [norm];
    if (scope.clause) {
        accessQuery += ` AND ${scope.clause}`;
        accessParams.push(...scope.params);
    }
    const job = await (0, connection_1.queryOne)(accessQuery, accessParams);
    if (!job) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    const jobWithCandidates = await getJobWithCandidates(job.id, req);
    res.json({ success: true, job: jobWithCandidates });
});
router.get('/stats', auth_1.requireAuth, async (req, res) => {
    if ((0, scope_1.isCaller)(req)) {
        res.status(403).json({ success: false, message: 'Dashboard not available for callers.' });
        return;
    }
    const managerId = (0, scope_1.isManager)(req) ? req.userId : null;
    const bidderId = (0, scope_1.isBidder)(req) ? req.bidderId : null;
    const scopeId = bidderId ?? managerId ?? null;
    const managerScope = Boolean(managerId && !bidderId);
    const scoped = Boolean(scopeId);
    const candidateScopeSql = managerScope
        ? 'bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)'
        : 'bidder_id = $1';
    const cjBidderJoin = scoped
        ? managerScope
            ? 'JOIN candidates c_scope ON c_scope.id = cj.candidate_id AND c_scope.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)'
            : 'JOIN candidates c_scope ON c_scope.id = cj.candidate_id AND c_scope.bidder_id = $1'
        : '';
    const cjParams = scopeId ? [scopeId] : [];
    const jobScope = scoped
        ? managerScope
            ? `WHERE (
          j.id IN (
            SELECT DISTINCT cj2.job_id FROM candidate_jobs cj2
            JOIN candidates c2 ON c2.id = cj2.candidate_id
            WHERE c2.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)
          ) OR j.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)
        )`
            : `WHERE j.id IN (
          SELECT DISTINCT cj2.job_id FROM candidate_jobs cj2
          JOIN candidates c2 ON c2.id = cj2.candidate_id WHERE c2.bidder_id = $1
        ) OR j.bidder_id = $1`
        : '';
    const totalJobs = await (0, connection_1.queryOne)(`SELECT COUNT(*)::int AS count FROM jobs j ${jobScope}`, cjParams);
    const totalCandidates = await (0, connection_1.queryOne)(scoped
        ? `SELECT COUNT(*)::int AS count FROM candidates WHERE ${candidateScopeSql}`
        : 'SELECT COUNT(*)::int AS count FROM candidates', cjParams);
    const activeCandidates = await (0, connection_1.queryOne)(scoped
        ? `SELECT COUNT(*)::int AS count FROM candidates WHERE is_active = TRUE AND ${candidateScopeSql}`
        : 'SELECT COUNT(*)::int AS count FROM candidates WHERE is_active = TRUE', cjParams);
    const applications = await (0, connection_1.queryOne)(scoped
        ? managerScope
            ? `SELECT COUNT(*)::int AS count FROM candidate_jobs cj
           JOIN candidates c_scope ON c_scope.id = cj.candidate_id
             AND c_scope.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)
           WHERE cj.status = 'applied'`
            : `SELECT COUNT(*)::int AS count FROM candidate_jobs cj
           JOIN candidates c_scope ON c_scope.id = cj.candidate_id AND c_scope.bidder_id = $1
           WHERE cj.status = 'applied'`
        : "SELECT COUNT(*)::int AS count FROM candidate_jobs WHERE status = 'applied'", cjParams);
    const todayBids = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
      AND cj.applied_at::date = CURRENT_DATE
  `, cjParams);
    const weekBids = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
      AND cj.applied_at >= NOW() - INTERVAL '7 days'
  `, cjParams);
    const monthBids = await (0, connection_1.queryOne)(`
    SELECT COUNT(*)::int AS count FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
      AND date_trunc('month', cj.applied_at) = date_trunc('month', NOW())
  `, cjParams);
    const recentApplications = await (0, connection_1.queryAll)(`
    SELECT j.id AS job_id, j.title AS job_title, j.company, c.name AS candidate_name, cj.applied_at
    FROM candidate_jobs cj
    JOIN jobs j ON j.id = cj.job_id
    JOIN candidates c ON c.id = cj.candidate_id
    WHERE cj.status = 'applied'
    ${scoped ? (managerScope ? 'AND c.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1)' : 'AND c.bidder_id = $1') : ''}
    ORDER BY cj.applied_at DESC NULLS LAST, cj.updated_at DESC
    LIMIT 50
  `, cjParams);
    const dailyBids = await (0, connection_1.queryAll)(`
    SELECT cj.applied_at::date AS label, COUNT(*)::int AS count
    FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
      AND cj.applied_at >= NOW() - INTERVAL '30 days'
    GROUP BY cj.applied_at::date
    ORDER BY label DESC
  `, cjParams);
    const weeklyBids = await (0, connection_1.queryAll)(`
    SELECT TO_CHAR(cj.applied_at, 'IYYY-"W"IW') AS label, COUNT(*)::int AS count
    FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
      AND cj.applied_at >= NOW() - INTERVAL '84 days'
    GROUP BY TO_CHAR(cj.applied_at, 'IYYY-"W"IW')
    ORDER BY label DESC
    LIMIT 12
  `, cjParams);
    const monthlyBids = await (0, connection_1.queryAll)(`
    SELECT TO_CHAR(cj.applied_at, 'YYYY-MM') AS label, COUNT(*)::int AS count
    FROM candidate_jobs cj
    ${cjBidderJoin}
    WHERE cj.status = 'applied' AND cj.applied_at IS NOT NULL
    GROUP BY TO_CHAR(cj.applied_at, 'YYYY-MM')
    ORDER BY label DESC
    LIMIT 12
  `, cjParams);
    const jobRows = await (0, connection_1.queryAll)(`
    SELECT j.id, j.title, j.company, j.url, j.created_at, c.name AS candidate_name, cj.applied_at
    FROM jobs j
    LEFT JOIN candidate_jobs cj ON cj.job_id = j.id AND cj.status = 'applied'
    LEFT JOIN candidates c ON c.id = cj.candidate_id
    ${scoped ? (managerScope ? 'WHERE (c.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1) OR j.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $1))' : 'WHERE (c.bidder_id = $1 OR j.bidder_id = $1)') : ''}
    ORDER BY j.created_at DESC, cj.applied_at DESC NULLS LAST
  `, cjParams);
    const jobsOverviewMap = new Map();
    for (const row of jobRows) {
        if (!jobsOverviewMap.has(row.id)) {
            jobsOverviewMap.set(row.id, {
                id: row.id,
                title: row.title,
                company: row.company,
                url: row.url,
                created_at: row.created_at,
                appliedCandidates: [],
            });
        }
        if (row.candidate_name && row.applied_at) {
            jobsOverviewMap.get(row.id).appliedCandidates.push({
                name: row.candidate_name,
                applied_at: row.applied_at,
            });
        }
    }
    res.json({
        success: true,
        stats: {
            totalJobs: Number(totalJobs?.count ?? 0),
            totalCandidates: Number(totalCandidates?.count ?? 0),
            activeCandidates: Number(activeCandidates?.count ?? 0),
            applications: Number(applications?.count ?? 0),
            bidSummary: {
                today: Number(todayBids?.count ?? 0),
                week: Number(weekBids?.count ?? 0),
                month: Number(monthBids?.count ?? 0),
            },
            dailyBids,
            weeklyBids,
            monthlyBids,
            recentApplications,
            jobsOverview: Array.from(jobsOverviewMap.values()),
        },
    });
});
router.get('/:id', auth_1.requireAuth, async (req, res) => {
    const jobId = parseInt(req.params.id, 10);
    const scope = (0, scope_1.jobBidderFilter)(req, 'j', 2);
    let accessQuery = 'SELECT id FROM jobs j WHERE j.id = $1';
    const accessParams = [jobId];
    if (scope.clause) {
        accessQuery += ` AND ${scope.clause}`;
        accessParams.push(...scope.params);
    }
    const accessible = await (0, connection_1.queryOne)(accessQuery, accessParams);
    if (!accessible) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    const job = await getJobWithCandidates(jobId, req);
    if (!job) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    res.json({ success: true, job });
});
router.post('/', auth_1.requireAuth, auth_1.requireAdminOrBidder, async (req, res) => {
    const data = JobSchema.parse(req.body);
    const normUrl = (0, normalize_url_1.normalizeUrl)(data.url);
    const existing = await (0, connection_1.queryOne)('SELECT * FROM jobs WHERE normalized_url = $1', [normUrl]);
    if (existing) {
        const ex = existing;
        logger_1.logger.warn('Duplicate URL attempt', { url: normUrl });
        res.status(409).json({
            success: false,
            duplicate: true,
            message: 'A job with this URL already exists.',
            job: { id: ex.id, title: ex.title, company: ex.company, url: ex.url },
        });
        return;
    }
    const jobId = await (0, connection_1.withTransaction)(async (client) => {
        const bidderId = (0, scope_1.isAdmin)(req) ? null : (req.bidderId ?? null);
        const result = await client.query(`INSERT INTO jobs (title, company, url, normalized_url, description, source, bidder_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`, [
            data.title,
            data.company,
            data.url,
            normUrl,
            data.description,
            data.source || null,
            bidderId,
            req.userId ?? null,
        ]);
        const id = result.rows[0].id;
        await upsertCandidateStatuses(id, data.candidateStatuses, client, bidderId);
        return id;
    });
    const job = await getJobWithCandidates(jobId, req);
    logger_1.logger.info('Job created', { id: jobId, title: data.title });
    res.status(201).json({ success: true, message: 'Job saved successfully.', job });
});
router.put('/:id', auth_1.requireAuth, auth_1.requireAdminWrite, async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    const data = JobSchema.parse(req.body);
    const normUrl = (0, normalize_url_1.normalizeUrl)(data.url);
    const conflict = await (0, connection_1.queryOne)('SELECT id FROM jobs WHERE normalized_url = $1 AND id != $2', [normUrl, req.params.id]);
    if (conflict) {
        res.status(409).json({ success: false, code: 'URL_ALREADY_EXISTS', message: 'Another saved job already uses this URL.' });
        return;
    }
    await (0, connection_1.withTransaction)(async (client) => {
        await client.query(`UPDATE jobs
       SET title = $1, company = $2, url = $3, normalized_url = $4, description = $5, source = $6, updated_at = NOW()
       WHERE id = $7`, [data.title, data.company, data.url, normUrl, data.description, data.source || null, req.params.id]);
        await upsertCandidateStatuses(parseInt(req.params.id, 10), data.candidateStatuses, client, null);
    });
    const job = await getJobWithCandidates(parseInt(req.params.id, 10), req);
    logger_1.logger.info('Job updated', { id: req.params.id });
    res.json({ success: true, message: 'Job updated successfully.', job });
});
router.delete('/:id', auth_1.requireAuth, auth_1.requireAdminWrite, async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    logger_1.logger.info('Job deleted', { id: req.params.id });
    res.json({ success: true, message: 'Job deleted.' });
});
router.post('/upsert', auth_1.requireAuth, auth_1.requireAdminOrBidder, async (req, res) => {
    const data = JobSchema.parse(req.body);
    const normUrl = (0, normalize_url_1.normalizeUrl)(data.url);
    const bidderId = (0, scope_1.isAdmin)(req) ? null : (req.bidderId ?? null);
    const existing = await (0, connection_1.queryOne)('SELECT id FROM jobs WHERE normalized_url = $1', [normUrl]);
    if (existing && !(await (0, scope_1.jobAccessible)(req, existing.id))) {
        res.status(403).json({ success: false, message: 'You cannot update this job.' });
        return;
    }
    const jobId = await (0, connection_1.withTransaction)(async (client) => {
        let id;
        if (existing) {
            await client.query(`UPDATE jobs SET title = $1, company = $2, url = $3, description = $4, source = $5, updated_at = NOW()
         WHERE id = $6`, [data.title, data.company, data.url, data.description, data.source || null, existing.id]);
            id = existing.id;
        }
        else {
            const result = await client.query(`INSERT INTO jobs (title, company, url, normalized_url, description, source, bidder_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`, [
                data.title,
                data.company,
                data.url,
                normUrl,
                data.description,
                data.source || null,
                bidderId,
                req.userId ?? null,
            ]);
            id = result.rows[0].id;
        }
        await upsertCandidateStatuses(id, data.candidateStatuses, client, bidderId);
        return id;
    });
    const job = await getJobWithCandidates(jobId, req);
    res.json({ success: true, job });
});
router.get('/:jobId/candidates', auth_1.requireAuth, async (req, res) => {
    const jobId = parseInt(req.params.jobId, 10);
    if (!(await (0, scope_1.jobAccessible)(req, jobId))) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    let query = `
    SELECT c.id AS candidate_id, c.name, COALESCE(cj.status, 'none') AS status, cj.applied_at
    FROM candidates c
    LEFT JOIN candidate_jobs cj ON cj.candidate_id = c.id AND cj.job_id = $1
    WHERE c.is_active = TRUE`;
    const params = [jobId];
    if ((0, scope_1.isBidder)(req) && req.bidderId) {
        query += ' AND c.bidder_id = $2';
        params.push(req.bidderId);
    }
    query += ' ORDER BY c.name ASC';
    const rows = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, candidateStatuses: rows });
});
router.put('/:jobId/candidates', auth_1.requireAuth, auth_1.requireAdminWrite, async (req, res) => {
    const job = await (0, connection_1.queryOne)('SELECT id FROM jobs WHERE id = $1', [req.params.jobId]);
    if (!job) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
    }
    const { candidateStatuses } = zod_1.z.object({ candidateStatuses: zod_1.z.array(CandidateStatusSchema) }).parse(req.body);
    await (0, connection_1.withTransaction)(async (client) => {
        await upsertCandidateStatuses(parseInt(req.params.jobId, 10), candidateStatuses, client);
    });
    res.json({ success: true, message: 'Candidate statuses updated.' });
});
exports.default = router;
//# sourceMappingURL=jobs.routes.js.map