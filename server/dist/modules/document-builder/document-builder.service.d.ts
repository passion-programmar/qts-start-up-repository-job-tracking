import type { BuildDocumentsInput } from './document.schemas';
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
/**
 * Build resume and/or cover letter PDFs from Custom GPT JSON.
 * Saves source JSON + PDF under server/data/application-documents/{applicationId}/
 */
export declare function buildApplicationDocuments(applicationId: number, input: BuildDocumentsInput): Promise<ApplicationDocumentManifest>;
export declare function readDocumentManifest(applicationId: number): ApplicationDocumentManifest | null;
//# sourceMappingURL=document-builder.service.d.ts.map