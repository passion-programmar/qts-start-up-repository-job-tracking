'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { QtsResumeDocument, QtsResumeSectionItem } from '@/components/ResumeDocumentTypes';
import { replaceResumePages } from '@/components/resume-preview-dom';

type QtsResume3PreviewProps = {
  resume: QtsResumeDocument;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  scaleMode: 'fit' | 'actual';
  onReady: (ready: boolean) => void;
  onError: (message: string) => void;
  onDocumentReady: (html: string) => void;
};

const pageWidth = 816;
const pageHeight = 1056;
const pageGap = 32;

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

function safeWebUrl(value: string | undefined): string {
  const trimmed = value?.trim() || '';
  if (!trimmed) return '';
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(url).protocol === 'https:' || new URL(url).protocol === 'http:' ? url : '';
  } catch {
    return '';
  }
}

function contactHtml(resume: QtsResumeDocument): string {
  const contacts = [
    { value: resume.candidate.location },
    {
      value: resume.candidate.email,
      href: resume.candidate.email ? `mailto:${resume.candidate.email}` : undefined,
    },
    {
      value: resume.candidate.phone,
      href: resume.candidate.phone ? `tel:${resume.candidate.phone}` : undefined,
    },
    {
      value: resume.candidate.linkedinUrl?.replace(/^https?:\/\/(www\.)?/i, ''),
      href: safeWebUrl(resume.candidate.linkedinUrl),
    },
  ].filter((contact) => contact.value?.trim());

  return contacts.map(({ value, href }) => {
    const text = escapeHtml(value?.trim());
    const safeHref = href ? escapeHtml(href) : '';
    const content = safeHref ? `<a href="${safeHref}">${text}</a>` : `<span>${text}</span>`;
    return `<span class="contact-item">${content}</span>`;
  }).join('');
}

function splitDateAndLocation(value: string | undefined) {
  const [date, ...locationParts] = (value || '').split('|');
  return { date: date.trim(), location: locationParts.join('|').trim() };
}

function entryHtml(item: QtsResumeSectionItem, sectionTitle: string): string {
  const isEducation = sectionTitle.toLowerCase().includes('education');
  const heading = escapeHtml(isEducation ? item.subheading : item.heading);
  const subheading = escapeHtml(isEducation ? item.heading : item.subheading);
  const title = [heading, subheading].filter(Boolean).join(' / ');
  const { date, location } = splitDateAndLocation(item.dateRange);
  const bullets = (item.bullets || []).filter((bullet) => bullet.trim());
  const bulletList = bullets.length
    ? `<ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
    : '';

  return `<div class="resume-block resume-entry">
    <div class="entry-heading"><strong>${title}</strong>${date ? `<span class="entry-date">${escapeHtml(date)}</span>` : ''}</div>
    ${location ? `<div class="entry-location">${escapeHtml(location)}</div>` : ''}
    ${bulletList}
  </div>`;
}

function sectionHtml(title: string, items: QtsResumeSectionItem[]): string {
  const isSkills = title.toLowerCase().includes('skill');
  const blocks = items.map((item) => {
    if (!isSkills) return entryHtml(item, title);
    const heading = escapeHtml(item.heading);
    const subheading = escapeHtml(item.subheading);
    return `<div class="resume-block skill-row">${heading ? `<strong>${heading}</strong>` : ''}${subheading
      ? `<span>${heading ? ' — ' : ''}${subheading}</span>`
      : ''}</div>`;
  }).join('');
  if (!blocks) return '';
  return `<section class="resume-section"><h2 class="section-title">${escapeHtml(title)}</h2>${blocks}</section>`;
}

export function buildQtsResume3Document(resume: QtsResumeDocument): string {
  const summary = resume.summary?.trim()
    ? `<section class="resume-section"><h2 class="section-title">Summary</h2><div class="resume-block summary-text">${escapeHtml(resume.summary)}</div></section>`
    : '';
  const sections = resume.sections
    .filter((section) => section.title?.trim())
    .map((section) => sectionHtml(section.title!.trim(), section.items || []))
    .join('');
  const name = escapeHtml(resume.candidate.fullName);
  const headline = escapeHtml(resume.candidate.headline);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 215.9mm; }
      body { color: #263445; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.45; }
      #resumePages { width: 215.9mm; }
      .resumePage {
        position: relative; width: 215.9mm; height: 279.4mm; min-height: 279.4mm;
        margin: 0 0 32px; overflow: visible; background: #fff; color: #263445;
      }
      .page-content { height: 100%; padding: 44px 56px 50px; }
      .resume-header {
        display: flex; flex-direction: column; align-items: flex-start; text-align: left;
        margin: -44px -56px 25px; padding: 30px 56px 24px;
        background: #14283f; color: #fff;
      }
      .resume-name { max-width: 100%; margin: 0; color: #fff; font-size: 30pt; font-weight: 700; line-height: 1.12; letter-spacing: -.5px; overflow-wrap: anywhere; }
      .resume-headline { max-width: 100%; margin: 7px 0 14px; color: #79d3c4; font-size: 13pt; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
      .contact-list { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 0; margin: 0; color: #e6edf4; font-size: 9pt; line-height: 1.4; }
      .contact-item { display: inline-flex; align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
      .contact-item + .contact-item::before { content: "|"; flex: 0 0 auto; margin: 0 10px; color: #79d3c4; }
      a { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
      .resume-section { margin: 0 0 20px; }
      .section-title {
        display: flex; align-items: center; min-height: 29px;
        margin: 0 0 10px; padding: 5px 10px; border-left: 4px solid #168b80;
        background: #edf4f5; color: #14283f;
        font-size: 11pt; font-weight: 700; letter-spacing: .7px; line-height: 1.3;
        text-align: left; text-transform: uppercase;
      }
      .resume-block { margin: 0 0 11px; }
      .summary-text { white-space: pre-line; }
      .resume-entry { break-inside: avoid; page-break-inside: avoid; }
      .entry-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .entry-heading strong { min-width: 0; color: #14283f; font-weight: 700; }
      .entry-date { flex: 0 0 auto; color: #14796f; font-size: 9pt; font-weight: 700; text-align: right; }
      .entry-location { margin: 2px 0 3px; color: #526273; font-size: 9.5pt; }
      .resume-entry ul { margin: 4px 0 0; padding-left: 18px; list-style: disc; }
      .resume-entry li { padding-left: 2px; }
      .skill-row { display: grid; grid-template-columns: minmax(115px, 30%) 1fr; gap: 10px; }
      .skill-row strong { color: #14796f; font-weight: 700; }
      .resume-running-header {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        margin: -44px -56px 22px; padding: 13px 56px;
        background: #14283f; color: #fff;
      }
      .resume-running-header .resume-name { font-size: 13pt; letter-spacing: 0; }
      .resume-running-header .resume-headline { margin: 0; color: #79d3c4; font-size: 9pt; text-align: right; }
      @page { size: letter portrait; margin: 0; }
      @media print {
        html, body, #resumePages { width: 215.9mm; }
        .resumePage { margin: 0; break-after: page; page-break-after: always; }
        .resumePage:last-child { break-after: auto; page-break-after: auto; }
      }
    </style>
  </head>
  <body>
    <div id="resumePages">
      <article class="resumePage">
        <div class="page-content">
          <header class="resume-header">
            <h1 class="resume-name">${name}</h1>
            ${headline ? `<div class="resume-headline">${headline}</div>` : ''}
            ${resume.candidate.location || resume.candidate.email || resume.candidate.phone || resume.candidate.linkedinUrl
    ? `<div class="contact-list">${contactHtml(resume)}</div>`
    : ''}
          </header>
          <main class="resume-main">${summary}${sections}</main>
        </div>
      </article>
    </div>
  </body>
</html>`;
}

export function createQtsResume3Page(document: Document): HTMLElement {
  const page = document.createElement('article');
  page.className = 'resumePage';
  const content = document.createElement('div');
  content.className = 'page-content';
  const sourceHeader = document.querySelector<HTMLElement>('.resume-header');
  const runningHeader = document.createElement('header');
  runningHeader.className = 'resume-running-header';
  const name = sourceHeader?.querySelector<HTMLElement>('.resume-name')?.cloneNode(true);
  const headline = sourceHeader?.querySelector<HTMLElement>('.resume-headline')?.cloneNode(true);
  if (name) runningHeader.append(name);
  if (headline) runningHeader.append(headline);
  const main = document.createElement('main');
  main.className = 'resume-main';
  content.append(runningHeader, main);
  page.append(content);
  document.getElementById('resumePages')?.append(page);
  return page;
}

export function paginateQtsResume3Document(document: Document): number {
  const firstPage = document.querySelector<HTMLElement>('.resumePage');
  const firstMain = firstPage?.querySelector<HTMLElement>('.resume-main');
  if (!firstPage || !firstMain) throw new Error('The QTS Resume 3 template could not be laid out.');

  const sections = Array.from(firstMain.children) as HTMLElement[];
  let page = firstPage;
  let main = firstMain;
  let pageBlockCount = 0;

  for (const sourceSection of sections) {
    const heading = sourceSection.querySelector<HTMLElement>('.section-title');
    const blocks = Array.from(sourceSection.querySelectorAll<HTMLElement>(':scope > .resume-block'));
    if (!heading || blocks.length === 0) continue;
    sourceSection.remove();

    let section = sourceSection.cloneNode(false) as HTMLElement;
    section.append(heading.cloneNode(true));
    main.append(section);
    for (const block of blocks) {
      section.append(block);
      const pageContent = page.querySelector<HTMLElement>('.page-content');
      const bottomPadding = pageContent ? Number.parseFloat(getComputedStyle(pageContent).paddingBottom) : 0;
      if (
        pageContent
        && block.getBoundingClientRect().bottom > pageContent.getBoundingClientRect().bottom - bottomPadding
        && pageBlockCount > 0
      ) {
        block.remove();
        if (!section.querySelector('.resume-block')) section.remove();
        page = createQtsResume3Page(document);
        main = page.querySelector<HTMLElement>('.resume-main')!;
        section = sourceSection.cloneNode(false) as HTMLElement;
        section.append(heading.cloneNode(true), block);
        main.append(section);
        pageBlockCount = 1;
      } else {
        pageBlockCount += 1;
      }
    }
  }
  return document.querySelectorAll('.resumePage').length;
}

export function QtsResume3Preview({
  resume,
  iframeRef,
  scaleMode,
  onReady,
  onError,
  onDocumentReady,
}: QtsResume3PreviewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [srcDoc] = useState(() => buildQtsResume3Document(resume));
  const [frameReady, setFrameReady] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const viewport = wrapper?.parentElement;
    if (!wrapper || !viewport) return undefined;
    const updateScale = () => {
      setViewportWidth(viewport.clientWidth);
      setScale(scaleMode === 'actual' ? 1 : Math.min(1, viewport.clientWidth / pageWidth));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scaleMode]);

  useLayoutEffect(() => {
    if (!frameReady) return undefined;
    let cancelled = false;
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) {
      onReady(false);
      onError('Could not read the QTS Resume 3 preview.');
      return undefined;
    }

    async function updatePreview(previewDocument: Document) {
      try {
        await previewDocument.fonts.ready;
        if (cancelled) return;
        replaceResumePages(previewDocument, buildQtsResume3Document(resume));
        const pages = paginateQtsResume3Document(previewDocument);
        setPageCount(pages);
        onDocumentReady(`<!doctype html>${previewDocument.documentElement.outerHTML}`);
        onReady(true);
        onError('');
      } catch (error) {
        if (cancelled) return;
        onReady(false);
        onError(error instanceof Error ? error.message : 'Could not lay out the QTS Resume 3 preview.');
      }
    }

    void updatePreview(frameDocument);
    return () => {
      cancelled = true;
    };
  }, [frameReady, iframeRef, onDocumentReady, onError, onReady, resume]);

  const frameHeight = pageCount * pageHeight + Math.max(0, pageCount - 1) * pageGap;

  return (
    <div
      className="qts-resume3-preview"
      ref={wrapperRef}
      style={{ width: `${Math.max(pageWidth * scale, viewportWidth)}px`, height: `${frameHeight * scale}px` }}
      aria-label="Live QTS Resume 3 preview"
    >
      <iframe
        ref={iframeRef}
        title="QTS_Resume_3 live resume"
        srcDoc={srcDoc}
        onLoad={() => setFrameReady(true)}
        style={{
          width: `${pageWidth}px`,
          height: `${frameHeight}px`,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}
