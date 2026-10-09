import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

const PeriodSchema = z.enum(['day', 'week', 'month', 'year']);
const PERIODS = {
  day: { interval: '30 days', buckets: 'day' },
  week: { interval: '12 weeks', buckets: 'week' },
  month: { interval: '12 months', buckets: 'month' },
  year: { interval: '5 years', buckets: 'year' },
} as const;

function managerScope(user: NonNullable<NewSchemaAuthRequest['newSchemaUser']>) {
  if (user.role === 'super') return { clause: '', params: [] as unknown[] };
  if (user.role === 'admin') {
    return { clause: 'manager.parent_user_id = $1', params: [user.id] };
  }
  if (user.role === 'manager') {
    return { clause: 'manager.u_id = $1', params: [user.id] };
  }
  return null;
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  const scope = managerScope(user);
  if (!scope) {
    res.status(403).json({ success: false, message: 'Analytics are not available for this role.' });
    return;
  }
  const parsedPeriod = PeriodSchema.safeParse(req.query.period ?? 'month');
  if (!parsedPeriod.success) {
    res.status(400).json({ success: false, message: 'Period must be day, week, month, or year.' });
    return;
  }
  const period = PERIODS[parsedPeriod.data];
  const where = scope.clause ? `AND ${scope.clause}` : '';
  const params = scope.params;

  const [bidsByPeriod, interviewsByPeriod, bidsByStatus, interviewsByOutcome, byManager, byAccount] =
    await Promise.all([
      queryAll<{ bucket: Date; count: number | string }>(
        `SELECT date_trunc('${period.buckets}', b.applied_date) AS bucket, count(*)::int AS count
        FROM bids b
        JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
        WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
         GROUP BY bucket ORDER BY bucket ASC`,
        params
      ),
      queryAll<{ bucket: Date; count: number | string }>(
        `SELECT date_trunc('${period.buckets}', i.interview_date::timestamp) AS bucket,
               count(*)::int AS count
        FROM interviews i
        JOIN bids b ON b.b_id = i.b_id
        JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
         WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
         GROUP BY bucket ORDER BY bucket ASC`,
        params
      ),
      queryAll<{ status: string; count: number | string }>(
        `SELECT b.job_status AS status, count(*)::int AS count
         FROM bids b
         JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
         WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
         GROUP BY b.job_status ORDER BY b.job_status`,
        params
      ),
      queryAll<{ outcome: string; count: number | string }>(
        `SELECT COALESCE(i.outcome, 'pending') AS outcome, count(*)::int AS count
        FROM interviews i
        JOIN bids b ON b.b_id = i.b_id
        JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
         WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
         GROUP BY COALESCE(i.outcome, 'pending') ORDER BY outcome`,
        params
      ),
      queryAll<{
        manager_id: number;
        manager_name: string;
        bids: number | string;
        interviews: number | string;
      }>(
        `WITH scoped_managers AS (
           SELECT manager.u_id AS manager_id, manager.name AS manager_name
           FROM users manager
           WHERE manager.role = 'manager' ${scope.clause ? `AND ${scope.clause}` : ''}
         ), bid_counts AS (
           SELECT b.manager_user_id AS manager_id, count(*)::int AS bids
           FROM bids b
           WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}'
           GROUP BY b.manager_user_id
         ), interview_counts AS (
           SELECT b.manager_user_id AS manager_id, count(*)::int AS interviews
           FROM interviews i
           JOIN bids b ON b.b_id = i.b_id
           WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}'
           GROUP BY b.manager_user_id
         )
         SELECT m.manager_id, m.manager_name, COALESCE(b.bids, 0)::int AS bids,
                COALESCE(i.interviews, 0)::int AS interviews
         FROM scoped_managers m
         LEFT JOIN bid_counts b ON b.manager_id = m.manager_id
         LEFT JOIN interview_counts i ON i.manager_id = m.manager_id
         ORDER BY bids DESC, interviews DESC, m.manager_name ASC
         LIMIT 20`,
        params
      ),
      queryAll<{
        account_user_id: number;
        account_name: string;
        bids: number | string;
        interviews: number | string;
      }>(
        `WITH bid_counts AS (
           SELECT b.u_id AS account_user_id, count(*)::int AS bids
           FROM bids b
           JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
           WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
           GROUP BY b.u_id
         ), interview_counts AS (
           SELECT b.u_id AS account_user_id, count(*)::int AS interviews
           FROM interviews i
           JOIN bids b ON b.b_id = i.b_id
           JOIN users manager ON manager.u_id = b.manager_user_id AND manager.role = 'manager'
           WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
           GROUP BY b.u_id
         )
         SELECT account.u_id AS account_user_id, account.name AS account_name,
                COALESCE(b.bids, 0)::int AS bids, COALESCE(i.interviews, 0)::int AS interviews
         FROM users account
         LEFT JOIN bid_counts b ON b.account_user_id = account.u_id
         LEFT JOIN interview_counts i ON i.account_user_id = account.u_id
         WHERE account.role = 'account' AND (b.account_user_id IS NOT NULL OR i.account_user_id IS NOT NULL)
         ORDER BY bids DESC, interviews DESC, account.name ASC
         LIMIT 20`,
        params
      ),
    ]);

  const asCount = <T extends Record<string, unknown>>(rows: T[]) =>
    rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, key === 'count' || key === 'bids' || key === 'interviews'
        ? Number(value)
        : value])
    ));

  res.json({
    success: true,
    analytics: {
      period: parsedPeriod.data,
      bidsByPeriod: bidsByPeriod.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
      interviewsByPeriod: interviewsByPeriod.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
      bidsByStatus: asCount(bidsByStatus),
      interviewsByOutcome: asCount(interviewsByOutcome),
      byManager: asCount(byManager),
      byAccount: asCount(byAccount),
    },
  });
});

export default router;
