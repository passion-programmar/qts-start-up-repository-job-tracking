"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const env_1 = require("../../config/env");
const auth_1 = require("../../middleware/auth");
const application_session_store_1 = require("../../services/application-session-store");
const application_learning_store_1 = require("../../services/application-learning-store");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.use(auth_1.requireAdminOrAccount);
const ConfirmationSchema = zod_1.z.object({
    fieldStableId: zod_1.z.string().min(1).max(500),
    question: zod_1.z.string().max(1000).optional().nullable(),
    currentAnswer: zod_1.z.string().max(2000).optional().nullable(),
    editedAnswer: zod_1.z.string().max(2000).optional().nullable(),
    policyType: zod_1.z.enum(['reusable_profile', 'generated_ai', 'requires_review', 'manual_only', 'ignore']),
    confidence: zod_1.z.number().min(0).max(1).default(0),
    userApproved: zod_1.z.boolean().default(true),
    fieldType: zod_1.z.string().max(64).optional().nullable(),
    sectionHeading: zod_1.z.string().max(200).optional().nullable(),
    evidenceSummary: zod_1.z.record(zod_1.z.unknown()).optional(),
});
const AssistDecisionSchema = zod_1.z.object({
    stableFieldId: zod_1.z.string().min(1).max(500).optional().nullable(),
    question: zod_1.z.string().max(1000).optional().nullable(),
    fieldType: zod_1.z.string().max(64).optional().nullable(),
    sectionHeading: zod_1.z.string().max(200).optional().nullable(),
});
async function getSessionForRequest(req, sessionId) {
    if (!env_1.config.applicationSessionPersistDb) {
        const session = (0, application_session_store_1.getMemoryApplicationSession)(sessionId);
        if (!session)
            return null;
        if (req.role !== 'admin'
            && req.role !== 'super'
            && (req.accountId == null || Number(session.account_id) !== req.accountId)) {
            return null;
        }
        return session;
    }
    const session = await (0, connection_1.queryOne)(`SELECT s.*, c.name AS candidate_name, c.email AS candidate_email
     FROM application_sessions s
     JOIN candidates c ON c.id = s.candidate_id
     WHERE s.id = $1`, [sessionId]);
    if (!session)
        return null;
    if (req.role !== 'admin' && req.role !== 'super' && req.accountId != null && Number(session.account_id) !== req.accountId) {
        return null;
    }
    return session;
}
router.get('/:id/learning-summary', async (req, res) => {
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
    const summary = await (0, application_learning_store_1.getLearningSummary)(sessionId);
    res.json({ success: true, sessionId, summary });
});
router.get('/:id/learning-queue', async (req, res) => {
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
    const rows = await (0, application_learning_store_1.listLearningQueue)(sessionId);
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
router.get('/:id/replay-confidence', async (req, res) => {
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
    res.json({ success: true, sessionId, matches: await (0, application_learning_store_1.getReplayConfidence)(sessionId) });
});
router.post('/:id/assist-decision', async (req, res) => {
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
    const decision = await (0, application_learning_store_1.evaluateAssistDecision)(sessionId, parsed.data);
    res.json({ success: true, sessionId, decision });
});
router.post('/:id/learning-confirmation', async (req, res) => {
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
    const semantic = await (0, application_learning_store_1.upsertSemanticMapping)({
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
    const policy = await (0, application_learning_store_1.upsertAnswerPolicy)({
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
exports.default = router;
//# sourceMappingURL=application-learning.routes.js.map