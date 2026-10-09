import { NextFunction, Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { execute, queryAll, queryOne } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

type FieldType = 'text' | 'password' | 'integer' | 'boolean' | 'date' | 'datetime'
  | 'time' | 'url' | 'integer-array' | 'enum';

interface FieldDefinition {
  type: FieldType;
  nullable?: boolean;
  required?: boolean;
  options?: readonly string[];
  maxLength?: number;
}

const TABLES = {
  categories: {
    label: 'Categories',
    description: 'Job categories used by Manager job listings.',
    columns: ['category_id', 'category_title', 'created_date'],
    searchColumns: ['category_title'],
    orderBy: 'category_id',
    primaryKey: 'category_id',
    fields: {
      category_title: { type: 'text', required: true, maxLength: 200 },
      created_date: { type: 'datetime' },
    },
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
    primaryKey: 'u_id',
    fields: {
      username: { type: 'text', required: true, maxLength: 100 },
      name: { type: 'text', required: true, maxLength: 200 },
      role: { type: 'enum', required: true, options: ['super', 'admin', 'manager', 'caller', 'account'] },
      password: { type: 'password', maxLength: 200 },
      must_change_password: { type: 'boolean' },
      parent_user_id: { type: 'integer', nullable: true, required: true },
      email: { type: 'text', nullable: true, maxLength: 320 },
      address: { type: 'text', nullable: true, maxLength: 500 },
      sex: { type: 'text', nullable: true, maxLength: 50 },
      birthday: { type: 'date', nullable: true },
      phone: { type: 'text', nullable: true, maxLength: 50 },
      country: { type: 'text', nullable: true, maxLength: 100 },
      city: { type: 'text', nullable: true, maxLength: 100 },
      blocked_date: { type: 'datetime', nullable: true },
      category_id: { type: 'integer', nullable: true },
    },
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
    primaryKey: 'j_id',
    fields: {
      u_id: { type: 'integer', required: true },
      url: { type: 'url', required: true, maxLength: 2000 },
      company: { type: 'text', required: true, maxLength: 300 },
      title: { type: 'text', required: true, maxLength: 300 },
      category_ids: { type: 'integer-array' },
      selected_account_u_ids: { type: 'integer-array' },
      status: { type: 'enum', required: true, options: ['processing', 'todo', 'did', 'failed'] },
      get_date: { type: 'datetime' },
    },
  },
  bids: {
    label: 'Bids',
    description: 'Durable Account applications with job details retained independently of the job list.',
    columns: [
      'b_id', 'u_id', 'j_id', 'manager_user_id', 'job_title', 'company',
      'job_url', 'job_status', 'resume_path', 'applied_date',
    ],
    searchColumns: ['job_title', 'company', 'job_url', 'job_status', 'resume_path'],
    orderBy: 'b_id',
    primaryKey: 'b_id',
    fields: {
      u_id: { type: 'integer', required: true },
      j_id: { type: 'integer', required: true },
      manager_user_id: { type: 'integer', required: true },
      job_title: { type: 'text', required: true, maxLength: 300 },
      company: { type: 'text', required: true, maxLength: 300 },
      job_url: { type: 'url', required: true, maxLength: 2000 },
      job_status: { type: 'enum', required: true, options: ['processing', 'todo', 'did', 'failed'] },
      resume_path: { type: 'text', required: true, maxLength: 2000 },
      applied_date: { type: 'datetime' },
    },
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
    primaryKey: 'i_id',
    fields: {
      b_id: { type: 'integer', required: true },
      interview_time: { type: 'time', required: true },
      interview_date: { type: 'date', required: true },
      caller_user_id: { type: 'integer', required: true },
      interviewer: { type: 'text', required: true, maxLength: 200 },
      step: { type: 'enum', required: true, options: ['intro', 'tech-1', 'tech-2', 'final'] },
      status: { type: 'enum', required: true, options: ['todo', 'did', 'failed', 'respond_waiting'] },
      outcome: { type: 'enum', nullable: true, options: ['good', 'bad', 'normal'] },
      created_date: { type: 'datetime' },
      comment: { type: 'text', nullable: true, maxLength: 5000 },
    },
  },
  app_settings: {
    label: 'Application settings',
    description: 'Application-wide settings.',
    columns: ['setting_name', 'setting_value', 'updated_by', 'created_date', 'updated_date'],
    searchColumns: ['setting_name', 'setting_value'],
    orderBy: 'setting_name',
    primaryKey: 'setting_name',
    fields: {
      setting_name: { type: 'text', required: true, maxLength: 200 },
      setting_value: { type: 'text', required: true, maxLength: 10000 },
      updated_by: { type: 'integer', nullable: true },
      created_date: { type: 'datetime' },
      updated_date: { type: 'datetime' },
    },
  },
} as const;

type TableName = keyof typeof TABLES;

function isTableName(value: string): value is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, value);
}

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super users can manage database records.' });
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFieldValue(
  name: string,
  definition: FieldDefinition,
  value: unknown
): { success: true; value: unknown } | { success: false; message: string } {
  if ((value === null || value === '') && definition.nullable) {
    return { success: true, value: null };
  }
  if (definition.type === 'password') {
    if (typeof value !== 'string' || value.length > (definition.maxLength ?? 200)) {
      return { success: false, message: `${name} must be a valid password.` };
    }
    return { success: true, value };
  }
  if (value === null || value === undefined || value === '') {
    return { success: false, message: `${name} is required.` };
  }
  if (definition.type === 'text') {
    if (typeof value !== 'string' || value.length > (definition.maxLength ?? 5000)) {
      return { success: false, message: `${name} must be text of at most ${definition.maxLength ?? 5000} characters.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.options?.includes(value)) {
      return { success: false, message: `${name} has an unsupported value.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'integer') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { success: false, message: `${name} must be a positive integer.` };
    }
    return { success: true, value: parsed };
  }
  if (definition.type === 'integer-array') {
    if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || Number(item) <= 0)) {
      return { success: false, message: `${name} must be an array of positive integers.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') return { success: false, message: `${name} must be true or false.` };
    return { success: true, value };
  }
  if (definition.type === 'url') {
    const parsed = z.string().url().max(definition.maxLength ?? 2000).safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid URL.` };
  }
  if (definition.type === 'date') {
    const parsed = z.string().date().safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid date.` };
  }
  if (definition.type === 'time') {
    const parsed = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid time.` };
  }
  if (definition.type === 'datetime') {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      return { success: false, message: `${name} must be a valid date and time.` };
    }
    return { success: true, value };
  }
  return { success: false, message: `${name} has an unsupported field type.` };
}

function parseRecord(
  table: TableName,
  value: unknown,
  creating: boolean
): { success: true; values: Record<string, unknown> } | { success: false; message: string } {
  if (!isRecord(value)) return { success: false, message: 'Provide a record object.' };
  const fields = TABLES[table].fields as Record<string, FieldDefinition>;
  const unknownField = Object.keys(value).find((name) => !Object.prototype.hasOwnProperty.call(fields, name));
  if (unknownField) return { success: false, message: `Field ${unknownField} cannot be changed.` };

  const values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      if (creating && field.required) {
        if (table === 'users' && name === 'username' && value.role === 'account') continue;
        if (table === 'users' && name === 'parent_user_id' && value.role === 'super') continue;
        return { success: false, message: `${name} is required.` };
      }
      continue;
    }
    if (
      creating
      && table === 'users'
      && name === 'username'
      && value.role === 'account'
      && value[name] === ''
    ) continue;
    if (table === 'users' && name === 'password' && value[name] === '' && !creating) continue;
    if (value[name] === '' && !field.required && !field.nullable && field.type !== 'password') continue;
    const parsed = parseFieldValue(name, field, value[name]);
    if (!parsed.success) {
      if (name === 'password' && creating && parsed.message.endsWith('is required.')) continue;
      return parsed;
    }
    values[name] = parsed.value;
  }

  if (table === 'users') {
    const role = values.role;
    const effectiveRole = role ?? (creating ? null : undefined);
    if (effectiveRole === 'super') {
      values.parent_user_id = null;
      values.category_id = null;
      values.password = values.password || undefined;
    } else if (effectiveRole === 'account') {
      values.password = null;
      values.must_change_password = false;
    } else if (effectiveRole) {
      values.category_id = null;
      if (creating && (typeof values.password !== 'string' || values.password.length < 4)) {
        return { success: false, message: 'A staff password must contain at least 4 characters.' };
      }
    }
    if (creating && effectiveRole === 'account') {
      const requiredAccountFields = ['parent_user_id', 'email', 'address', 'sex', 'birthday', 'phone', 'country', 'city', 'category_id'];
      const missing = requiredAccountFields.find((name) => values[name] === undefined || values[name] === null);
      if (missing) return { success: false, message: `${missing} is required for an Account profile.` };
    }
    if (creating && effectiveRole === 'super' &&
        (typeof values.password !== 'string' || values.password.length < 4)) {
      return { success: false, message: 'A Super user password must contain at least 4 characters.' };
    }
    if (creating && effectiveRole !== 'super' && effectiveRole !== 'account' &&
        (values.parent_user_id === undefined || values.parent_user_id === null)) {
      return { success: false, message: 'parent_user_id is required for staff users.' };
    }
  }
  if (table === 'app_settings' && creating) {
    values.updated_by ??= null;
  }
  return { success: true, values };
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
        primaryKey: definition.primaryKey,
        fields: Object.entries(definition.fields).map(([name, field]) => ({
          name,
          ...field,
        })),
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

router.post('/tables/:table', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const parsed = parseRecord(table, req.body, true);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.message });
    return;
  }
  try {
    const values = { ...parsed.values };
    if (table === 'users') {
      if (values.role === 'account' && !values.username) values.username = `account-${randomUUID()}`;
      values.password_hash = typeof values.password === 'string'
        ? await bcrypt.hash(values.password, 12)
        : null;
      delete values.password;
    }
    if (table === 'app_settings') values.updated_by = req.newSchemaUser!.id;

    const columns = Object.keys(values);
    const placeholders = columns.map((_column, index) => `$${index + 1}`);
    const returnColumns = TABLES[table].columns.map((column) => `"${column}"`).join(', ');
    const record = await queryOne(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING ${returnColumns}`,
      columns.map((column) => values[column])
    );
    res.status(201).json({ success: true, record });
  } catch (error) {
    next(error);
  }
});

router.put('/tables/:table/:id', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const definition = TABLES[table];
  const recordId = table === 'app_settings' ? req.params.id : Number(req.params.id);
  if (table !== 'app_settings' && (!Number.isSafeInteger(recordId) || Number(recordId) <= 0)) {
    res.status(400).json({ success: false, message: 'Invalid record ID.' });
    return;
  }
  const parsed = parseRecord(table, req.body, false);
  if (!parsed.success || Object.keys(parsed.values).length === 0) {
    res.status(400).json({
      success: false,
      message: parsed.success ? 'Provide at least one field to update.' : parsed.message,
    });
    return;
  }
  try {
    const values = { ...parsed.values };
    if (table === 'users') {
      const current = values.role
        ? await queryOne<{ role: string }>('SELECT role FROM users WHERE u_id = $1', [recordId])
        : undefined;
      if (current?.role === 'super' && values.role !== 'super') {
        if (Number(recordId) === req.newSchemaUser!.id) {
          res.status(400).json({ success: false, message: 'You cannot change the role of the Super account you are using.' });
          return;
        }
        const count = await queryOne<{ count: number | string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'super'"
        );
        if (Number(count?.count ?? 0) <= 1) {
          res.status(400).json({ success: false, message: 'The last Super account cannot be demoted.' });
          return;
        }
      }
      if (values.role === 'account') {
        values.password_hash = null;
        values.must_change_password = false;
      } else if (typeof values.password === 'string' && values.password.length > 0) {
        if (values.password.length < 4) {
          res.status(400).json({ success: false, message: 'A password must contain at least 4 characters.' });
          return;
        }
        values.password_hash = await bcrypt.hash(values.password, 12);
      } else if (values.role && values.role !== 'account') {
        if (current?.role === 'account') {
          res.status(400).json({ success: false, message: 'Enter a password when changing an Account profile to a staff role.' });
          return;
        }
      }
      delete values.password;
    }
    if (table === 'app_settings') {
      values.updated_by = req.newSchemaUser!.id;
      values.updated_date = new Date().toISOString();
    }

    const columns = Object.keys(values);
    const params = columns.map((column) => values[column]);
    params.push(recordId);
    const assignments = columns.map((column, index) => `"${column}" = $${index + 1}`);
    const returnColumns = definition.columns.map((column) => `"${column}"`).join(', ');
    const record = await queryOne(
      `UPDATE "${table}" SET ${assignments.join(', ')}
       WHERE "${definition.primaryKey}" = $${params.length}
       RETURNING ${returnColumns}`,
      params
    );
    if (!record) {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
    res.json({ success: true, record });
  } catch (error) {
    next(error);
  }
});

router.delete('/tables/:table/:id', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const definition = TABLES[table];
  const recordId = table === 'app_settings' ? req.params.id : Number(req.params.id);
  if (table !== 'app_settings' && (!Number.isSafeInteger(recordId) || Number(recordId) <= 0)) {
    res.status(400).json({ success: false, message: 'Invalid record ID.' });
    return;
  }
  if (table === 'users' && Number(recordId) === req.newSchemaUser!.id) {
    res.status(400).json({ success: false, message: 'You cannot delete the Super account you are using.' });
    return;
  }

  try {
    if (table === 'users') {
      const target = await queryOne<{ role: string }>(
        'SELECT role FROM users WHERE u_id = $1',
        [recordId]
      );
      if (target?.role === 'super') {
        const count = await queryOne<{ count: number | string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'super'"
        );
        if (Number(count?.count ?? 0) <= 1) {
          res.status(400).json({ success: false, message: 'The last Super account cannot be deleted.' });
          return;
        }
      }
    }
    const result = await execute(
      `DELETE FROM "${table}" WHERE "${definition.primaryKey}" = $1`,
      [recordId]
    );
    if (!result.rowCount) {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
    res.json({ success: true, message: 'Record deleted.' });
  } catch (error) {
    next(error);
  }
});

export default router;
