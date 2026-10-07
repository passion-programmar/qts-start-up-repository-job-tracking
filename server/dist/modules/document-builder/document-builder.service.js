"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApplicationDocuments = buildApplicationDocuments;
exports.readDocumentManifest = readDocumentManifest;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const application_document_pdf_1 = require("../../services/application-document-pdf");
const application_documents_1 = require("../../services/application-documents");
const logger_1 = require("../../utilities/logger");
function writeJson(filePath, data) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
function fileSize(filePath) {
    try {
        return node_fs_1.default.statSync(filePath).size;
    }
    catch {
        return 0;
    }
}
async function buildResumeArtifact(applicationId, resume) {
    const dir = (0, application_documents_1.getApplicationDocumentsDir)(applicationId);
    const builtAt = new Date().toISOString();
    const jsonPath = node_path_1.default.join(dir, 'resume.json');
    const pdfPath = node_path_1.default.join(dir, 'resume.pdf');
    const fileName = `${(0, application_document_pdf_1.safePdfFileName)(resume.candidate.fullName)}_Resume.pdf`;
    writeJson(jsonPath, resume);
    await (0, application_document_pdf_1.renderResumePdf)(resume, pdfPath);
    logger_1.logger.info('Resume PDF built', { applicationId, pdfPath, sizeBytes: fileSize(pdfPath) });
    return {
        type: 'resume',
        jsonPath,
        pdfPath,
        fileName,
        sizeBytes: fileSize(pdfPath),
        builtAt,
    };
}
async function buildCoverLetterArtifact(applicationId, coverLetter) {
    const dir = (0, application_documents_1.getApplicationDocumentsDir)(applicationId);
    const builtAt = new Date().toISOString();
    const jsonPath = node_path_1.default.join(dir, 'cover-letter.json');
    const pdfPath = node_path_1.default.join(dir, 'cover-letter.pdf');
    const fileName = `${(0, application_document_pdf_1.safePdfFileName)(coverLetter.candidate.fullName)}_Cover_Letter.pdf`;
    writeJson(jsonPath, coverLetter);
    await (0, application_document_pdf_1.renderCoverLetterPdf)(coverLetter, pdfPath);
    logger_1.logger.info('Cover letter PDF built', { applicationId, pdfPath, sizeBytes: fileSize(pdfPath) });
    return {
        type: 'cover_letter',
        jsonPath,
        pdfPath,
        fileName,
        sizeBytes: fileSize(pdfPath),
        builtAt,
    };
}
function artifactToPaths(artifacts) {
    const paths = {};
    for (const artifact of artifacts) {
        if (artifact.type === 'resume') {
            paths.resumeJsonPath = artifact.jsonPath;
            paths.resumePdfPath = artifact.pdfPath;
            paths.resumeFileName = artifact.fileName;
        }
        if (artifact.type === 'cover_letter') {
            paths.coverLetterJsonPath = artifact.jsonPath;
            paths.coverLetterPdfPath = artifact.pdfPath;
            paths.coverLetterFileName = artifact.fileName;
        }
    }
    return paths;
}
/**
 * Build resume and/or cover letter PDFs from Custom GPT JSON.
 * Saves source JSON + PDF under server/data/application-documents/{applicationId}/
 */
async function buildApplicationDocuments(applicationId, input) {
    const artifacts = [];
    if (input.resume) {
        artifacts.push(await buildResumeArtifact(applicationId, input.resume));
    }
    if (input.coverLetter) {
        artifacts.push(await buildCoverLetterArtifact(applicationId, input.coverLetter));
    }
    const builtAt = new Date().toISOString();
    const manifest = {
        applicationId,
        builtAt,
        artifacts,
        paths: artifactToPaths(artifacts),
    };
    const manifestPath = node_path_1.default.join((0, application_documents_1.getApplicationDocumentsDir)(applicationId), 'manifest.json');
    writeJson(manifestPath, manifest);
    manifest.paths.manifestPath = manifestPath;
    return manifest;
}
function readDocumentManifest(applicationId) {
    const manifestPath = node_path_1.default.join((0, application_documents_1.getApplicationDocumentsDir)(applicationId), 'manifest.json');
    if (!node_fs_1.default.existsSync(manifestPath))
        return null;
    try {
        const raw = JSON.parse(node_fs_1.default.readFileSync(manifestPath, 'utf8'));
        return raw;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=document-builder.service.js.map