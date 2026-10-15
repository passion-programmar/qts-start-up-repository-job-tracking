import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import {
  ManagerExtensionFeature,
  managerHasExtensionFeature,
  requireManagerExtensionFeature,
} from './extension-feature-access';

const router = Router();
router.use(requireNewSchemaAuth);

const highlightRuleSchema = z.object({
  id: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(500),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
}).strict();

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super can assign extension features.' });
  return false;
}

function requireManager(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'manager') return true;
  res.status(403).json({ success: false, message: 'Only Managers can access shared extension features.' });
  return false;
}

async function managerHighlightAccess(managerId: number): Promise<boolean> {
  return managerHasExtensionFeature(managerId, 'text_highlights_manage');
}

async function readRules() {
  return queryAll(
    `SELECT rule_id AS id, text,
            text_color AS "textColor", background_color AS "backgroundColor"
     FROM global_text_highlight_rules
     ORDER BY created_date ASC, rule_id ASC`
  );
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

router.get('/assignments', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const managers = await queryAll(
    `SELECT manager.u_id AS id, manager.name, manager.username,
            (manager.blocked_date IS NULL) AS "isActive",
            COALESCE(bool_or(assignment.feature_key = 'text_highlights_manage'), FALSE) AS "canManageTextHighlights",
            COALESCE(bool_or(assignment.feature_key = 'job_site_scanner'), FALSE) AS "canUseScanner"
     FROM users manager
     LEFT JOIN manager_extension_feature_assignments assignment
       ON assignment.manager_user_id = manager.u_id
     WHERE manager.role = 'manager'
     GROUP BY manager.u_id
     ORDER BY manager.name ASC, manager.u_id ASC`
  );
  res.json({ success: true, managers });
});

router.put('/assignments/:managerId', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const managerId = /^\d+$/.test(req.params.managerId) ? Number(req.params.managerId) : Number.NaN;
  const parsed = z.object({
    canManageTextHighlights: z.boolean(),
    canUseScanner: z.boolean(),
  }).strict().safeParse(req.body);
  if (!Number.isSafeInteger(managerId) || managerId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a Manager ID and both feature permission values.' });
    return;
  }
  const manager = await queryOne<{ u_id: number }>(
    `SELECT u_id FROM users WHERE u_id = $1 AND role = 'manager'`,
    [managerId]
  );
  if (!manager) {
    res.status(404).json({ success: false, message: 'Manager not found.' });
    return;
  }
  const features: ManagerExtensionFeature[] = [];
  if (parsed.data.canManageTextHighlights) features.push('text_highlights_manage');
  if (parsed.data.canUseScanner) features.push('job_site_scanner');

  await withTransaction(async (tx) => {
    await tx.query(
      'DELETE FROM manager_extension_feature_assignments WHERE manager_user_id = $1',
      [managerId]
    );
    for (const feature of features) {
      await tx.query(
        `INSERT INTO manager_extension_feature_assignments (manager_user_id, feature_key, assigned_by)
         VALUES ($1, $2, $3)`,
        [managerId, feature, req.newSchemaUser!.id]
      );
    }
  });
  res.json({ success: true, message: 'Manager extension permissions saved.' });
});

router.get('/me', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireManager(req, res)) return;
  const [canManageTextHighlights, canUseScanner] = await Promise.all([
    managerHasExtensionFeature(req.newSchemaUser!.id, 'text_highlights_manage'),
    managerHasExtensionFeature(req.newSchemaUser!.id, 'job_site_scanner'),
  ]);
  res.json({
    success: true,
    features: { canManageTextHighlights, canUseScanner },
  });
});

router.get('/highlights', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireManager(req, res)) return;
  res.json({ success: true, rules: await readRules() });
});

router.post('/highlights', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireManager(req, res) ||
      !(await requireManagerExtensionFeature(req, res, 'text_highlights_manage'))) return;
  const parsed = highlightRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || 'Provide a valid text highlight rule.',
    });
    return;
  }
  try {
    const { id, text, textColor, backgroundColor } = parsed.data;
    await execute(
      `INSERT INTO global_text_highlight_rules
         (rule_id, text, text_color, background_color, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, text, textColor, backgroundColor, req.newSchemaUser!.id]
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ success: false, message: 'A rule with this ID or text already exists.' });
    return;
  }
  res.status(201).json({ success: true, rules: await readRules() });
});

router.put('/highlights/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireManager(req, res) ||
      !(await requireManagerExtensionFeature(req, res, 'text_highlights_manage'))) return;
  const ruleId = String(req.params.id || '').trim();
  const parsed = highlightRuleSchema.omit({ id: true }).safeParse(req.body);
  if (!ruleId || ruleId.length > 100 || !parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.success ? 'Provide a valid text highlight rule ID.' :
        parsed.error.issues[0]?.message || 'Provide valid text and colors.',
    });
    return;
  }
  try {
    const updated = await execute(
      `UPDATE global_text_highlight_rules
       SET text = $1, text_color = $2, background_color = $3,
           updated_by = $4, updated_date = NOW()
       WHERE rule_id = $5`,
      [parsed.data.text, parsed.data.textColor, parsed.data.backgroundColor, req.newSchemaUser!.id, ruleId]
    );
    if (!updated.rowCount) {
      res.status(404).json({ success: false, message: 'Text highlight rule not found.' });
      return;
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ success: false, message: 'A rule with this text already exists.' });
    return;
  }
  res.json({ success: true, rules: await readRules() });
});

router.delete('/highlights/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireManager(req, res) ||
      !(await requireManagerExtensionFeature(req, res, 'text_highlights_manage'))) return;
  const ruleId = String(req.params.id || '').trim();
  if (!ruleId || ruleId.length > 100) {
    res.status(400).json({ success: false, message: 'Provide a valid text highlight rule ID.' });
    return;
  }
  const deleted = await execute(
    'DELETE FROM global_text_highlight_rules WHERE rule_id = $1',
    [ruleId]
  );
  if (!deleted.rowCount) {
    res.status(404).json({ success: false, message: 'Text highlight rule not found.' });
    return;
  }
  res.json({ success: true, rules: await readRules() });
});

export default router;
