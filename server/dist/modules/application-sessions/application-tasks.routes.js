"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const logger_1 = require("../../utilities/logger");
const env_1 = require("../../config/env");
const application_session_store_1 = require("../../services/application-session-store");
const document_builder_1 = require("../document-builder");
const application_task_id_1 = require("./application-task-id");
const gpt_task_context_1 = require("./gpt-task-context");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuthOrGptActionKey);
router.use((req, res, next) => {
    if (req.gptServiceAuth) {
        next();
        return;
    }
    (0, auth_1.requireAdminOrBidder)(req, res, next);
});
const AnswerItemSchema = zod_1.z.object({
    stableFieldId: zod_1.z.string().min(1),
    answer: zod_1.z.string(),
});
async function getSessionForRequest(req, sessionId) {
    if (!env_1.config.applicationSessionPersistDb) {
        const session = (0, application_session_store_1.getMemoryApplicationSession)(sessionId);
        if (!session)
            return null;
        if (!req.gptServiceAuth && req.role !== 'admin' && req.bidderId != null && req.bidderId !== session.bidder_id) {
            return null;
        }
        return session;
    }
    if (req.gptServiceAuth) {
        return (0, connection_1.queryOne)(`SELECT s.*,
        c.name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.linkedin_url AS candidate_linkedin_url,
        c.stack AS candidate_stack
      FROM application_sessions s
      JOIN candidates c ON c.id = s.candidate_id
      WHERE s.id = $1`, [sessionId]);
    }
    const scope = (0, scope_1.candidateBidderFilter)(req, 'c', 2);
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
    const params = [sessionId];
    if (scope.clause) {
        query += ` AND ${scope.clause}`;
        params.push(...scope.params);
    }
    return (0, connection_1.queryOne)(query, params);
}
function mapFieldRow(row) {
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
function readMetadata(session) {
    const raw = session.metadata;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}
function readGptTask(metadata) {
    const gptTask = metadata.gptTask;
    if (gptTask && typeof gptTask === 'object' && !Array.isArray(gptTask)) {
        return gptTask;
    }
    return {};
}
async function resolveSessionIdFromTaskId(taskIdParam) {
    if (!env_1.config.applicationSessionPersistDb) {
        return (0, application_session_store_1.resolveMemorySessionIdFromTaskId)(taskIdParam);
    }
    const legacy = (0, application_task_id_1.parseLegacySessionId)(taskIdParam);
    if (legacy != null)
        return legacy;
    const trimmed = String(taskIdParam || '').trim();
    if (!(0, application_task_id_1.isPublicTaskId)(trimmed))
        return null;
    const row = await (0, connection_1.queryOne)(`SELECT id FROM application_sessions
     WHERE metadata->>'publicTaskId' = $1 OR metadata->>'taskId' = $1
     LIMIT 1`, [trimmed]);
    return row?.id ?? null;
}
function taskIdForSession(sessionId, session) {
    return (0, application_task_id_1.readPublicTaskId)(readMetadata(session)) || (0, application_task_id_1.formatTaskId)(sessionId);
}
async function loadSessionContext(req, taskIdParam) {
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
    const fields = env_1.config.applicationSessionPersistDb
        ? await (0, connection_1.queryAll)('SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC', [sessionId])
        : (0, application_session_store_1.listMemorySessionFields)(sessionId);
    const mapped = fields.map((row) => mapFieldRow(row));
    return { sessionId, session, fields: mapped };
}
function inferSuggestedDocumentForPackage(label, nameAttr) {
    return (0, gpt_task_context_1.inferSuggestedDocument)(label, nameAttr);
}
router.post('/:taskId/dispatch', async (req, res) => {
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
    if (!env_1.config.applicationSessionPersistDb) {
        (0, application_session_store_1.updateMemorySession)(sessionId, {
            metadata: { ...metadata, taskId: publicTaskId, publicTaskId, gptTask },
            status: 'awaiting_ai',
        });
    }
    else {
        await (0, connection_1.execute)(`UPDATE application_sessions
       SET metadata = $2::jsonb,
           status = 'awaiting_ai',
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`, [sessionId, JSON.stringify({ ...metadata, taskId: publicTaskId, publicTaskId, gptTask })]);
    }
    logger_1.logger.info('GPT task dispatched', { sessionId, taskId: publicTaskId });
    res.json({
        success: true,
        taskId: publicTaskId,
        applicationId: sessionId,
        gptTaskStatus: 'waiting_for_gpt',
    });
});
router.get('/:taskId/context', async (req, res) => {
    const loaded = await loadSessionContext(req, req.params.taskId);
    if (loaded.error) {
        res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
        return;
    }
    const { sessionId, session, fields } = loaded;
    const metadata = readMetadata(session);
    const publicTaskId = taskIdForSession(sessionId, session);
    const pendingAiFields = fields.filter((f) => f.category === 'ai_generation' && f.fillStatus !== 'filled');
    const fileFields = fields
        .filter((f) => f.fieldType === 'file')
        .map((f) => (0, gpt_task_context_1.mapFileFieldForGpt)(f));
    const documentGeneration = (0, gpt_task_context_1.buildDocumentGeneration)(fileFields);
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
        packageSchema: (0, gpt_task_context_1.buildPackageSchemaRef)(),
        allFields: fields,
        documentRequirements: {
            resumeRequired: fileFields.some((f) => f.suggestedDocument === 'resume'),
            coverLetterRecommended: fileFields.some((f) => f.suggestedDocument === 'cover_letter'),
        },
    });
});
router.get('/:taskId/status', async (req, res) => {
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
    const aiPending = fields.filter((f) => (f.category === 'ai_generation' || f.category === 'document_upload')
        && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')).length;
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
router.post('/:taskId/package', async (req, res) => {
    const loaded = await loadSessionContext(req, req.params.taskId);
    if (loaded.error) {
        res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
        return;
    }
    const parsed = document_builder_1.GptApplicationPackageSchema.safeParse(req.body);
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
    const generatedAnswers = {
        ...(typeof session.generated_answers === 'object' && session.generated_answers
            ? session.generated_answers
            : {}),
    };
    if (!env_1.config.applicationSessionPersistDb) {
        for (const item of allAnswers) {
            generatedAnswers[item.stableFieldId] = item.answer;
            (0, application_session_store_1.updateMemorySessionField)(sessionId, item.stableFieldId, {
                generated_answer: item.answer,
                fill_value: item.answer,
                fill_status: 'filled',
            });
        }
    }
    else {
        await (0, connection_1.withTransaction)(async (client) => {
            for (const item of allAnswers) {
                generatedAnswers[item.stableFieldId] = item.answer;
                await client.query(`UPDATE application_session_fields
           SET generated_answer = $3,
               fill_value = $3,
               fill_status = 'filled',
               updated_at = NOW()
           WHERE session_id = $1 AND stable_field_id = $2`, [sessionId, item.stableFieldId, item.answer]);
            }
        });
    }
    let documentManifest = null;
    let documents = {};
    if (packageData.resume || packageData.coverLetter) {
        documentManifest = await (0, document_builder_1.buildApplicationDocuments)(sessionId, {
            resume: packageData.resume,
            coverLetter: packageData.coverLetter,
        });
        documents = documentManifest.paths;
    }
    const fileFieldRows = env_1.config.applicationSessionPersistDb
        ? await (0, connection_1.queryAll)(`SELECT stable_field_id, label, name_attr FROM application_session_fields
       WHERE session_id = $1 AND field_type = 'file'`, [sessionId])
        : (0, application_session_store_1.listMemorySessionFields)(sessionId).filter((row) => row.field_type === 'file');
    for (const row of fileFieldRows) {
        const slot = inferSuggestedDocumentForPackage(row.label, row.name_attr);
        const docKey = slot === 'cover_letter' ? 'coverLetterPdfPath' : 'resumePdfPath';
        if (!documents[docKey])
            continue;
        if (!env_1.config.applicationSessionPersistDb) {
            (0, application_session_store_1.updateMemorySessionField)(sessionId, String(row.stable_field_id), {
                fill_status: 'awaiting_answer',
                generated_answer: slot,
            });
            continue;
        }
        await (0, connection_1.execute)(`UPDATE application_session_fields
       SET fill_status = 'awaiting_answer',
           generated_answer = $3,
           updated_at = NOW()
       WHERE session_id = $1 AND stable_field_id = $2`, [sessionId, row.stable_field_id, slot]);
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
    const nextMetadata = {
        ...metadata,
        taskId: publicTaskId,
        publicTaskId,
        gptTask,
        documents: { ...(metadata.documents || {}), ...documents },
        documentManifest,
    };
    if (!env_1.config.applicationSessionPersistDb) {
        (0, application_session_store_1.updateMemorySession)(sessionId, {
            generated_answers: generatedAnswers,
            metadata: nextMetadata,
            status: 'filling',
        });
    }
    else {
        await (0, connection_1.execute)(`UPDATE application_sessions
       SET generated_answers = $2::jsonb,
           metadata = $3::jsonb,
           status = 'filling',
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`, [
            sessionId,
            JSON.stringify(generatedAnswers),
            JSON.stringify(nextMetadata),
        ]);
    }
    logger_1.logger.info('GPT package stored', {
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
exports.default = router;
//# sourceMappingURL=application-tasks.routes.js.map