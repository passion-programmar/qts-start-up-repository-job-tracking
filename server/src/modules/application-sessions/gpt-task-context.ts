/** Maps stored form fields → Custom GPT task context (file upload + document schemas). */

export type DocumentSlot = 'resume' | 'cover_letter';

export interface GptFileUploadField {
  stableFieldId: string;
  label: string | null;
  fieldType: 'file';
  required: boolean;
  category: 'document_upload';
  documentSlot: DocumentSlot;
  suggestedDocument: DocumentSlot;
  placeholder: string | null;
  nameAttr: string | null;
  sectionHeading: string | null;
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
  selectorHints: Record<string, unknown>;
  outputSchema: {
    schemaId: string;
    $id: string;
    packageKey: 'resume' | 'coverLetter';
  };
  generateFromJobDescription: boolean;
}

const RESUME_SCHEMA = {
  schemaId: 'resume-document.schema.json',
  $id: 'https://qts-job-tracking.local/schemas/resume-document.json',
  packageKey: 'resume' as const,
};

const COVER_SCHEMA = {
  schemaId: 'cover-letter-document.schema.json',
  $id: 'https://qts-job-tracking.local/schemas/cover-letter-document.json',
  packageKey: 'coverLetter' as const,
};

export function inferSuggestedDocument(label?: unknown, nameAttr?: unknown): DocumentSlot {
  const text = `${label || ''} ${nameAttr || ''}`.toLowerCase();
  if (/cover|message|letter/.test(text)) return 'cover_letter';
  return 'resume';
}

function parseAcceptAttribute(accept?: unknown): { mimeTypes: string[]; extensions: string[] } {
  const mimeTypes: string[] = [];
  const extensions: string[] = [];
  const raw = String(accept || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of raw) {
    if (part.startsWith('.')) extensions.push(part.slice(1).toLowerCase());
    else mimeTypes.push(part.toLowerCase());
  }

  if (!mimeTypes.length && !extensions.length) {
    return {
      mimeTypes: ['application/pdf'],
      extensions: ['pdf', 'doc', 'docx'],
    };
  }
  return { mimeTypes, extensions };
}

function readAcceptFromField(field: Record<string, unknown>): string {
  const hints = field.selectorHints;
  if (hints && typeof hints === 'object' && !Array.isArray(hints)) {
    const accept = (hints as Record<string, unknown>).accept;
    if (typeof accept === 'string') return accept;
  }
  return '';
}

export function mapFileFieldForGpt(field: Record<string, unknown>): GptFileUploadField {
  const slot = (field.documentSlot as DocumentSlot)
    || inferSuggestedDocument(field.label, field.nameAttr);
  const schema = slot === 'cover_letter' ? COVER_SCHEMA : RESUME_SCHEMA;
  const { mimeTypes, extensions } = parseAcceptAttribute(readAcceptFromField(field));
  const selectorHints = (field.selectorHints && typeof field.selectorHints === 'object'
    && !Array.isArray(field.selectorHints))
    ? field.selectorHints as Record<string, unknown>
    : {};

  return {
    stableFieldId: String(field.stableFieldId || ''),
    label: (field.label as string) ?? null,
    fieldType: 'file',
    required: Boolean(field.required),
    category: 'document_upload',
    documentSlot: slot,
    suggestedDocument: slot,
    placeholder: (field.placeholder as string) ?? null,
    nameAttr: (field.nameAttr as string) ?? null,
    sectionHeading: (field.sectionHeading as string) ?? null,
    acceptedMimeTypes: mimeTypes,
    acceptedExtensions: extensions,
    selectorHints,
    outputSchema: schema,
    generateFromJobDescription: true,
  };
}

export function buildDocumentGeneration(fileFields: GptFileUploadField[]) {
  const resumeRequired = fileFields.some((f) => f.suggestedDocument === 'resume');
  const coverRequired = fileFields.some((f) => f.suggestedDocument === 'cover_letter');

  return {
    resume: {
      required: resumeRequired,
      schemaId: RESUME_SCHEMA.schemaId,
      $id: RESUME_SCHEMA.$id,
      packageKey: RESUME_SCHEMA.packageKey,
      instructions: resumeRequired
        ? 'Read jobContext.jobDescription and candidate profile. Output JSON matching resume-document.schema.json (tailored role summary, skills, experience bullets). Server renders resume.pdf for the form upload field in fileFields.'
        : 'Not required for this application.',
    },
    coverLetter: {
      required: coverRequired,
      schemaId: COVER_SCHEMA.schemaId,
      $id: COVER_SCHEMA.$id,
      packageKey: COVER_SCHEMA.packageKey,
      instructions: coverRequired
        ? 'Output JSON matching cover-letter-document.schema.json tailored to jobContext.jobDescription.'
        : 'Optional unless a cover-letter file field is present.',
    },
  };
}

export function buildPackageSchemaRef() {
  return {
    schemaId: 'gpt-application-package.schema.json',
    $id: 'https://qts-job-tracking.local/schemas/gpt-application-package.json',
  };
}
