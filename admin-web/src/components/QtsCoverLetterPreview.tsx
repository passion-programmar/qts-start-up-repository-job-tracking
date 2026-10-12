'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QtsCoverLetterDocument, QtsResumeDocument } from '@/components/ResumeDocumentTypes';

export type QtsCoverLetterTemplate = 'qts_resume_1' | 'qts_resume_2' | 'qts_resume_3';

type QtsCoverLetterPreviewProps = {
  resume: QtsResumeDocument;
  coverLetter: QtsCoverLetterDocument;
  template: QtsCoverLetterTemplate;
  onError: (message: string) => void;
};

const pageWidth = 816;
const pageHeight = 1056;

function escapeHtml(value: string | undefined): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return (value || '').replace(/[&<>"']/g, (character) => entities[character] || character);
}

export function createQtsCoverLetterHtml(
  resume: QtsResumeDocument,
  coverLetter: QtsCoverLetterDocument,
  template: QtsCoverLetterTemplate = 'qts_resume_1',
): string {
  const candidate = resume.candidate;
  const contacts = [
    candidate.email,
    candidate.phone,
    candidate.location,
    candidate.linkedinUrl,
  ].filter((value): value is string => Boolean(value?.trim()));
  const date = coverLetter.date?.trim() || new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const company = resume.targetCompany?.trim() || 'Hiring Team';
  const jobsite = resume.targetJobsite?.trim() || '';
  const bodyParagraphs = coverLetter.bodyParagraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QTS Cover Letter</title>
  <style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9edf2; }
  body { color: #172b3a; font-family: Arial, Helvetica, sans-serif; }
  #resumePages { width: ${pageWidth}px; margin: 0 auto; }
  .resumePage {
    position: relative;
    width: ${pageWidth}px;
    min-height: ${pageHeight}px;
    padding: 54px 74px 64px;
    background: #fff;
  }
  .letter-header {
    margin-bottom: 28px;
    padding-bottom: 18px;
    border-bottom: 2px solid #8bb8c0;
  }
  .letter-sender-name {
    margin: 0 0 6px;
    color: #12364a;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.15;
  }
  .letter-headline {
    margin: 0 0 8px;
    color: #536775;
    font-size: 12px;
    line-height: 1.5;
  }
  .letter-contact {
    color: #536775;
    font-size: 11px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    .letter-meta {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 35px;
      color: #536775;
      font-size: 12px;
      line-height: 1.7;
    }
    .letter-recipient { color: #12364a; font-weight: 700; overflow-wrap: anywhere; }
    .letter-date { text-align: right; white-space: nowrap; }
    .letter-subject {
      margin: 0 0 24px;
      color: #0e5265;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 17px;
      font-weight: 700;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .letter-salutation {
      margin: 0 0 18px;
      color: #172b3a;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.6;
    }
    .letter-body {
      color: #283c49;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13px;
      line-height: 1.85;
      overflow-wrap: anywhere;
    }
    .letter-body p { margin: 0 0 17px; }
    .letter-closing {
      margin-top: 27px;
      color: #283c49;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13px;
      line-height: 1.7;
    }
    .letter-signature {
      margin-top: 8px;
      color: #12364a;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 17px;
      font-weight: 700;
    }
    .letter-footer { height: 3px; margin-top: 42px; background: #8bb8c0; }
    .resumePage[data-template="qts_resume_1"] { border-top: 12px solid #0e5265; }
    .resumePage[data-template="qts_resume_2"] { border-top: 8px solid #355c7d; }
    .resumePage[data-template="qts_resume_2"] .letter-header {
      margin-bottom: 32px;
      border-bottom-color: #355c7d;
      text-align: center;
    }
    .resumePage[data-template="qts_resume_2"] .letter-sender-name {
      color: #355c7d;
      font-size: 34px;
    }
    .resumePage[data-template="qts_resume_2"] .letter-meta { margin-bottom: 32px; }
    .resumePage[data-template="qts_resume_2"] .letter-subject {
      color: #355c7d;
      font-family: Georgia, 'Times New Roman', serif;
    }
    .resumePage[data-template="qts_resume_2"] .letter-footer { background: #355c7d; }
    .resumePage[data-template="qts_resume_3"] {
      padding: 0;
      border-top: 0;
      border-bottom: 8px solid #168b80;
    }
    .resumePage[data-template="qts_resume_3"] .letter-header {
      margin: 0;
      padding: 48px 74px 34px;
      border: 0;
      background: #14283f;
    }
    .resumePage[data-template="qts_resume_3"] .letter-sender-name { color: #fff; }
    .resumePage[data-template="qts_resume_3"] .letter-headline { color: #79d3c4; }
    .resumePage[data-template="qts_resume_3"] .letter-contact { color: #e6edf4; }
    .resumePage[data-template="qts_resume_3"] .letter-main { padding: 38px 74px 56px; }
    .resumePage[data-template="qts_resume_3"] .letter-recipient { color: #14283f; }
    .resumePage[data-template="qts_resume_3"] .letter-subject { color: #14796f; }
    .resumePage[data-template="qts_resume_3"] .letter-footer { background: #168b80; }
    @media print {
      html, body, #resumePages { width: ${pageWidth}px; }
      .resumePage { break-after: page; page-break-after: always; }
    }
    html, body { background: #fff; }
  </style>
</head>
<body>
  <div id="resumePages">
    <article class="resumePage" data-template="${template}">
      <header class="letter-header">
        <h1 class="letter-sender-name">${escapeHtml(candidate.fullName)}</h1>
        ${candidate.headline?.trim() ? `<p class="letter-headline">${escapeHtml(candidate.headline)}</p>` : ''}
        <div class="letter-contact">${contacts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
      </header>
      <main class="letter-main">
        <section class="letter-meta">
          <div>
            <div class="letter-recipient">${escapeHtml(company)}</div>
            ${jobsite ? `<div>${escapeHtml(jobsite)}</div>` : ''}
            <div>Hiring Team</div>
          </div>
          <div class="letter-date">${escapeHtml(date)}</div>
        </section>
        <h2 class="letter-subject">Re: ${escapeHtml(resume.targetRole)}</h2>
        <p class="letter-salutation">${escapeHtml(coverLetter.salutation?.trim() || 'Dear Hiring Manager,')}</p>
        <div class="letter-body">${bodyParagraphs}</div>
        <div class="letter-closing">${escapeHtml(coverLetter.closing?.trim() || 'Sincerely,')}</div>
        <div class="letter-signature">${escapeHtml(candidate.fullName)}</div>
        <div class="letter-footer"></div>
      </main>
    </article>
  </div>
</body>
</html>`;
}

export function QtsCoverLetterPreview({
  resume,
  coverLetter,
  template,
  onError,
}: QtsCoverLetterPreviewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [frameReady, setFrameReady] = useState(false);
  const [srcDoc] = useState(() => createQtsCoverLetterHtml(resume, coverLetter, template));
  const html = createQtsCoverLetterHtml(resume, coverLetter, template);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const viewport = wrapper?.parentElement;
    if (!wrapper || !viewport) return undefined;
    const updateScale = () => setScale(Math.min(1.8, viewport.clientWidth / pageWidth));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const resizeFrame = useCallback(() => {
    if (!frameReady) return;
    const document = iframeRef.current?.contentDocument;
    if (!document) return;
    const page = document.querySelector<HTMLElement>('.resumePage');
    if (!page) return;
    const contentHeight = Math.max(pageHeight, document.documentElement.scrollHeight);
    page.style.minHeight = `${contentHeight}px`;
    if (iframeRef.current) {
      iframeRef.current.style.height = `${contentHeight}px`;
    }
    if (wrapperRef.current) {
      wrapperRef.current.style.height = `${contentHeight * scale}px`;
    }
  }, [frameReady, scale]);

  useLayoutEffect(() => {
    if (!frameReady) return;
    const previewDocument = iframeRef.current?.contentDocument;
    if (!previewDocument) {
      onError('Could not read the cover letter preview.');
      return;
    }

    try {
      const nextDocument = new DOMParser().parseFromString(html, 'text/html');
      const nextStyle = nextDocument.head.querySelector('style');
      const currentStyle = previewDocument.head.querySelector('style');
      const nextPage = nextDocument.querySelector('.resumePage');
      const currentPage = previewDocument.querySelector('.resumePage');
      if (!nextStyle || !currentStyle || !nextPage || !currentPage) {
        throw new Error('Could not update the cover letter preview content.');
      }

      currentStyle.replaceWith(previewDocument.importNode(nextStyle, true));
      currentPage.replaceWith(previewDocument.importNode(nextPage, true));
      resizeFrame();
      onError('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not update the cover letter preview.');
    }
  }, [frameReady, html, onError, resizeFrame]);

  return (
    <div
      className="qts-cover-letter-preview"
      ref={wrapperRef}
      style={{ width: `${pageWidth * scale}px`, height: `${pageHeight * scale}px` }}
      aria-label="QTS cover letter preview"
    >
      <iframe
        ref={iframeRef}
        title="QTS cover letter preview"
        srcDoc={srcDoc}
        onLoad={() => {
          setFrameReady(true);
          window.requestAnimationFrame(resizeFrame);
        }}
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}
