"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const normalize_url_1 = require("../../utilities/normalize-url");
const logger_1 = require("../../utilities/logger");
const application_task_id_1 = require("./application-task-id");
const application_documents_routes_1 = __importDefault(require("./application-documents.routes"));
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.use(auth_1.requireAdminOrBidder);
router.use('/:id/documents', application_documents_routes_1.default);
const FieldCategorySchema = zod_1.z.enum([
    'candidate_profile',
    'saved_answer',
    'ai_generation',
    'document_upload',
    'unknown',
]);
const FillStatusSchema = zod_1.z.enum(['pending', 'filled', 'skipped', 'awaiting_answer', 'error', 'manual']);
const CreateSessionSchema = zod_1.z.object({
    candidateId: zod_1.z.number().int().positive(),
    jobId: zod_1.z.number().int().positive().optional().nullable(),
    jobUrl: zod_1.z.string().url(),
    jobTitle: zod_1.z.string().optional().nullable(),
    company: zod_1.z.string().optional().nullable(),
    jobDescription: zod_1.z.string().optional().nullable(),
    platform: zod_1.z.string().optional().nullable(),
    currentStep: zod_1.z.string().optional().nullable(),
    discoveredPages: zod_1.z.array(zod_1.z.record(zod_1.z.unknown())).optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
});
const SessionFieldSchema = zod_1.z.object({
    stableFieldId: zod_1.z.string().min(1).max(500),
    label: zod_1.z.string().optional().nullable(),
    fieldType: zod_1.z.string().min(1).max(100),
    required: zod_1.z.boolean().optional().default(false),
    options: zod_1.z.array(zod_1.z.string()).optional().nullable(),
    currentValue: zod_1.z.string().optional().nullable(),
    placeholder: zod_1.z.string().optional().nullable(),
    sectionHeading: zod_1.z.string().optional().nullable(),
    pageStep: zod_1.z.string().optional().nullable(),
    pageUrl: zod_1.z.string().optional().nullable(),
    nameAttr: zod_1.z.string().optional().nullable(),
    autocompleteAttr: zod_1.z.string().optional().nullable(),
    validationMessage: zod_1.z.string().optional().nullable(),
    selectorHints: zod_1.z.record(zod_1.z.unknown()).optional().nullable(),
    fieldFingerprint: zod_1.z.string().min(1).max(500),
    category: FieldCategorySchema.optional().default('unknown'),
    profileKey: zod_1.z.string().optional().nullable(),
    savedAnswerKey: zod_1.z.string().optional().nullable(),
    documentSlot: zod_1.z.enum(['resume', 'cover_letter']).optional().nullable(),
    fillValue: zod_1.z.string().optional().nullable(),
    fillStatus: FillStatusSchema.optional().default('pending'),
    generatedAnswer: zod_1.z.string().optional().nullable(),
});
const PatchFieldsSchema = zod_1.z.object({
    fields: zod_1.z.array(SessionFieldSchema).min(1),
    currentStep: zod_1.z.string().optional().nullable(),
    discoveredPages: zod_1.z.array(zod_1.z.record(zod_1.z.unknown())).optional(),
    status: zod_1.z.enum(['active', 'scanning', 'filling', 'awaiting_ai', 'completed', 'abandoned', 'error']).optional(),
});
const SubmitAnswersSchema = zod_1.z.object({
    answers: zod_1.z.array(zod_1.z.object({
        stableFieldId: zod_1.z.string().min(1),
        answer: zod_1.z.string(),
    })).min(1),
});
async function canAccessCandidate(req, candidateId) {
    if (req.role === 'admin')
        return true;
    if ((0, scope_1.isBidder)(req) && req.bidderId) {
        const row = await (0, connection_1.queryOne)('SELECT id FROM candidates WHERE id = $1 AND bidder_id = $2', [candidateId, req.bidderId]);
        return Boolean(row);
    }
    return false;
}
async function getSessionForRequest(req, sessionId) {
    const scope = (0, scope_1.candidateBidderFilter)(req, 'c', 2);
    let query = `
    SELECT s.*,
      c.name AS candidate_name,
      c.email AS candidate_email,
      c.phone AS candidate_phone,
      c.linkedin_url AS candidate_linkedin_url
    FROM application_sessions s
    JOIN candidates c ON c.id = s.candidate_id
    WHERE s.id = $1`;
    const params = [sessionId];
    if (scope.clause) {
        query += ` AND ${scope.clause}`;
        params.push(...scope.params);
    }
    return (0, connection_1.queryOne)(query, params);
}
function mapSessionRow(row) {
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
function mapFieldRow(row) {
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
router.post('/', async (req, res) => {
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
    const candidate = await (0, connection_1.queryOne)('SELECT bidder_id FROM candidates WHERE id = $1', [data.candidateId]);
    if (!candidate?.bidder_id) {
        res.status(400).json({ success: false, message: 'Candidate is not linked to a bidder organization.' });
        return;
    }
    if ((0, scope_1.isBidder)(req) && req.bidderId !== candidate.bidder_id) {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return;
    }
    const bidderId = candidate.bidder_id;
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return;
    }
    const normalized = (0, normalize_url_1.normalizeUrl)(data.jobUrl);
    const publicTaskId = (0, application_task_id_1.createPublicTaskId)();
    const sessionMetadata = {
        ...(data.metadata ?? {}),
        publicTaskId,
        taskId: publicTaskId,
    };
    const inserted = await (0, connection_1.queryOne)(`INSERT INTO application_sessions (
      candidate_id, job_id, user_id, bidder_id,
      job_url, normalized_url, job_title, company, job_description,
      platform, current_step, discovered_pages, metadata, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, 'scanning')
    RETURNING *`, [
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
    ]);
    if (!inserted) {
        res.status(500).json({ success: false, message: 'Could not create application session.' });
        return;
    }
    const savedAnswers = await (0, connection_1.queryAll)(`SELECT answer_key, answer_value, approved
     FROM candidate_saved_answers
     WHERE candidate_id = $1 AND approved = TRUE
     ORDER BY answer_key ASC`, [data.candidateId]);
    logger_1.logger.info('Application session created', { sessionId: inserted.id, candidateId: data.candidateId });
    const applicationId = Number(inserted.id);
    res.status(201).json({
        success: true,
        taskId: publicTaskId,
        session: mapSessionRow(inserted),
        savedAnswers: savedAnswers.map((row) => ({
            answerKey: row.answer_key,
            answerValue: row.answer_value,
            approved: row.approved,
        })),
    });
});
router.patch('/:id/fields', async (req, res) => {
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
    const aiPending = fields.some((f) => (f.category === 'ai_generation' || f.category === 'document_upload')
        && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer'));
    await (0, connection_1.withTransaction)(async (client) => {
        for (const field of fields) {
            await client.query(`INSERT INTO application_session_fields (
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
          updated_at = NOW()`, [
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
            ]);
        }
        const nextStatus = status ?? (aiPending ? 'awaiting_ai' : 'filling');
        await client.query(`UPDATE application_sessions
       SET current_step = COALESCE($2, current_step),
           discovered_pages = COALESCE($3::jsonb, discovered_pages),
           status = $4,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`, [
            sessionId,
            currentStep ?? null,
            discoveredPages ? JSON.stringify(discoveredPages) : null,
            nextStatus,
        ]);
    });
    const updatedFields = await (0, connection_1.queryAll)('SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
    res.json({
        success: true,
        fields: updatedFields.map((row) => mapFieldRow(row)),
        pendingAiCount: updatedFields.filter((row) => (row.category === 'ai_generation' || row.category === 'document_upload')
            && (row.fill_status === 'pending' || row.fill_status === 'awaiting_answer')
            && (row.required === true || row.required === 't')).length,
    });
});
router.get('/:id', async (req, res) => {
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
    const fields = await (0, connection_1.queryAll)('SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
    res.json({
        success: true,
        session: mapSessionRow(session),
        fields: fields.map((row) => mapFieldRow(row)),
    });
});
router.get('/:id/pending-fields', async (req, res) => {
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
    const fields = await (0, connection_1.queryAll)(`SELECT * FROM application_session_fields
     WHERE session_id = $1
       AND category IN ('ai_generation', 'document_upload')
       AND fill_status IN ('pending', 'awaiting_answer')
     ORDER BY required DESC, id ASC`, [sessionId]);
    res.json({
        success: true,
        applicationId: sessionId,
        pendingFields: fields.map((row) => mapFieldRow(row)),
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
router.post('/:id/answers', async (req, res) => {
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
    const generatedAnswers = {
        ...(typeof session.generated_answers === 'object' && session.generated_answers
            ? session.generated_answers
            : {}),
    };
    for (const item of parsed.data.answers) {
        generatedAnswers[item.stableFieldId] = item.answer;
        await (0, connection_1.execute)(`UPDATE application_session_fields
       SET generated_answer = $3,
           fill_value = $3,
           fill_status = 'filled',
           updated_at = NOW()
       WHERE session_id = $1 AND stable_field_id = $2`, [sessionId, item.stableFieldId, item.answer]);
    }
    const remaining = await (0, connection_1.queryOne)(`SELECT COUNT(*)::int AS count FROM application_session_fields
     WHERE session_id = $1
       AND category = 'ai_generation'
       AND fill_status IN ('pending', 'awaiting_answer')`, [sessionId]);
    const allAnswered = Number(remaining?.count ?? 0) === 0;
    await (0, connection_1.execute)(`UPDATE application_sessions
     SET generated_answers = $2::jsonb,
         status = $3,
         last_activity_at = NOW(),
         updated_at = NOW(),
         completed_at = CASE WHEN $4 THEN NOW() ELSE completed_at END
     WHERE id = $1`, [
        sessionId,
        JSON.stringify(generatedAnswers),
        allAnswered ? 'completed' : 'awaiting_ai',
        allAnswered,
    ]);
    res.json({
        success: true,
        applicationId: sessionId,
        answersStored: parsed.data.answers.length,
        allAiFieldsAnswered: allAnswered,
        generatedAnswers,
    });
});
router.get('/:id/result', async (req, res) => {
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
    const fields = await (0, connection_1.queryAll)('SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
    const mapped = fields.map((row) => mapFieldRow(row));
    const summary = {
        totalFields: mapped.length,
        filled: mapped.filter((f) => f.fillStatus === 'filled').length,
        pending: mapped.filter((f) => f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer').length,
        skipped: mapped.filter((f) => f.fillStatus === 'skipped').length,
        errors: mapped.filter((f) => f.fillStatus === 'error').length,
        candidateProfile: mapped.filter((f) => f.category === 'candidate_profile').length,
        savedAnswers: mapped.filter((f) => f.category === 'saved_answer').length,
        aiGeneration: mapped.filter((f) => f.category === 'ai_generation').length,
        aiPending: mapped.filter((f) => f.category === 'ai_generation' && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')).length,
    };
    res.json({
        success: true,
        session: mapSessionRow(session),
        summary,
        fields: mapped,
        pendingAiFields: mapped.filter((f) => f.category === 'ai_generation' && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')),
    });
});
exports.default = router;
//# sourceMappingURL=application-sessions.routes.js.map