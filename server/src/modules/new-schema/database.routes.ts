import { NextFunction, Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
  requireNewSchemaPasswordChanged,
} from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth, requireNewSchemaPasswordChanged);

const TABLES = {
  categories: {
    label: 'Categories',
    description: 'Job categories used by Manager job listings.',
    columns: ['category_id', 'category_title', 'created_date'],
    searchColumns: ['category_title'],
    orderBy: 'category_id',
  },
  users: {
    label: 'New-schema users',
    description: 'Super, Admin, Manager, Caller, and Account profiles. Password hashes are excluded.',
    columns: [
      'u_id', 'username', 'name', 'role', 'must_change_password', 'parent_user_id',
      'email', 'address', 'sex', 'birthday', 'phone', 'country', 'city',
      'blocked_date', 'category_id',
    ],
    searchColumns: ['username', 'name', 'role', 'email', 'phone', 'city'],
    orderBy: 'u_id',
  },
  job_list: {
    label: 'Jobs (new schema)',
    description: 'Manager-owned job listings and their Account selections.',
    columns: [
      'j_id', 'u_id', 'url', 'company', 'title', 'category_ids',
      'selected_account_u_ids', 'status', 'get_date',
    ],
    searchColumns: ['url', 'company', 'title', 'status'],
    orderBy: 'j_id',
  },
  bids: {
    label: 'Bids',
    description: 'Account applications recorded against Manager job listings.',
    columns: ['b_id', 'u_id', 'j_id', 'resume_path', 'applied_date'],
    searchColumns: ['resume_path'],
    orderBy: 'b_id',
  },
  interviews: {
    label: 'Interviews (new schema)',
    description: 'Interview schedule, assignment, status, outcome, and comments.',
    columns: [
      'i_id', 'b_id', 'interview_time', 'interview_date', 'caller_user_id',
      'interviewer', 'step', 'status', 'outcome', 'created_date', 'comment',
    ],
    searchColumns: ['interviewer', 'step', 'status', 'outcome', 'comment'],
    orderBy: 'i_id',
  },
  accounts: {
    label: 'Legacy accounts',
    description: 'Legacy account/team records. Private credentials are not shown.',
    columns: ['id', 'name', 'notes', 'is_active', 'manager_id', 'custom_gpt_url', 'created_at', 'updated_at'],
    searchColumns: ['name', 'notes'],
    orderBy: 'id',
  },
  admins: {
    label: 'Legacy staff accounts',
    description: 'Legacy staff account metadata. Password hashes are excluded.',
    columns: ['id', 'username', 'role', 'account_id', 'is_active', 'created_at', 'updated_at'],
    searchColumns: ['username', 'role'],
    orderBy: 'id',
  },
  candidates: {
    label: 'Legacy candidates',
    description: 'Legacy candidate profiles. Saved answers and application session data are not included.',
    columns: ['id', 'name', 'email', 'phone', 'linkedin_url', 'notes', 'color', 'stack', 'is_active', 'account_id', 'created_at', 'updated_at'],
    searchColumns: ['name', 'email', 'phone', 'stack'],
    orderBy: 'id',
  },
  jobs: {
    label: 'Legacy jobs',
    description: 'Legacy job postings.',
    columns: ['id', 'title', 'company', 'url', 'source', 'created_at', 'updated_at'],
    searchColumns: ['title', 'company', 'url', 'source'],
    orderBy: 'id',
  },
  candidate_jobs: {
    label: 'Legacy candidate applications',
    description: 'Links between legacy candidates and job postings.',
    columns: ['id', 'candidate_id', 'job_id', 'status', 'applied_at', 'created_at', 'updated_at'],
    searchColumns: ['status'],
    orderBy: 'id',
  },
  interview_processes: {
    label: 'Legacy interview processes',
    description: 'Legacy interview schedule and result records.',
    columns: [
      'id', 'candidate_id', 'candidate_name', 'caller_user_id', 'account_id',
      'scheduled_date', 'attend_date', 'interview_time', 'timezone', 'position',
      'company', 'job_url', 'resume', 'meeting_url', 'salary', 'stage',
      'created_by_user_id', 'created_at', 'updated_at',
    ],
    searchColumns: ['candidate_name', 'company', 'position', 'stage'],
    orderBy: 'id',
  },
} as const;

type TableName = keyof typeof TABLES;

function isTableName(value: string): value is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, value);
}

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super users can browse database tables.' });
  return false;
}

const ListSchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
});

router.get('/tables', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  try {
    const tables = await Promise.all(
      (Object.keys(TABLES) as TableName[]).map(async (key) => {
        const definition = TABLES[key];
        const result = await queryOne<{ count: number | string }>(
          `SELECT count(*)::int AS count FROM "${key}"`
        );
        return {
          id: key,
          label: definition.label,
          description: definition.description,
          count: Number(result?.count ?? 0),
        };
      })
    );
    res.json({ success: true, tables });
  } catch (error) {
    next(error);
  }
});

router.get('/tables/:table', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for browsing.' });
    return;
  }
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Search text or pagination values are invalid.' });
    return;
  }

  const { q, limit, offset } = parsed.data;
  const definition = TABLES[req.params.table];
  try {
    const searchCondition = q
      ? `WHERE ${definition.searchColumns
        .map((column) => `position(lower($1) in lower(COALESCE("${column}"::text, ''))) > 0`)
        .join(' OR ')}`
      : '';
    const params = q ? [q] : [];
    const count = await queryOne<{ count: number | string }>(
      `SELECT count(*)::int AS count FROM "${req.params.table}" ${searchCondition}`,
      params
    );
    const records = await queryAll<Record<string, unknown>>(
      `SELECT ${definition.columns.map((column) => `"${column}"`).join(', ')}
       FROM "${req.params.table}" ${searchCondition}
       ORDER BY "${definition.orderBy}" DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      table: {
        id: req.params.table,
        label: definition.label,
        description: definition.description,
        columns: definition.columns,
      },
      records,
      total: Number(count?.count ?? 0),
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
