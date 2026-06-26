import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute, withTransaction } from '../../database/connection';
import {
  requireAuthOrGptActionKey,
  requireAdminOrBidder,
  AuthRequest,
} from '../../middleware/auth';
import { candidateBidderFilter } from '../../middleware/scope';
import { logger } from '../../utilities/logger';
import {
  GptApplicationPackageSchema,
  buildApplicationDocuments,
} from '../document-builder';
import {
  parseLegacySessionId,
  isPublicTaskId,
  createPublicTaskId,
  readPublicTaskId,
  formatTaskId,
} from './application-task-id';
import {
  buildDocumentGeneration,
  buildPackageSchemaRef,
  inferSuggestedDocument,
  mapFileFieldForGpt,
} from './gpt-task-context';

const router = Router();
router.use(requireAuthOrGptActionKey);
router.use((req: AuthRequest, res: Response, next) => {
  if (req.gptServiceAuth) {
    next();
    return;
  }
  requireAdminOrBidder(req, res, next);
});

const AnswerItemSchema = z.object({
  stableFieldId: z.string().min(1),
  answer: z.string(),
});

async function getSessionForRequest(req: AuthRequest, sessionId: number) {
  if (req.gptServiceAuth) {
    return queryOne<Record<string, unknown>>(
      `SELECT s.*,
        c.name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.linkedin_url AS candidate_linkedin_url,
        c.stack AS candidate_stack
      FROM application_sessions s
      JOIN candidates c ON c.id = s.candidate_id
      WHERE s.id = $1`,
      [sessionId]
    );
  }

  const scope = candidateBidderFilter(req, 'c', 2);
  let query = `
    SELECT s.*,
      c.name AS candidate_name,
      c.email AS candidate_email,
      c.phone AS candidate_phone,
      c.linkedin_url AS candidate_linkedin_url,
      c.stack AS candidate_stack
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

function mapFieldRow(row: Record<string, unknown>) {
  return {
    stableFieldId: row.stable_field_id,
    label: row.label,
    fieldType: row.field_type,
    required: row.required,
    category: row.category,
    fillStatus: row.fill_status,
    generatedAnswer: row.generated_answer,
    fillValue: row.fill_value,
    options: row.options ?? [],
    placeholder: row.placeholder,
    nameAttr: row.name_attr,
    sectionHeading: row.section_heading,
    documentSlot: row.document_slot,
    selectorHints: row.selector_hints ?? {},
  };
}

function readMetadata(session: Record<string, unknown>): Record<string, unknown> {
  const raw = session.metadata;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function readGptTask(metadata: Record<string, unknown>) {
  const gptTask = metadata.gptTask;
  if (gptTask && typeof gptTask === 'object' && !Array.isArray(gptTask)) {
    return gptTask as Record<string, unknown>;
  }
  return {};
}

async function resolveSessionIdFromTaskId(taskIdParam: string): Promise<number | null> {
  const legacy = parseLegacySessionId(taskIdParam);
  if (legacy != null) return legacy;
  const trimmed = String(taskIdParam || '').trim();
  if (!isPublicTaskId(trimmed)) return null;
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM application_sessions
     WHERE metadata->>'publicTaskId' = $1 OR metadata->>'taskId' = $1
     LIMIT 1`,
    [trimmed]
  );
  return row?.id ?? null;
}

function taskIdForSession(sessionId: number, session: Record<string, unknown>): string {
  return readPublicTaskId(readMetadata(session)) || formatTaskId(sessionId);
}

async function loadSessionContext(req: AuthRequest, taskIdParam: string) {
  const sessionId = await resolveSessionIdFromTaskId(taskIdParam);
  if (!sessionId) {
    return {
      error: {
        status: 400,
        message: 'Invalid task id. Use the taskId returned when the application session was created.',
      },
    };
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    return { error: { status: 404, message: 'Application task not found.' } };
  }

  const fields = await queryAll(
    'SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC',
    [sessionId]
  );
  const mapped = fields.map((row) => mapFieldRow(row as Record<string, unknown>));

  return { sessionId, session, fields: mapped };
}

function inferSuggestedDocumentForPackage(label?: unknown, nameAttr?: unknown): 'resume' | 'cover_letter' {
  return inferSuggestedDocument(label, nameAttr);
}

router.post('/:taskId/dispatch', async (req: AuthRequest, res: Response) => {
  const loaded = await loadSessionContext(req, req.params.taskId);
  if (loaded.error) {
    res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    return;
  }

  const { sessionId, session } = loaded;
  const metadata = readMetadata(session);
  const publicTaskId = taskIdForSession(sessionId, session);
  const gptTask = {
    ...readGptTask(metadata),
    status: 'waiting_for_gpt',
    taskId: publicTaskId,
    dispatchedAt: new Date().toISOString(),
    error: null,
  };

  await execute(
    `UPDATE application_sessions
     SET metadata = $2::jsonb,
         status = 'awaiting_ai',
         last_activity_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify({ ...metadata, taskId: publicTaskId, publicTaskId, gptTask })]
  );

  logger.info('GPT task dispatched', { sessionId, taskId: publicTaskId });
  res.json({
    success: true,
    taskId: publicTaskId,
    applicationId: sessionId,
    gptTaskStatus: 'waiting_for_gpt',
  });
});

router.get('/:taskId/context', async (req: AuthRequest, res: Response) => {
  const loaded = await loadSessionContext(req, req.params.taskId);
  if (loaded.error) {
    res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    return;
  }

  const { sessionId, session, fields } = loaded;
  const metadata = readMetadata(session);
  const publicTaskId = taskIdForSession(sessionId, session);
  const pendingAiFields = fields.filter(
    (f) => f.category === 'ai_generation' && f.fillStatus !== 'filled'
  );
  const fileFields = fields
    .filter((f) => f.fieldType === 'file')
    .map((f) => mapFileFieldForGpt(f as Record<string, unknown>));
  const documentGeneration = buildDocumentGeneration(fileFields);

  res.json({
    success: true,
    taskId: publicTaskId,
    applicationId: sessionId,
    gptTaskStatus: readGptTask(metadata).status || 'waiting_for_gpt',
    jobContext: {
      jobTitle: session.job_title,
      company: session.company,
      jobDescription: session.job_description,
      jobUrl: session.job_url,
      platform: session.platform,
    },
    candidate: {
      name: session.candidate_name,
      email: session.candidate_email,
      phone: session.candidate_phone,
      linkedinUrl: session.candidate_linkedin_url,
      stack: session.candidate_stack,
    },
    pendingAiFields,
    fileFields,
    documentGeneration,
    packageSchema: buildPackageSchemaRef(),
    allFields: fields,
    documentRequirements: {
      resumeRequired: fileFields.some((f) => f.suggestedDocument === 'resume'),
      coverLetterRecommended: fileFields.some((f) => f.suggestedDocument === 'cover_letter'),
    },
  });
});

router.get('/:taskId/status', async (req: AuthRequest, res: Response) => {
  const loaded = await loadSessionContext(req, req.params.taskId);
  if (loaded.error) {
    res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    return;
  }

  const { sessionId, session, fields } = loaded;
  const metadata = readMetadata(session);
  const publicTaskId = taskIdForSession(sessionId, session);
  const gptTask = readGptTask(metadata);
  const documents = metadata.documents && typeof metadata.documents === 'object'
    ? metadata.documents
    : {};

  const aiPending = fields.filter(
    (f) => (f.category === 'ai_generation' || f.category === 'document_upload')
      && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
  ).length;

  res.json({
    success: true,
    taskId: publicTaskId,
    applicationId: sessionId,
    sessionStatus: session.status,
    gptTaskStatus: gptTask.status || (aiPending > 0 ? 'waiting_for_gpt' : 'ready'),
    aiPending,
    readyToApply: gptTask.status === 'ready' || (aiPending === 0 && fields.some((f) => f.category === 'ai_generation')),
    documents,
    documentManifest: metadata.documentManifest || null,
    notes: gptTask.notes || null,
    error: gptTask.error || null,
    dispatchedAt: gptTask.dispatchedAt || null,
    completedAt: gptTask.completedAt || null,
  });
});

router.post('/:taskId/package', async (req: AuthRequest, res: Response) => {
  const loaded = await loadSessionContext(req, req.params.taskId);
  if (loaded.error) {
    res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    return;
  }

  const parsed = GptApplicationPackageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const { sessionId, session, fields } = loaded;
  const packageData = parsed.data;
  const hasFileField = fields.some((f) => f.fieldType === 'file');
  if (hasFileField && !packageData.resume) {
    res.status(400).json({
      success: false,
      message: 'resume JSON is required when the application form has a file upload field.',
    });
    return;
  }

  const allAnswers = [
    ...packageData.answers,
    ...(packageData.remainingFields || []),
  ];

  if (!allAnswers.length && !packageData.resume && !packageData.coverLetter) {
    res.status(400).json({ success: false, message: 'Package must include answers and/or documents.' });
    return;
  }

  const generatedAnswers: Record<string, string> = {
    ...(typeof session.generated_answers === 'object' && session.generated_answers
      ? session.generated_answers as Record<string, string>
      : {}),
  };

  await withTransaction(async (client) => {
    for (const item of allAnswers) {
      generatedAnswers[item.stableFieldId] = item.answer;
      await client.query(
        `UPDATE application_session_fields
         SET generated_answer = $3,
             fill_value = $3,
             fill_status = 'filled',
             updated_at = NOW()
         WHERE session_id = $1 AND stable_field_id = $2`,
        [sessionId, item.stableFieldId, item.answer]
      );
    }
  });

  let documentManifest = null;
  let documents: Record<string, string> = {};
  if (packageData.resume || packageData.coverLetter) {
    documentManifest = await buildApplicationDocuments(sessionId, {
      resume: packageData.resume,
      coverLetter: packageData.coverLetter,
    });
    documents = documentManifest.paths;
  }

  const fileFieldRows = await queryAll(
    `SELECT stable_field_id, label, name_attr FROM application_session_fields
     WHERE session_id = $1 AND field_type = 'file'`,
    [sessionId]
  );
  for (const row of fileFieldRows as Array<Record<string, unknown>>) {
    const slot = inferSuggestedDocumentForPackage(row.label, row.name_attr);
    const docKey = slot === 'cover_letter' ? 'coverLetterPdfPath' : 'resumePdfPath';
    if (!documents[docKey]) continue;
    await execute(
      `UPDATE application_session_fields
       SET fill_status = 'awaiting_answer',
           generated_answer = $3,
           updated_at = NOW()
       WHERE session_id = $1 AND stable_field_id = $2`,
      [sessionId, row.stable_field_id, slot]
    );
  }

  const metadata = readMetadata(session);
  const publicTaskId = taskIdForSession(sessionId, session);
  const gptTask = {
    ...readGptTask(metadata),
    status: 'ready',
    taskId: publicTaskId,
    completedAt: new Date().toISOString(),
    notes: packageData.notes || null,
    error: null,
  };

  await execute(
    `UPDATE application_sessions
     SET generated_answers = $2::jsonb,
         metadata = $3::jsonb,
         status = 'filling',
         last_activity_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [
      sessionId,
      JSON.stringify(generatedAnswers),
      JSON.stringify({
        ...metadata,
        taskId: publicTaskId,
        publicTaskId,
        gptTask,
        documents: { ...(metadata.documents as object || {}), ...documents },
        documentManifest,
      }),
    ]
  );

  logger.info('GPT package stored', {
    sessionId,
    taskId: publicTaskId,
    answersStored: allAnswers.length,
    documentsBuilt: documentManifest?.artifacts.length ?? 0,
  });

  res.json({
    success: true,
    taskId: publicTaskId,
    applicationId: sessionId,
    answersStored: allAnswers.length,
    gptTaskStatus: 'ready',
    documents,
    documentManifest,
    status: 'filling',
  });
});

export default router;
