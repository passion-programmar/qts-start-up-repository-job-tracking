"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GptApplicationPackageSchema = exports.BuildDocumentsInputSchema = exports.CoverLetterDocumentSchema = exports.ResumeDocumentSchema = exports.ResumeSectionSchema = exports.ResumeSectionItemSchema = exports.CandidateContactSchema = void 0;
const zod_1 = require("zod");
exports.CandidateContactSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(1).max(200),
    email: zod_1.z.string().email().max(200),
    phone: zod_1.z.string().max(80).optional(),
    linkedinUrl: zod_1.z.string().max(500).optional(),
    location: zod_1.z.string().max(200).optional(),
    headline: zod_1.z.string().max(300).optional(),
});
exports.ResumeSectionItemSchema = zod_1.z.object({
    heading: zod_1.z.string().max(300).optional(),
    subheading: zod_1.z.string().max(300).optional(),
    dateRange: zod_1.z.string().max(100).optional(),
    bullets: zod_1.z.array(zod_1.z.string().max(500)).optional(),
});
exports.ResumeSectionSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(100),
    items: zod_1.z.array(exports.ResumeSectionItemSchema).min(1),
});
/** JSON resume payload from Custom GPT — matches docs/schemas/resume-document.schema.json */
exports.ResumeDocumentSchema = zod_1.z.object({
    candidate: exports.CandidateContactSchema,
    targetRole: zod_1.z.string().min(1).max(300),
    targetCompany: zod_1.z.string().max(300).optional(),
    summary: zod_1.z.string().max(1200).optional(),
    sections: zod_1.z.array(exports.ResumeSectionSchema).min(1),
});
/** JSON cover letter payload from Custom GPT */
exports.CoverLetterDocumentSchema = zod_1.z.object({
    candidate: exports.CandidateContactSchema.pick({
        fullName: true,
        email: true,
        phone: true,
        linkedinUrl: true,
    }),
    targetRole: zod_1.z.string().min(1).max(300),
    targetCompany: zod_1.z.string().min(1).max(300),
    date: zod_1.z.string().max(50).optional(),
    salutation: zod_1.z.string().max(200).optional(),
    bodyParagraphs: zod_1.z.array(zod_1.z.string().max(900)).min(1).max(6),
    closing: zod_1.z.string().max(100).optional(),
    signatureName: zod_1.z.string().max(200).optional(),
});
exports.BuildDocumentsInputSchema = zod_1.z.object({
    resume: exports.ResumeDocumentSchema.optional(),
    coverLetter: exports.CoverLetterDocumentSchema.optional(),
}).refine((data) => data.resume || data.coverLetter, {
    message: 'At least one of resume or coverLetter is required.',
});
exports.GptApplicationPackageSchema = zod_1.z.object({
    answers: zod_1.z.array(zod_1.z.object({
        stableFieldId: zod_1.z.string().min(1),
        answer: zod_1.z.string(),
    })).default([]),
    resume: exports.ResumeDocumentSchema.optional(),
    coverLetter: exports.CoverLetterDocumentSchema.optional(),
    remainingFields: zod_1.z.array(zod_1.z.object({
        stableFieldId: zod_1.z.string().min(1),
        answer: zod_1.z.string(),
    })).optional(),
    notes: zod_1.z.string().max(2000).optional(),
});
//# sourceMappingURL=document.schemas.js.map