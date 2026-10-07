type ResumeSectionItem = {
    heading?: string;
    subheading?: string;
    dateRange?: string;
    bullets?: string[];
};
type ResumeSection = {
    title?: string;
    items?: ResumeSectionItem[];
};
export type ResumeDocumentInput = {
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
    sections: ResumeSection[];
};
export type CoverLetterDocumentInput = {
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
};
export declare function renderResumePdf(resume: ResumeDocumentInput, outputPath: string): Promise<void>;
export declare function renderCoverLetterPdf(coverLetter: CoverLetterDocumentInput, outputPath: string): Promise<void>;
export declare function safePdfFileName(base: string): string;
export {};
//# sourceMappingURL=application-document-pdf.d.ts.map