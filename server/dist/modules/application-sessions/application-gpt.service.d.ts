import { z } from 'zod';
import type { CoverLetterDocument, ResumeDocument } from './document-pdf.service';
export declare const ResumeDocumentSchema: z.ZodObject<{
    candidate: z.ZodObject<{
        fullName: z.ZodString;
        email: z.ZodString;
        phone: z.ZodOptional<z.ZodString>;
        linkedinUrl: z.ZodOptional<z.ZodString>;
        location: z.ZodOptional<z.ZodString>;
        headline: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    }, {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    }>;
    targetRole: z.ZodString;
    targetCompany: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    sections: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        items: z.ZodArray<z.ZodObject<{
            heading: z.ZodOptional<z.ZodString>;
            subheading: z.ZodOptional<z.ZodString>;
            dateRange: z.ZodOptional<z.ZodString>;
            bullets: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }, {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        title: string;
        items: {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }[];
    }, {
        title: string;
        items: {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    candidate: {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    };
    targetRole: string;
    sections: {
        title: string;
        items: {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }[];
    }[];
    targetCompany?: string | undefined;
    summary?: string | undefined;
}, {
    candidate: {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    };
    targetRole: string;
    sections: {
        title: string;
        items: {
            heading?: string | undefined;
            subheading?: string | undefined;
            dateRange?: string | undefined;
            bullets?: string[] | undefined;
        }[];
    }[];
    targetCompany?: string | undefined;
    summary?: string | undefined;
}>;
export declare const CoverLetterDocumentSchema: z.ZodObject<{
    candidate: z.ZodObject<{
        fullName: z.ZodString;
        email: z.ZodString;
        phone: z.ZodOptional<z.ZodString>;
        linkedinUrl: z.ZodOptional<z.ZodString>;
        location: z.ZodOptional<z.ZodString>;
        headline: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    }, {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    }>;
    targetRole: z.ZodString;
    targetCompany: z.ZodString;
    date: z.ZodOptional<z.ZodString>;
    salutation: z.ZodOptional<z.ZodString>;
    bodyParagraphs: z.ZodArray<z.ZodString, "many">;
    closing: z.ZodOptional<z.ZodString>;
    signatureName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    candidate: {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    };
    targetRole: string;
    targetCompany: string;
    bodyParagraphs: string[];
    date?: string | undefined;
    salutation?: string | undefined;
    closing?: string | undefined;
    signatureName?: string | undefined;
}, {
    candidate: {
        email: string;
        fullName: string;
        phone?: string | undefined;
        linkedinUrl?: string | undefined;
        location?: string | undefined;
        headline?: string | undefined;
    };
    targetRole: string;
    targetCompany: string;
    bodyParagraphs: string[];
    date?: string | undefined;
    salutation?: string | undefined;
    closing?: string | undefined;
    signatureName?: string | undefined;
}>;
export declare const GptApplicationPackageSchema: z.ZodObject<{
    answers: z.ZodArray<z.ZodObject<{
        stableFieldId: z.ZodString;
        answer: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        stableFieldId: string;
        answer: string;
    }, {
        stableFieldId: string;
        answer: string;
    }>, "many">;
    resume: z.ZodOptional<z.ZodObject<{
        candidate: z.ZodObject<{
            fullName: z.ZodString;
            email: z.ZodString;
            phone: z.ZodOptional<z.ZodString>;
            linkedinUrl: z.ZodOptional<z.ZodString>;
            location: z.ZodOptional<z.ZodString>;
            headline: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        }, {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        }>;
        targetRole: z.ZodString;
        targetCompany: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        sections: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            items: z.ZodArray<z.ZodObject<{
                heading: z.ZodOptional<z.ZodString>;
                subheading: z.ZodOptional<z.ZodString>;
                dateRange: z.ZodOptional<z.ZodString>;
                bullets: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strip", z.ZodTypeAny, {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }, {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }, {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        sections: {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }[];
        targetCompany?: string | undefined;
        summary?: string | undefined;
    }, {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        sections: {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }[];
        targetCompany?: string | undefined;
        summary?: string | undefined;
    }>>;
    coverLetter: z.ZodOptional<z.ZodObject<{
        candidate: z.ZodObject<{
            fullName: z.ZodString;
            email: z.ZodString;
            phone: z.ZodOptional<z.ZodString>;
            linkedinUrl: z.ZodOptional<z.ZodString>;
            location: z.ZodOptional<z.ZodString>;
            headline: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        }, {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        }>;
        targetRole: z.ZodString;
        targetCompany: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        salutation: z.ZodOptional<z.ZodString>;
        bodyParagraphs: z.ZodArray<z.ZodString, "many">;
        closing: z.ZodOptional<z.ZodString>;
        signatureName: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        targetCompany: string;
        bodyParagraphs: string[];
        date?: string | undefined;
        salutation?: string | undefined;
        closing?: string | undefined;
        signatureName?: string | undefined;
    }, {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        targetCompany: string;
        bodyParagraphs: string[];
        date?: string | undefined;
        salutation?: string | undefined;
        closing?: string | undefined;
        signatureName?: string | undefined;
    }>>;
    remainingFields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        stableFieldId: z.ZodString;
        answer: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        stableFieldId: string;
        answer: string;
    }, {
        stableFieldId: string;
        answer: string;
    }>, "many">>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    answers: {
        stableFieldId: string;
        answer: string;
    }[];
    resume?: {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        sections: {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }[];
        targetCompany?: string | undefined;
        summary?: string | undefined;
    } | undefined;
    notes?: string | undefined;
    coverLetter?: {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        targetCompany: string;
        bodyParagraphs: string[];
        date?: string | undefined;
        salutation?: string | undefined;
        closing?: string | undefined;
        signatureName?: string | undefined;
    } | undefined;
    remainingFields?: {
        stableFieldId: string;
        answer: string;
    }[] | undefined;
}, {
    answers: {
        stableFieldId: string;
        answer: string;
    }[];
    resume?: {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        sections: {
            title: string;
            items: {
                heading?: string | undefined;
                subheading?: string | undefined;
                dateRange?: string | undefined;
                bullets?: string[] | undefined;
            }[];
        }[];
        targetCompany?: string | undefined;
        summary?: string | undefined;
    } | undefined;
    notes?: string | undefined;
    coverLetter?: {
        candidate: {
            email: string;
            fullName: string;
            phone?: string | undefined;
            linkedinUrl?: string | undefined;
            location?: string | undefined;
            headline?: string | undefined;
        };
        targetRole: string;
        targetCompany: string;
        bodyParagraphs: string[];
        date?: string | undefined;
        salutation?: string | undefined;
        closing?: string | undefined;
        signatureName?: string | undefined;
    } | undefined;
    remainingFields?: {
        stableFieldId: string;
        answer: string;
    }[] | undefined;
}>;
export type GptApplicationPackage = z.infer<typeof GptApplicationPackageSchema>;
export interface GptJobContext {
    jobTitle: string | null;
    company: string | null;
    jobDescription: string | null;
    jobUrl: string | null;
    platform: string | null;
}
export interface GptCandidateContext {
    name: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    stack: string | null;
    notes: string | null;
}
export interface GptPendingField {
    stableFieldId: string;
    label: string | null;
    fieldType: string;
    required: boolean;
    category: string;
    placeholder?: string | null;
    options?: string[];
}
export interface GptContextPayload {
    applicationId: number;
    jobContext: GptJobContext;
    candidate: GptCandidateContext;
    pendingAiFields: GptPendingField[];
    fileFields: GptPendingField[];
    allFields: GptPendingField[];
}
export declare function generateApplicationPackage(context: GptContextPayload): Promise<GptApplicationPackage>;
export type { ResumeDocument, CoverLetterDocument };
//# sourceMappingURL=application-gpt.service.d.ts.map