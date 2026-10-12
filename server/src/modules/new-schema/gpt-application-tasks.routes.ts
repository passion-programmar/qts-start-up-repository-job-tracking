import { createHash, randomUUID } from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne } from '../../database/connection';
import {
  renderCoverLetterPdfBuffer,
  renderResumePdfBuffer,
  safePdfFileName,
} from '../../services/application-document-pdf';
import { extractPdfText } from '../../services/pdf-text-extraction';
import {
  CoverLetterDocumentSchema,
  ResumeDocumentSchema,
} from '../document-builder/document.schemas';
import { NewSchemaAuthRequest, requireNewSchemaAuth } from '../../middleware/new-schema-auth';
import { config } from '../../config/env';

const router = Router();
const taskIdSchema = z.string().regex(/^task_[0-9a-f-]{36}$/i);

const pageFieldSchema = z.object({
  stableFieldId: z.string().min(1).max(300),
  label: z.string().max(1000),
  fieldType: z.string().max(100),
  fieldKey: z.string().max(300).optional(),
  section: z.string().max(200).optional(),
  documentSlot: z.enum(['resume', 'cover_letter']).optional(),
  accountSpecific: z.boolean().optional(),
  jobSpecific: z.boolean().optional(),
  required: z.boolean(),
  options: z.array(z.string().max(500)).max(100).optional(),
  placeholder: z.string().max(1000).optional(),
  currentValue: z.string().max(5000).optional(),
  manualReview: z.boolean().optional(),
}).strict();

const pageContextSchema = z.object({
  pageUrl: z.string().url().max(2000),
  pageTitle: z.string().max(500),
  pageNumber: z.number().int().min(1).max(50),
  fields: z.array(pageFieldSchema).max(150),
  jobDescription: z.string().max(50000).optional(),
}).strict();

const createTaskSchema = z.object({
  sourcePlatform: z.string().trim().min(1).max(100).optional(),
  jobDescription: z.string().trim().max(50000).optional(),
}).strict();

const taskPackageSchema = z.object({
  answers: z.array(z.object({
    stableFieldId: z.string().min(1).max(300),
    answer: z.string().max(10000),
  }).strict()).max(150),
  unresolvedFields: z.array(z.object({
    stableFieldId: z.string().min(1).max(300),
    question: z.string().max(1000),
    reason: z.string().max(1000),
  }).strict()).max(150).optional(),
  resume: ResumeDocumentSchema.optional(),
  coverLetter: CoverLetterDocumentSchema.optional(),
  notes: z.string().max(2000).optional(),
}).strict();

type TaskRow = {
  task_id: string;
  job_id: number;
  manager_user_id: number;
  status: string;
  page_number: number;
  task_context: Record<string, unknown>;
  package: Record<string, unknown>;
  answers: Array<{ stableFieldId: string; answer: string }>;
  resume_text: string | null;
  resume_text_expires_at: Date | string | null;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function packageSubmissionHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function packageMetadataMatches(
  current: Record<string, unknown>,
  incoming: {
    answers: Array<{ stableFieldId: string; answer: string }>;
    unresolvedFields: Array<{ stableFieldId: string; question: string; reason: string }>;
    notes: string;
    documents: { resume: boolean; coverLetter: boolean };
  }
): boolean {
  return canonicalJson({
    answers: current.answers || [],
    unresolvedFields: current.unresolvedFields || [],
    notes: current.notes || '',
    documents: current.documents || { resume: false, coverLetter: false },
  }) === canonicalJson(incoming);
}

function isManager(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'manager') return true;
  res.status(403).json({ success: false, message: 'Only Managers can manage GPT application tasks.' });
  return false;
}

function actionKeyConfigured(res: Response): boolean {
  if (config.gptActionApiKey) return true;
  res.status(503).json({
    success: false,
    message: 'Custom GPT Action authentication is not configured on the server.',
  });
  return false;
}

function requireGptActionKey(req: Request, res: Response, next: NextFunction): void {
  if (!actionKeyConfigured(res)) return;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.slice(7) !== config.gptActionApiKey) {
    res.status(401).json({ success: false, message: 'Invalid Custom GPT Action key.' });
    return;
  }
  next();
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  return queryOne<TaskRow>(
    `SELECT task.task_id, task.job_id, job.u_id AS manager_user_id, task.status,
            task.page_number, task.task_context, task.package, task.answers, task.resume_text,
            task.resume_text_expires_at
     FROM gpt_application_tasks task
     JOIN job_list job ON job.j_id = task.job_id
     WHERE task.task_id = $1 AND job.application_type <> 'workable'`,
    [taskId]
  );
}

async function loadManagerTask(
  req: NewSchemaAuthRequest,
  res: Response,
  taskId: string
): Promise<TaskRow | null> {
  if (!taskIdSchema.safeParse(taskId).success) {
    res.status(400).json({ success: false, message: 'Provide a valid task ID.' });
    return null;
  }
  const task = await loadTask(taskId);
  if (!task || task.manager_user_id !== req.newSchemaUser?.id) {
    res.status(404).json({ success: false, message: 'GPT application task not found.' });
    return null;
  }
  return task;
}

function taskContextParts(context: Record<string, unknown>) {
  return {
    jobContext: context.jobContext || {},
    candidate: context.candidate || {},
    managerAnswers: context.managerAnswers || {},
    page: context.page || null,
  };
}

router.post('/jobs/:jobId', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  if (!actionKeyConfigured(res)) return;
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    res.status(400).json({ success: false, message: 'Provide a valid Account-specific job row ID.' });
    return;
  }
  const createOptions = createTaskSchema.safeParse(req.body || {});
  if (!createOptions.success) {
    res.status(400).json({ success: false, message: 'Provide valid job task details.' });
    return;
  }

  const context = await queryOne<Record<string, unknown>>(
    `SELECT job.j_id, job.u_id AS manager_user_id, job.status, job.application_type,
            job.title AS job_title, job.company, job.url,
            account.u_id AS account_id, account.name AS account_name,
            account.email, account.phone, account.address, account.city,
            account.country, account.sex, account.birthday,
            profile.first_name, profile.last_name, profile.resume_content,
            profile.education, profile.work_experience, profile.custom_fields,
            manager.managed_country,
            COALESCE(manager_profile.relocation_willing, FALSE) AS relocation_willing,
            manager_profile.notice_period_value,
            manager_profile.notice_period_unit, manager_profile.notice_period_text
     FROM job_list job
     JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
     JOIN users account ON account.u_id = assignment.account_user_id AND account.role = 'account'
     LEFT JOIN account_application_profiles profile ON profile.account_user_id = account.u_id
     JOIN users manager ON manager.u_id = job.u_id AND manager.role = 'manager'
     LEFT JOIN manager_application_profiles manager_profile ON manager_profile.manager_user_id = manager.u_id
     WHERE job.j_id = $1 AND job.u_id = $2 AND job.status = 'processing'
       AND job.application_type <> 'workable'`,
    [jobId, req.newSchemaUser!.id]
  );
  if (!context) {
    res.status(404).json({ success: false, message: 'Processing Account-specific job row not found.' });
    return;
  }

  const resumeBytes = context.resume_content;
  let resumeText = '';
  if (resumeBytes != null) {
    try {
      resumeText = await extractPdfText(Buffer.isBuffer(resumeBytes) ? resumeBytes : Buffer.from(resumeBytes as Uint8Array));
    } catch (error) {
      res.status(422).json({
        success: false,
        message: error instanceof Error ? error.message : 'Could not extract text from the saved resume PDF.',
      });
      return;
    }
  }

  const [salaryAnswers, customAnswers, accountCustomAnswers] = await Promise.all([
    queryAll(
      `SELECT currency, minimum_amount, maximum_amount, pay_period, answer_text
       FROM manager_salary_answers WHERE manager_user_id = $1 ORDER BY salary_answer_id`,
      [req.newSchemaUser!.id]
    ),
    queryAll(
      `SELECT topic, question, answer
       FROM manager_custom_application_answers WHERE manager_user_id = $1 ORDER BY custom_answer_id`,
      [req.newSchemaUser!.id]
    ),
    queryAll(
      `SELECT topic, question, answer
       FROM account_custom_application_answers
       WHERE account_user_id = $1 ORDER BY custom_answer_id`,
      [context.account_id]
    ),
  ]);
  const taskContext = {
    jobContext: {
      jobId: context.j_id,
      jobTitle: context.job_title,
      company: context.company,
      jobUrl: context.url,
      platform: createOptions.data.sourcePlatform || String(context.application_type),
      ...(createOptions.data.jobDescription
        ? { jobDescription: createOptions.data.jobDescription }
        : {}),
    },
    candidate: {
      accountId: context.account_id,
      fullName: context.account_name,
      firstName: context.first_name,
      lastName: context.last_name,
      email: context.email,
      phone: context.phone,
      address: context.address,
      city: context.city,
      country: context.country,
      sex: context.sex,
      birthday: context.birthday,
      education: context.education || [],
      workExperience: context.work_experience || [],
      customFields: context.custom_fields || [],
      customAnswers: accountCustomAnswers,
    },
    managerAnswers: {
      managedCountry: context.managed_country,
      relocationWilling: context.relocation_willing,
      noticePeriodValue: context.notice_period_value,
      noticePeriodUnit: context.notice_period_unit,
      noticePeriodText: context.notice_period_text,
      salaryAnswers,
      customAnswers,
    },
  };
  const taskId = `task_${randomUUID()}`;
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const inserted = await queryOne<{ task_id: string; status: string }>(
    `INSERT INTO gpt_application_tasks (
       task_id, job_id, task_context, resume_text, resume_text_expires_at
     ) VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (job_id) DO NOTHING
     RETURNING task_id, status`,
    [taskId, jobId, JSON.stringify(taskContext), resumeText || null, resumeText ? expiry : null]
  );
  const existing = inserted || await queryOne<{ task_id: string; status: string }>(
    `SELECT task_id, status FROM gpt_application_tasks WHERE job_id = $1`,
    [jobId]
  );
  if (!existing) {
    res.status(500).json({ success: false, message: 'Could not create the GPT application task for this job row.' });
    return;
  }
  if (!inserted && !['waiting_for_page', 'ready'].includes(existing.status)) {
    res.status(409).json({
      success: false,
      taskId: existing.task_id,
      status: existing.status,
      message: `The existing GPT task is ${existing.status}; it cannot be refreshed while active or closed.`,
    });
    return;
  }
  if (!inserted) {
    const refreshed = await execute(
      `UPDATE gpt_application_tasks
       SET task_context = jsonb_set(
             jsonb_set(
               jsonb_set(
                 task_context,
                 '{jobContext}',
                 COALESCE(task_context->'jobContext', '{}'::jsonb) || $2::jsonb,
                 true
               ),
               '{candidate}', $3::jsonb, true
             ),
             '{managerAnswers}', $4::jsonb, true
           ),
           resume_text = CASE
             WHEN resume_text IS NULL OR resume_text_expires_at IS NULL OR resume_text_expires_at <= NOW()
               THEN $5
             ELSE resume_text
           END,
           resume_text_expires_at = CASE
             WHEN resume_text IS NULL OR resume_text_expires_at IS NULL OR resume_text_expires_at <= NOW()
               THEN CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
             ELSE resume_text_expires_at
           END,
           last_activity_at = NOW(), updated_at = NOW()
       WHERE task_id = $1 AND status IN ('waiting_for_page', 'ready')`,
      [
        existing.task_id,
        JSON.stringify(taskContext.jobContext),
        JSON.stringify(taskContext.candidate),
        JSON.stringify(taskContext.managerAnswers),
        resumeText,
      ]
    );
    if (!refreshed.rowCount) {
      res.status(409).json({
        success: false,
        message: 'The GPT task became active while Scanner was refreshing it; its existing context was left unchanged.',
      });
      return;
    }
  }

  res.status(inserted ? 201 : 200).json({
    success: true,
    taskId: existing.task_id,
    status: existing.status,
    resumeTextAvailable: Boolean(resumeText),
  });
});

router.put('/:taskId/page', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  if (task.status === 'completed' || task.status === 'failed') {
    res.status(409).json({ success: false, message: 'This GPT application task is already closed.' });
    return;
  }
  if (!['waiting_for_page', 'ready'].includes(task.status)) {
    res.status(409).json({
      success: false,
      message: `This GPT application task is ${task.status}; wait for the current page to finish before replacing it.`,
    });
    return;
  }
  const parsed = pageContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Provide a valid application page context.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const previousContext = task.task_context || {};
  const previousJob = (previousContext.jobContext || {}) as Record<string, unknown>;
  const page = parsed.data;
  const jobDescription = page.jobDescription?.trim() || String(previousJob.jobDescription || '').trim();
  const nextContext = {
    ...previousContext,
    jobContext: { ...previousJob, jobDescription },
    page: { ...page, jobDescription: undefined },
  };
  const updated = await execute(
    `UPDATE gpt_application_tasks
     SET task_context = $2::jsonb, page_number = $3, package = '{}'::jsonb,
         status = 'waiting_for_gpt', last_activity_at = NOW(), updated_at = NOW(),
         resume_text_expires_at = CASE WHEN resume_text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
     WHERE task_id = $1 AND status IN ('waiting_for_page', 'ready')`,
    [task.task_id, JSON.stringify(nextContext), page.pageNumber]
  );
  if (!updated.rowCount) {
    res.status(409).json({
      success: false,
      message: 'The GPT task changed while Scanner was preparing this page. Reload its status and try again.',
    });
    return;
  }
  res.json({ success: true, taskId: task.task_id, status: 'waiting_for_gpt', pageNumber: page.pageNumber });
});

router.post('/:taskId/scanner-acknowledge', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  if (!['waiting_for_gpt', 'ready'].includes(task.status)) {
    res.status(409).json({
      success: false,
      message: `This GPT task is ${task.status}; Scanner cannot acknowledge its current page.`,
    });
    return;
  }
  const updated = await execute(
    `UPDATE gpt_application_tasks
     SET status = 'waiting_for_page', last_activity_at = NOW(), updated_at = NOW()
     WHERE task_id = $1 AND status IN ('waiting_for_gpt', 'ready')`,
    [task.task_id]
  );
  if (!updated.rowCount) {
    res.status(409).json({
      success: false,
      message: 'The GPT task changed while Scanner was acknowledging this page. Reload its status and try again.',
    });
    return;
  }
  res.json({ success: true, taskId: task.task_id, status: 'waiting_for_page' });
});

router.get('/:taskId/context', requireGptActionKey, async (req, res: Response) => {
  const taskId = String(req.params.taskId || '');
  if (!taskIdSchema.safeParse(taskId).success) {
    res.status(400).json({ success: false, message: 'Provide a valid task ID.' });
    return;
  }
  const task = await loadTask(taskId);
  if (!task) {
    res.status(404).json({ success: false, message: 'GPT application task not found.' });
    return;
  }
  if (task.status !== 'waiting_for_gpt') {
    res.status(409).json({ success: false, message: 'No application page is currently waiting for a GPT response.' });
    return;
  }
  const { jobContext, candidate, managerAnswers, page } = taskContextParts(task.task_context);
  if (!String((jobContext as Record<string, unknown>).jobDescription || '').trim()) {
    res.status(409).json({ success: false, message: 'The job description has not been captured yet.' });
    return;
  }
  await execute(
    `UPDATE gpt_application_tasks
     SET last_activity_at = NOW(), updated_at = NOW(),
         resume_text_expires_at = CASE WHEN resume_text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
     WHERE task_id = $1`,
    [taskId]
  );
  res.json({
    success: true,
    taskId,
    pageNumber: task.page_number,
    jobContext,
    candidate,
    managerAnswers,
    resumeText: task.resume_text || '',
    previousAnswers: task.answers,
    previousUnresolvedFields: task.package.unresolvedFields || [],
    page,
  });
});

router.post('/:taskId/package', requireGptActionKey, async (req, res: Response) => {
  const taskId = String(req.params.taskId || '');
  if (!taskIdSchema.safeParse(taskId).success) {
    res.status(400).json({ success: false, message: 'Provide a valid task ID.' });
    return;
  }
  const task = await loadTask(taskId);
  if (!task) {
    res.status(404).json({ success: false, message: 'GPT application task not found.' });
    return;
  }
  const parsed = taskPackageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Provide a valid answer package.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  const unresolved = parsed.data.unresolvedFields || [];
  const submittedPackage = {
    answers: parsed.data.answers,
    unresolvedFields: unresolved,
    notes: parsed.data.notes || '',
    documents: {
      resume: Boolean(parsed.data.resume),
      coverLetter: Boolean(parsed.data.coverLetter),
    },
  };
  const submissionHash = packageSubmissionHash(parsed.data);
  if (task.status === 'ready') {
    const storedHash = task.package.submissionHash;
    const sameSubmission = typeof storedHash === 'string'
      ? storedHash === submissionHash
      : packageMetadataMatches(task.package, submittedPackage);
    if (sameSubmission) {
      res.json({
        success: true,
        taskId,
        status: 'ready',
        pageNumber: task.page_number,
        answersStored: parsed.data.answers.length,
        unresolvedCount: unresolved.length,
        documents: submittedPackage.documents,
        idempotentReplay: true,
      });
      return;
    }
    res.status(409).json({
      success: false,
      message: 'A different answer package has already been saved for this task.',
    });
    return;
  }
  if (task.status !== 'waiting_for_gpt') {
    res.status(409).json({ success: false, message: 'This task is not waiting for a GPT response.' });
    return;
  }
  const page = (task.task_context.page || {}) as { fields?: Array<{ stableFieldId: string }> };
  const validFieldIds = new Set((page.fields || []).map((field) => field.stableFieldId));
  const answerIds = new Set<string>();
  for (const answer of parsed.data.answers) {
    if (!validFieldIds.has(answer.stableFieldId)) {
      res.status(400).json({
        success: false,
        message: `Answer references a field that is not on the current page: ${answer.stableFieldId}`,
      });
      return;
    }
    if (answerIds.has(answer.stableFieldId)) {
      res.status(400).json({
        success: false,
        message: `Answer package contains a duplicate field: ${answer.stableFieldId}`,
      });
      return;
    }
    answerIds.add(answer.stableFieldId);
  }

  const mergedAnswers = new Map(
    (task.answers || []).map((answer) => [answer.stableFieldId, answer.answer])
  );
  for (const answer of parsed.data.answers) {
    mergedAnswers.set(answer.stableFieldId, answer.answer);
  }
  const allAnswers = [...mergedAnswers].map(([stableFieldId, answer]) => ({
    stableFieldId,
    answer,
  }));
  const packageData = { ...submittedPackage, submissionHash };
  if (!parsed.data.answers.length && !unresolved.length && !parsed.data.resume && !parsed.data.coverLetter) {
    res.status(400).json({ success: false, message: 'Package must include answers, documents, or unresolved fields.' });
    return;
  }
  const pageFields = (page.fields || []) as Array<{ fieldType?: string; documentSlot?: 'resume' | 'cover_letter'; required?: boolean }>;
  const requestedDocuments = new Set(
    pageFields.filter((field) => field.fieldType === 'file')
      .map((field) => field.documentSlot || 'resume')
  );
  if (parsed.data.resume && !requestedDocuments.has('resume')) {
    res.status(400).json({ success: false, message: 'Resume JSON was not requested by a file field on the current page.' });
    return;
  }
  if (parsed.data.coverLetter && !requestedDocuments.has('cover_letter')) {
    res.status(400).json({ success: false, message: 'Cover letter JSON was not requested by a file field on the current page.' });
    return;
  }
  if (pageFields.some((field) => field.fieldType === 'file' && field.required) &&
      [...requestedDocuments].some((type) =>
        pageFields.some((field) => field.fieldType === 'file' && field.required
          && (field.documentSlot || 'resume') === type)
          && (type === 'resume' ? !parsed.data.resume : !parsed.data.coverLetter)
      )) {
    res.status(400).json({ success: false, message: 'The package is missing JSON for a required document upload on this page.' });
    return;
  }

  const documents: Array<{ type: 'resume' | 'cover_letter'; fileName: string; content: Buffer }> = [];
  if (parsed.data.resume) {
    documents.push({
      type: 'resume',
      fileName: `${safePdfFileName(parsed.data.resume.candidate.fullName)}_Resume.pdf`,
      content: await renderResumePdfBuffer(parsed.data.resume),
    });
  }
  if (parsed.data.coverLetter) {
    documents.push({
      type: 'cover_letter',
      fileName: `${safePdfFileName(parsed.data.coverLetter.candidate.fullName)}_Cover_Letter.pdf`,
      content: await renderCoverLetterPdfBuffer(parsed.data.coverLetter),
    });
  }

  for (const document of documents) {
    await execute(
      `INSERT INTO gpt_application_task_documents (task_id, document_type, file_name, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, document_type)
       DO UPDATE SET file_name = EXCLUDED.file_name, content = EXCLUDED.content, updated_at = NOW()`,
      [taskId, document.type, document.fileName, document.content]
    );
  }
  const nextStatus = unresolved.length ? 'waiting_for_gpt' : 'ready';
  await execute(
    `UPDATE gpt_application_tasks
     SET package = $2::jsonb, answers = $3::jsonb, status = $4,
         last_activity_at = NOW(), updated_at = NOW(),
         resume_text_expires_at = CASE WHEN resume_text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
     WHERE task_id = $1 AND status = 'waiting_for_gpt'`,
    [taskId, JSON.stringify(packageData), JSON.stringify(allAnswers), nextStatus]
  );
  res.json({
    success: true,
    taskId,
    status: nextStatus,
    pageNumber: task.page_number,
    answersStored: parsed.data.answers.length,
    unresolvedCount: unresolved.length,
    documents: packageData.documents,
  });
});

router.get('/:taskId/status', requireGptActionKey, async (req, res: Response) => {
  const taskId = String(req.params.taskId || '');
  if (!taskIdSchema.safeParse(taskId).success) {
    res.status(400).json({ success: false, message: 'Provide a valid task ID.' });
    return;
  }
  const task = await loadTask(taskId);
  if (!task) {
    res.status(404).json({ success: false, message: 'GPT application task not found.' });
    return;
  }
  await execute(
    `UPDATE gpt_application_tasks SET last_activity_at = NOW(), updated_at = NOW(),
       resume_text_expires_at = CASE WHEN resume_text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
     WHERE task_id = $1`,
    [taskId]
  );
  res.json({
    success: true,
    taskId,
    status: task.status,
    pageNumber: task.page_number,
    answers: task.answers,
    package: task.package,
  });
});

router.get('/:taskId/extension-status', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  await execute(
    `UPDATE gpt_application_tasks
     SET last_activity_at = NOW(), updated_at = NOW(),
         resume_text_expires_at = CASE WHEN resume_text IS NULL THEN NULL ELSE NOW() + INTERVAL '30 days' END
     WHERE task_id = $1`,
    [task.task_id]
  );
  res.json({
    success: true,
    taskId: task.task_id,
    status: task.status,
    pageNumber: task.page_number,
    jobContext: task.task_context.jobContext || {},
    page: task.task_context.page || null,
    answers: task.answers,
    package: task.package,
  });
});

router.get('/:taskId/documents/:documentType', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  const documentType = req.params.documentType;
  if (documentType !== 'resume' && documentType !== 'cover_letter') {
    res.status(400).json({ success: false, message: 'Document type must be resume or cover_letter.' });
    return;
  }
  const document = await queryOne<{ file_name: string; content: Buffer }>(
    `SELECT file_name, content FROM gpt_application_task_documents
     WHERE task_id = $1 AND document_type = $2`,
    [task.task_id, documentType]
  );
  if (!document) {
    res.status(404).json({ success: false, message: 'Generated document not found.' });
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${document.file_name.replace(/["\\\r\n]/g, '_')}"`);
  res.send(document.content);
});

router.delete('/:taskId/documents/:documentType', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  const documentType = req.params.documentType;
  if (documentType !== 'resume' && documentType !== 'cover_letter') {
    res.status(400).json({ success: false, message: 'Document type must be resume or cover_letter.' });
    return;
  }
  const result = await execute(
    `DELETE FROM gpt_application_task_documents
     WHERE task_id = $1 AND document_type = $2`,
    [task.task_id, documentType]
  );
  if (!result.rowCount) {
    res.status(404).json({ success: false, message: 'Generated document was not found or was already removed.' });
    return;
  }
  res.json({ success: true, taskId: task.task_id, documentType, deleted: true });
});

router.post('/:taskId/finish', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  if (!isManager(req, res)) return;
  const task = await loadManagerTask(req, res, req.params.taskId);
  if (!task) return;
  const result = await execute(
    `UPDATE gpt_application_tasks
     SET status = 'completed',
         task_context = jsonb_build_object('jobContext', COALESCE(task_context->'jobContext', '{}'::jsonb)),
         resume_text = NULL, resume_text_expires_at = NULL,
         last_activity_at = NOW(), updated_at = NOW()
     WHERE gpt_application_tasks.task_id = $1
       AND gpt_application_tasks.status <> 'failed'
       AND EXISTS (
         SELECT 1 FROM job_list job
         WHERE job.j_id = gpt_application_tasks.job_id
           AND job.u_id = $2 AND job.status IN ('did', 'failed')
       )`,
    [task.task_id, req.newSchemaUser!.id]
  );
  if (!result.rowCount) {
    res.status(409).json({ success: false, message: 'Finish the Account-specific job row before closing its GPT task.' });
    return;
  }
  res.json({ success: true, taskId: task.task_id, status: 'completed' });
});

router.post('/cleanup', async (req, res: Response) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(503).json({ success: false, message: 'Scheduled cleanup authentication is not configured.' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ success: false, message: 'Invalid scheduled cleanup credential.' });
    return;
  }
  const result = await execute(
    `UPDATE gpt_application_tasks
     SET task_context = jsonb_build_object('jobContext', COALESCE(task_context->'jobContext', '{}'::jsonb)),
         resume_text = NULL, resume_text_expires_at = NULL, updated_at = NOW()
     WHERE last_activity_at <= NOW() - INTERVAL '30 days'
       AND (resume_text IS NOT NULL OR task_context ? 'candidate')`
  );
  res.json({ success: true, expiredTaskContextsCleared: result.rowCount || 0 });
});

export default router;
