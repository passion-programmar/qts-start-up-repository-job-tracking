"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const auth_1 = require("../../middleware/auth");
const scope_1 = require("../../middleware/scope");
const application_documents_1 = require("../../services/application-documents");
const connection_1 = require("../../database/connection");
const env_1 = require("../../config/env");
const application_session_store_1 = require("../../services/application-session-store");
const document_builder_1 = require("../document-builder");
const logger_1 = require("../../utilities/logger");
const router = (0, express_1.Router)({ mergeParams: true });
router.use(auth_1.requireAuth);
router.use(auth_1.requireAdminOrBidder);
async function getSessionForRequest(req, sessionId) {
    if (!env_1.config.applicationSessionPersistDb) {
        const session = (0, application_session_store_1.getMemoryApplicationSession)(sessionId);
        if (!session)
            return null;
        if (req.role !== 'admin' && req.bidderId != null && req.bidderId !== session.bidder_id) {
            return null;
        }
        return session;
    }
    const scope = (0, scope_1.candidateBidderFilter)(req, 'c', 2);
    let query = `
    SELECT s.*
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
function readMetadata(session) {
    const raw = session.metadata;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}
/** GET /api/application-sessions/:id/documents — manifest of built PDFs */
router.get('/', async (req, res) => {
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
    const manifest = (0, document_builder_1.readDocumentManifest)(sessionId);
    const metadata = readMetadata(session);
    const documents = metadata.documents && typeof metadata.documents === 'object'
        ? metadata.documents
        : {};
    res.json({
        success: true,
        applicationId: sessionId,
        manifest,
        documents,
        hasResume: Boolean(manifest?.artifacts.some((a) => a.type === 'resume')
            || documents.resumePdfPath),
        hasCoverLetter: Boolean(manifest?.artifacts.some((a) => a.type === 'cover_letter')
            || documents.coverLetterPdfPath),
    });
});
/** POST /api/application-sessions/:id/documents/build — build PDFs from GPT JSON */
router.post('/build', async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
        res.status(400).json({ success: false, message: 'Invalid session id.' });
        return;
    }
    const parsed = document_builder_1.BuildDocumentsInputSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            message: 'Invalid document JSON.',
            errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
    }
    const session = await getSessionForRequest(req, sessionId);
    if (!session) {
        res.status(404).json({ success: false, message: 'Application session not found.' });
        return;
    }
    const manifest = await (0, document_builder_1.buildApplicationDocuments)(sessionId, parsed.data);
    const metadata = readMetadata(session);
    const nextMetadata = {
        ...metadata,
        documents: { ...(metadata.documents || {}), ...manifest.paths },
        documentManifest: manifest,
    };
    if (!env_1.config.applicationSessionPersistDb) {
        (0, application_session_store_1.updateMemorySession)(sessionId, { metadata: nextMetadata });
    }
    else {
        await (0, connection_1.execute)(`UPDATE application_sessions
       SET metadata = $2::jsonb,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`, [
            sessionId,
            JSON.stringify(nextMetadata),
        ]);
    }
    logger_1.logger.info('Documents built via API', { sessionId, artifacts: manifest.artifacts.length });
    res.json({
        success: true,
        applicationId: sessionId,
        manifest,
        documents: manifest.paths,
    });
});
/** GET /api/application-sessions/:id/documents/:docType — download PDF */
router.get('/:docType', async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const docType = String(req.params.docType || '').toLowerCase();
    if (!Number.isFinite(sessionId)) {
        res.status(400).json({ success: false, message: 'Invalid session id.' });
        return;
    }
    if (docType === 'build') {
        res.status(405).json({ success: false, message: 'Use POST /documents/build to generate PDFs.' });
        return;
    }
    const session = await getSessionForRequest(req, sessionId);
    if (!session) {
        res.status(404).json({ success: false, message: 'Application session not found.' });
        return;
    }
    const metadata = readMetadata(session);
    const resolved = (0, application_documents_1.resolveDocumentFile)(sessionId, docType, metadata);
    if (!resolved) {
        res.status(404).json({
            success: false,
            message: `Document not found: ${docType}. Submit GPT package or POST /documents/build first.`,
        });
        return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resolved.fileName}"`);
    node_fs_1.default.createReadStream(resolved.filePath).pipe(res);
});
exports.default = router;
//# sourceMappingURL=application-documents.routes.js.map