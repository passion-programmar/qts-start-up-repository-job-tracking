import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

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

function writePdf(build: (doc: PDFKit.PDFDocument) => void, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const doc = new PDFDocument({ margin: 54, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    build(doc);
    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

function contactLine(doc: PDFKit.PDFDocument, parts: string[]) {
  const line = parts.filter(Boolean).join('  |  ');
  if (line) {
    doc.fontSize(10).fillColor('#334155').text(line, { align: 'center' });
    doc.moveDown(0.5);
  }
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  doc.fontSize(12).fillColor('#0f172a').text(title.toUpperCase(), { underline: true });
  doc.moveDown(0.35);
}

export async function renderResumePdf(resume: ResumeDocumentInput, outputPath: string): Promise<void> {
  await writePdf((doc) => {
    const { candidate, targetRole, targetCompany, summary, sections } = resume;

    doc.fontSize(20).fillColor('#0f172a').text(candidate.fullName, { align: 'center' });
    if (candidate.headline) {
      doc.fontSize(11).fillColor('#475569').text(candidate.headline, { align: 'center' });
    }
    doc.moveDown(0.3);
    contactLine(doc, [
      candidate.email,
      candidate.phone || '',
      candidate.location || '',
      candidate.linkedinUrl || '',
    ]);

    doc.fontSize(12).fillColor('#1d4ed8').text(
      [targetRole, targetCompany].filter(Boolean).join(' — '),
      { align: 'center' }
    );
    doc.moveDown(0.8);

    if (summary) {
      sectionHeading(doc, 'Summary');
      doc.fontSize(10).fillColor('#334155').text(summary, { align: 'left', lineGap: 2 });
    }

    for (const section of sections || []) {
      if (!section?.title) continue;
      sectionHeading(doc, section.title);
      for (const item of section.items || []) {
        if (item.heading) {
          doc.fontSize(11).fillColor('#0f172a').text(item.heading, { continued: Boolean(item.dateRange) });
          if (item.dateRange) {
            doc.fontSize(10).fillColor('#64748b').text(`  (${item.dateRange})`);
          } else {
            doc.text('');
          }
        }
        if (item.subheading) {
          doc.fontSize(10).fillColor('#475569').text(item.subheading);
        }
        for (const bullet of item.bullets || []) {
          doc.fontSize(10).fillColor('#334155').text(`• ${bullet}`, { indent: 12, lineGap: 1 });
        }
        doc.moveDown(0.25);
      }
    }
  }, outputPath);
}

export async function renderCoverLetterPdf(
  coverLetter: CoverLetterDocumentInput,
  outputPath: string
): Promise<void> {
  await writePdf((doc) => {
    const {
      candidate,
      targetRole,
      targetCompany,
      date,
      salutation,
      bodyParagraphs,
      closing,
      signatureName,
    } = coverLetter;

    const displayDate = date || new Date().toISOString().slice(0, 10);
    doc.fontSize(10).fillColor('#334155').text(displayDate);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0f172a').text(targetCompany);
    doc.moveDown(0.8);

    doc.text(salutation || 'Dear Hiring Manager,');
    doc.moveDown(0.6);

    doc.fontSize(10).fillColor('#1e293b');
    for (const paragraph of bodyParagraphs || []) {
      doc.text(paragraph, { align: 'left', lineGap: 3 });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);
    doc.text(closing || 'Sincerely,');
    doc.moveDown(1.2);
    doc.text(signatureName || candidate.fullName);
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#64748b').text(
      [candidate.email, candidate.phone].filter(Boolean).join(' · ')
    );
    doc.moveDown(0.3);
    doc.text(`Re: ${targetRole} at ${targetCompany}`);
  }, outputPath);
}

export function safePdfFileName(base: string): string {
  return base.replace(/[^\w.-]+/g, '_').slice(0, 80);
}
