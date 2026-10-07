export interface ResumeDocument {
    candidate: {
        fullName: string;
        email: string;
        phone?: string;
        linkedinUrl?: string;
        location?: string;
        headline?: string;
    };
    targetRole: string;
    targetCompany?: string;
    summary?: string;
    sections: Array<{
        title: string;
        items: Array<{
            heading?: string;
            subheading?: string;
            dateRange?: string;
            bullets?: string[];
        }>;
    }>;
}
export interface CoverLetterDocument {
    candidate: {
        fullName: string;
        email: string;
        phone?: string;
        linkedinUrl?: string;
    };
    targetRole: string;
    targetCompany: string;
    date?: string;
    salutation?: string;
    bodyParagraphs: string[];
    closing?: string;
    signatureName?: string;
}
export declare function getApplicationDocumentsDir(sessionId: number): string;
export declare function ensureApplicationDocumentsDir(sessionId: number): string;
export declare function renderResumePdf(resume: ResumeDocument, outputPath: string): Promise<void>;
export declare function renderCoverLetterPdf(coverLetter: CoverLetterDocument, outputPath: string): Promise<void>;
//# sourceMappingURL=document-pdf.service.d.ts.map