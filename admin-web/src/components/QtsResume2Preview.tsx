'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { QtsResumeDocument } from '@/components/ResumeDocumentTypes';
import { replaceResumePages } from '@/components/resume-preview-dom';

type QtsResume2PreviewProps = {
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

type FontAssets = {
  abril: string;
  zillaRegular: string;
  zillaBold: string;
};

async function loadFont(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load a resume font (${response.status}).`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not encode a resume font.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read a resume font.'));
    reader.readAsDataURL(blob);
  });
}

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

function contactItem(value: string | undefined, href?: string, separator = false): string {
  if (!value?.trim()) return '';
  const text = escapeHtml(value.trim());
  const safeHref = href ? escapeHtml(href) : '';
  return `<span class="contact-item">${separator ? '<span class="contact-separator" aria-hidden="true">•</span>' : ''}${safeHref
    ? `<a href="${safeHref}">${text}</a>`
    : `<span>${text}</span>`}</span>`;
}

function splitDateAndLocation(value: string | undefined) {
  const [date, ...locationParts] = (value || '').split('|');
  return { date: date.trim(), location: locationParts.join('|').trim() };
}

function sectionHtml(title: string, items: NonNullable<QtsResumeDocument['sections'][number]['items']>): string {
  const isSkills = title.toLowerCase().includes('skill');
  const blocks = items.map((item) => {
    const heading = escapeHtml(item.heading);
    const subheading = escapeHtml(item.subheading);
    const { date, location } = splitDateAndLocation(item.dateRange);
    if (isSkills) {
      const label = heading ? `<strong>${heading}${heading.endsWith(':') ? '' : ':'}</strong>` : '';
      return `<div class="resume-block skill-row">${label}<span>${subheading}</span></div>`;
    }
    const titleText = [heading, subheading].filter(Boolean).join(' / ');
    const bulletList = (item.bullets || []).filter((bullet) => bullet.trim()).length
      ? `<ul>${item.bullets?.filter((bullet) => bullet.trim()).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
      : '';
    return `<div class="resume-block resume-entry">
      <div class="entry-heading"><strong>${titleText}</strong>${date ? `<span class="entry-date">${escapeHtml(date)}</span>` : ''}</div>
      ${location ? `<div class="entry-location">${escapeHtml(location)}</div>` : ''}
      ${bulletList}
    </div>`;
  }).join('');
  if (!blocks) return '';
  return `<section class="resume-section"><h2 class="section-title">${escapeHtml(title)}</h2>${blocks}</section>`;
}

function makeDocument(resume: QtsResumeDocument, fonts: FontAssets): string {
  const name = escapeHtml(resume.candidate.fullName);
  const headline = escapeHtml(resume.candidate.headline);
  const linkedIn = safeWebUrl(resume.candidate.linkedinUrl);
  const contactDetails = [
    { value: resume.candidate.location },
    { value: resume.candidate.email, href: resume.candidate.email ? `mailto:${resume.candidate.email}` : undefined },
    { value: resume.candidate.phone, href: resume.candidate.phone ? `tel:${resume.candidate.phone}` : undefined },
    { value: resume.candidate.linkedinUrl, href: linkedIn, isLinkedIn: true },
  ].filter((detail) => detail.value?.trim());
  const contact = contactDetails
    .map((detail, index) => contactItem(detail.value, detail.href, index > 0 && !detail.isLinkedIn))
    .join('');
  const summary = resume.summary?.trim()
    ? `<section class="resume-section"><h2 class="section-title">Summary</h2><div class="resume-block summary-text">${escapeHtml(resume.summary)}</div></section>`
    : '';
  const sections = resume.sections
    .filter((section) => section.title?.trim())
    .map((section) => sectionHtml(section.title!.trim(), section.items || []))
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @font-face { font-family: "Abril Fatface"; src: url("${fonts.abril}") format("woff2"); font-style: normal; font-weight: 400; }
      @font-face { font-family: "Zilla Slab"; src: url("${fonts.zillaRegular}") format("truetype"); font-style: normal; font-weight: 400; }
      @font-face { font-family: "Zilla Slab"; src: url("${fonts.zillaBold}") format("truetype"); font-style: normal; font-weight: 700; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 215.9mm; }
      body { color: #000; font-family: "Zilla Slab", Georgia, serif; font-size: 13pt; line-height: 23px; }
      #resumePages { width: 215.9mm; }
      .resumePage {
        position: relative; width: 215.9mm; height: 279.4mm; min-height: 279.4mm;
        margin: 0 0 32px; padding: 13.4708mm 12mm 10.5604mm;
        overflow: visible; background: #fff; color: #000;
      }
      .resumePage:last-child { margin-bottom: 0; }
      .page-content { height: 100%; }
      .resume-header { margin: 0 0 10px; text-align: center; }
      .resume-name { margin: 0; padding-bottom: .2em; color: #355c7d; font-family: "Abril Fatface", Georgia, serif; font-size: 30pt; font-weight: 400; letter-spacing: 1px; line-height: 46px; overflow-wrap: anywhere; }
      .resume-headline { margin: 0; padding-bottom: .16em; color: #355c7d; font-size: 15pt; line-height: 23px; overflow-wrap: anywhere; }
      .contact-list { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; column-gap: 0; row-gap: 2px; margin-top: 5px; font-size: 13pt; line-height: 23px; }
      .contact-item { display: inline-flex; align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
      .contact-separator { margin: 0 12px; }
      a { color: inherit; text-decoration: none; }
      .resume-section { margin: 0 0 10px; }
      .section-title { margin: 0 0 11.98px; border-bottom: 2px solid #355c7d; color: #355c7d; font-size: 16pt; font-weight: 700; letter-spacing: .5px; line-height: 28px; }
      .resume-block { margin: 0 0 6px; }
      .summary-text { white-space: pre-line; }
      .resume-entry { break-inside: avoid; page-break-inside: avoid; }
      .entry-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .entry-heading strong { min-width: 0; }
      .entry-date { flex: 0 0 auto; }
      .entry-location { margin: 0; }
      .resume-entry ul { margin: 0; padding-left: 16px; }
      .resume-entry li { padding-left: 1px; }
      .skill-row { display: flex; gap: 5px; }
      .skill-row strong { flex: 0 0 auto; }
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
            ${contact ? `<div class="contact-list">${contact}</div>` : ''}
          </header>
          <main class="resume-main">${summary}${sections}</main>
        </div>
      </article>
    </div>
  </body>
</html>`;
}

function createPage(document: Document): HTMLElement {
  const page = document.createElement('article');
  page.className = 'resumePage';
  const content = document.createElement('div');
  content.className = 'page-content';
  const main = document.createElement('main');
  main.className = 'resume-main';
  content.append(main);
  page.append(content);
  document.getElementById('resumePages')?.append(page);
  return page;
}

function paginateDocument(document: Document): number {
  const firstPage = document.querySelector<HTMLElement>('.resumePage');
  const firstMain = firstPage?.querySelector<HTMLElement>('.resume-main');
  if (!firstPage || !firstMain) throw new Error('The QTS Resume 2 template could not be laid out.');

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
      if (
        pageContent
        && block.getBoundingClientRect().bottom > pageContent.getBoundingClientRect().bottom
        && pageBlockCount > 0
      ) {
        block.remove();
        if (!section.querySelector('.resume-block')) section.remove();
        page = createPage(document);
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

export { paginateDocument as paginateQtsResume2Document };

export function QtsResume2Preview({
  resume,
  iframeRef,
  scaleMode,
  onReady,
  onError,
  onDocumentReady,
}: QtsResume2PreviewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef(resume);
  const [fonts, setFonts] = useState<FontAssets | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [frameReady, setFrameReady] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    resumeRef.current = resume;
  }, [resume]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadFont('/fonts/AbrilFatface-Regular.woff2'),
      loadFont('/fonts/ZillaSlab-Regular.ttf'),
      loadFont('/fonts/ZillaSlab-Bold.ttf'),
    ])
      .then(([abril, zillaRegular, zillaBold]) => {
        if (cancelled) return;
        const assets = { abril, zillaRegular, zillaBold };
        setFonts(assets);
        setSrcDoc(makeDocument(resumeRef.current, assets));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onReady(false);
        onError(error instanceof Error ? error.message : 'Could not load the QTS Resume 2 fonts.');
      });
    return () => {
      cancelled = true;
    };
  }, [onError, onReady]);

  useLayoutEffect(() => {
    const loadedFonts = fonts;
    if (!loadedFonts || !frameReady) return undefined;
    let cancelled = false;
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) {
      onReady(false);
      onError('Could not read the QTS Resume 2 preview.');
      return undefined;
    }
    const previewDocument = frameDocument;

    async function updatePreview(previewDocument: Document, previewFonts: FontAssets) {
      try {
        await previewDocument.fonts.ready;
        if (cancelled) return;
        replaceResumePages(previewDocument, makeDocument(resume, previewFonts));
        const pages = paginateDocument(previewDocument);
        setPageCount(pages);
        onDocumentReady(`<!doctype html>${previewDocument.documentElement.outerHTML}`);
        onReady(true);
        onError('');
      } catch (error) {
        if (cancelled) return;
        onReady(false);
        onError(error instanceof Error ? error.message : 'Could not update the QTS Resume 2 preview.');
      }
    }

    void updatePreview(previewDocument, loadedFonts);
    return () => {
      cancelled = true;
    };
  }, [frameReady, fonts, iframeRef, onDocumentReady, onError, onReady, resume]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const viewport = wrapper?.parentElement;
    if (!wrapper || !viewport) return undefined;
    const updateScale = () => {
      setScale(scaleMode === 'actual' ? 1 : Math.min(1.8, viewport.clientWidth / pageWidth));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [scaleMode]);

  const frameHeight = pageCount * pageHeight + Math.max(0, pageCount - 1) * pageGap;

  return (
    <div
      className="qts-flowcv-preview"
      ref={wrapperRef}
      style={{ width: `${pageWidth * scale}px`, height: `${frameHeight * scale}px` }}
      aria-label="Live QTS Resume 2 preview"
    >
      {srcDoc ? (
        <iframe
          ref={iframeRef}
          title="QTS_Resume_2 live resume"
          srcDoc={srcDoc}
          onLoad={() => setFrameReady(true)}
          style={{
            width: `${pageWidth}px`,
            height: `${frameHeight}px`,
            transform: `scale(${scale})`,
          }}
        />
      ) : (
        <div className="manager-pdf-viewer__message" role="status">Loading QTS Resume 2 template…</div>
      )}
    </div>
  );
}