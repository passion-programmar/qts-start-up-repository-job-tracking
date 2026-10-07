import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../../database/connection';
import {
  requireAuth,
  requireAdminWrite,
  requireAdminOrCaller,
  AuthRequest,
} from '../../middleware/auth';
import { interviewCallerFilter, isAdmin, isManager } from '../../middleware/scope';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireAuth);

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata', 'Australia/Sydney',
];

const InterviewSchema = z.object({
  candidateId: z.number().int().positive().optional().nullable(),
  candidateName: z.string().min(1).max(200),
  callerUserId: z.number().int().positive().optional().nullable(),
  bidderId: z.number().int().positive().optional().nullable(),
  scheduledDate: z.string().optional().nullable(),
  attendDate: z.string().optional().nullable(),
  interviewTime: z.string().optional().nullable(),
  timezone: z.string().optional().default('UTC'),
  position: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  jobUrl: z.string().optional().nullable(),
  resume: z.string().optional().nullable(),
  meetingUrl: z.string().optional().nullable(),
  salary: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
});

router.get('/meta/timezones', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, timezones: TIMEZONES });
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const filter = interviewCallerFilter(req, 'ip', 1);
  let query = `
    SELECT ip.*, a.username AS caller_username, b.name AS bidder_name
    FROM interview_processes ip
    LEFT JOIN admins a ON a.id = ip.caller_user_id
    LEFT JOIN bidders b ON b.id = ip.bidder_id
  `;
  const params: unknown[] = [...filter.params];
  if (filter.clause) query += ` WHERE ${filter.clause}`;
  query += ' ORDER BY ip.scheduled_date DESC NULLS LAST, ip.id DESC';

  const interviews = await queryAll(query, params);
  res.json({ success: true, interviews });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const filter = interviewCallerFilter(req, 'ip', 2);
  let query = `
    SELECT ip.*, a.username AS caller_username, b.name AS bidder_name
    FROM interview_processes ip
    LEFT JOIN admins a ON a.id = ip.caller_user_id
    LEFT JOIN bidders b ON b.id = ip.bidder_id
    WHERE ip.id = $1
  `;
  const params: unknown[] = [req.params.id, ...filter.params];
  if (filter.clause) query += ` AND ${filter.clause}`;

  const interview = await queryOne(query, params);
  if (!interview) {
    res.status(404).json({ success: false, message: 'Interview not found.' });
    return;
  }
  res.json({ success: true, interview });
});

router.post('/', requireAdminOrCaller, async (req: AuthRequest, res: Response) => {
  const data = InterviewSchema.parse(req.body);
  const callerUserId = isAdmin(req) || isManager(req)
    ? (data.callerUserId ?? null)
    : (req.userId ?? null);

  const row = await queryOne<{ id: number }>(
    `INSERT INTO interview_processes (
      candidate_id, candidate_name, caller_user_id, bidder_id,
      scheduled_date, attend_date, interview_time, timezone,
      position, company, job_url, resume, meeting_url, salary, stage,
      created_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING id`,
    [
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
    ]
  );

  const interview = await queryOne('SELECT * FROM interview_processes WHERE id = $1', [row!.id]);
  logger.info('Interview created', { id: row!.id, candidate: data.candidateName });
  res.status(201).json({ success: true, interview });
});

router.put('/:id', requireAdminWrite, async (req: AuthRequest, res: Response) => {
  const existing = await queryOne('SELECT id FROM interview_processes WHERE id = $1', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Interview not found.' });
    return;
  }
  const data = InterviewSchema.parse(req.body);
  await execute(
    `UPDATE interview_processes SET
      candidate_id = $1, candidate_name = $2, caller_user_id = $3, bidder_id = $4,
      scheduled_date = $5, attend_date = $6, interview_time = $7, timezone = $8,
      position = $9, company = $10, job_url = $11, resume = $12, meeting_url = $13,
      salary = $14, stage = $15, updated_at = NOW()
     WHERE id = $16`,
    [
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
    ]
  );
  const interview = await queryOne('SELECT * FROM interview_processes WHERE id = $1', [req.params.id]);
  res.json({ success: true, interview });
});

router.delete('/:id', requireAdminWrite, async (req: AuthRequest, res: Response) => {
  const existing = await queryOne('SELECT id FROM interview_processes WHERE id = $1', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Interview not found.' });
    return;
  }
  await execute('DELETE FROM interview_processes WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Interview deleted.' });
});

export default router;
