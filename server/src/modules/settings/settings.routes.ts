import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, withTransaction } from '../../database/connection';
import { requireAuth, requireAdmin, AuthRequest } from '../../middleware/auth';
import { backupDb } from '../../database/connection';
import { logger } from '../../utilities/logger';
import {
  CANDIDATE_STACKS_SETTING_KEY,
  getCandidateStacks,
  saveCandidateStacks,
  sanitizeCandidateStacksInput,
  parseCandidateStacks,
  serializeCandidateStacks,
} from '../../config/candidate-stacks';

const ADMIN_UI_MODES = new Set(['mode1', 'mode2', 'mode3']);

function sanitizeSettings(settings: Record<string, string>): Record<string, string> {
  const next = { ...settings };
  if (next.admin_ui_mode && !ADMIN_UI_MODES.has(next.admin_ui_mode)) {
    delete next.admin_ui_mode;
  }
  return next;
}

const router = Router();
router.use(requireAuth);

router.get('/', async (_req: AuthRequest, res: Response) => {
  const rows = await queryAll<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  );
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json({ success: true, settings });
});

router.get('/candidate-stacks', async (_req: AuthRequest, res: Response) => {
  const stacks = await getCandidateStacks();
  res.json({ success: true, stacks });
});

router.put('/candidate-stacks', requireAdmin, async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ stacks: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Stacks must be a list of names.' });
    return;
  }
  const sanitized = sanitizeCandidateStacksInput(parsed.data.stacks);
  if (!sanitized.length) {
    res.status(400).json({ success: false, message: 'At least one stack option is required.' });
    return;
  }
  try {
    const saved = await saveCandidateStacks(sanitized);
    res.json({ success: true, stacks: saved, message: 'Candidate stacks saved.' });
  } catch (err) {
    logger.error('Failed to save candidate stacks', err);
    res.status(500).json({ success: false, message: 'Could not save candidate stacks.' });
  }
});

router.put('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ settings: z.record(z.string()) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Invalid settings payload.' });
    return;
  }
  const sanitized = sanitizeSettings(parsed.data.settings);

  if (sanitized[CANDIDATE_STACKS_SETTING_KEY] !== undefined) {
    const stacks = sanitizeCandidateStacksInput(
      parseCandidateStacks(sanitized[CANDIDATE_STACKS_SETTING_KEY])
    );
    if (!stacks.length) {
      res.status(400).json({ success: false, message: 'At least one stack option is required.' });
      return;
    }
    try {
      await saveCandidateStacks(stacks);
    } catch (err) {
      logger.error('Failed to save candidate stacks via settings', err);
      res.status(500).json({ success: false, message: 'Could not save candidate stacks.' });
      return;
    }
    sanitized[CANDIDATE_STACKS_SETTING_KEY] = serializeCandidateStacks(stacks);
  }

  await withTransaction(async (client) => {
    for (const [key, value] of Object.entries(sanitized)) {
      await client.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }
  });
  res.json({ success: true, message: 'Settings saved.' });
});

router.post('/backup', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const dest = await backupDb();
    logger.info('Database backup created', { dest });
    res.json({ success: true, message: 'Backup created.', path: dest });
  } catch (err) {
    logger.error('Backup failed', err);
    res.status(500).json({ success: false, message: 'Backup failed.' });
  }
});

export default router;
