"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GptApplicationPackageSchema = exports.CoverLetterDocumentSchema = exports.ResumeDocumentSchema = void 0;
exports.generateApplicationPackage = generateApplicationPackage;
const openai_1 = __importDefault(require("openai"));
const zod_1 = require("zod");
const env_1 = require("../../config/env");
const AnswerItemSchema = zod_1.z.object({
    stableFieldId: zod_1.z.string().min(1),
    answer: zod_1.z.string(),
});
const ResumeCandidateSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(1),
    email: zod_1.z.string().min(1),
    phone: zod_1.z.string().optional(),
    linkedinUrl: zod_1.z.string().optional(),
    location: zod_1.z.string().optional(),
    headline: zod_1.z.string().optional(),
});
const ResumeSectionItemSchema = zod_1.z.object({
    heading: zod_1.z.string().optional(),
    subheading: zod_1.z.string().optional(),
    dateRange: zod_1.z.string().optional(),
    bullets: zod_1.z.array(zod_1.z.string()).optional(),
});
const ResumeSectionSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    items: zod_1.z.array(ResumeSectionItemSchema),
});
exports.ResumeDocumentSchema = zod_1.z.object({
    candidate: ResumeCandidateSchema,
    targetRole: zod_1.z.string().min(1),
    targetCompany: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    sections: zod_1.z.array(ResumeSectionSchema).min(1),
});
exports.CoverLetterDocumentSchema = zod_1.z.object({
    candidate: ResumeCandidateSchema,
    targetRole: zod_1.z.string().min(1),
    targetCompany: zod_1.z.string().min(1),
    date: zod_1.z.string().optional(),
    salutation: zod_1.z.string().optional(),
    bodyParagraphs: zod_1.z.array(zod_1.z.string().min(1)).min(2),
    closing: zod_1.z.string().optional(),
    signatureName: zod_1.z.string().optional(),
});
exports.GptApplicationPackageSchema = zod_1.z.object({
    answers: zod_1.z.array(AnswerItemSchema),
    resume: exports.ResumeDocumentSchema.optional(),
    coverLetter: exports.CoverLetterDocumentSchema.optional(),
    remainingFields: zod_1.z.array(AnswerItemSchema).optional(),
    notes: zod_1.z.string().optional(),
});
function getOpenAiClient() {
    if (!env_1.config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not configured on the server. Add it to server/.env and restart.');
    }
    return new openai_1.default({ apiKey: env_1.config.openaiApiKey });
}
function buildSystemPrompt() {
    return `You are the QTS Job Application Assistant. Generate tailored application content as JSON only.

Rules:
- Use only candidate facts from the provided context. Never invent employers, degrees, or contact details.
- Tailor resume and cover letter to the job description, company, and target role.
- For each pending AI field, provide an answer using the exact stableFieldId.
- For checkbox fields in remainingFields, answer only "true" or "false".
- For essay or textarea questions, write 80-180 words unless the label implies shorter.
- Always include resume JSON when a file upload field exists or when tailoring is needed.
- Always include coverLetter JSON when applying to a company.
- Do not include markdown or commentary outside the JSON schema.`;
}
function buildUserPrompt(context) {
    return JSON.stringify({
        applicationId: context.applicationId,
        jobContext: context.jobContext,
        candidate: context.candidate,
        pendingAiFields: context.pendingAiFields,
        fileFields: context.fileFields,
        instructions: {
            answers: 'One entry per pendingAiFields stableFieldId',
            remainingFields: 'Optional checkbox/select fills not already handled',
            resume: 'Structured resume JSON tailored to the job',
            coverLetter: 'Structured cover letter JSON tailored to company and role',
        },
    }, null, 2);
}
async function generateApplicationPackage(context) {
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
        model: env_1.config.openaiModel,
        temperature: 0.4,
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'gpt_application_package',
                strict: false,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['answers'],
                    properties: {
                        answers: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['stableFieldId', 'answer'],
                                properties: {
                                    stableFieldId: { type: 'string' },
                                    answer: { type: 'string' },
                                },
                            },
                        },
                        resume: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['candidate', 'targetRole', 'sections'],
                            properties: {
                                candidate: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['fullName', 'email'],
                                    properties: {
                                        fullName: { type: 'string' },
                                        email: { type: 'string' },
                                        phone: { type: 'string' },
                                        linkedinUrl: { type: 'string' },
                                        location: { type: 'string' },
                                        headline: { type: 'string' },
                                    },
                                },
                                targetRole: { type: 'string' },
                                targetCompany: { type: 'string' },
                                summary: { type: 'string' },
                                sections: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['title', 'items'],
                                        properties: {
                                            title: { type: 'string' },
                                            items: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    additionalProperties: false,
                                                    properties: {
                                                        heading: { type: 'string' },
                                                        subheading: { type: 'string' },
                                                        dateRange: { type: 'string' },
                                                        bullets: { type: 'array', items: { type: 'string' } },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        coverLetter: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['candidate', 'targetRole', 'targetCompany', 'bodyParagraphs'],
                            properties: {
                                candidate: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['fullName', 'email'],
                                    properties: {
                                        fullName: { type: 'string' },
                                        email: { type: 'string' },
                                        phone: { type: 'string' },
                                        linkedinUrl: { type: 'string' },
                                    },
                                },
                                targetRole: { type: 'string' },
                                targetCompany: { type: 'string' },
                                date: { type: 'string' },
                                salutation: { type: 'string' },
                                bodyParagraphs: { type: 'array', items: { type: 'string' } },
                                closing: { type: 'string' },
                                signatureName: { type: 'string' },
                            },
                        },
                        remainingFields: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['stableFieldId', 'answer'],
                                properties: {
                                    stableFieldId: { type: 'string' },
                                    answer: { type: 'string' },
                                },
                            },
                        },
                        notes: { type: 'string' },
                    },
                },
            },
        },
        messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: buildUserPrompt(context) },
        ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('OpenAI returned an empty response.');
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        throw new Error('OpenAI returned invalid JSON.');
    }
    return exports.GptApplicationPackageSchema.parse(parsed);
}
//# sourceMappingURL=application-gpt.service.js.map