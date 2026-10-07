import fs from 'node:fs';
import path from 'node:path';
import {
  renderResumePdf,
  renderCoverLetterPdf,
  safePdfFileName,
} from '../../services/application-document-pdf';
import { getApplicationDocumentsDir } from '../../services/application-documents';
import { logger } from '../../utilities/logger';
import type { BuildDocumentsInput, CoverLetterDocument, ResumeDocument } from './document.schemas';

export interface DocumentArtifact {
  type: 'resume' | 'cover_letter';
  jsonPath: string;
  pdfPath: string;
  fileName: string;
  sizeBytes: number;
  builtAt: string;
}

export interface ApplicationDocumentManifest {
  applicationId: number;
  builtAt: string;
  artifacts: DocumentArtifact[];
  /** Flat map for session metadata + extension compatibility */
  paths: Record<string, string>;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

async function buildResumeArtifact(
  applicationId: number,
  resume: ResumeDocument
): Promise<DocumentArtifact> {
  const dir = getApplicationDocumentsDir(applicationId);
  const builtAt = new Date().toISOString();
  const jsonPath = path.join(dir, 'resume.json');
  const pdfPath = path.join(dir, 'resume.pdf');
  const fileName = `${safePdfFileName(resume.candidate.fullName)}_Resume.pdf`;

  writeJson(jsonPath, resume);
  await renderResumePdf(resume, pdfPath);

  logger.info('Resume PDF built', { applicationId, pdfPath, sizeBytes: fileSize(pdfPath) });

  return {
    type: 'resume',
    jsonPath,
    pdfPath,
    fileName,
    sizeBytes: fileSize(pdfPath),
    builtAt,
  };
}

async function buildCoverLetterArtifact(
  applicationId: number,
  coverLetter: CoverLetterDocument
): Promise<DocumentArtifact> {
  const dir = getApplicationDocumentsDir(applicationId);
  const builtAt = new Date().toISOString();
  const jsonPath = path.join(dir, 'cover-letter.json');
  const pdfPath = path.join(dir, 'cover-letter.pdf');
  const fileName = `${safePdfFileName(coverLetter.candidate.fullName)}_Cover_Letter.pdf`;

  writeJson(jsonPath, coverLetter);
  await renderCoverLetterPdf(coverLetter, pdfPath);

  logger.info('Cover letter PDF built', { applicationId, pdfPath, sizeBytes: fileSize(pdfPath) });

  return {
    type: 'cover_letter',
    jsonPath,
    pdfPath,
    fileName,
    sizeBytes: fileSize(pdfPath),
    builtAt,
  };
}

function artifactToPaths(artifacts: DocumentArtifact[]): Record<string, string> {
  const paths: Record<string, string> = {};
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
export async function buildApplicationDocuments(
  applicationId: number,
  input: BuildDocumentsInput
): Promise<ApplicationDocumentManifest> {
  const artifacts: DocumentArtifact[] = [];

  if (input.resume) {
    artifacts.push(await buildResumeArtifact(applicationId, input.resume));
  }
  if (input.coverLetter) {
    artifacts.push(await buildCoverLetterArtifact(applicationId, input.coverLetter));
  }

  const builtAt = new Date().toISOString();
  const manifest: ApplicationDocumentManifest = {
    applicationId,
    builtAt,
    artifacts,
    paths: artifactToPaths(artifacts),
  };

  const manifestPath = path.join(getApplicationDocumentsDir(applicationId), 'manifest.json');
  writeJson(manifestPath, manifest);
  manifest.paths.manifestPath = manifestPath;

  return manifest;
}

export function readDocumentManifest(applicationId: number): ApplicationDocumentManifest | null {
  const manifestPath = path.join(getApplicationDocumentsDir(applicationId), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ApplicationDocumentManifest;
    return raw;
  } catch {
    return null;
  }
}
