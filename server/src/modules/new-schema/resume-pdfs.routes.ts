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
  template: z.enum(['qts_resume_1', 'qts_resume_2', 'qts_resume_3', 'qts_cover_letter', 'flowcv', 'classic', 'compact']),
  resume: ResumeDocumentSchema,
  renderedHtml: z.string().max(1_500_000).optional(),
}).strict().superRefine((data, context) => {
  if (
    (
      data.template === 'qts_resume_1'
      || data.template === 'qts_resume_2'
      || data.template === 'qts_resume_3'
      || data.template === 'qts_cover_letter'
    )
    && !data.renderedHtml
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['renderedHtml'],
      message: 'Provide the rendered QTS document to generate a matching PDF.',
    });
  }
});

router.post(
  '/preview',
  requireNewSchemaAuth,
  async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
    if (req.newSchemaUser?.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Only Managers can generate resume and cover letter PDFs.' });
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
      let pdf: Buffer;
      if (template === 'qts_cover_letter') {
        const renderedHtml = parsed.data.renderedHtml;
        if (!renderedHtml) throw new Error('Rendered cover letter is required.');
        pdf = await renderFlowCvHtmlPdfBuffer(renderedHtml);
      } else if (template === 'qts_resume_1' || template === 'qts_resume_2' || template === 'qts_resume_3') {
        const renderedHtml = parsed.data.renderedHtml;
        if (!renderedHtml) throw new Error('Rendered resume is required.');
        pdf = await renderFlowCvHtmlPdfBuffer(renderedHtml);
      } else {
        pdf = await renderResumePdfBuffer(parsed.data.resume, template);
      }
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
