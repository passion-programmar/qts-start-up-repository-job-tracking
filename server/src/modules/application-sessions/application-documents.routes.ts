import { Router, Response } from 'express';
import fs from 'node:fs';
import {
  requireAuth,
  requireAdminOrBidder,
  AuthRequest,
} from '../../middleware/auth';
import { candidateBidderFilter } from '../../middleware/scope';
import { resolveDocumentFile } from '../../services/application-documents';
import { execute, queryOne } from '../../database/connection';
import {
  BuildDocumentsInputSchema,
  buildApplicationDocuments,
  readDocumentManifest,
} from '../document-builder';
import { logger } from '../../utilities/logger';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireAdminOrBidder);

async function getSessionForRequest(req: AuthRequest, sessionId: number) {
  const scope = candidateBidderFilter(req, 'c', 2);
  let query = `
    SELECT s.*
    FROM application_sessions s
    JOIN candidates c ON c.id = s.candidate_id
    WHERE s.id = $1`;
  const params: unknown[] = [sessionId];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  return queryOne<Record<string, unknown>>(query, params);
}

function readMetadata(session: Record<string, unknown>): Record<string, unknown> {
  const raw = session.metadata;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** GET /api/application-sessions/:id/documents — manifest of built PDFs */
router.get('/', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const manifest = readDocumentManifest(sessionId);
  const metadata = readMetadata(session);
  const documents = metadata.documents && typeof metadata.documents === 'object'
    ? metadata.documents
    : {};

  res.json({
    success: true,
    applicationId: sessionId,
    manifest,
    documents,
    hasResume: Boolean(
      manifest?.artifacts.some((a) => a.type === 'resume')
      || (documents as Record<string, string>).resumePdfPath
    ),
    hasCoverLetter: Boolean(
      manifest?.artifacts.some((a) => a.type === 'cover_letter')
      || (documents as Record<string, string>).coverLetterPdfPath
    ),
  });
});

/** POST /api/application-sessions/:id/documents/build — build PDFs from GPT JSON */
router.post('/build', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }

  const parsed = BuildDocumentsInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid document JSON.',
      errors: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const manifest = await buildApplicationDocuments(sessionId, parsed.data);
  const metadata = readMetadata(session);

  await execute(
    `UPDATE application_sessions
     SET metadata = $2::jsonb,
         last_activity_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [
      sessionId,
      JSON.stringify({
        ...metadata,
        documents: { ...(metadata.documents as object || {}), ...manifest.paths },
        documentManifest: manifest,
      }),
    ]
  );

  logger.info('Documents built via API', { sessionId, artifacts: manifest.artifacts.length });

  res.json({
    success: true,
    applicationId: sessionId,
    manifest,
    documents: manifest.paths,
  });
});

/** GET /api/application-sessions/:id/documents/:docType — download PDF */
router.get('/:docType', async (req: AuthRequest, res: Response) => {
  const sessionId = parseInt(req.params.id, 10);
  const docType = String(req.params.docType || '').toLowerCase();
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session id.' });
    return;
  }
  if (docType === 'build') {
    res.status(405).json({ success: false, message: 'Use POST /documents/build to generate PDFs.' });
    return;
  }

  const session = await getSessionForRequest(req, sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Application session not found.' });
    return;
  }

  const metadata = readMetadata(session);
  const resolved = resolveDocumentFile(sessionId, docType, metadata);
  if (!resolved) {
    res.status(404).json({
      success: false,
      message: `Document not found: ${docType}. Submit GPT package or POST /documents/build first.`,
    });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${resolved.fileName}"`);
  fs.createReadStream(resolved.filePath).pipe(res);
});

export default router;
