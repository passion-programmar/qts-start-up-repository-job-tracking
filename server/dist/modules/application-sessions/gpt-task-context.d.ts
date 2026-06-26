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
export declare function inferSuggestedDocument(label?: unknown, nameAttr?: unknown): DocumentSlot;
export declare function mapFileFieldForGpt(field: Record<string, unknown>): GptFileUploadField;
export declare function buildDocumentGeneration(fileFields: GptFileUploadField[]): {
    resume: {
        required: boolean;
        schemaId: string;
        $id: string;
        packageKey: "resume";
        instructions: string;
    };
    coverLetter: {
        required: boolean;
        schemaId: string;
        $id: string;
        packageKey: "coverLetter";
        instructions: string;
    };
};
export declare function buildPackageSchemaRef(): {
    schemaId: string;
    $id: string;
};
//# sourceMappingURL=gpt-task-context.d.ts.map