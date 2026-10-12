"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPdfText = extractPdfText;
require("@napi-rs/canvas");
const pdf_parse_1 = require("pdf-parse");
const MAX_RESUME_TEXT_LENGTH = 75000;
const PDF_PARSE_TIMEOUT_MS = 15000;
function extractPdfText(pdf) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0 || pdf.length > 4 * 1024 * 1024) {
        throw new Error('Resume PDF must be non-empty and no larger than 4 MB.');
    }
    const parser = new pdf_parse_1.PDFParse({ data: pdf });
    let timeout;
    return Promise.race([
        parser.getText().then((result) => result.text),
        new Promise((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Resume PDF text extraction timed out.')), PDF_PARSE_TIMEOUT_MS);
        }),
    ])
        .then((text) => {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (normalized.length > MAX_RESUME_TEXT_LENGTH) {
            throw new Error('Resume text is too long to safely send to the Custom GPT.');
        }
        return normalized;
    })
        .finally(async () => {
        if (timeout)
            clearTimeout(timeout);
        await parser.destroy();
    });
}
//# sourceMappingURL=pdf-text-extraction.js.map