import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute, withTransaction } from '../../database/connection';
import {
  requireAuth,
  requireAdminOrBidder,
  AuthRequest,
} from '../../middleware/auth';
import { candidateBidderFilter, isBidder } from '../../middleware/scope';
import { normalizeUrl } from '../../utilities/normalize-url';
import { logger } from '../../utilities/logger';
import { config } from '../../config/env';
import {
  createMemoryApplicationSession,
  getMemoryApplicationSession,
  upsertMemorySessionFields,
  listMemorySessionFields,
  updateMemorySession,
  updateMemorySessionField,
  countMemoryPendingAiFields,
  readPublicTaskIdFromSession,
  type ApplicationSessionStatus,
  type UpsertFieldInput,
} from '../../services/application-session-store';
import { createPublicTaskId, formatTaskId } from './application-task-id';
import applicationDocumentsRoutes from './application-documents.routes';

const router = Router();
router.use(requireAuth);
router.use(requireAdminOrBidder);

router.use('/:id/documents', applicationDocumentsRoutes);

const FieldCategorySchema = z.enum([
  'candidate_profile',
  'saved_answer',
  'ai_generation',
  'document_upload',
  'unknown',
]);
const FillStatusSchema = z.enum(['pending', 'filled', 'skipped', 'awaiting_answer', 'error', 'manual']);

const CreateSessionSchema = z.object({
  candidateId: z.number().int().positive(),
  jobId: z.number().int().positive().optional().nullable(),
  jobUrl: z.string().url(),
  jobTitle: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  jobDescription: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
  currentStep: z.string().optional().nullable(),
  discoveredPages: z.array(z.record(z.unknown())).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const SessionFieldSchema = z.object({
  stableFieldId: z.string().min(1).max(500),
  label: z.string().optional().nullable(),
  fieldType: z.string().min(1).max(100),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional().nullable(),
  currentValue: z.string().optional().nullable(),
  placeholder: z.string().optional().nullable(),
  sectionHeading: z.string().optional().nullable(),
  pageStep: z.string().optional().nullable(),
  pageUrl: z.string().optional().nullable(),
  nameAttr: z.string().optional().nullable(),
  autocompleteAttr: z.string().optional().nullable(),
  validationMessage: z.string().optional().nullable(),
  selectorHints: z.record(z.unknown()).optional().nullable(),
  fieldFingerprint: z.string().min(1).max(500),
  category: FieldCategorySchema.optional().default('unknown'),
  profileKey: z.string().optional().nullable(),
  savedAnswerKey: z.string().optional().nullable(),
  documentSlot: z.enum(['resume', 'cover_letter']).optional().nullable(),
  fillValue: z.string().optional().nullable(),
  fillStatus: FillStatusSchema.optional().default('pending'),
  generatedAnswer: z.string().optional().nullable(),
});

const PatchFieldsSchema = z.object({
  fields: z.array(SessionFieldSchema).min(1),
  currentStep: z.string().optional().nullable(),
  discoveredPages: z.array(z.record(z.unknown())).optional(),
  status: z.enum(['active', 'scanning', 'filling', 'awaiting_ai', 'completed', 'abandoned', 'error']).optional(),
});

const SubmitAnswersSchema = z.object({
  answers: z.array(z.object({
    stableFieldId: z.string().min(1),
    answer: z.string(),
  })).min(1),
});

async function canAccessCandidate(req: AuthRequest, candidateId: number): Promise<boolean> {
  if (req.role === 'admin') return true;
  if (isBidder(req) && req.bidderId) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM candidates WHERE id = $1 AND bidder_id = $2',
      [candidateId, req.bidderId]
    );
    return Boolean(row);
  }
  return false;
}

async function getSessionForRequest(req: AuthRequest, sessionId: number) {
  if (!config.applicationSessionPersistDb) {
    const session = getMemoryApplicationSession(sessionId);
    if (!session) return null;
    if (req.role !== 'admin' && isBidder(req) && req.bidderId !== session.bidder_id) {
      return null;
    }
    return session as unknown as Record<string, unknown>;
  }

  const scope = candidateBidderFilter(req, 'c', 2);
  let query = `
    SELECT s.*,
      c.name AS candidate_name,
      c.email AS candidate_email,
      c.phone AS candidate_phone,
      c.linkedin_url AS candidate_linkedin_url
    FROM application_sessions s
    JOIN candidates c ON c.id = s.candidate_id
    WHERE s.id = $1`;
  const params: unknown[] = [sessionId];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  return queryOne<Record<string, unknown>>(query, params);
}

function mapSessionRow(row: Record<string, unknown>) {
  return {
    applicationId: row.id,
    candidateId: row.candidate_id,
    jobId: row.job_id,
    userId: row.user_id,
    bidderId: row.bidder_id,
    jobUrl: row.job_url,
    normalizedUrl: row.normalized_url,
    jobTitle: row.job_title,
    company: row.company,
    jobDescription: row.job_description,
    platform: row.platform,
    currentStep: row.current_step,
    discoveredPages: row.discovered_pages ?? [],
    generatedAnswers: row.generated_answers ?? {},
    status: row.status,
    metadata: row.metadata ?? {},
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    candidate: {
      name: row.candidate_name,
      email: row.candidate_email,
      phone: row.candidate_phone,
      linkedinUrl: row.candidate_linkedin_url,
    },
  };
}

function mapFieldRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    stableFieldId: row.stable_field_id,
    label: row.label,
    fieldType: row.field_type,
    required: row.required,
    options: row.options ?? [],
    currentValue: row.current_value,
    placeholder: row.placeholder,
    sectionHeading: row.section_heading,
    pageStep: row.page_step,
    pageUrl: row.page_url,
    nameAttr: row.name_attr,
    autocompleteAttr: row.autocomplete_attr,
    validationMessage: row.validation_message,
    selectorHints: row.selector_hints ?? {},
    fieldFingerprint: row.field_fingerprint,
    category: row.category,
    profileKey: row.profile_key,
    savedAnswerKey: row.saved_answer_key,
    documentSlot: row.document_slot,
    fillValue: row.fill_value,
    fillStatus: row.fill_status,
    generatedAnswer: row.generated_answer,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = CreateSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const data = parsed.data;
  if (!(await canAccessCandidate(req, data.candidateId))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }

  const candidate = await queryOne<{
    bidder_id: number | null;
    name: string;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    stack: string | null;
  }>(
    'SELECT bidder_id, name, email, phone, linkedin_url, stack FROM candidates WHERE id = $1',
    [data.candidateId]
  );
  if (!candidate?.bidder_id) {
    res.status(400).json({ success: false, message: 'Candidate is not linked to a bidder organization.' });
    return;
  }

  if (isBidder(req) && req.bidderId !== candidate.bidder_id) {
    res.status(403).json({ success: false, message: 'Access denied.' });
    return;
  }

  const bidderId = candidate.bidder_id;
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const normalized = normalizeUrl(data.jobUrl);
  const publicTaskId = createPublicTaskId();
  const sessionMetadata = {
    ...(data.metadata ?? {}),
    publicTaskId,
    taskId: publicTaskId,
  };

  if (!config.applicationSessionPersistDb) {
    const inserted = createMemoryApplicationSession({
      candidateId: data.candidateId,
      jobId: data.jobId ?? null,
      userId,
      bidderId,
      jobUrl: data.jobUrl,
      jobTitle: data.jobTitle ?? null,
      company: data.company ?? null,
      jobDescription: data.jobDescription ?? null,
      platform: data.platform ?? null,
      currentStep: data.currentStep ?? 'scan',
      discoveredPages: data.discoveredPages ?? [],
      metadata: sessionMetadata,
      candidate,
    });

    logger.info('Application session created (memory)', { sessionId: inserted.id, candidateId: data.candidateId });
    const responseTaskId = readPublicTaskIdFromSession(inserted) ?? publicTaskId;
    res.status(201).json({
      success: true,
      taskId: responseTaskId,
      session: mapSessionRow(inserted as unknown as Record<string, unknown>),
      savedAnswers: [],
    });
    return;
  }

  const inserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO application_sessions (
      candidate_id, job_id, user_id, bidder_id,
      job_url, normalized_url, job_title, company, job_description,
      platform, current_step, discovered_pages, metadata, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, 'scanning')
    RETURNING *`,
    [
      data.candidateId,
      data.jobId ?? null,
      userId,
      bidderId,
      data.jobUrl,
      normalized,
      data.jobTitle ?? null,
      data.company ?? null,
      data.jobDescription ?? null,
      data.platform ?? null,
      data.currentStep ?? 'scan',
      JSON.stringify(data.discoveredPages ?? []),
      JSON.stringify(sessionMetadata),
    ]
  );

  if (!inserted) {
    res.status(500).json({ success: false, message: 'Could not create application session.' });
    return;
  }

  const savedAnswers = await queryAll(
    `SELECT answer_key, answer_value, approved
     FROM candidate_saved_answers
     WHERE candidate_id = $1 AND approved = TRUE
     ORDER BY answer_key ASC`,
    [data.candidateId]
  );

  logger.info('Application session created', { sessionId: inserted.id, candidateId: data.candidateId });
  const applicationId = Number(inserted.id);
  res.status(201).json({
    success: true,
    taskId: publicTaskId,
    session: mapSessionRow(inserted),
    savedAnswers: savedAnswers.map((row: Record<string, unknown>) => ({
      answerKey: row.answer_key,
      answerValue: row.answer_value,
      approved: row.approved,
    })),
  });
});

router.patch('/:id/fields', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const parsed = PatchFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const { fields, currentStep, discoveredPages, status } = parsed.data;
  const aiPending = fields.some(
    (f) => (f.category === 'ai_generation' || f.category === 'document_upload')
      && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
  );
  const nextStatus = status ?? (aiPending ? 'awaiting_ai' : 'filling');

  if (!config.applicationSessionPersistDb) {
    const upsertFields: UpsertFieldInput[] = fields.map((field) => ({
      stableFieldId: field.stableFieldId,
      label: field.label ?? null,
      fieldType: field.fieldType,
      required: field.required ?? false,
      options: field.options ?? [],
      currentValue: field.currentValue ?? null,
      placeholder: field.placeholder ?? null,
      sectionHeading: field.sectionHeading ?? null,
      pageStep: field.pageStep ?? null,
      pageUrl: field.pageUrl ?? null,
      nameAttr: field.nameAttr ?? null,
      autocompleteAttr: field.autocompleteAttr ?? null,
      validationMessage: field.validationMessage ?? null,
      selectorHints: field.selectorHints ?? {},
      fieldFingerprint: field.fieldFingerprint,
      category: field.category ?? 'unknown',
      profileKey: field.profileKey ?? null,
      savedAnswerKey: field.savedAnswerKey ?? null,
      documentSlot: field.documentSlot ?? null,
      fillValue: field.fillValue ?? null,
      fillStatus: field.fillStatus ?? 'pending',
      generatedAnswer: field.generatedAnswer ?? null,
    }));

    const updatedFields = upsertMemorySessionFields(sessionId, upsertFields, {
      currentStep: currentStep ?? null,
      discoveredPages: discoveredPages ?? undefined,
      status: nextStatus as ApplicationSessionStatus,
    });

    res.json({
      success: true,
      fields: updatedFields.map((row) => mapFieldRow(row as unknown as Record<string, unknown>)),
      pendingAiCount: updatedFields.filter(
        (row) =>
          (row.category === 'ai_generation' || row.category === 'document_upload')
          && (row.fill_status === 'pending' || row.fill_status === 'awaiting_answer')
          && row.required
      ).length,
    });
    return;
  }

  await withTransaction(async (client) => {
    for (const field of fields) {
      await client.query(
        `INSERT INTO application_session_fields (
          session_id, stable_field_id, label, field_type, required, options,
          current_value, placeholder, section_heading, page_step, page_url,
          name_attr, autocomplete_attr, validation_message, selector_hints,
          field_fingerprint, category, profile_key, saved_answer_key, document_slot,
          fill_value, fill_status, generated_answer, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11,
          $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
        )
        ON CONFLICT (session_id, stable_field_id) DO UPDATE SET
          label = EXCLUDED.label,
          field_type = EXCLUDED.field_type,
          required = EXCLUDED.required,
          options = EXCLUDED.options,
          current_value = EXCLUDED.current_value,
          placeholder = EXCLUDED.placeholder,
          section_heading = EXCLUDED.section_heading,
          page_step = EXCLUDED.page_step,
          page_url = EXCLUDED.page_url,
          name_attr = EXCLUDED.name_attr,
          autocomplete_attr = EXCLUDED.autocomplete_attr,
          validation_message = EXCLUDED.validation_message,
          selector_hints = EXCLUDED.selector_hints,
          field_fingerprint = EXCLUDED.field_fingerprint,
          category = EXCLUDED.category,
          profile_key = EXCLUDED.profile_key,
          saved_answer_key = EXCLUDED.saved_answer_key,
          document_slot = EXCLUDED.document_slot,
          fill_value = EXCLUDED.fill_value,
          fill_status = EXCLUDED.fill_status,
          generated_answer = EXCLUDED.generated_answer,
          updated_at = NOW()`,
        [
          sessionId,
          field.stableFieldId,
          field.label ?? null,
          field.fieldType,
          field.required ?? false,
          JSON.stringify(field.options ?? []),
          field.currentValue ?? null,
          field.placeholder ?? null,
          field.sectionHeading ?? null,
          field.pageStep ?? null,
          field.pageUrl ?? null,
          field.nameAttr ?? null,
          field.autocompleteAttr ?? null,
          field.validationMessage ?? null,
          JSON.stringify(field.selectorHints ?? {}),
          field.fieldFingerprint,
          field.category ?? 'unknown',
          field.profileKey ?? null,
          field.savedAnswerKey ?? null,
          field.documentSlot ?? null,
          field.fillValue ?? null,
          field.fillStatus ?? 'pending',
          field.generatedAnswer ?? null,
        ]
      );
    }

    const nextStatus = status ?? (aiPending ? 'awaiting_ai' : 'filling');
    await client.query(
      `UPDATE application_sessions
       SET current_step = COALESCE($2, current_step),
           discovered_pages = COALESCE($3::jsonb, discovered_pages),
           status = $4,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [
        sessionId,
        currentStep ?? null,
        discoveredPages ? JSON.stringify(discoveredPages) : null,
        nextStatus,
      ]
    );
  });

  const updatedFields = await queryAll(
    'SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC',
    [sessionId]
  );

  res.json({
    success: true,
    fields: updatedFields.map((row) => mapFieldRow(row as Record<string, unknown>)),
    pendingAiCount: updatedFields.filter(
      (row: Record<string, unknown>) =>
        (row.category === 'ai_generation' || row.category === 'document_upload')
        && (row.fill_status === 'pending' || row.fill_status === 'awaiting_answer')
        && (row.required === true || row.required === 't')
    ).length,
  });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const fields = config.applicationSessionPersistDb
    ? await queryAll(
      'SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
    )
    : listMemorySessionFields(sessionId);

  res.json({
    success: true,
    session: mapSessionRow(session),
    fields: fields.map((row) => mapFieldRow(row as Record<string, unknown>)),
  });
});

router.get('/:id/pending-fields', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const fields = config.applicationSessionPersistDb
    ? await queryAll(
      `SELECT * FROM application_session_fields
       WHERE session_id = $1
         AND category IN ('ai_generation', 'document_upload')
         AND fill_status IN ('pending', 'awaiting_answer')
       ORDER BY required DESC, id ASC`,
      [sessionId]
    )
    : listMemorySessionFields(sessionId).filter(
      (row) =>
        (row.category === 'ai_generation' || row.category === 'document_upload')
        && (row.fill_status === 'pending' || row.fill_status === 'awaiting_answer')
    );

  res.json({
    success: true,
    applicationId: sessionId,
    pendingFields: fields.map((row) => mapFieldRow(row as Record<string, unknown>)),
    jobContext: {
      jobTitle: session.job_title,
      company: session.company,
      jobDescription: session.job_description,
      jobUrl: session.job_url,
      platform: session.platform,
      candidateName: session.candidate_name,
    },
  });
});

router.post('/:id/answers', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const parsed = SubmitAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const generatedAnswers: Record<string, string> = {
    ...(typeof session.generated_answers === 'object' && session.generated_answers
      ? session.generated_answers as Record<string, string>
      : {}),
  };

  for (const item of parsed.data.answers) {
    generatedAnswers[item.stableFieldId] = item.answer;
    if (!config.applicationSessionPersistDb) {
      updateMemorySessionField(sessionId, item.stableFieldId, {
        generated_answer: item.answer,
        fill_value: item.answer,
        fill_status: 'filled',
      });
      continue;
    }
    await execute(
      `UPDATE application_session_fields
       SET generated_answer = $3,
           fill_value = $3,
           fill_status = 'filled',
           updated_at = NOW()
       WHERE session_id = $1 AND stable_field_id = $2`,
      [sessionId, item.stableFieldId, item.answer]
    );
  }

  const remainingCount = config.applicationSessionPersistDb
    ? Number((await queryOne<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM application_session_fields
       WHERE session_id = $1
         AND category = 'ai_generation'
         AND fill_status IN ('pending', 'awaiting_answer')`,
      [sessionId]
    ))?.count ?? 0)
    : countMemoryPendingAiFields(sessionId);

  const allAnswered = remainingCount === 0;

  if (!config.applicationSessionPersistDb) {
    updateMemorySession(sessionId, {
      generated_answers: generatedAnswers,
      status: allAnswered ? 'completed' : 'awaiting_ai',
      completed_at: allAnswered ? new Date().toISOString() : session.completed_at as string | null,
    });
  } else {
    await execute(
      `UPDATE application_sessions
       SET generated_answers = $2::jsonb,
           status = $3,
           last_activity_at = NOW(),
           updated_at = NOW(),
           completed_at = CASE WHEN $4 THEN NOW() ELSE completed_at END
       WHERE id = $1`,
      [
        sessionId,
        JSON.stringify(generatedAnswers),
        allAnswered ? 'completed' : 'awaiting_ai',
        allAnswered,
      ]
    );
  }

  res.json({
    success: true,
    applicationId: sessionId,
    answersStored: parsed.data.answers.length,
    allAiFieldsAnswered: allAnswered,
    generatedAnswers,
  });
});

router.get('/:id/result', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const fields = config.applicationSessionPersistDb
    ? await queryAll(
      'SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
    )
    : listMemorySessionFields(sessionId);

  const mapped = fields.map((row) => mapFieldRow(row as Record<string, unknown>));
  const summary = {
    totalFields: mapped.length,
    filled: mapped.filter((f) => f.fillStatus === 'filled').length,
    pending: mapped.filter((f) => f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer').length,
    skipped: mapped.filter((f) => f.fillStatus === 'skipped').length,
    errors: mapped.filter((f) => f.fillStatus === 'error').length,
    candidateProfile: mapped.filter((f) => f.category === 'candidate_profile').length,
    savedAnswers: mapped.filter((f) => f.category === 'saved_answer').length,
    aiGeneration: mapped.filter((f) => f.category === 'ai_generation').length,
    aiPending: mapped.filter(
      (f) => f.category === 'ai_generation' && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
    ).length,
  };

  res.json({
    success: true,
    session: mapSessionRow(session),
    summary,
    fields: mapped,
    pendingAiFields: mapped.filter(
      (f) => f.category === 'ai_generation' && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
    ),
  });
});

export default router;
