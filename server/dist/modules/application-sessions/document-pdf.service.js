"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApplicationDocumentsDir = getApplicationDocumentsDir;
exports.ensureApplicationDocumentsDir = ensureApplicationDocumentsDir;
exports.renderResumePdf = renderResumePdf;
exports.renderCoverLetterPdf = renderCoverLetterPdf;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const paths_1 = require("../../config/paths");
function getApplicationDocumentsDir(sessionId) {
    return node_path_1.default.join((0, paths_1.getAppRoot)(), 'data', 'application-documents', String(sessionId));
}
function ensureApplicationDocumentsDir(sessionId) {
    const dir = getApplicationDocumentsDir(sessionId);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function writePdfToFile(filePath, build) {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({ margin: 50, size: 'A4' });
        const stream = node_fs_1.default.createWriteStream(filePath);
        doc.pipe(stream);
        build(doc);
        doc.end();
        stream.on('finish', () => resolve());
        stream.on('error', reject);
        doc.on('error', reject);
    });
}
async function renderResumePdf(resume, outputPath) {
    await writePdfToFile(outputPath, (doc) => {
        const { candidate } = resume;
        doc.fontSize(20).text(candidate.fullName, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#334155');
        const contact = [
            candidate.email,
            candidate.phone,
            candidate.location,
            candidate.linkedinUrl,
        ].filter(Boolean).join(' · ');
        if (contact)
            doc.text(contact);
        if (candidate.headline) {
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#0f172a').text(candidate.headline);
        }
        doc.moveDown(0.8);
        doc.fontSize(12).fillColor('#0f172a').text(resume.targetRole);
        if (resume.targetCompany) {
            doc.fontSize(10).fillColor('#475569').text(resume.targetCompany);
        }
        if (resume.summary) {
            doc.moveDown(0.8);
            doc.fontSize(11).fillColor('#0f172a').text('Summary', { underline: true });
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#1e293b').text(resume.summary, { align: 'justify' });
        }
        for (const section of resume.sections || []) {
            doc.moveDown(0.8);
            doc.fontSize(11).fillColor('#0f172a').text(section.title, { underline: true });
            doc.moveDown(0.3);
            for (const item of section.items || []) {
                if (item.heading) {
                    doc.fontSize(10).fillColor('#0f172a').text(item.heading);
                }
                const meta = [item.subheading, item.dateRange].filter(Boolean).join(' · ');
                if (meta) {
                    doc.fontSize(9).fillColor('#64748b').text(meta);
                }
                for (const bullet of item.bullets || []) {
                    doc.fontSize(9).fillColor('#1e293b').text(`• ${bullet}`, { indent: 12 });
                }
                doc.moveDown(0.3);
            }
        }
    });
}
async function renderCoverLetterPdf(coverLetter, outputPath) {
    await writePdfToFile(outputPath, (doc) => {
        const date = coverLetter.date || new Date().toISOString().slice(0, 10);
        doc.fontSize(10).fillColor('#334155').text(date, { align: 'right' });
        doc.moveDown(1);
        doc.fontSize(10).fillColor('#0f172a').text(coverLetter.candidate.fullName);
        if (coverLetter.candidate.email)
            doc.text(coverLetter.candidate.email);
        if (coverLetter.candidate.phone)
            doc.text(coverLetter.candidate.phone);
        doc.moveDown(1);
        doc.text(coverLetter.salutation || 'Dear Hiring Manager,');
        doc.moveDown(0.5);
        for (const paragraph of coverLetter.bodyParagraphs || []) {
            doc.text(paragraph, { align: 'justify' });
            doc.moveDown(0.5);
        }
        doc.text(coverLetter.closing || 'Sincerely,');
        doc.moveDown(0.8);
        doc.text(coverLetter.signatureName || coverLetter.candidate.fullName);
    });
}
//# sourceMappingURL=document-pdf.service.js.map