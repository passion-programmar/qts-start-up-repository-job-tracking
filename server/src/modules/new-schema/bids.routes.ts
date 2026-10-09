import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireNewSchemaAuth);

const RecordBidSchema = z.object({
  jobId: z.number().int().positive(),
  accountUserId: z.number().int().positive(),
  resumePath: z.string().trim().min(1).max(2000),
});

function bidScope(user: NonNullable<NewSchemaAuthRequest['newSchemaUser']>): {
  clause: string;
  params: unknown[];
} {
  if (user.role === 'super') return { clause: '', params: [] };
  if (user.role === 'admin') {
    return {
      clause: `manager.parent_user_id = $1 AND b.manager_user_id = manager.u_id`,
      params: [user.id],
    };
  }
  if (user.role === 'manager') {
    return { clause: 'account.parent_user_id = $1 AND b.manager_user_id = $1', params: [user.id] };
  }
  if (user.role === 'account') {
    return { clause: 'b.u_id = $1', params: [user.id] };
  }
  return { clause: 'FALSE', params: [] };
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const scope = bidScope(req.newSchemaUser!);
  let query = `
    SELECT b.b_id, b.u_id AS account_user_id, account.name AS account_name,
           b.j_id AS job_id, b.job_title, b.company, b.job_url AS url,
           b.job_status AS status, b.resume_path, b.applied_date,
           b.manager_user_id AS manager_id
    FROM bids b
    JOIN users account ON account.u_id = b.u_id AND account.role = 'account'
    JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'`;
  const params = [...scope.params];
  if (scope.clause) query += ` WHERE ${scope.clause}`;
  query += ' ORDER BY b.applied_date DESC, b.b_id DESC';
  const bids = await queryAll(query, params);
  res.json({ success: true, bids });
});

router.post('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Bid recording requires the owning Manager’s automation session.' });
    return;
  }
  const parsed = RecordBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a job, selected Account profile, and resume reference.' });
    return;
  }
  const data = parsed.data;
  const eligible = await queryOne<{
    j_id: number;
    title: string;
    company: string;
    url: string;
    status: 'processing' | 'todo' | 'did' | 'failed';
  }>(
    `SELECT j.j_id, j.title, j.company, j.url, j.status
     FROM job_list j
     JOIN users account ON account.u_id = $2 AND account.role = 'account'
       AND account.parent_user_id = j.u_id AND account.blocked_date IS NULL
     WHERE j.j_id = $1 AND j.u_id = $3
       AND $2 = ANY(j.selected_account_u_ids)`,
    [data.jobId, data.accountUserId, user.id]
  );
  if (!eligible) {
    res.status(404).json({ success: false, message: 'The job or selected Account is not available to this Manager.' });
    return;
  }
  const existing = await queryOne<{ b_id: number }>(
    'SELECT b_id FROM bids WHERE u_id = $1 AND j_id = $2',
    [data.accountUserId, data.jobId]
  );
  if (existing) {
    res.status(409).json({ success: false, message: 'This Account has already bid on this job.', bidId: existing.b_id });
    return;
  }
  const bid = await queryOne<{ b_id: number }>(
    `INSERT INTO bids (
       u_id, j_id, manager_user_id, job_title, company, job_url, job_status, resume_path
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (u_id, j_id) DO NOTHING
     RETURNING b_id`,
    [
      data.accountUserId, data.jobId, user.id, eligible.title,
      eligible.company, eligible.url, eligible.status, data.resumePath,
    ]
  );
  if (!bid) {
    res.status(409).json({ success: false, message: 'This Account has already bid on this job.' });
    return;
  }
  const record = await queryOne(
    `SELECT b.b_id, b.u_id AS account_user_id, account.name AS account_name,
            b.j_id AS job_id, b.job_title, b.company, b.job_url AS url,
            b.job_status AS status, b.resume_path, b.applied_date,
            b.manager_user_id AS manager_id
     FROM bids b
     JOIN users account ON account.u_id = b.u_id
     WHERE b.b_id = $1`,
    [bid.b_id]
  );
  logger.info('New-schema bid recorded by automation', {
    bidId: bid.b_id,
    managerId: user.id,
    accountUserId: data.accountUserId,
    jobId: data.jobId,
  });
  res.status(201).json({ success: true, bid: record });
});

export default router;
