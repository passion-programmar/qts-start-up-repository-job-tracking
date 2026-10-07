import { z } from 'zod';

export const CandidateContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().max(200),
  phone: z.string().max(80).optional(),
  linkedinUrl: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  headline: z.string().max(300).optional(),
});

export const ResumeSectionItemSchema = z.object({
  heading: z.string().max(300).optional(),
  subheading: z.string().max(300).optional(),
  dateRange: z.string().max(100).optional(),
  bullets: z.array(z.string().max(500)).optional(),
});

export const ResumeSectionSchema = z.object({
  title: z.string().min(1).max(100),
  items: z.array(ResumeSectionItemSchema).min(1),
});

/** JSON resume payload from Custom GPT — matches docs/schemas/resume-document.schema.json */
export const ResumeDocumentSchema = z.object({
  candidate: CandidateContactSchema,
  targetRole: z.string().min(1).max(300),
  targetCompany: z.string().max(300).optional(),
  summary: z.string().max(1200).optional(),
  sections: z.array(ResumeSectionSchema).min(1),
});

/** JSON cover letter payload from Custom GPT */
export const CoverLetterDocumentSchema = z.object({
  candidate: CandidateContactSchema.pick({
    fullName: true,
    email: true,
    phone: true,
    linkedinUrl: true,
  }),
  targetRole: z.string().min(1).max(300),
  targetCompany: z.string().min(1).max(300),
  date: z.string().max(50).optional(),
  salutation: z.string().max(200).optional(),
  bodyParagraphs: z.array(z.string().max(900)).min(1).max(6),
  closing: z.string().max(100).optional(),
  signatureName: z.string().max(200).optional(),
});

export const BuildDocumentsInputSchema = z.object({
  resume: ResumeDocumentSchema.optional(),
  coverLetter: CoverLetterDocumentSchema.optional(),
}).refine((data) => data.resume || data.coverLetter, {
  message: 'At least one of resume or coverLetter is required.',
});

export const GptApplicationPackageSchema = z.object({
  answers: z.array(z.object({
    stableFieldId: z.string().min(1),
    answer: z.string(),
  })).default([]),
  resume: ResumeDocumentSchema.optional(),
  coverLetter: CoverLetterDocumentSchema.optional(),
  remainingFields: z.array(z.object({
    stableFieldId: z.string().min(1),
    answer: z.string(),
  })).optional(),
  notes: z.string().max(2000).optional(),
});

export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;
export type CoverLetterDocument = z.infer<typeof CoverLetterDocumentSchema>;
export type BuildDocumentsInput = z.infer<typeof BuildDocumentsInputSchema>;
export type GptApplicationPackage = z.infer<typeof GptApplicationPackageSchema>;
