'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QtsCoverLetterDocument, QtsResumeDocument } from '@/components/ResumeDocumentTypes';

type QtsCoverLetterPreviewProps = {
  resume: QtsResumeDocument;
  coverLetter: QtsCoverLetterDocument;
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
  coverLetter: QtsCoverLetterDocument
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
      padding: 66px 74px 64px;
      border-top: 12px solid #0e5265;
      background: #fff;
    }
    .letter-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 38px;
    }
    .letter-brand-mark {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border-radius: 8px;
      background: #0e5265;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    .letter-brand-name {
      color: #0e5265;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2em;
    }
    .letter-sender-name {
      margin: 0 0 8px;
      color: #12364a;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 32px;
      font-weight: 700;
      line-height: 1.15;
    }
    .letter-contact {
      color: #536775;
      font-size: 11px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    .letter-rule {
      height: 2px;
      margin: 25px 0 24px;
      background: #8bb8c0;
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
    .letter-footer {
      height: 4px;
      margin-top: 42px;
      background: linear-gradient(90deg, #0e5265 0 28%, #8bb8c0 28% 100%);
    }
    html, body { background: #fff; }
  </style>
</head>
<body>
  <div id="resumePages">
    <article class="resumePage">
      <header class="letter-brand">
        <div class="letter-brand-mark">QTS</div>
        <div class="letter-brand-name">CAREER DOCUMENTS</div>
      </header>
      <section>
        <h1 class="letter-sender-name">${escapeHtml(candidate.fullName)}</h1>
        <div class="letter-contact">${contacts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
      </section>
      <div class="letter-rule"></div>
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
    </article>
  </div>
</body>
</html>`;
}

export function QtsCoverLetterPreview({ resume, coverLetter }: QtsCoverLetterPreviewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [frameReady, setFrameReady] = useState(false);
  const srcDoc = createQtsCoverLetterHtml(resume, coverLetter);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const viewport = wrapper?.parentElement;
    if (!wrapper || !viewport) return undefined;
    const updateScale = () => setScale(Math.min(1, viewport.clientWidth / pageWidth));
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

  useEffect(() => {
    resizeFrame();
  }, [resizeFrame, srcDoc]);

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
