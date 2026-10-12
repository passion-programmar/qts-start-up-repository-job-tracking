import { Router, Response } from 'express';
import { z } from 'zod';
import { queryOne } from '../../database/connection';
import { config } from '../../config/env';
import { requireAuth, requireAdminOrAccount, AuthRequest } from '../../middleware/auth';
import { getMemoryApplicationSession } from '../../services/application-session-store';
import {
  evaluateAssistDecision,
  getLearningSummary,
  getReplayConfidence,
  listLearningQueue,
  upsertAnswerPolicy,
  upsertSemanticMapping,
} from '../../services/application-learning-store';

const router = Router();
router.use(requireAuth);
router.use(requireAdminOrAccount);

const ConfirmationSchema = z.object({
  fieldStableId: z.string().min(1).max(500),
  question: z.string().max(1000).optional().nullable(),
  currentAnswer: z.string().max(2000).optional().nullable(),
  editedAnswer: z.string().max(2000).optional().nullable(),
  policyType: z.enum(['reusable_profile', 'generated_ai', 'requires_review', 'manual_only', 'ignore']),
  confidence: z.number().min(0).max(1).default(0),
  userApproved: z.boolean().default(true),
  fieldType: z.string().max(64).optional().nullable(),
  sectionHeading: z.string().max(200).optional().nullable(),
  evidenceSummary: z.record(z.unknown()).optional(),
});

const AssistDecisionSchema = z.object({
  stableFieldId: z.string().min(1).max(500).optional().nullable(),
  question: z.string().max(1000).optional().nullable(),
  fieldType: z.string().max(64).optional().nullable(),
  sectionHeading: z.string().max(200).optional().nullable(),
});

async function getSessionForRequest(req: AuthRequest, sessionId: number) {
  if (!config.applicationSessionPersistDb) {
    const session = getMemoryApplicationSession(sessionId);
    if (!session) return null;
    if (
      req.role !== 'admin'
      && req.role !== 'super'
      && (req.accountId == null || Number(session.account_id) !== req.accountId)
    ) {
      return null;
    }
    return session as unknown as Record<string, unknown>;
  }

  const session = await queryOne<Record<string, unknown>>(
    `SELECT s.*, c.name AS candidate_name, c.email AS candidate_email
     FROM application_sessions s
     JOIN candidates c ON c.id = s.candidate_id
     WHERE s.id = $1`,
    [sessionId]
  );

  if (!session) return null;
  if (req.role !== 'admin' && req.role !== 'super' && req.accountId != null && Number(session.account_id) !== req.accountId) {
    return null;
  }
  return session;
}

router.get('/:id/learning-summary', async (req: AuthRequest, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const summary = await getLearningSummary(sessionId);
  res.json({ success: true, sessionId, summary });
});

router.get('/:id/learning-queue', async (req: AuthRequest, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const rows = await listLearningQueue(sessionId);
  res.json({
    success: true,
    sessionId,
    queue: rows.map((row) => ({
      stableFieldId: row.stableFieldId,
      label: row.label,
      fieldType: row.fieldType,
      currentAnswer: row.currentAnswer,
      fillStatus: row.fillStatus,
      category: row.category,
      sectionHeading: row.sectionHeading,
      pageStep: row.pageStep,
      updatedAt: row.updatedAt,
      policyType: row.category === 'candidate_profile' ? 'reusable_profile' : 'requires_review',
    })),
  });
});

router.get('/:id/replay-confidence', async (req: AuthRequest, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  res.json({ success: true, sessionId, matches: await getReplayConfidence(sessionId) });
});

router.post('/:id/assist-decision', async (req: AuthRequest, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const parsed = AssistDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message })),
    });
    return;
  }

  const decision = await evaluateAssistDecision(sessionId, parsed.data);
  res.json({ success: true, sessionId, decision });
});

router.post('/:id/learning-confirmation', async (req: AuthRequest, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const parsed = ConfirmationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message })),
    });
    return;
  }

  const semantic = await upsertSemanticMapping({
    stableFieldId: parsed.data.fieldStableId,
    question: parsed.data.question,
    fieldType: parsed.data.fieldType,
    sectionHeading: parsed.data.sectionHeading,
    confidence: parsed.data.confidence,
    sourceSessionId: sessionId,
    inferredSemanticGroup: parsed.data.policyType === 'generated_ai'
      ? 'generated_ai'
      : parsed.data.policyType === 'reusable_profile'
        ? 'candidate_profile'
        : parsed.data.policyType === 'manual_only'
          ? 'manual_only'
          : 'requires_review',
  });

  if (!semantic) {
    res.status(500).json({ success: false, message: 'Failed to save semantic mapping.' });
    return;
  }

  const policy = await upsertAnswerPolicy({
    semanticId: semantic.id,
    policyType: parsed.data.policyType,
    confidence: parsed.data.confidence,
    answerSource: parsed.data.evidenceSummary ? JSON.stringify(parsed.data.evidenceSummary) : null,
    approvedByUser: parsed.data.userApproved,
    observedAnswer: parsed.data.currentAnswer ?? null,
    editedAnswer: parsed.data.editedAnswer ?? null,
  });

  if (!policy) {
    res.status(500).json({ success: false, message: 'Failed to save answer policy.' });
    return;
  }

  res.json({
    success: true,
    sessionId,
    semanticId: semantic.id,
    policyId: policy.id,
    policyType: policy.policy_type,
    confidence: policy.confidence,
  });
});

export default router;
