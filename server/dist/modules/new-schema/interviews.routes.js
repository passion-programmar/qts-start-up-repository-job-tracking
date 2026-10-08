"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const InterviewSchema = zod_1.z.object({
    bidId: zod_1.z.number().int().positive(),
    interviewTime: zod_1.z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    interviewDate: zod_1.z.string().date(),
    callerUserId: zod_1.z.number().int().positive(),
    interviewer: zod_1.z.string().trim().min(1).max(200),
    step: zod_1.z.enum(['intro', 'tech-1', 'tech-2', 'final']),
    status: zod_1.z.enum(['todo', 'did', 'failed', 'respond_waiting']).optional(),
    outcome: zod_1.z.enum(['good', 'bad', 'normal']).nullable().optional(),
    comment: zod_1.z.string().max(5000).nullable().optional(),
});
const OutcomeSchema = zod_1.z.object({
    outcome: zod_1.z.enum(['good', 'bad', 'normal']).nullable(),
    comment: zod_1.z.string().max(5000).nullable().optional(),
});
const interviewSelect = `
  SELECT i.i_id, i.b_id, i.interview_time, i.interview_date,
         i.caller_user_id, caller.name AS caller_name,
         i.interviewer, i.step, i.status, i.outcome, i.created_date, i.comment,
         b.u_id AS account_user_id, account.name AS account_name,
         j.j_id, j.title AS job_title, j.company
  FROM interviews i
  JOIN bids b ON b.b_id = i.b_id
  JOIN users account ON account.u_id = b.u_id
  JOIN job_list j ON j.j_id = b.j_id
  JOIN users caller ON caller.u_id = i.caller_user_id
`;
function scopeForUser(user, paramIndex = 1) {
    if (user.role === 'super')
        return { clause: '', params: [] };
    if (user.role === 'admin') {
        return {
            clause: `account.parent_user_id IN (
        SELECT manager.u_id FROM users manager
        WHERE manager.role = 'manager' AND manager.parent_user_id = $${paramIndex}
      ) AND j.u_id = account.parent_user_id`,
            params: [user.id],
        };
    }
    if (user.role === 'manager') {
        return {
            clause: `account.parent_user_id = $${paramIndex} AND j.u_id = $${paramIndex}`,
            params: [user.id],
        };
    }
    if (user.role === 'caller') {
        return { clause: `i.caller_user_id = $${paramIndex}`, params: [user.id] };
    }
    return { clause: 'FALSE', params: [] };
}
async function canManageBid(bidId, managerId) {
    const row = await (0, connection_1.queryOne)(`SELECT b.b_id
     FROM bids b
     JOIN users account ON account.u_id = b.u_id AND account.role = 'account'
     JOIN job_list j ON j.j_id = b.j_id
     WHERE b.b_id = $1 AND account.parent_user_id = $2 AND j.u_id = $2`, [bidId, managerId]);
    return Boolean(row);
}
async function canAssignCaller(callerUserId, managerParentId) {
    if (!managerParentId)
        return false;
    const row = await (0, connection_1.queryOne)(`SELECT u_id FROM users
     WHERE u_id = $1 AND role = 'caller' AND parent_user_id = $2
       AND blocked_date IS NULL`, [callerUserId, managerParentId]);
    return Boolean(row);
}
async function getAccessibleInterview(interviewId, user) {
    const scope = scopeForUser(user, 2);
    let query = `
    SELECT i.i_id, i.b_id, i.caller_user_id
    FROM interviews i
    JOIN bids b ON b.b_id = i.b_id
    JOIN users account ON account.u_id = b.u_id
    JOIN job_list j ON j.j_id = b.j_id
    WHERE i.i_id = $1`;
    const params = [interviewId];
    if (scope.clause) {
        query += ` AND ${scope.clause}`;
        params.push(...scope.params);
    }
    return (0, connection_1.queryOne)(query, params);
}
router.get('/', async (req, res) => {
    const scope = scopeForUser(req.newSchemaUser);
    let query = interviewSelect;
    const params = [...scope.params];
    if (scope.clause)
        query += ` WHERE ${scope.clause}`;
    query += ' ORDER BY i.interview_date DESC, i.interview_time DESC, i.i_id DESC';
    const interviews = await (0, connection_1.queryAll)(query, params);
    res.json({ success: true, interviews });
});
router.get('/:id', async (req, res) => {
    const interviewId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(interviewId) || interviewId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid interview ID.' });
        return;
    }
    const scope = scopeForUser(req.newSchemaUser, 2);
    let query = `${interviewSelect} WHERE i.i_id = $1`;
    const params = [interviewId];
    if (scope.clause) {
        query += ` AND ${scope.clause}`;
        params.push(...scope.params);
    }
    const interview = await (0, connection_1.queryOne)(query, params);
    if (!interview) {
        res.status(404).json({ success: false, message: 'Interview not found.' });
        return;
    }
    res.json({ success: true, interview });
});
router.post('/', async (req, res) => {
    const user = req.newSchemaUser;
    if (user.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only Managers can schedule interviews.' });
        return;
    }
    const parsed = InterviewSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter valid interview details.' });
        return;
    }
    const data = parsed.data;
    if (!(await canManageBid(data.bidId, user.id))) {
        res.status(404).json({ success: false, message: 'Bid not found in your Accounts.' });
        return;
    }
    if (!(await canAssignCaller(data.callerUserId, user.parentUserId))) {
        res.status(400).json({ success: false, message: 'Select an active Caller assigned to your Admin.' });
        return;
    }
    const row = await (0, connection_1.queryOne)(`INSERT INTO interviews (
      b_id, interview_time, interview_date, caller_user_id, interviewer,
      step, status, outcome, comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING i_id`, [
        data.bidId, data.interviewTime, data.interviewDate, data.callerUserId,
        data.interviewer, data.step, data.status ?? 'todo', data.outcome ?? null,
        data.comment ?? null,
    ]);
    const interview = await (0, connection_1.queryOne)(`${interviewSelect} WHERE i.i_id = $1`, [row.i_id]);
    logger_1.logger.info('New-schema interview created', { id: row.i_id, managerId: user.id });
    res.status(201).json({ success: true, interview });
});
router.put('/:id', async (req, res) => {
    const user = req.newSchemaUser;
    if (user.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only Managers can edit interview details.' });
        return;
    }
    const interviewId = Number.parseInt(req.params.id, 10);
    const parsed = InterviewSchema.safeParse(req.body);
    if (!Number.isSafeInteger(interviewId) || interviewId <= 0 || !parsed.success) {
        res.status(400).json({ success: false, message: 'Enter a valid interview ID and interview details.' });
        return;
    }
    const data = parsed.data;
    const existing = await getAccessibleInterview(interviewId, user);
    if (!existing || !(await canManageBid(data.bidId, user.id))) {
        res.status(404).json({ success: false, message: 'Interview not found in your Accounts.' });
        return;
    }
    if (!(await canAssignCaller(data.callerUserId, user.parentUserId))) {
        res.status(400).json({ success: false, message: 'Select an active Caller assigned to your Admin.' });
        return;
    }
    await (0, connection_1.execute)(`UPDATE interviews SET
      b_id = $1, interview_time = $2, interview_date = $3,
      caller_user_id = $4, interviewer = $5, step = $6,
      status = COALESCE($7, status),
      outcome = CASE WHEN $8 THEN $9 ELSE outcome END,
      comment = CASE WHEN $10 THEN $11 ELSE comment END
     WHERE i_id = $12`, [
        data.bidId, data.interviewTime, data.interviewDate, data.callerUserId,
        data.interviewer, data.step, data.status ?? null,
        data.outcome !== undefined, data.outcome ?? null,
        data.comment !== undefined, data.comment ?? null, interviewId,
    ]);
    const interview = await (0, connection_1.queryOne)(`${interviewSelect} WHERE i.i_id = $1`, [interviewId]);
    res.json({ success: true, interview });
});
router.patch('/:id/outcome', async (req, res) => {
    const user = req.newSchemaUser;
    if (user.role !== 'caller' && user.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only assigned Callers or Managers can submit an outcome.' });
        return;
    }
    const interviewId = Number.parseInt(req.params.id, 10);
    const parsed = OutcomeSchema.safeParse(req.body);
    if (!Number.isSafeInteger(interviewId) || interviewId <= 0 || !parsed.success) {
        res.status(400).json({ success: false, message: 'Select good, bad, or normal as the outcome.' });
        return;
    }
    const interview = await getAccessibleInterview(interviewId, user);
    if (!interview || (user.role === 'caller' && interview.caller_user_id !== user.id)) {
        res.status(404).json({ success: false, message: 'Interview not found in your assignments.' });
        return;
    }
    if (user.role === 'caller') {
        if (parsed.data.comment !== undefined) {
            res.status(403).json({ success: false, message: 'Callers cannot edit Manager comments.' });
            return;
        }
        await (0, connection_1.execute)('UPDATE interviews SET outcome = $1 WHERE i_id = $2', [parsed.data.outcome, interviewId]);
    }
    else {
        await (0, connection_1.execute)(`UPDATE interviews SET outcome = $1,
         comment = CASE WHEN $2 THEN $3 ELSE comment END
       WHERE i_id = $4`, [
            parsed.data.outcome,
            parsed.data.comment !== undefined,
            parsed.data.comment ?? null,
            interviewId,
        ]);
    }
    const updated = await (0, connection_1.queryOne)(`${interviewSelect} WHERE i.i_id = $1`, [interviewId]);
    res.json({ success: true, interview: updated });
});
router.delete('/:id', async (req, res) => {
    const user = req.newSchemaUser;
    if (user.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only Managers can delete scheduled interviews.' });
        return;
    }
    const interviewId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(interviewId) || interviewId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid interview ID.' });
        return;
    }
    const existing = await getAccessibleInterview(interviewId, user);
    if (!existing) {
        res.status(404).json({ success: false, message: 'Interview not found in your Accounts.' });
        return;
    }
    await (0, connection_1.execute)('DELETE FROM interviews WHERE i_id = $1', [interviewId]);
    res.json({ success: true, message: 'Interview deleted.' });
});
exports.default = router;
//# sourceMappingURL=interviews.routes.js.map