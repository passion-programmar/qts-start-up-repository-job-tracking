"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeApplicationDocumentArtifacts = storeApplicationDocumentArtifacts;
exports.getStoredApplicationDocument = getStoredApplicationDocument;
const promises_1 = __importDefault(require("node:fs/promises"));
const connection_1 = require("../database/connection");
async function storeApplicationDocumentArtifacts(sessionId, manifest) {
    for (const artifact of manifest.artifacts) {
        const content = await promises_1.default.readFile(artifact.pdfPath);
        await (0, connection_1.execute)(`INSERT INTO application_session_documents (session_id, doc_type, file_name, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, doc_type)
       DO UPDATE SET file_name = EXCLUDED.file_name,
                     content = EXCLUDED.content,
                     updated_at = NOW()`, [sessionId, artifact.type, artifact.fileName, content]);
    }
}
async function getStoredApplicationDocument(sessionId, docType) {
    return (0, connection_1.queryOne)(`SELECT file_name, content
     FROM application_session_documents
     WHERE session_id = $1 AND doc_type = $2`, [sessionId, docType]);
}
//# sourceMappingURL=application-document-store.js.map