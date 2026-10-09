import type { ApplicationDocumentManifest } from '../modules/document-builder';
type StoredApplicationDocument = {
    file_name: string;
    content: Buffer;
};
export declare function storeApplicationDocumentArtifacts(sessionId: number, manifest: ApplicationDocumentManifest): Promise<void>;
export declare function getStoredApplicationDocument(sessionId: number, docType: 'resume' | 'cover_letter'): Promise<StoredApplicationDocument | null>;
export {};
//# sourceMappingURL=application-document-store.d.ts.map