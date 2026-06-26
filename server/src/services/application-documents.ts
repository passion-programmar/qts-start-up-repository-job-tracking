import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot } from '../config/paths';

export function getApplicationDocumentsDir(sessionId: number): string {
  return path.join(getAppRoot(), 'data', 'application-documents', String(sessionId));
}

export function resolveDocumentFile(
  sessionId: number,
  docType: string,
  metadata?: Record<string, unknown>
): { filePath: string; fileName: string } | null {
  const docs = metadata?.documents;
  const docMeta = docs && typeof docs === 'object' && !Array.isArray(docs)
    ? docs as Record<string, string>
    : {};

  if (docType === 'resume') {
    const filePath = docMeta.resumePdfPath || path.join(getApplicationDocumentsDir(sessionId), 'resume.pdf');
    const fileName = docMeta.resumeFileName || 'resume.pdf';
    return fs.existsSync(filePath) ? { filePath, fileName } : null;
  }

  if (docType === 'cover-letter' || docType === 'cover_letter') {
    const filePath = docMeta.coverLetterPdfPath || path.join(getApplicationDocumentsDir(sessionId), 'cover-letter.pdf');
    const fileName = docMeta.coverLetterFileName || 'cover-letter.pdf';
    return fs.existsSync(filePath) ? { filePath, fileName } : null;
  }

  return null;
}
