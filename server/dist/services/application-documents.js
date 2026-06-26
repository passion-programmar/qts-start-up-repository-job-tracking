"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApplicationDocumentsDir = getApplicationDocumentsDir;
exports.resolveDocumentFile = resolveDocumentFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
function getApplicationDocumentsDir(sessionId) {
    return node_path_1.default.join((0, paths_1.getAppRoot)(), 'data', 'application-documents', String(sessionId));
}
function resolveDocumentFile(sessionId, docType, metadata) {
    const docs = metadata?.documents;
    const docMeta = docs && typeof docs === 'object' && !Array.isArray(docs)
        ? docs
        : {};
    if (docType === 'resume') {
        const filePath = docMeta.resumePdfPath || node_path_1.default.join(getApplicationDocumentsDir(sessionId), 'resume.pdf');
        const fileName = docMeta.resumeFileName || 'resume.pdf';
        return node_fs_1.default.existsSync(filePath) ? { filePath, fileName } : null;
    }
    if (docType === 'cover-letter' || docType === 'cover_letter') {
        const filePath = docMeta.coverLetterPdfPath || node_path_1.default.join(getApplicationDocumentsDir(sessionId), 'cover-letter.pdf');
        const fileName = docMeta.coverLetterFileName || 'cover-letter.pdf';
        return node_fs_1.default.existsSync(filePath) ? { filePath, fileName } : null;
    }
    return null;
}
//# sourceMappingURL=application-documents.js.map