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

export type ResumePdfTemplate = 'qts_resume_1' | 'flowcv' | 'classic' | 'compact';

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

const resumeFontsPath = path.resolve(__dirname, '../../assets/fonts');

function registerResumeFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont('Resume-Regular', path.join(resumeFontsPath, 'NotoSans-Regular.ttf'));
  doc.registerFont('Resume-Bold', path.join(resumeFontsPath, 'NotoSans-Bold.ttf'));
  doc.registerFont('Resume-Slab', path.join(resumeFontsPath, 'ZillaSlab-Regular.ttf'));
  doc.registerFont('Resume-Slab-Bold', path.join(resumeFontsPath, 'ZillaSlab-Bold.ttf'));
}

function writePdf(
  build: (doc: PDFKit.PDFDocument) => void,
  outputPath: string,
  margin = 54
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const doc = new PDFDocument({ margin, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    build(doc);
    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

function writePdfBuffer(build: (doc: PDFKit.PDFDocument) => void, margin = 54): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function contactLine(doc: PDFKit.PDFDocument, parts: string[]) {
  const line = parts.filter(Boolean).join('  |  ');
  if (line) {
    doc.font('Resume-Regular').fontSize(10).fillColor('#334155').text(line, { align: 'center' });
    doc.moveDown(0.5);
  }
}

function classicSectionHeading(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  doc.font('Resume-Bold').fontSize(12).fillColor('#0f172a').text(title.toUpperCase(), { underline: true });
  doc.moveDown(0.35);
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string, compact = false) {
  doc.moveDown(compact ? 0.35 : 0.6);
  doc.font('Resume-Bold').fontSize(compact ? 10 : 11).fillColor('#1d4ed8')
    .text(title.toUpperCase());
  const y = doc.y + 3;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.7)
    .strokeColor('#cbd5e1')
    .stroke();
  doc.moveDown(compact ? 0.3 : 0.45);
}

function buildModernResume(
  doc: PDFKit.PDFDocument,
  resume: ResumeDocumentInput,
  compact = false
): void {
  const { candidate, targetRole, targetCompany, summary, sections } = resume;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const baseSize = compact ? 9 : 10;

  doc.font('Resume-Bold').fontSize(compact ? 21 : 24).fillColor('#0f172a')
    .text(candidate.fullName);
  if (candidate.headline) {
    doc.moveDown(0.15);
    doc.font('Resume-Regular').fontSize(compact ? 10 : 11).fillColor('#475569')
      .text(candidate.headline);
  }

  doc.moveDown(0.35);
  const contacts = [
    candidate.email,
    candidate.phone,
    candidate.location,
    candidate.linkedinUrl,
  ].filter((value): value is string => Boolean(value));
  if (contacts.length) {
    doc.font('Resume-Regular').fontSize(9).fillColor('#334155')
      .text(contacts.join('  |  '), { width: contentWidth });
  }

  doc.moveDown(0.35);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(2)
    .strokeColor('#2563eb')
    .stroke();
  doc.moveDown(0.35);
  doc.font('Resume-Bold').fontSize(10).fillColor('#1d4ed8')
    .text([targetRole, targetCompany].filter(Boolean).join('  |  '));

  if (summary) {
    sectionHeading(doc, 'Summary', compact);
    doc.font('Resume-Regular').fontSize(baseSize).fillColor('#334155')
      .text(summary, { align: 'left', lineGap: compact ? 0 : 2 });
  }

  for (const section of sections || []) {
    if (!section?.title) continue;
    sectionHeading(doc, section.title, compact);
    for (const item of section.items || []) {
      if (item.heading) {
        doc.font('Resume-Bold').fontSize(compact ? 10 : 11).fillColor('#0f172a')
          .text(item.heading);
      }
      const itemDetails = [item.subheading, item.dateRange].filter(Boolean).join('  |  ');
      if (itemDetails) {
        doc.moveDown(0.1);
        doc.font('Resume-Regular').fontSize(9).fillColor('#64748b').text(itemDetails);
      }
      for (const bullet of item.bullets || []) {
        doc.moveDown(0.12);
        doc.font('Resume-Regular').fontSize(baseSize).fillColor('#334155')
          .text(`• ${bullet}`, { indent: 10, lineGap: compact ? 0 : 1 });
      }
      doc.moveDown(compact ? 0.12 : 0.25);
    }
  }
}

const flowCvColors = {
  header: '#0b3440',
  heading: '#26123b',
  body: '#24272b',
  muted: '#e6edf0',
};

function drawContactIcon(
  doc: PDFKit.PDFDocument,
  kind: 'email' | 'phone' | 'location' | 'linkedin',
  x: number,
  y: number
): void {
  const color = '#f4f7f7';
  doc.save().lineWidth(0.7).strokeColor(color).fillColor(color);
  if (kind === 'email') {
    doc.rect(x, y + 2, 8, 5.5).stroke();
    doc.moveTo(x, y + 2).lineTo(x + 4, y + 5).lineTo(x + 8, y + 2).stroke();
  } else if (kind === 'phone') {
    doc.circle(x + 4, y + 4.5, 3).stroke();
    doc.moveTo(x + 2, y + 2.8).lineTo(x + 3, y + 4).lineTo(x + 4.5, y + 5.5).lineTo(x + 6, y + 6.2).stroke();
  } else if (kind === 'location') {
    doc.circle(x + 4, y + 3.4, 2.3).stroke();
    doc.circle(x + 4, y + 3.4, 0.6).fill();
    doc.moveTo(x + 2.4, y + 5.1).lineTo(x + 4, y + 8).lineTo(x + 5.6, y + 5.1).stroke();
  } else {
    doc.roundedRect(x, y + 1, 8, 8, 1).stroke();
    doc.font('Resume-Slab-Bold').fontSize(6).fillColor(color).text('in', x + 1, y + 2, { lineBreak: false });
  }
  doc.restore();
}

function drawSectionIcon(doc: PDFKit.PDFDocument, title: string, x: number, y: number): void {
  const label = title.toLowerCase();
  const size = 9;
  doc.save().fillColor(flowCvColors.heading).roundedRect(x, y, size, size, 1.5).fill();
  doc.fillColor('#ffffff').strokeColor('#ffffff').lineWidth(0.65);

  if (label.includes('skill')) {
    for (let row = 0; row < 3; row += 1) {
      doc.circle(x + 2.2, y + 2.2 + row * 2.3, 0.55).fill();
      doc.moveTo(x + 4, y + 2.2 + row * 2.3).lineTo(x + 7, y + 2.2 + row * 2.3).stroke();
    }
  } else if (label.includes('experience') || label.includes('work')) {
    doc.rect(x + 1.6, y + 3.2, 5.8, 4).stroke();
    doc.moveTo(x + 3, y + 3.2).lineTo(x + 3, y + 2).lineTo(x + 6, y + 2).lineTo(x + 6, y + 3.2).stroke();
    doc.moveTo(x + 1.8, y + 5).lineTo(x + 7.2, y + 5).stroke();
  } else if (label.includes('education')) {
    doc.moveTo(x + 1.2, y + 3.2).lineTo(x + 4.5, y + 1.5).lineTo(x + 7.8, y + 3.2).lineTo(x + 4.5, y + 5).closePath().fill();
    doc.moveTo(x + 2.7, y + 4.3).lineTo(x + 2.7, y + 6.3).lineTo(x + 4.5, y + 7.1).lineTo(x + 6.3, y + 6.3).lineTo(x + 6.3, y + 4.3).stroke();
  } else {
    doc.circle(x + 4.5, y + 2.8, 1.1).fill();
    doc.moveTo(x + 2.1, y + 7).lineTo(x + 2.1, y + 6.1).lineTo(x + 3.1, y + 5.2).lineTo(x + 5.9, y + 5.2).lineTo(x + 6.9, y + 6.1).lineTo(x + 6.9, y + 7).stroke();
  }
  doc.restore();
}

function flowCvSectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  const { left, bottom } = doc.page.margins;
  if (doc.y > doc.page.height - bottom - 28) doc.addPage();

  const y = doc.y + 1;
  drawSectionIcon(doc, title, left, y);
  doc.font('Resume-Slab-Bold').fontSize(9.5).fillColor(flowCvColors.heading)
    .text(title.toUpperCase(), left + 15, y - 1);
  doc.y = Math.max(doc.y, y + 13);
  doc.moveDown(0.45);
}

function flowCvContact(
  doc: PDFKit.PDFDocument,
  kind: 'email' | 'phone' | 'location' | 'linkedin',
  value: string | undefined,
  x: number,
  y: number,
  width: number
): void {
  if (!value) return;
  drawContactIcon(doc, kind, x, y);
  doc.font('Resume-Slab').fontSize(7.7).fillColor('#f4f7f7')
    .text(value, x + 13, y, { width: width - 13, lineBreak: false, ellipsis: true });
}

function buildFlowCvResume(doc: PDFKit.PDFDocument, resume: ResumeDocumentInput): void {
  const { candidate, summary, sections } = resume;
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin - doc.page.margins.right;
  const headerHeight = 180;
  const columnGap = 18;
  const contactColumnWidth = (width - columnGap) / 2;
  const rightColumnX = margin + contactColumnWidth + columnGap;
  const linkedin = candidate.linkedinUrl?.replace(/^https?:\/\/(www\.)?/i, '');

  doc.save().fillColor(flowCvColors.header).rect(0, 0, doc.page.width, headerHeight).fill();
  doc.font('Resume-Slab-Bold').fontSize(19).fillColor('#ffffff')
    .text(candidate.fullName, margin, 39, { width });
  if (candidate.headline) {
    doc.font('Resume-Slab').fontSize(10.5).fillColor('#eef3f4')
      .text(candidate.headline, margin, 72, { width, lineGap: 1 });
  }

  flowCvContact(doc, 'location', candidate.location, margin, 122, contactColumnWidth);
  flowCvContact(doc, 'email', candidate.email, rightColumnX, 122, contactColumnWidth);
  flowCvContact(doc, 'phone', candidate.phone, margin, 146, contactColumnWidth);
  flowCvContact(doc, 'linkedin', linkedin, rightColumnX, 146, contactColumnWidth);
  doc.restore();
  doc.y = headerHeight + 19;

  const bodySize = 8.2;
  if (summary) {
    flowCvSectionHeading(doc, 'Summary');
    doc.font('Resume-Slab').fontSize(bodySize).fillColor(flowCvColors.body)
      .text(summary, { width, lineGap: 1.15, paragraphGap: 1 });
    doc.moveDown(0.75);
  }

  for (const section of sections || []) {
    if (!section?.title) continue;
    flowCvSectionHeading(doc, section.title);

    for (const item of section.items || []) {
      if (section.title.toLowerCase().includes('skill') && item.heading) {
        doc.font('Resume-Slab-Bold').fontSize(bodySize).fillColor(flowCvColors.body)
          .text(item.heading, { continued: Boolean(item.subheading) });
        if (item.subheading) {
          doc.font('Resume-Slab').fontSize(bodySize).fillColor(flowCvColors.body)
            .text(`: ${item.subheading}`, { width, lineGap: 0.8 });
        }
      } else {
        if (item.heading) {
          doc.font('Resume-Slab-Bold').fontSize(9).fillColor(flowCvColors.body)
            .text(item.heading, { continued: Boolean(item.dateRange) });
          if (item.dateRange) {
            doc.font('Resume-Slab').fontSize(7.8).fillColor('#535b60')
              .text(`  |  ${item.dateRange}`, { width });
          }
        }
        if (item.subheading) {
          doc.font('Resume-Slab').fontSize(8).fillColor('#454b50')
            .text(item.subheading, { width });
        }
      }

      for (const bullet of item.bullets || []) {
        doc.font('Resume-Slab').fontSize(bodySize).fillColor(flowCvColors.body)
          .text(`• ${bullet}`, { width, indent: 8, lineGap: 0.8, paragraphGap: 1 });
      }
      doc.moveDown(0.3);
    }
    doc.moveDown(0.45);
  }
}

function buildClassicResume(doc: PDFKit.PDFDocument, resume: ResumeDocumentInput): void {
    const { candidate, targetRole, targetCompany, summary, sections } = resume;

    doc.font('Resume-Bold').fontSize(20).fillColor('#0f172a').text(candidate.fullName, { align: 'center' });
    if (candidate.headline) {
      doc.font('Resume-Regular').fontSize(11).fillColor('#475569').text(candidate.headline, { align: 'center' });
    }
    doc.moveDown(0.3);
    contactLine(doc, [
      candidate.email,
      candidate.phone || '',
      candidate.location || '',
      candidate.linkedinUrl || '',
    ]);

    doc.font('Resume-Bold').fontSize(12).fillColor('#1d4ed8').text(
      [targetRole, targetCompany].filter(Boolean).join(' — '),
      { align: 'center' }
    );
    doc.moveDown(0.8);

    if (summary) {
      classicSectionHeading(doc, 'Summary');
      doc.font('Resume-Regular').fontSize(10).fillColor('#334155').text(summary, { align: 'left', lineGap: 2 });
    }

    for (const section of sections || []) {
      if (!section?.title) continue;
      classicSectionHeading(doc, section.title);
      for (const item of section.items || []) {
        if (item.heading) {
          doc.font('Resume-Bold').fontSize(11).fillColor('#0f172a').text(item.heading, { continued: Boolean(item.dateRange) });
          if (item.dateRange) {
            doc.font('Resume-Regular').fontSize(10).fillColor('#64748b').text(`  (${item.dateRange})`);
          } else {
            doc.text('');
          }
        }
        if (item.subheading) {
          doc.font('Resume-Regular').fontSize(10).fillColor('#475569').text(item.subheading);
        }
        for (const bullet of item.bullets || []) {
          doc.font('Resume-Regular').fontSize(10).fillColor('#334155').text(`• ${bullet}`, { indent: 12, lineGap: 1 });
        }
        doc.moveDown(0.25);
      }
    }
}

function buildResume(
  doc: PDFKit.PDFDocument,
  resume: ResumeDocumentInput,
  template: ResumePdfTemplate
): void {
  registerResumeFonts(doc);
  if (template === 'qts_resume_1' || template === 'flowcv') {
    buildFlowCvResume(doc, resume);
  } else if (template === 'compact') {
    buildModernResume(doc, resume, true);
  } else {
    buildClassicResume(doc, resume);
  }
}

export async function renderResumePdf(
  resume: ResumeDocumentInput,
  outputPath: string,
  template: ResumePdfTemplate = 'classic'
): Promise<void> {
  const margin = template === 'qts_resume_1' || template === 'flowcv' ? 42 : 54;
  await writePdf((doc) => buildResume(doc, resume, template), outputPath, margin);
}

export function renderResumePdfBuffer(
  resume: ResumeDocumentInput,
  template: ResumePdfTemplate = 'classic'
): Promise<Buffer> {
  const margin = template === 'qts_resume_1' || template === 'flowcv' ? 42 : 54;
  return writePdfBuffer((doc) => buildResume(doc, resume, template), margin);
}

function buildCoverLetter(doc: PDFKit.PDFDocument, coverLetter: CoverLetterDocumentInput): void {
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
}

export async function renderCoverLetterPdf(
  coverLetter: CoverLetterDocumentInput,
  outputPath: string
): Promise<void> {
  await writePdf((doc) => buildCoverLetter(doc, coverLetter), outputPath);
}

export function renderCoverLetterPdfBuffer(coverLetter: CoverLetterDocumentInput): Promise<Buffer> {
  return writePdfBuffer((doc) => buildCoverLetter(doc, coverLetter));
}

export function safePdfFileName(base: string): string {
  return base.replace(/[^\w.-]+/g, '_').slice(0, 80);
}
