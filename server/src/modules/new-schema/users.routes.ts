import { randomUUID } from 'node:crypto';
import { raw, Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import type { UserRole } from '../../lib/roles';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireNewSchemaAuth);

const staffCreateSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(4).max(200),
  role: z.enum(['admin', 'manager', 'caller']),
});

const educationSchema = z.object({
  school: z.string().trim().min(1).max(300),
  qualification: z.string().trim().min(1).max(200),
  fieldOfStudy: z.string().trim().max(200).nullable(),
  startDate: z.string().date().nullable(),
  endDate: z.string().date().nullable(),
  description: z.string().trim().max(2000).nullable(),
});

const workExperienceSchema = z.object({
  employer: z.string().trim().min(1).max(300),
  jobTitle: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).nullable(),
  startDate: z.string().date().nullable(),
  endDate: z.string().date().nullable(),
  currentRole: z.boolean(),
  description: z.string().trim().max(3000).nullable(),
});

const accountCustomFieldSchema = z.object({
  fieldName: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(4000),
}).strict();

const accountApplicationProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  education: z.array(educationSchema).max(20).default([]),
  workExperience: z.array(workExperienceSchema).max(30).default([]),
  customFields: z.array(accountCustomFieldSchema).max(100).default([]),
});

const accountProfileSchema = accountApplicationProfileSchema.extend({
  email: z.string().email(),
  address: z.string().trim().min(1).max(500),
  sex: z.string().trim().min(1).max(50),
  birthday: z.string().date(),
  phone: z.string().trim().min(1).max(50),
  country: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  categoryId: z.number().int().positive(),
});

const staffUpdateSchema = z.object({
  username: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  temporaryPassword: z.string().min(4).max(200).optional(),
});

const accountUpdateSchema = accountProfileSchema.partial();

const staffColumns = `
  u_id, username, name, role, parent_user_id, (blocked_date IS NULL) AS is_active,
  blocked_date, must_change_password
`;
const accountColumns = `
  u.u_id, u.username, u.name, u.role, u.parent_user_id, u.email, u.address, u.sex,
  u.birthday, u.phone, u.country, u.city, u.category_id, u.blocked_date,
  app.first_name, app.last_name, app.education, app.work_experience, app.custom_fields,
  (app.resume_content IS NOT NULL) AS has_resume, app.resume_file_name
`;

function accountSelect(where: string): string {
  return `SELECT ${accountColumns}
          FROM users u
          LEFT JOIN account_application_profiles app ON app.account_user_id = u.u_id
          ${where}`;
}

const validResumeUpload = raw({ type: 'application/pdf', limit: '4mb' });

function canCreateRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'super') return targetRole === 'admin';
  if (actorRole === 'admin') return targetRole === 'manager' || targetRole === 'caller';
  return actorRole === 'manager' && targetRole === 'account';
}

function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'super') return targetRole === 'admin';
  if (actorRole === 'admin') return targetRole === 'manager' || targetRole === 'caller';
  return actorRole === 'manager' && targetRole === 'account';
}

async function getTarget(userId: number) {
  return queryOne<{ u_id: number; role: UserRole; parent_user_id: number | null }>(
    'SELECT u_id, role, parent_user_id FROM users WHERE u_id = $1',
    [userId]
  );
}

async function canManageTarget(
  actor: NewSchemaAuthRequest['newSchemaUser'],
  target: { role: UserRole; parent_user_id: number | null },
  operation: 'crud' | 'block'
): Promise<boolean> {
  if (!actor) return false;
  if (operation === 'block' && actor.role === 'super' &&
      (target.role === 'admin' || target.role === 'manager')) return true;
  return canManageRole(actor.role, target.role) && target.parent_user_id === actor.id;
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const actor = req.newSchemaUser!;
  const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
  let query: string;
  let params: unknown[];

  if (actor.role === 'super') {
    query = `SELECT ${staffColumns} FROM users WHERE role IN ('admin', 'manager')`;
    params = [];
  } else {
    query = `SELECT ${staffColumns} FROM users WHERE parent_user_id = $1`;
    params = [actor.id];
  }

  if (roleFilter) {
    query += ` AND role = $${params.length + 1}`;
    params.push(roleFilter);
  }
  query += ' ORDER BY name ASC, u_id ASC';
  const users = await queryAll(query, params);
  res.json({ success: true, users });
});

router.get('/callers', async (req: NewSchemaAuthRequest, res: Response) => {
  const actor = req.newSchemaUser!;
  if (actor.role !== 'manager' || !actor.parentUserId) {
    res.status(403).json({ success: false, message: 'Only Managers can list their assigned Callers.' });
    return;
  }
  const callers = await queryAll(
    `SELECT u_id, username, name, role
     FROM users
     WHERE role = 'caller' AND parent_user_id = $1 AND blocked_date IS NULL
     ORDER BY name ASC`,
    [actor.parentUserId]
  );
  res.json({ success: true, callers });
});

router.get('/accounts', async (req: NewSchemaAuthRequest, res: Response) => {
  const actor = req.newSchemaUser!;
  if (actor.role !== 'super' && actor.role !== 'admin' && actor.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Manager access required.' });
    return;
  }
  const query = actor.role === 'super'
    ? accountSelect(`WHERE u.role = 'account' ORDER BY u.name ASC`)
    : actor.role === 'admin'
      ? accountSelect(`WHERE u.role = 'account' AND u.parent_user_id IN (
           SELECT u_id FROM users WHERE role = 'manager' AND parent_user_id = $1
         )
         ORDER BY u.name ASC`)
      : accountSelect(`WHERE u.role = 'account' AND u.parent_user_id = $1 ORDER BY u.name ASC`);
  const accounts = await queryAll(query, actor.role === 'super' ? [] : [actor.id]);
  res.json({ success: true, accounts });
});

router.post('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const actor = req.newSchemaUser!;
  const role = req.body?.role as UserRole | undefined;
  if (!role || !canCreateRole(actor.role, role)) {
    res.status(403).json({ success: false, message: 'You cannot create this account role.' });
    return;
  }

  if (role === 'account') {
    const parsed = accountProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Complete all required Account profile fields.' });
      return;
    }
    const data = parsed.data;
    const category = await queryOne<{ category_id: number }>(
      'SELECT category_id FROM categories WHERE category_id = $1',
      [data.categoryId]
    );
    if (!category) {
      res.status(400).json({ success: false, message: 'Select an existing category.' });
      return;
    }
    const username = `account-${randomUUID()}`;
    const row = await withTransaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO users (
          username, name, role, password_hash, parent_user_id,
          email, address, sex, birthday, phone, country, city, category_id
        ) VALUES ($1, $2, 'account', NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING u_id`,
        [
          username, `${data.firstName} ${data.lastName}`, actor.id, data.email, data.address, data.sex,
          data.birthday, data.phone, data.country, data.city, data.categoryId,
        ]
      );
      const created = result.rows[0] as { u_id: number };
      await tx.query(
        `INSERT INTO account_application_profiles (
          account_user_id, first_name, last_name, education, work_experience, custom_fields
        ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
        [
          created.u_id, data.firstName, data.lastName,
          JSON.stringify(data.education), JSON.stringify(data.workExperience),
          JSON.stringify(data.customFields),
        ]
      );
      return created;
    });
    const account = await queryOne(accountSelect('WHERE u.u_id = $1'), [row.u_id]);
    logger.info('New-schema Account profile created', { id: row.u_id, managerId: actor.id });
    res.status(201).json({ success: true, account });
    return;
  }

  const parsed = staffCreateSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.role !== role) {
    res.status(400).json({ success: false, message: 'Enter a username and temporary password of at least 4 characters.' });
    return;
  }
  const data = parsed.data;
  const duplicate = await queryOne<{ u_id: number }>(
    'SELECT u_id FROM users WHERE username = $1',
    [data.username]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'That username is already in use.' });
    return;
  }
  const passwordHash = await bcrypt.hash(data.password, 12);
  const row = await queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, must_change_password, parent_user_id)
     VALUES ($1, $2, $3, $4, FALSE, $5)
     RETURNING u_id`,
    [data.username, data.username, data.role, passwordHash, actor.id]
  );
  const user = await queryOne(
    `SELECT ${staffColumns} FROM users WHERE u_id = $1`,
    [row!.u_id]
  );
  logger.info('New-schema user created', { id: row!.u_id, role, parentUserId: actor.id });
  res.status(201).json({ success: true, user });
});

router.put('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid user ID.' });
    return;
  }
  const target = await getTarget(userId);
  if (!target || !(await canManageTarget(req.newSchemaUser, target, 'crud'))) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }

  if (target.role === 'account') {
    const parsed = accountUpdateSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ success: false, message: 'Provide valid Account profile fields to update.' });
      return;
    }
    const data = parsed.data;
    const assignments: string[] = [];
    const values: unknown[] = [];
    const columns: Record<string, string> = {
      email: 'email',
      address: 'address',
      sex: 'sex',
      birthday: 'birthday',
      phone: 'phone',
      country: 'country',
      city: 'city',
      categoryId: 'category_id',
    };
    for (const [key, column] of Object.entries(columns) as Array<[keyof typeof data, string]>) {
      const value = data[key];
      if (value !== undefined) {
        assignments.push(`${column} = $${values.length + 1}`);
        values.push(value);
      }
    }
    if (data.categoryId !== undefined) {
      const category = await queryOne<{ category_id: number }>(
        'SELECT category_id FROM categories WHERE category_id = $1',
        [data.categoryId]
      );
      if (!category) {
        res.status(400).json({ success: false, message: 'Select an existing category.' });
        return;
      }
    }
    const currentProfile = await queryOne<{
      first_name: string; last_name: string; education: unknown; work_experience: unknown; custom_fields: unknown;
    }>(
      'SELECT first_name, last_name, education, work_experience, custom_fields FROM account_application_profiles WHERE account_user_id = $1',
      [userId]
    );
    const firstName = data.firstName ?? currentProfile?.first_name;
    const lastName = data.lastName ?? currentProfile?.last_name;
    if (!firstName || !lastName) {
      res.status(400).json({ success: false, message: 'Enter the Account’s first and last names.' });
      return;
    }
    await withTransaction(async (tx) => {
      if (data.firstName !== undefined || data.lastName !== undefined) {
        assignments.push(`name = $${values.length + 1}`);
        values.push(`${firstName} ${lastName}`);
      }
      if (assignments.length) {
        values.push(userId);
        await tx.query(`UPDATE users SET ${assignments.join(', ')} WHERE u_id = $${values.length}`, values);
      }
      await tx.query(
        `INSERT INTO account_application_profiles (
          account_user_id, first_name, last_name, education, work_experience, custom_fields
        ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
        ON CONFLICT (account_user_id) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          education = EXCLUDED.education,
          work_experience = EXCLUDED.work_experience,
          custom_fields = EXCLUDED.custom_fields,
          updated_date = NOW()`,
        [
          userId, firstName, lastName,
          JSON.stringify(data.education ?? currentProfile?.education ?? []),
          JSON.stringify(data.workExperience ?? currentProfile?.work_experience ?? []),
          JSON.stringify(data.customFields ?? currentProfile?.custom_fields ?? []),
        ]
      );
    });
    const account = await queryOne(accountSelect('WHERE u.u_id = $1'), [userId]);
    res.json({ success: true, account });
    return;
  }

  const parsed = staffUpdateSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ success: false, message: 'Provide a valid username, name, or temporary password.' });
    return;
  }
  const data = parsed.data;
  if (data.username) {
    const duplicate = await queryOne<{ u_id: number }>(
      'SELECT u_id FROM users WHERE username = $1 AND u_id <> $2',
      [data.username, userId]
    );
    if (duplicate) {
      res.status(409).json({ success: false, message: 'That username is already in use.' });
      return;
    }
  }
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (data.username !== undefined) {
    assignments.push(`username = $${values.length + 1}`);
    values.push(data.username);
  }
  if (data.name !== undefined) {
    assignments.push(`name = $${values.length + 1}`);
    values.push(data.name);
  }
  if (data.temporaryPassword) {
    assignments.push(`password_hash = $${values.length + 1}`);
    values.push(await bcrypt.hash(data.temporaryPassword, 12));
    assignments.push('must_change_password = FALSE');
  }
  values.push(userId);
  await execute(`UPDATE users SET ${assignments.join(', ')} WHERE u_id = $${values.length}`, values);
  const user = await queryOne(`SELECT ${staffColumns} FROM users WHERE u_id = $1`, [userId]);
  res.json({ success: true, user });
});

async function canManageAccountApplicationProfile(
  req: NewSchemaAuthRequest,
  accountId: number
): Promise<boolean> {
  const actor = req.newSchemaUser!;
  if (actor.role !== 'manager' && actor.role !== 'super') return false;
  const account = await queryOne<{ parent_user_id: number }>(
    "SELECT parent_user_id FROM users WHERE u_id = $1 AND role = 'account'",
    [accountId]
  );
  if (!account) return false;
  return actor.role === 'super' || account.parent_user_id === actor.id;
}

router.put('/:id/resume', validResumeUpload, async (req: NewSchemaAuthRequest, res: Response) => {
  const accountId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !(await canManageAccountApplicationProfile(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account profile not found.' });
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !req.body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    res.status(400).json({ success: false, message: 'Upload a valid PDF resume (maximum 4 MB).' });
    return;
  }
  const encodedFileName = String(req.headers['x-resume-filename'] || 'resume.pdf');
  let rawFileName: string;
  try {
    rawFileName = decodeURIComponent(encodedFileName);
  } catch {
    res.status(400).json({ success: false, message: 'Provide a valid resume filename.' });
    return;
  }
  const fileName = rawFileName.replace(/[\/\\\r\n"]/g, '_').trim().slice(0, 200) || 'resume.pdf';
  await execute(
    `UPDATE account_application_profiles
     SET resume_file_name = $1, resume_content = $2, updated_date = NOW()
     WHERE account_user_id = $3`,
    [fileName, req.body, accountId]
  );
  res.json({ success: true, fileName });
});

router.get('/:id/resume', async (req: NewSchemaAuthRequest, res: Response) => {
  const accountId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !(await canManageAccountApplicationProfile(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account profile not found.' });
    return;
  }
  const resume = await queryOne<{ resume_file_name: string; resume_content: Buffer }>(
    `SELECT app.resume_file_name, app.resume_content
     FROM account_application_profiles app
     WHERE app.account_user_id = $1 AND app.resume_content IS NOT NULL`,
    [accountId]
  );
  if (!resume) {
    res.status(404).json({ success: false, message: 'No resume is saved for this Account.' });
    return;
  }
  const safeFileName = resume.resume_file_name.replace(/[\/\\\r\n"]/g, '_');
  const asciiFileName = safeFileName.replace(/[^\x20-\x7E]/g, '_');
  const encodedFileName = encodeURIComponent(safeFileName).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`
  );
  res.send(resume.resume_content);
});

router.delete('/:id/resume', async (req: NewSchemaAuthRequest, res: Response) => {
  const accountId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !(await canManageAccountApplicationProfile(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account profile not found.' });
    return;
  }
  await execute(
    `UPDATE account_application_profiles
     SET resume_file_name = NULL, resume_content = NULL, updated_date = NOW()
     WHERE account_user_id = $1`,
    [accountId]
  );
  res.json({ success: true });
});

router.patch('/:id/block', async (req: NewSchemaAuthRequest, res: Response) => {
  const userId = Number.parseInt(req.params.id, 10);
  const parsed = z.object({ blocked: z.boolean() }).safeParse(req.body);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid user ID and blocked value.' });
    return;
  }
  const target = await getTarget(userId);
  if (!target || !(await canManageTarget(req.newSchemaUser, target, 'block'))) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }
  if (target.role !== 'admin' && target.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Admin or Manager accounts can be blocked.' });
    return;
  }
  await execute(
    'UPDATE users SET blocked_date = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE u_id = $2',
    [parsed.data.blocked, userId]
  );
  res.json({ success: true, blocked: parsed.data.blocked });
});

router.delete('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid user ID.' });
    return;
  }
  const target = await getTarget(userId);
  if (!target || !(await canManageTarget(req.newSchemaUser, target, 'crud'))) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }

  const children = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM users WHERE parent_user_id = $1',
    [userId]
  );
  if (Number(children?.count ?? 0) > 0) {
    res.status(409).json({ success: false, message: 'Reassign or delete this user’s child profiles before deleting the user.' });
    return;
  }
  if (target.role === 'account') {
    const assignedJobs = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM job_account_assignments WHERE account_user_id = $1',
      [userId]
    );
    if (Number(assignedJobs?.count ?? 0) > 0) {
      res.status(409).json({ success: false, message: 'Remove this Account from its todo job rows before deleting it. Non-todo job rows are retained as history.' });
      return;
    }
    const bids = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM bids WHERE u_id = $1',
      [userId]
    );
    if (Number(bids?.count ?? 0) > 0) {
      res.status(409).json({ success: false, message: 'This Account has bid history and cannot be deleted.' });
      return;
    }
  } else if (target.role === 'manager') {
    const jobs = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM job_list WHERE u_id = $1',
      [userId]
    );
    if (Number(jobs?.count ?? 0) > 0) {
      res.status(409).json({ success: false, message: 'This Manager owns jobs and cannot be deleted.' });
      return;
    }
    const bids = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM bids WHERE manager_user_id = $1',
      [userId]
    );
    if (Number(bids?.count ?? 0) > 0) {
      res.status(409).json({ success: false, message: 'This Manager has bid history and cannot be deleted.' });
      return;
    }
  } else if (target.role === 'caller') {
    const interviews = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM interviews WHERE caller_user_id = $1',
      [userId]
    );
    if (Number(interviews?.count ?? 0) > 0) {
      res.status(409).json({ success: false, message: 'This Caller has assigned interviews and cannot be deleted.' });
      return;
    }
  }

  await execute('DELETE FROM users WHERE u_id = $1', [userId]);
  logger.info('New-schema user deleted', { id: userId, role: target.role });
  res.json({ success: true, message: 'User deleted.' });
});

export default router;
