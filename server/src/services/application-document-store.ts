import fs from 'node:fs/promises';
import { execute, queryOne } from '../database/connection';
import type { ApplicationDocumentManifest } from '../modules/document-builder';

type StoredApplicationDocument = {
  file_name: string;
  content: Buffer;
};

export async function storeApplicationDocumentArtifacts(
  sessionId: number,
  manifest: ApplicationDocumentManifest
): Promise<void> {
  for (const artifact of manifest.artifacts) {
    const content = await fs.readFile(artifact.pdfPath);
    await execute(
      `INSERT INTO application_session_documents (session_id, doc_type, file_name, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, doc_type)
       DO UPDATE SET file_name = EXCLUDED.file_name,
                     content = EXCLUDED.content,
                     updated_at = NOW()`,
      [sessionId, artifact.type, artifact.fileName, content]
    );
  }
}

export async function getStoredApplicationDocument(
  sessionId: number,
  docType: 'resume' | 'cover_letter'
): Promise<StoredApplicationDocument | null> {
  return queryOne<StoredApplicationDocument>(
    `SELECT file_name, content
     FROM application_session_documents
     WHERE session_id = $1 AND doc_type = $2`,
    [sessionId, docType]
  );
}
