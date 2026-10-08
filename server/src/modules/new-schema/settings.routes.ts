import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super can manage application settings.' });
  return false;
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const rows = await queryAll<{ setting_name: string; setting_value: string }>(
    'SELECT setting_name, setting_value FROM app_settings ORDER BY setting_name ASC'
  );
  res.json({
    success: true,
    settings: Object.fromEntries(rows.map((row) => [row.setting_name, row.setting_value])),
  });
});

router.put('/', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!requireSuper(req, res)) return;
  const parsed = z.object({
    settings: z.record(z.string().min(1), z.string().max(10000)),
  }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data.settings).length === 0) {
    res.status(400).json({ success: false, message: 'Provide one or more valid settings.' });
    return;
  }
  for (const [name, value] of Object.entries(parsed.data.settings)) {
    await execute(
      `INSERT INTO app_settings (setting_name, setting_value, updated_by, updated_date)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (setting_name) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by = EXCLUDED.updated_by,
           updated_date = NOW()`,
      [name.trim(), value, req.userId]
    );
  }
  res.json({ success: true, message: 'Settings saved.' });
});

export default router;
