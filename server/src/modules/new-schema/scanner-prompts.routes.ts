import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import {
  BUILT_IN_SCANNER_PROMPT,
  SCANNER_DEFAULT_PROMPT_SETTING,
} from './scanner-prompt-default';

const router = Router();
router.use(requireNewSchemaAuth);

const PromptSchema = z.object({
  name: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000),
}).strict();

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super can manage Scanner prompts.' });
  return false;
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const [prompts, managers, assignments, defaultPromptSetting] = await Promise.all([
    queryAll(
      `SELECT prompt_id AS id, prompt_name AS name, prompt_content AS content,
              created_date AS "createdDate", updated_date AS "updatedDate"
       FROM prompts
       ORDER BY prompt_name ASC, prompt_id ASC`
    ),
    queryAll(
      `SELECT u_id AS id, name, username
       FROM users
       WHERE role = 'manager'
       ORDER BY name ASC, u_id ASC`
    ),
    queryAll(
      `SELECT assignment.manager_user_id AS "managerId",
              assignment.prompt_id AS "promptId",
              assignment.assigned_date AS "assignedDate"
       FROM manager_scanner_prompt_assignments assignment
       JOIN users manager ON manager.u_id = assignment.manager_user_id
       WHERE manager.role = 'manager'
       ORDER BY manager.name ASC, manager.u_id ASC`
    ),
    queryOne<{ setting_value: string }>(
      'SELECT setting_value FROM app_settings WHERE setting_name = $1',
      [SCANNER_DEFAULT_PROMPT_SETTING]
    ),
  ]);
  res.json({
    success: true,
    prompts,
    managers,
    assignments,
    defaultPrompt: defaultPromptSetting?.setting_value || BUILT_IN_SCANNER_PROMPT,
  });
});

router.get('/assigned', async (req: NewSchemaAuthRequest, res: Response) => {
  if (req.newSchemaUser?.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can load their Scanner prompt.' });
    return;
  }
  const prompt = await queryOne(
    `SELECT prompt.prompt_id AS id, prompt.prompt_name AS name,
            prompt.prompt_content AS content
     FROM manager_scanner_prompt_assignments assignment
     JOIN prompts prompt ON prompt.prompt_id = assignment.prompt_id
     WHERE assignment.manager_user_id = $1`,
    [req.newSchemaUser.id]
  );
  res.json({ success: true, prompt: prompt || null });
});

router.post('/', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const parsed = PromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Enter a prompt name and prompt content (up to 50,000 characters).' });
    return;
  }
  const duplicate = await queryOne<{ prompt_id: number }>(
    'SELECT prompt_id FROM prompts WHERE lower(prompt_name) = lower($1)',
    [parsed.data.name]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'A prompt with that name already exists.' });
    return;
  }
  const prompt = await queryOne(
    `INSERT INTO prompts (prompt_name, prompt_content, created_by, updated_by)
     VALUES ($1, $2, $3, $3)
     RETURNING prompt_id AS id, prompt_name AS name, prompt_content AS content,
               created_date AS "createdDate", updated_date AS "updatedDate"`,
    [parsed.data.name, parsed.data.content, req.newSchemaUser!.id]
  );
  res.status(201).json({ success: true, prompt });
});

router.put('/default', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const parsed = z.object({
    content: z.string().trim().min(1).max(50000),
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Enter default Scanner instructions (up to 50,000 characters).',
    });
    return;
  }
  const saved = await queryOne<{ setting_value: string }>(
    `INSERT INTO app_settings (setting_name, setting_value, updated_by, updated_date)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (setting_name) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         updated_by = EXCLUDED.updated_by,
         updated_date = NOW()
     RETURNING setting_value`,
    [SCANNER_DEFAULT_PROMPT_SETTING, parsed.data.content, req.newSchemaUser!.id]
  );
  if (!saved) {
    res.status(500).json({ success: false, message: 'Could not save the default Scanner instructions.' });
    return;
  }
  res.json({ success: true, defaultPrompt: saved.setting_value });
});

router.put('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const promptId = Number.parseInt(req.params.id, 10);
  const parsed = PromptSchema.safeParse(req.body);
  if (!Number.isSafeInteger(promptId) || promptId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid prompt ID, name, and content.' });
    return;
  }
  const duplicate = await queryOne<{ prompt_id: number }>(
    'SELECT prompt_id FROM prompts WHERE lower(prompt_name) = lower($1) AND prompt_id <> $2',
    [parsed.data.name, promptId]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'A prompt with that name already exists.' });
    return;
  }
  const prompt = await queryOne(
    `UPDATE prompts
     SET prompt_name = $1, prompt_content = $2, updated_by = $3, updated_date = NOW()
     WHERE prompt_id = $4
     RETURNING prompt_id AS id, prompt_name AS name, prompt_content AS content,
               created_date AS "createdDate", updated_date AS "updatedDate"`,
    [parsed.data.name, parsed.data.content, req.newSchemaUser!.id, promptId]
  );
  if (!prompt) {
    res.status(404).json({ success: false, message: 'Prompt not found.' });
    return;
  }
  res.json({ success: true, prompt });
});

router.put('/assignments/:managerId', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const managerId = Number.parseInt(req.params.managerId, 10);
  const parsed = z.object({ promptId: z.number().int().positive().nullable() }).strict().safeParse(req.body);
  if (!Number.isSafeInteger(managerId) || managerId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid Manager ID and prompt selection.' });
    return;
  }
  const manager = await queryOne<{ u_id: number }>(
    "SELECT u_id FROM users WHERE u_id = $1 AND role = 'manager'",
    [managerId]
  );
  if (!manager) {
    res.status(404).json({ success: false, message: 'Manager not found.' });
    return;
  }
  if (parsed.data.promptId !== null) {
    const prompt = await queryOne<{ prompt_id: number }>(
      'SELECT prompt_id FROM prompts WHERE prompt_id = $1',
      [parsed.data.promptId]
    );
    if (!prompt) {
      res.status(404).json({ success: false, message: 'Prompt not found.' });
      return;
    }
  }

  await withTransaction(async (tx) => {
    if (parsed.data.promptId === null) {
      await tx.query(
        'DELETE FROM manager_scanner_prompt_assignments WHERE manager_user_id = $1',
        [managerId]
      );
      return;
    }
    await tx.query(
      `INSERT INTO manager_scanner_prompt_assignments
         (manager_user_id, prompt_id, assigned_by, assigned_date)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (manager_user_id) DO UPDATE SET
         prompt_id = EXCLUDED.prompt_id,
         assigned_by = EXCLUDED.assigned_by,
         assigned_date = NOW()`,
      [managerId, parsed.data.promptId, req.newSchemaUser!.id]
    );
  });
  res.json({ success: true, message: parsed.data.promptId === null ? 'Prompt unassigned.' : 'Prompt assigned to Manager.' });
});

router.delete('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const promptId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(promptId) || promptId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid prompt ID.' });
    return;
  }
  const prompt = await queryOne<{ prompt_id: number }>(
    'SELECT prompt_id FROM prompts WHERE prompt_id = $1',
    [promptId]
  );
  if (!prompt) {
    res.status(404).json({ success: false, message: 'Prompt not found.' });
    return;
  }
  const assigned = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM manager_scanner_prompt_assignments WHERE prompt_id = $1',
    [promptId]
  );
  if (Number(assigned?.count || 0) > 0) {
    res.status(409).json({ success: false, message: 'Unassign this prompt from all Managers before deleting it.' });
    return;
  }
  await execute('DELETE FROM prompts WHERE prompt_id = $1', [promptId]);
  res.json({ success: true, message: 'Prompt deleted.' });
});

export default router;
