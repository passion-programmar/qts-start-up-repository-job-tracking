import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { requireNewSchemaAuth, NewSchemaAuthRequest } from '../../middleware/new-schema-auth';
import {
  renderResumePdfBuffer,
  safePdfFileName,
  type ResumePdfTemplate,
} from '../../services/application-document-pdf';
import { renderFlowCvHtmlPdfBuffer } from '../../services/flowcv-html-pdf';
import { ResumeDocumentSchema } from '../document-builder/document.schemas';

const router = Router();
const requestSchema = z.object({
  template: z.enum(['qts_resume_1', 'qts_resume_2', 'flowcv', 'classic', 'compact']),
  resume: ResumeDocumentSchema,
  renderedHtml: z.string().max(1_500_000).optional(),
}).strict().superRefine((data, context) => {
  if ((data.template === 'qts_resume_1' || data.template === 'qts_resume_2') && !data.renderedHtml) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['renderedHtml'],
      message: 'Provide the rendered resume preview to generate a matching PDF.',
    });
  }
});

router.post(
  '/preview',
  requireNewSchemaAuth,
  async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
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
      const template: ResumePdfTemplate = parsed.data.template;
      const pdf = (template === 'qts_resume_1' || template === 'qts_resume_2') && parsed.data.renderedHtml
        ? await renderFlowCvHtmlPdfBuffer(parsed.data.renderedHtml)
        : await renderResumePdfBuffer(parsed.data.resume, template);
      const fileName = `${safePdfFileName(parsed.data.resume.candidate.fullName) || 'Resume'}.pdf`;
      res
        .status(200)
        .type('application/pdf')
        .set({
          'Content-Disposition': `inline; filename="${fileName}"`,
          'Cache-Control': 'no-store',
          'Content-Length': String(pdf.length),
        })
        .send(pdf);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
