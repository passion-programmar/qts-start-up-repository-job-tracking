'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type QtsResumeSectionItem = {
  heading?: string;
  subheading?: string;
  dateRange?: string;
  bullets?: string[];
};

export type QtsResumeSection = {
  title?: string;
  items?: QtsResumeSectionItem[];
};

export type QtsResumeDocument = {
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
  sections: QtsResumeSection[];
};

type QtsResumePreviewProps = {
  resume: QtsResumeDocument;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  scaleMode: 'fit' | 'actual';
  onReady: (ready: boolean) => void;
  onError: (message: string) => void;
  onDocumentReady: (html: string) => void;
};

const pageWidth = 816;
const pageHeight = 1056;

async function loadTextAsset(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load a resume template asset (${response.status}).`);
  return response.text();
}

async function loadDataUrlAsset(path: string): Promise<string> {
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

function setText(element: Element | null, value: string | undefined) {
  if (!element) return;
  const text = value?.trim() || '';
  element.textContent = text;
  setVisible(element, Boolean(text));
}

function setVisible(element: Element, visible: boolean) {
  const htmlElement = element as HTMLElement;
  if (!element.hasAttribute('data-qts-original-display')) {
    element.setAttribute('data-qts-original-display', htmlElement.style.display);
  }
  htmlElement.style.display = visible
    ? element.getAttribute('data-qts-original-display') || ''
    : 'none';
}

function setInlineText(container: Element | null, selector: string, value: string | undefined) {
  if (!container) return;
  const text = value?.trim() || '';
  const parts = Array.from(container.querySelectorAll(selector));
  if (parts.length === 0) {
    setText(container, text);
    return;
  }

  parts.forEach((part, index) => {
    if (index === 0) part.textContent = text;
    setVisible(part, Boolean(text) && index === 0);
  });
}

function setContact(
  document: Document,
  id: string,
  value: string | undefined,
  href?: string,
  displayValue?: string,
) {
  const element = document.getElementById(id);
  if (!element) return;
  const text = value?.trim() || '';
  setVisible(element, Boolean(text));
  if (element instanceof HTMLAnchorElement && href) element.href = href;
  const spans = element.querySelectorAll('span');
  const valueElement = spans.item(spans.length - 1);
  if (!valueElement) return;
  if (id === 'detailItem-linkedIn' && displayValue) {
    const linkParts = element.querySelectorAll('span[dir="ltr"] > span');
    const prefixEnd = displayValue.toLowerCase().indexOf('/in/');
    if (linkParts.length >= 2 && prefixEnd >= 0) {
      const splitAt = prefixEnd + '/in/'.length;
      linkParts[0].textContent = displayValue.slice(0, splitAt);
      linkParts[1].textContent = displayValue.slice(splitAt);
      return;
    }
  }
  valueElement.textContent = displayValue ?? text;
}

function setSkillInfo(element: Element, value: string) {
  const childSpans = Array.from(element.children) as HTMLElement[];
  const textNodes = [
    element.firstChild,
    ...childSpans.map((span) => span.lastChild),
  ].filter((node): node is Text => node?.nodeType === Node.TEXT_NODE);
  const storedCounts = element.getAttribute('data-qts-skill-segment-counts');
  const segmentCounts = storedCounts
    ? JSON.parse(storedCounts) as number[]
    : textNodes.map((node) => node.data.trim().split(',').filter((part) => part.trim()).length);
  if (!storedCounts) {
    element.setAttribute('data-qts-skill-segment-counts', JSON.stringify(segmentCounts));
  }

  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  let offset = 0;
  textNodes.forEach((node, index) => {
    const count = index === textNodes.length - 1
      ? parts.length - offset
      : Math.min(segmentCounts[index] || 0, parts.length - offset);
    node.data = `\u00a0${parts.slice(offset, offset + count).join(', ')}`;
    offset += count;
    if (index > 0) childSpans[index - 1].style.display = count ? '' : 'none';
  });
}

function splitDateAndLocation(value: string | undefined) {
  const [date, ...locationParts] = (value || '').split('|');
  return {
    date: date.trim(),
    location: locationParts.join('|').trim(),
  };
}

function clearIds(element: Element) {
  element.removeAttribute('id');
  element.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
}

function markWorkEntry(root: Element) {
  root.setAttribute('data-qts-work-entry', '');
  const date = root.querySelector('[id$="-date"], [data-qts-date]');
  const location = root.querySelector('[id$="-location"], [data-qts-location]');
  const company = root.querySelector('[data-role="title-word"], [data-qts-company]');
  const role = root.querySelector('[data-role="subTitle-container"], [data-qts-role]');
  if (date) date.setAttribute('data-qts-date', '');
  if (location) location.setAttribute('data-qts-location', '');
  if (company) company.setAttribute('data-qts-company', '');
  if (role) role.setAttribute('data-qts-role', '');
  root.querySelectorAll('li').forEach((bullet) => bullet.setAttribute('data-qts-bullet', ''));
}

function updateEntry(root: HTMLElement, item: QtsResumeSectionItem) {
  setVisible(root, true);
  const titleContainer = root.querySelector('[id$="-title"]');
  if (titleContainer) {
    setInlineText(titleContainer, '[data-role="title-word"], [data-qts-company]', item.heading);
  } else {
    setText(root.querySelector('[data-qts-company]'), item.heading);
  }
  setInlineText(root.querySelector('[data-role="subTitle-container"], [data-qts-role]'), '[data-role="subTitle-word"]', item.subheading);

  const { date, location } = splitDateAndLocation(item.dateRange);
  setText(root.querySelector('[data-qts-date]'), date);
  setText(root.querySelector('[data-qts-location]'), location);

  const bullets = item.bullets || [];
  const bulletElements = Array.from(root.querySelectorAll('[data-qts-bullet]'));
  const bulletPrototype = bulletElements[0];
  const bulletContainer = bulletPrototype?.parentElement;
  while (bulletElements.length < bullets.length && bulletPrototype && bulletContainer) {
    const clone = bulletPrototype.cloneNode(true) as Element;
    clearIds(clone);
    clone.setAttribute('data-qts-bullet', '');
    bulletContainer.appendChild(clone);
    bulletElements.push(clone);
  }

  bulletElements.forEach((bullet, index) => {
    const text = bullets[index];
    setVisible(bullet, Boolean(text));
    if (!text) return;
    const content = Array.from(bullet.children).find((child) => child.tagName === 'SPAN');
    if (!content) return;
    const textNode = Array.from(content.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = text;
    else content.appendChild(root.ownerDocument.createTextNode(text));
  });
}

function removeContentPagePadding(page: HTMLElement, selector: string) {
  const content = page.querySelector<HTMLElement>(selector);
  let ancestor = content?.parentElement;
  while (ancestor && ancestor !== page) {
    const style = page.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (style && (parseFloat(style.paddingTop) > 0 || parseFloat(style.paddingBottom) > 0)) {
      ancestor.style.paddingTop = '0';
      ancestor.style.paddingBottom = '0';
      return;
    }
    ancestor = ancestor.parentElement;
  }
}

function updateFlowCvDocument(document: Document, resume: QtsResumeDocument) {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.resumePage'));
  const firstPage = pages[0];
  const secondPage = pages[1];
  if (!firstPage || !secondPage) {
    throw new Error('The saved FlowCV template must contain its first two resume pages.');
  }

  removeContentPagePadding(firstPage, '#profileHeading');
  removeContentPagePadding(secondPage, '#educationHeading');

  setText(firstPage.querySelector('.js-fullName'), resume.candidate.fullName);
  setText(firstPage.querySelector('#js-jobTitleEl'), resume.candidate.headline);
  setContact(document, 'detailItem-address', resume.candidate.location);
  setContact(document, 'detailItem-phone', resume.candidate.phone, `tel:${resume.candidate.phone || ''}`);
  setContact(document, 'detailItem-displayEmail', resume.candidate.email, `mailto:${resume.candidate.email || ''}`);
  const linkedin = resume.candidate.linkedinUrl || '';
  setContact(
    document,
    'detailItem-linkedIn',
    linkedin,
    linkedin,
    linkedin.replace(/^https?:\/\/(www\.)?/i, ''),
  );

  const summary = firstPage.querySelector('#profile p[id^="tag-"]');
  setText(summary, resume.summary);

  const skills = resume.sections.find((section) => section.title?.toLowerCase().includes('skill'))?.items || [];
  const skillWords = Array.from(firstPage.querySelectorAll<HTMLElement>('#skill [id$="-word"], #skill [data-qts-skill-heading]'));
  const skillRows = skillWords.map((word) => word.parentElement).filter((row): row is HTMLElement => row !== null);
  skillRows.forEach((row) => {
    row.querySelector('[id$="-word"], [data-qts-skill-heading]')?.setAttribute('data-qts-skill-heading', '');
    row.querySelector('[id$="-info"], [data-qts-skill-info]')?.setAttribute('data-qts-skill-info', '');
  });
  const skillPrototype = skillRows[0];
  const skillContainer = skillPrototype?.parentElement;
  while (skillRows.length < skills.length && skillPrototype && skillContainer) {
    const clone = skillPrototype.cloneNode(true) as HTMLElement;
    clearIds(clone);
    const word = clone.querySelector<HTMLElement>('[id$="-word"]');
    const info = clone.querySelector<HTMLElement>('[id$="-info"]');
    word?.setAttribute('data-qts-skill-heading', '');
    info?.setAttribute('data-qts-skill-info', '');
    skillContainer.appendChild(clone);
    skillRows.push(clone);
  }
  skillRows.forEach((row, index) => {
    const item = skills[index];
    setVisible(row, Boolean(item));
    if (!item) return;
    const word = row.querySelector('[id$="-word"], [data-qts-skill-heading]');
    const info = row.querySelector('[id$="-info"], [data-qts-skill-info]');
    setText(word, item.heading ? `${item.heading}:` : '');
    if (info) {
      setVisible(info, Boolean(item.subheading));
      if (item.subheading) setSkillInfo(info, item.subheading);
    }
  });

  const workItems = resume.sections.find((section) => {
    const title = section.title?.toLowerCase() || '';
    return title.includes('experience') || title.includes('work');
  })?.items || [];
  const educationHeading = secondPage.querySelector<HTMLElement>('#educationHeading');
  const nextEducationEntry = educationHeading?.nextElementSibling;
  const educationEntry = document.defaultView && nextEducationEntry instanceof document.defaultView.HTMLElement
    ? nextEducationEntry
    : null;
  const workRoots: HTMLElement[] = [];
  const seenWorkRoots = new Set<HTMLElement>();
  pages.forEach((page) => {
    page.querySelectorAll<HTMLElement>('[id$="-date"], [data-qts-date]').forEach((date) => {
      const markedRoot = date.closest<HTMLElement>('[data-qts-work-entry]');
      const prefix = date.id.endsWith('-date') ? date.id.slice(0, -'-date'.length) : '';
      const root = markedRoot || (prefix ? page.querySelector<HTMLElement>(`[id="${prefix}"]`) : null);
      if (!root || root === educationEntry || root.closest('#educationHeading') || seenWorkRoots.has(root)) return;
      seenWorkRoots.add(root);
      markWorkEntry(root);
      workRoots.push(root);
    });
  });
  workRoots.forEach((root) => {
    if (!root.id) return;
    pages.forEach((page) => {
      page.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
        if (element !== root && !root.contains(element) && element.id.startsWith(`${root.id}-`)) {
          setVisible(element, false);
        }
      });
    });
  });
  const lastWorkRoot = workRoots[workRoots.length - 1];
  const workContainer = lastWorkRoot?.parentElement;
  while (workRoots.length < workItems.length && lastWorkRoot && workContainer) {
    const clone = lastWorkRoot.cloneNode(true) as HTMLElement;
    clearIds(clone);
    markWorkEntry(clone);
    workContainer.appendChild(clone);
    workRoots.push(clone);
  }
  workRoots.forEach((root, index) => {
    const item = workItems[index];
    if (item) updateEntry(root, item);
    else (root as HTMLElement).style.display = 'none';
  });

  const educationItems = resume.sections.find((section) => section.title?.toLowerCase().includes('education'))?.items || [];
  if (educationEntry) {
    markWorkEntry(educationEntry);
    educationEntry.setAttribute('data-qts-education-entry', '');
    const existing = [educationEntry, ...Array.from(secondPage.querySelectorAll<HTMLElement>('[data-qts-education-entry]'))
      .filter((entry) => entry !== educationEntry)];
    const prototype = existing[0];
    const container = prototype.parentElement;
    while (existing.length < educationItems.length && container) {
      const clone = prototype.cloneNode(true) as HTMLElement;
      clearIds(clone);
      markWorkEntry(clone);
      clone.setAttribute('data-qts-education-entry', '');
      container.appendChild(clone);
      existing.push(clone);
    }
    existing.forEach((entry, index) => {
      const item = educationItems[index];
      if (item) updateEntry(entry, item);
      else setVisible(entry, false);
    });
  }

  pages.slice(2).forEach((page) => page.remove());
}

function makeDocument(
  markup: string,
  stylesheet: string,
  regularFont: string,
  boldFont: string,
) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const pages = Array.from(parsed.querySelectorAll('.resumePage')).slice(0, 2);
  if (pages.length < 2) {
    throw new Error('The saved FlowCV resume structure did not contain two pages.');
  }

  return `<!doctype html>
    <html lang="en-US">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${stylesheet.replace(/^@charset\s+["'][^"']+["'];\s*/i, '')}</style>
        <style>
          @font-face {
            font-family: "Zilla Slab";
            src: url("${regularFont}") format("truetype");
            font-style: normal;
            font-weight: 400;
            font-display: swap;
          }
          @font-face {
            font-family: "Zilla Slab";
            src: url("${boldFont}") format("truetype");
            font-style: normal;
            font-weight: 700;
            font-display: swap;
          }
          html, body {
            height: auto !important;
            margin: 0;
            min-height: 0 !important;
            padding: 0;
            width: 215.9mm;
          }
          #resumePages { width: 215.9mm; }
          .resumePage {
            height: auto !important;
            line-height: 1.4 !important;
            margin-bottom: 0 !important;
            min-height: 0 !important;
            overflow: visible !important;
            font-size: 12pt !important;
          }
          .resumePage #profile p,
          .resumePage [data-qts-work-entry] :is(p, li, span),
          .resumePage [data-qts-education-entry] :is(p, li, span),
          .resumePage #skill span {
            font-size: 18px !important;
            line-height: 1.4 !important;
          }
          .resumePage #resumeHeaderId .js-fullName {
            align-self: stretch;
            font-size: 26.75pt !important;
            line-height: 1.15 !important;
            text-align: center;
          }
          .resumePage #resumeHeaderId [id^="detailItem-"] span {
            font-size: 16px !important;
          }
          @page { size: letter portrait; margin: 0; }
          @media print {
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body, #resumePages { width: 215.9mm; }
            body {
              display: block !important;
              min-height: 0 !important;
              position: static !important;
            }
            #resumePages {
              margin: 0 !important;
              padding: 0 !important;
            }
            .resumePage {
              margin: 0 !important;
              break-after: auto;
              break-inside: auto;
              page-break-after: auto;
              page-break-inside: auto;
            }
            .resumePage [data-qts-work-entry],
            .resumePage [data-qts-education-entry] {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .resumePage:last-child {
              break-after: auto;
              page-break-after: auto;
            }
          }
        </style>
      </head>
      <body><div id="resumePages">${pages.map((page) => page.outerHTML).join('')}</div></body>
    </html>`;
}

export function QtsResumePreview({
  resume,
  iframeRef,
  scaleMode,
  onReady,
  onError,
  onDocumentReady,
}: QtsResumePreviewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState('');
  const [srcDoc, setSrcDoc] = useState('');
  const [frameReady, setFrameReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(pageHeight);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadTextAsset('/flowcv-resume-structure.html'),
      loadTextAsset('/flowcv-assets/index-155cdc9c.css'),
      loadDataUrlAsset('/fonts/ZillaSlab-Regular.ttf'),
      loadDataUrlAsset('/fonts/ZillaSlab-Bold.ttf'),
    ])
      .then(([markup, stylesheet, regularFont, boldFont]) => {
        if (cancelled) return;
        setSource(markup);
        setSrcDoc(makeDocument(markup, stylesheet, regularFont, boldFont));
        onError('');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onError(error instanceof Error ? error.message : 'Could not load the saved FlowCV template.');
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

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
    if (!source || !frameReady) return;
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;
    try {
      updateFlowCvDocument(frameDocument, resume);
      const resumePages = frameDocument.getElementById('resumePages');
      const nextHeight = Math.max(pageHeight, resumePages?.scrollHeight ?? pageHeight);
      setFrameHeight(nextHeight);
      onReady(true);
      onDocumentReady(`<!doctype html>${frameDocument.documentElement.outerHTML}`);
      onError('');
    } catch (error) {
      onReady(false);
      onError(error instanceof Error ? error.message : 'Could not update the FlowCV resume preview.');
    }
  }, [frameReady, iframeRef, onDocumentReady, onError, onReady, resume, source]);

  return (
    <div
      className="qts-flowcv-preview"
      ref={wrapperRef}
      style={{ width: `${Math.max(pageWidth * scale, viewportWidth)}px`, height: `${frameHeight * scale}px` }}
      aria-label="Live FlowCV resume preview"
    >
      {srcDoc ? (
        <iframe
          ref={iframeRef}
          title="QTS_Resume_1 live resume"
          srcDoc={srcDoc}
          onLoad={() => setFrameReady(true)}
          style={{
            width: `${pageWidth}px`,
            height: `${frameHeight}px`,
            transform: `scale(${scale})`,
          }}
        />
      ) : (
        <div className="manager-pdf-viewer__message" role="status">Loading original FlowCV resume template…</div>
      )}
    </div>
  );
}
