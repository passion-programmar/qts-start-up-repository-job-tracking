import '@napi-rs/canvas';
import { PDFParse } from 'pdf-parse';

const MAX_RESUME_TEXT_LENGTH = 75_000;
const PDF_PARSE_TIMEOUT_MS = 15_000;

export function extractPdfText(pdf: Buffer): Promise<string> {
  if (!Buffer.isBuffer(pdf) || pdf.length === 0 || pdf.length > 4 * 1024 * 1024) {
    throw new Error('Resume PDF must be non-empty and no larger than 4 MB.');
  }

  const parser = new PDFParse({ data: pdf });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    parser.getText().then((result) => result.text),
    new Promise<never>((_resolve, reject) => {
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
      if (timeout) clearTimeout(timeout);
      await parser.destroy();
    });
}
