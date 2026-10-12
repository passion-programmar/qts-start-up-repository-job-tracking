"use strict";
// In-memory apply session store (server-side). Extension mirror: extension/shared/apply-session-store.js
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_APPLICATION_SESSION_TTL_MS = void 0;
exports.registerMemorySessionCleanupListener = registerMemorySessionCleanupListener;
exports.readPublicTaskIdFromSession = readPublicTaskIdFromSession;
exports.createMemoryApplicationSession = createMemoryApplicationSession;
exports.getMemoryApplicationSession = getMemoryApplicationSession;
exports.resolveMemorySessionIdFromTaskId = resolveMemorySessionIdFromTaskId;
exports.upsertMemorySessionFields = upsertMemorySessionFields;
exports.listMemorySessionFields = listMemorySessionFields;
exports.updateMemorySession = updateMemorySession;
exports.updateMemorySessionField = updateMemorySessionField;
exports.countMemoryPendingAiFields = countMemoryPendingAiFields;
const application_task_id_1 = require("../modules/application-sessions/application-task-id");
const normalize_url_1 = require("../utilities/normalize-url");
exports.MEMORY_APPLICATION_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let nextSessionId = 1000000;
let nextFieldId = 1;
const sessionsById = new Map();
const sessionIdByTaskId = new Map();
const fieldsBySessionId = new Map();
const sessionCleanupListeners = new Set();
function registerMemorySessionCleanupListener(listener) {
    sessionCleanupListeners.add(listener);
}
function nowIso() {
    return new Date().toISOString();
}
function touchSession(session) {
    session.last_activity_at = nowIso();
    session.updated_at = nowIso();
}
function pruneExpiredSessions() {
    const cutoff = Date.now() - exports.MEMORY_APPLICATION_SESSION_TTL_MS;
    for (const [id, session] of sessionsById) {
        const last = Date.parse(session.last_activity_at || session.created_at);
        if (!Number.isFinite(last) || last < cutoff) {
            sessionsById.delete(id);
            fieldsBySessionId.delete(id);
            const taskId = readPublicTaskIdFromSession(session);
            if (taskId)
                sessionIdByTaskId.delete(taskId);
            for (const listener of sessionCleanupListeners) {
                listener(id);
            }
        }
    }
}
setInterval(pruneExpiredSessions, CLEANUP_INTERVAL_MS).unref?.();
function readPublicTaskIdFromSession(session) {
    const raw = session.metadata?.publicTaskId ?? session.metadata?.taskId;
    return typeof raw === 'string' && raw.startsWith('task_') ? raw : null;
}
function createMemoryApplicationSession(input) {
    pruneExpiredSessions();
    const id = nextSessionId++;
    const passedRaw = input.metadata?.publicTaskId ?? input.metadata?.taskId;
    const passedTaskId = typeof passedRaw === 'string' && passedRaw.startsWith('task_') ? passedRaw : null;
    const publicTaskId = passedTaskId ?? (0, application_task_id_1.createPublicTaskId)();
    const timestamp = nowIso();
    const normalizedMode = input.mode === 'DISCOVERY' || input.mode === 'REAL_APPLICATION' ? input.mode : null;
    const templateVersion = input.templateVersion ?? (typeof input.metadata?.templateVersion === 'string' ? input.metadata.templateVersion : null);
    const pageFingerprint = input.pageFingerprint ?? (typeof input.metadata?.pageFingerprint === 'string' ? input.metadata.pageFingerprint : null);
    const metadata = {
        ...(input.metadata ?? {}),
        publicTaskId,
        taskId: publicTaskId,
        ...(templateVersion ? { templateVersion } : {}),
        ...(pageFingerprint ? { pageFingerprint } : {}),
        ...(normalizedMode ? { mode: normalizedMode } : {}),
    };
    const session = {
        id,
        candidate_id: input.candidateId,
        job_id: input.jobId ?? null,
        user_id: input.userId,
        account_id: input.accountId,
        job_url: input.jobUrl,
        normalized_url: (0, normalize_url_1.normalizeUrl)(input.jobUrl),
        job_title: input.jobTitle ?? null,
        company: input.company ?? null,
        job_description: input.jobDescription ?? null,
        platform: input.platform ?? null,
        current_step: input.currentStep ?? 'scan',
        discovered_pages: input.discoveredPages ?? [],
        generated_answers: {},
        status: 'scanning',
        metadata,
        template_version: templateVersion,
        page_fingerprint: pageFingerprint,
        mode: normalizedMode,
        started_at: timestamp,
        last_activity_at: timestamp,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
        candidate_name: input.candidate?.name ?? null,
        candidate_email: input.candidate?.email ?? null,
        candidate_phone: input.candidate?.phone ?? null,
        candidate_linkedin_url: input.candidate?.linkedin_url ?? null,
        candidate_stack: input.candidate?.stack ?? null,
    };
    sessionsById.set(id, session);
    sessionIdByTaskId.set(publicTaskId, id);
    fieldsBySessionId.set(id, new Map());
    return session;
}
function getMemoryApplicationSession(sessionId) {
    pruneExpiredSessions();
    return sessionsById.get(sessionId) ?? null;
}
function resolveMemorySessionIdFromTaskId(taskIdParam) {
    pruneExpiredSessions();
    const trimmed = String(taskIdParam || '').trim();
    if (!trimmed)
        return null;
    const byTask = sessionIdByTaskId.get(trimmed);
    if (byTask)
        return byTask;
    for (const session of sessionsById.values()) {
        if (readPublicTaskIdFromSession(session) === trimmed)
            return session.id;
    }
    const legacy = trimmed.match(/^task_(\d+)$/i);
    if (legacy) {
        const id = parseInt(legacy[1], 10);
        return sessionsById.has(id) ? id : null;
    }
    if (/^\d+$/.test(trimmed)) {
        const id = parseInt(trimmed, 10);
        return sessionsById.has(id) ? id : null;
    }
    return null;
}
function upsertMemorySessionFields(sessionId, fields, updates) {
    const session = sessionsById.get(sessionId);
    if (!session)
        return [];
    const fieldMap = fieldsBySessionId.get(sessionId) ?? new Map();
    const timestamp = nowIso();
    for (const field of fields) {
        const existing = fieldMap.get(field.stableFieldId);
        const next = {
            id: existing?.id ?? nextFieldId++,
            session_id: sessionId,
            stable_field_id: field.stableFieldId,
            label: field.label ?? null,
            field_type: field.fieldType,
            required: field.required ?? false,
            options: field.options ?? [],
            current_value: field.currentValue ?? null,
            placeholder: field.placeholder ?? null,
            section_heading: field.sectionHeading ?? null,
            page_step: field.pageStep ?? null,
            page_url: field.pageUrl ?? null,
            name_attr: field.nameAttr ?? null,
            autocomplete_attr: field.autocompleteAttr ?? null,
            validation_message: field.validationMessage ?? null,
            selector_hints: field.selectorHints ?? {},
            field_fingerprint: field.fieldFingerprint,
            category: field.category ?? 'unknown',
            profile_key: field.profileKey ?? null,
            saved_answer_key: field.savedAnswerKey ?? null,
            document_slot: field.documentSlot ?? null,
            fill_value: field.fillValue ?? null,
            fill_status: field.fillStatus ?? 'pending',
            generated_answer: field.generatedAnswer ?? null,
            discovered_at: existing?.discovered_at ?? timestamp,
            updated_at: timestamp,
        };
        fieldMap.set(field.stableFieldId, next);
    }
    fieldsBySessionId.set(sessionId, fieldMap);
    if (updates?.currentStep)
        session.current_step = updates.currentStep;
    if (updates?.discoveredPages)
        session.discovered_pages = updates.discoveredPages;
    if (updates?.status)
        session.status = updates.status;
    touchSession(session);
    return listMemorySessionFields(sessionId);
}
function listMemorySessionFields(sessionId) {
    const fieldMap = fieldsBySessionId.get(sessionId);
    if (!fieldMap)
        return [];
    return [...fieldMap.values()].sort((a, b) => a.id - b.id);
}
function updateMemorySession(sessionId, patch) {
    const session = sessionsById.get(sessionId);
    if (!session)
        return null;
    if (patch.status !== undefined)
        session.status = patch.status;
    if (patch.current_step !== undefined)
        session.current_step = patch.current_step;
    if (patch.discovered_pages !== undefined)
        session.discovered_pages = patch.discovered_pages;
    if (patch.generated_answers !== undefined)
        session.generated_answers = patch.generated_answers;
    if (patch.metadata !== undefined) {
        const nextMetadata = { ...(session.metadata ?? {}), ...patch.metadata };
        session.metadata = nextMetadata;
        if (typeof nextMetadata.templateVersion === 'string') {
            session.template_version = nextMetadata.templateVersion;
        }
        if (typeof nextMetadata.pageFingerprint === 'string') {
            session.page_fingerprint = nextMetadata.pageFingerprint;
        }
        if (nextMetadata.mode === 'DISCOVERY' || nextMetadata.mode === 'REAL_APPLICATION') {
            session.mode = nextMetadata.mode;
        }
    }
    if (patch.template_version !== undefined) {
        session.template_version = patch.template_version;
        if (patch.template_version) {
            session.metadata = { ...session.metadata, templateVersion: patch.template_version };
        }
    }
    if (patch.page_fingerprint !== undefined) {
        session.page_fingerprint = patch.page_fingerprint;
        if (patch.page_fingerprint) {
            session.metadata = { ...session.metadata, pageFingerprint: patch.page_fingerprint };
        }
    }
    if (patch.mode !== undefined) {
        session.mode = patch.mode === 'DISCOVERY' || patch.mode === 'REAL_APPLICATION' ? patch.mode : null;
        if (session.mode) {
            session.metadata = { ...session.metadata, mode: session.mode };
        }
    }
    if (patch.completed_at !== undefined)
        session.completed_at = patch.completed_at;
    touchSession(session);
    return session;
}
function updateMemorySessionField(sessionId, stableFieldId, patch) {
    const fieldMap = fieldsBySessionId.get(sessionId);
    if (!fieldMap)
        return;
    const field = fieldMap.get(stableFieldId);
    if (!field)
        return;
    if (patch.generated_answer !== undefined)
        field.generated_answer = patch.generated_answer;
    if (patch.fill_value !== undefined)
        field.fill_value = patch.fill_value;
    if (patch.fill_status !== undefined)
        field.fill_status = patch.fill_status;
    field.updated_at = nowIso();
    const session = sessionsById.get(sessionId);
    if (session)
        touchSession(session);
}
function countMemoryPendingAiFields(sessionId) {
    return listMemorySessionFields(sessionId).filter((field) => field.category === 'ai_generation'
        && (field.fill_status === 'pending' || field.fill_status === 'awaiting_answer')).length;
}
//# sourceMappingURL=application-session-store.js.map