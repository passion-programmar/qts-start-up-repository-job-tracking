"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const application_document_pdf_1 = require("../../services/application-document-pdf");
const flowcv_html_pdf_1 = require("../../services/flowcv-html-pdf");
const document_schemas_1 = require("../document-builder/document.schemas");
const router = (0, express_1.Router)();
const requestSchema = zod_1.z.object({
    template: zod_1.z.enum(['qts_resume_1', 'qts_resume_2', 'qts_resume_3', 'flowcv', 'classic', 'compact']),
    resume: document_schemas_1.ResumeDocumentSchema,
    renderedHtml: zod_1.z.string().max(1500000).optional(),
}).strict().superRefine((data, context) => {
    if ((data.template === 'qts_resume_1' || data.template === 'qts_resume_2' || data.template === 'qts_resume_3')
        && !data.renderedHtml) {
        context.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['renderedHtml'],
            message: 'Provide the rendered QTS preview to generate a matching PDF.',
        });
    }
});
router.post('/preview', new_schema_auth_1.requireNewSchemaAuth, async (req, res, next) => {
    if (req.newSchemaUser?.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Only Managers can generate resume PDFs.' });
        return;
    }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            message: 'Provide a valid resume and PDF template.',
            errors: parsed.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
        return;
    }
    try {
        const template = parsed.data.template;
        const pdf = (template === 'qts_resume_1' || template === 'qts_resume_2' || template === 'qts_resume_3') && parsed.data.renderedHtml
            ? await (0, flowcv_html_pdf_1.renderFlowCvHtmlPdfBuffer)(parsed.data.renderedHtml)
            : await (0, application_document_pdf_1.renderResumePdfBuffer)(parsed.data.resume, template);
        const fileName = `${(0, application_document_pdf_1.safePdfFileName)(parsed.data.resume.candidate.fullName) || 'Resume'}.pdf`;
        res
            .status(200)
            .type('application/pdf')
            .set({
            'Content-Disposition': `inline; filename="${fileName}"`,
            'Cache-Control': 'no-store',
            'Content-Length': String(pdf.length),
        })
            .send(pdf);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=resume-pdfs.routes.js.map