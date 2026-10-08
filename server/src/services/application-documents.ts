import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAppRoot } from '../config/paths';

export function getApplicationDocumentsDir(sessionId: number): string {
  const root = process.env.VERCEL
    ? path.join(os.tmpdir(), 'qts-startup', 'application-documents')
    : path.join(getAppRoot(), 'data', 'application-documents');
  return path.join(root, String(sessionId));
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
