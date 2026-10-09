import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireNewSchemaAuth);

const InterviewSchema = z.object({
  bidId: z.number().int().positive(),
  interviewTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  interviewDate: z.string().date(),
  callerUserId: z.number().int().positive(),
  interviewer: z.string().trim().min(1).max(200),
  step: z.enum(['intro', 'tech-1', 'tech-2', 'final']),
  status: z.enum(['todo', 'did', 'failed', 'respond_waiting']).optional(),
  outcome: z.enum(['good', 'bad', 'normal']).nullable().optional(),
  comment: z.string().max(5000).nullable().optional(),
});

const OutcomeSchema = z.object({
  outcome: z.enum(['good', 'bad', 'normal']).nullable(),
  comment: z.string().max(5000).nullable().optional(),
});

const interviewSelect = `
  SELECT i.i_id, i.b_id, i.interview_time, i.interview_date,
         i.caller_user_id, caller.name AS caller_name,
         i.interviewer, i.step, i.status, i.outcome, i.created_date, i.comment,
         b.u_id AS account_user_id, account.name AS account_name,
         b.j_id, b.job_title, b.company
  FROM interviews i
  JOIN bids b ON b.b_id = i.b_id
  JOIN users account ON account.u_id = b.u_id
  JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
  JOIN users caller ON caller.u_id = i.caller_user_id
`;

function scopeForUser(
  user: NonNullable<NewSchemaAuthRequest['newSchemaUser']>,
  paramIndex = 1
): { clause: string; params: unknown[] } {
  if (user.role === 'super') return { clause: '', params: [] };
  if (user.role === 'admin') {
    return {
      clause: `account.parent_user_id IN (
        SELECT manager.u_id FROM users manager
        WHERE manager.role = 'manager' AND manager.parent_user_id = $${paramIndex}
      ) AND b.manager_user_id = account.parent_user_id`,
      params: [user.id],
    };
  }
  if (user.role === 'manager') {
    return { clause: `account.parent_user_id = $${paramIndex} AND b.manager_user_id = $${paramIndex}`, params: [user.id] };
  }
  if (user.role === 'caller') {
    return { clause: `i.caller_user_id = $${paramIndex}`, params: [user.id] };
  }
  return { clause: 'FALSE', params: [] };
}

async function canManageBid(
  bidId: number,
  managerId: number
): Promise<boolean> {
  const row = await queryOne<{ b_id: number }>(
    `SELECT b.b_id
     FROM bids b
     JOIN users account ON account.u_id = b.u_id AND account.role = 'account'
     WHERE b.b_id = $1 AND account.parent_user_id = $2 AND b.manager_user_id = $2`,
    [bidId, managerId]
  );
  return Boolean(row);
}

async function canAssignCaller(
  callerUserId: number,
  managerParentId: number | null
): Promise<boolean> {
  if (!managerParentId) return false;
  const row = await queryOne<{ u_id: number }>(
    `SELECT u_id FROM users
     WHERE u_id = $1 AND role = 'caller' AND parent_user_id = $2
       AND blocked_date IS NULL`,
    [callerUserId, managerParentId]
  );
  return Boolean(row);
}

async function getAccessibleInterview(
  interviewId: number,
  user: NonNullable<NewSchemaAuthRequest['newSchemaUser']>
): Promise<{ i_id: number; b_id: number; caller_user_id: number } | null> {
  const scope = scopeForUser(user, 2);
  let query = `
    SELECT i.i_id, i.b_id, i.caller_user_id
    FROM interviews i
    JOIN bids b ON b.b_id = i.b_id
    JOIN users account ON account.u_id = b.u_id
    JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
    WHERE i.i_id = $1`;
  const params: unknown[] = [interviewId];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  return queryOne(query, params);
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const scope = scopeForUser(req.newSchemaUser!);
  let query = interviewSelect;
  const params = [...scope.params];
  if (scope.clause) query += ` WHERE ${scope.clause}`;
  query += ' ORDER BY i.interview_date DESC, i.interview_time DESC, i.i_id DESC';
  const interviews = await queryAll(query, params);
  res.json({ success: true, interviews });
});

router.get('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const interviewId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(interviewId) || interviewId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid interview ID.' });
    return;
  }
  const scope = scopeForUser(req.newSchemaUser!, 2);
  let query = `${interviewSelect} WHERE i.i_id = $1`;
  const params: unknown[] = [interviewId];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  const interview = await queryOne(query, params);
  if (!interview) {
    res.status(404).json({ success: false, message: 'Interview not found.' });
    return;
  }
  res.json({ success: true, interview });
});

router.post('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
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
  const row = await queryOne<{ i_id: number }>(
    `INSERT INTO interviews (
      b_id, interview_time, interview_date, caller_user_id, interviewer,
      step, status, outcome, comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING i_id`,
    [
      data.bidId, data.interviewTime, data.interviewDate, data.callerUserId,
      data.interviewer, data.step, data.status ?? 'todo', data.outcome ?? null,
      data.comment ?? null,
    ]
  );
  const interview = await queryOne(
    `${interviewSelect} WHERE i.i_id = $1`,
    [row!.i_id]
  );
  logger.info('New-schema interview created', { id: row!.i_id, managerId: user.id });
  res.status(201).json({ success: true, interview });
});

router.put('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
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
  await execute(
    `UPDATE interviews SET
      b_id = $1, interview_time = $2, interview_date = $3,
      caller_user_id = $4, interviewer = $5, step = $6,
      status = COALESCE($7, status),
      outcome = CASE WHEN $8 THEN $9 ELSE outcome END,
      comment = CASE WHEN $10 THEN $11 ELSE comment END
     WHERE i_id = $12`,
    [
      data.bidId, data.interviewTime, data.interviewDate, data.callerUserId,
      data.interviewer, data.step, data.status ?? null,
      data.outcome !== undefined, data.outcome ?? null,
      data.comment !== undefined, data.comment ?? null, interviewId,
    ]
  );
  const interview = await queryOne(`${interviewSelect} WHERE i.i_id = $1`, [interviewId]);
  res.json({ success: true, interview });
});

router.patch('/:id/outcome', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
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
    await execute(
      'UPDATE interviews SET outcome = $1 WHERE i_id = $2',
      [parsed.data.outcome, interviewId]
    );
  } else {
    await execute(
      `UPDATE interviews SET outcome = $1,
         comment = CASE WHEN $2 THEN $3 ELSE comment END
       WHERE i_id = $4`,
      [
        parsed.data.outcome,
        parsed.data.comment !== undefined,
        parsed.data.comment ?? null,
        interviewId,
      ]
    );
  }
  const updated = await queryOne(`${interviewSelect} WHERE i.i_id = $1`, [interviewId]);
  res.json({ success: true, interview: updated });
});

router.delete('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
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
  await execute('DELETE FROM interviews WHERE i_id = $1', [interviewId]);
  res.json({ success: true, message: 'Interview deleted.' });
});

export default router;
