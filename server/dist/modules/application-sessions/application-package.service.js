"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyGptPackage = applyGptPackage;
exports.loadSessionFields = loadSessionFields;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const connection_1 = require("../../database/connection");
const document_pdf_service_1 = require("./document-pdf.service");
async function applyAnswerItems(sessionId, items) {
    let stored = 0;
    for (const item of items) {
        const result = await (0, connection_1.execute)(`UPDATE application_session_fields
       SET generated_answer = $3,
           fill_value = $3,
           fill_status = 'filled',
           updated_at = NOW()
       WHERE session_id = $1 AND stable_field_id = $2`, [sessionId, item.stableFieldId, item.answer]);
        if (result.rowCount > 0)
            stored += 1;
    }
    return stored;
}
async function applyGptPackage(sessionId, pkg, existingGeneratedAnswers = {}) {
    const allAnswers = [
        ...pkg.answers,
        ...(pkg.remainingFields || []),
    ];
    const generatedAnswers = { ...existingGeneratedAnswers };
    for (const item of allAnswers) {
        generatedAnswers[item.stableFieldId] = item.answer;
    }
    const answersStored = await applyAnswerItems(sessionId, allAnswers);
    const docDir = (0, document_pdf_service_1.ensureApplicationDocumentsDir)(sessionId);
    let resumePath = null;
    let coverLetterPath = null;
    if (pkg.resume) {
        const resumeJsonPath = node_path_1.default.join(docDir, 'resume.json');
        const resumePdfPath = node_path_1.default.join(docDir, 'resume.pdf');
        node_fs_1.default.writeFileSync(resumeJsonPath, JSON.stringify(pkg.resume, null, 2), 'utf8');
        await (0, document_pdf_service_1.renderResumePdf)(pkg.resume, resumePdfPath);
        resumePath = resumePdfPath;
    }
    if (pkg.coverLetter) {
        const coverJsonPath = node_path_1.default.join(docDir, 'cover-letter.json');
        const coverPdfPath = node_path_1.default.join(docDir, 'cover-letter.pdf');
        node_fs_1.default.writeFileSync(coverJsonPath, JSON.stringify(pkg.coverLetter, null, 2), 'utf8');
        await (0, document_pdf_service_1.renderCoverLetterPdf)(pkg.coverLetter, coverPdfPath);
        coverLetterPath = coverPdfPath;
    }
    const session = await (0, connection_1.queryOne)('SELECT metadata FROM application_sessions WHERE id = $1', [sessionId]);
    const metadata = {
        ...(session?.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
        documents: {
            resumePath,
            coverLetterPath,
            generatedAt: new Date().toISOString(),
            notes: pkg.notes || null,
        },
    };
    const remaining = await (0, connection_1.queryOne)(`SELECT COUNT(*)::int AS count FROM application_session_fields
     WHERE session_id = $1
       AND category = 'ai_generation'
       AND fill_status IN ('pending', 'awaiting_answer')`, [sessionId]);
    const aiPending = Number(remaining?.count ?? 0);
    const status = aiPending === 0 ? 'ready_to_apply' : 'awaiting_ai';
    await (0, connection_1.execute)(`UPDATE application_sessions
     SET generated_answers = $2::jsonb,
         metadata = $3::jsonb,
         status = $4,
         last_activity_at = NOW(),
         updated_at = NOW(),
         completed_at = CASE WHEN $5 THEN NOW() ELSE completed_at END
     WHERE id = $1`, [
        sessionId,
        JSON.stringify(generatedAnswers),
        JSON.stringify(metadata),
        status,
        aiPending === 0,
    ]);
    return {
        applicationId: sessionId,
        answersStored,
        resumePath,
        coverLetterPath,
        status,
    };
}
async function loadSessionFields(sessionId) {
    return (0, connection_1.queryAll)('SELECT * FROM application_session_fields WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
}
//# sourceMappingURL=application-package.service.js.map