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
const TIMEZONES = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata', 'Australia/Sydney',
];
const InterviewSchema = zod_1.z.object({
    candidateId: zod_1.z.number().int().positive().optional().nullable(),
    candidateName: zod_1.z.string().min(1).max(200),
    callerUserId: zod_1.z.number().int().positive().optional().nullable(),
    bidderId: zod_1.z.number().int().positive().optional().nullable(),
    scheduledDate: zod_1.z.string().optional().nullable(),
    attendDate: zod_1.z.string().optional().nullable(),
    interviewTime: zod_1.z.string().optional().nullable(),
    timezone: zod_1.z.string().optional().default('UTC'),
    position: zod_1.z.string().optional().nullable(),
    company: zod_1.z.string().optional().nullable(),
    jobUrl: zod_1.z.string().optional().nullable(),
    resume: zod_1.z.string().optional().nullable(),
    meetingUrl: zod_1.z.string().optional().nullable(),
    salary: zod_1.z.string().optional().nullable(),
    stage: zod_1.z.string().optional().nullable(),
});
router.get('/meta/timezones', (_req, res) => {
    res.json({ success: true, timezones: TIMEZONES });
});
router.get('/', async (req, res) => {
    const filter = (0, scope_1.interviewCallerFilter)(req, 'ip', 1);
    let query = `
    SELECT ip.*, a.username AS caller_username, b.name AS bidder_name
    FROM interview_processes ip
    LEFT JOIN admins a ON a.id = ip.caller_user_id
    LEFT JOIN bidders b ON b.id = ip.bidder_id
  `;
    const params = [...filter.params];
    if (filter.clause)
        query += ` WHERE ${filter.clause}`;
    query += ' ORDER BY ip.scheduled_date DESC NULLS LAST, ip.id DESC';
    const interviews = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, interviews });
});
router.get('/:id', async (req, res) => {
    const filter = (0, scope_1.interviewCallerFilter)(req, 'ip', 2);
    let query = `
    SELECT ip.*, a.username AS caller_username, b.name AS bidder_name
    FROM interview_processes ip
    LEFT JOIN admins a ON a.id = ip.caller_user_id
    LEFT JOIN bidders b ON b.id = ip.bidder_id
    WHERE ip.id = $1
  `;
    const params = [req.params.id, ...filter.params];
    if (filter.clause)
        query += ` AND ${filter.clause}`;
    const interview = await (0, connection_1.queryOne)(query, params);
    if (!interview) {
        res.status(404).json({ success: false, message: 'Interview not found.' });
        return;
    }
    res.json({ success: true, interview });
});
router.post('/', auth_1.requireAdminOrCaller, async (req, res) => {
    const data = InterviewSchema.parse(req.body);
    const callerUserId = (0, scope_1.isAdmin)(req) || (0, scope_1.isManager)(req)
        ? (data.callerUserId ?? null)
        : (req.userId ?? null);
    const row = await (0, connection_1.queryOne)(`INSERT INTO interview_processes (
      candidate_id, candidate_name, caller_user_id, bidder_id,
      scheduled_date, attend_date, interview_time, timezone,
      position, company, job_url, resume, meeting_url, salary, stage,
      created_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING id`, [
        data.candidateId ?? null,
        data.candidateName,
        callerUserId,
        data.bidderId ?? null,
        data.scheduledDate || null,
        data.attendDate || null,
        data.interviewTime || null,
        data.timezone || 'UTC',
        data.position || null,
        data.company || null,
        data.jobUrl || null,
        data.resume || null,
        data.meetingUrl || null,
        data.salary || null,
        data.stage || null,
        req.userId ?? null,
    ]);
    const interview = await (0, connection_1.queryOne)('SELECT * FROM interview_processes WHERE id = $1', [row.id]);
    logger_1.logger.info('Interview created', { id: row.id, candidate: data.candidateName });
    res.status(201).json({ success: true, interview });
});
router.put('/:id', auth_1.requireAdminWrite, async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT id FROM interview_processes WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Interview not found.' });
        return;
    }
    const data = InterviewSchema.parse(req.body);
    await (0, connection_1.execute)(`UPDATE interview_processes SET
      candidate_id = $1, candidate_name = $2, caller_user_id = $3, bidder_id = $4,
      scheduled_date = $5, attend_date = $6, interview_time = $7, timezone = $8,
      position = $9, company = $10, job_url = $11, resume = $12, meeting_url = $13,
      salary = $14, stage = $15, updated_at = NOW()
     WHERE id = $16`, [
        data.candidateId ?? null,
        data.candidateName,
        data.callerUserId ?? null,
        data.bidderId ?? null,
        data.scheduledDate || null,
        data.attendDate || null,
        data.interviewTime || null,
        data.timezone || 'UTC',
        data.position || null,
        data.company || null,
        data.jobUrl || null,
        data.resume || null,
        data.meetingUrl || null,
        data.salary || null,
        data.stage || null,
        req.params.id,
    ]);
    const interview = await (0, connection_1.queryOne)('SELECT * FROM interview_processes WHERE id = $1', [req.params.id]);
    res.json({ success: true, interview });
});
router.delete('/:id', auth_1.requireAdminWrite, async (req, res) => {
    const existing = await (0, connection_1.queryOne)('SELECT id FROM interview_processes WHERE id = $1', [req.params.id]);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Interview not found.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM interview_processes WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Interview deleted.' });
});
exports.default = router;
//# sourceMappingURL=interviews.routes.js.map