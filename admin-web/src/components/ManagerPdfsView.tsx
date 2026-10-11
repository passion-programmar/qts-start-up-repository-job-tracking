'use client';

import { useEffect, useRef, useState } from 'react';
import { requestPdf } from '@/lib/api';
import { ManagerPdfCanvasPreview } from '@/components/ManagerPdfCanvasPreview';
import { QtsResumePreview, type QtsResumeDocument } from '@/components/QtsResumePreview';
import { QtsResume2Preview } from '@/components/QtsResume2Preview';

type ResumeTemplate = 'qts_resume_1' | 'qts_resume_2' | 'classic' | 'compact';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

const templates: Array<{ id: ResumeTemplate; label: string }> = [
  { id: 'qts_resume_1', label: 'QTS_Resume_1' },
  { id: 'qts_resume_2', label: 'QTS_Resume_2' },
  { id: 'classic', label: '2. Classic ATS' },
  { id: 'compact', label: '3. Compact modern' },
];

const sampleResume: QtsResumeDocument = {
  candidate: {
    fullName: 'Alex Morgan',
    email: 'alex.morgan@example.com',
    phone: '+1 202-555-0100',
    linkedinUrl: 'https://example.com/alex-morgan',
    location: 'Example City',
    headline: 'Software Engineer | Example Resume',
  },
  targetRole: 'Software Engineer',
  summary: 'Example resume content for previewing the QTS templates. Replace this fictional sample with your own resume information before downloading.',
  sections: [
    {
      title: 'Skills',
      items: [
        {
          heading: 'Development',
          subheading: 'TypeScript, JavaScript, React, Node.js, HTML, CSS',
        },
        {
          heading: 'Data',
          subheading: 'SQL, APIs, Data Modeling, Testing',
        },
        {
          heading: 'Collaboration',
          subheading: 'Communication, Documentation, Code Review, Problem Solving',
        },
      ],
    },
    {
      title: 'Professional Experience',
      items: [
        {
          heading: 'Example Company',
          subheading: 'Software Engineer',
          dateRange: '2024 – Present | Example City',
          bullets: [
            'Built and maintained application features using the team technology stack.',
            'Collaborated with teammates to test, document, and deliver reliable changes.',
          ],
        },
      ],
    },
    {
      title: 'Education',
      items: [
        {
          heading: 'Example Degree',
          subheading: 'Example University',
          dateRange: '2020 – 2024 | Example City',
        },
      ],
    },
  ],
};

const defaultJson = JSON.stringify(sampleResume, null, 2);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResumeJson(value: string): { resume?: QtsResumeDocument; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'Enter valid JSON to update the resume.' };
  }

  if (!isRecord(parsed) || !isRecord(parsed.candidate)) {
    return { error: 'Resume JSON must include a candidate object.' };
  }
  if (typeof parsed.candidate.fullName !== 'string' || typeof parsed.candidate.email !== 'string') {
    return { error: 'Resume candidate must include a name and email address.' };
  }
  if (!Array.isArray(parsed.sections)) {
    return { error: 'Resume JSON must include a sections array.' };
  }

  const sections: QtsResumeDocument['sections'] = [];
  for (const [sectionIndex, section] of parsed.sections.entries()) {
    if (!isRecord(section) || (section.title !== undefined && typeof section.title !== 'string')) {
      return { error: `Section ${sectionIndex + 1} must have a text title.` };
    }
    if (section.items !== undefined && !Array.isArray(section.items)) {
      return { error: `Items in section ${sectionIndex + 1} must be an array.` };
    }
    const items: NonNullable<QtsResumeDocument['sections'][number]['items']> = [];
    for (const [itemIndex, item] of ((section.items || []) as unknown[]).entries()) {
      if (!isRecord(item)) return { error: `Item ${itemIndex + 1} in section ${sectionIndex + 1} must be an object.` };
      for (const field of ['heading', 'subheading', 'dateRange'] as const) {
        if (item[field] !== undefined && typeof item[field] !== 'string') {
          return { error: `${field} in section ${sectionIndex + 1}, item ${itemIndex + 1} must be text.` };
        }
      }
      if (item.bullets !== undefined && (!Array.isArray(item.bullets) || item.bullets.some((bullet) => typeof bullet !== 'string'))) {
        return { error: `Bullets in section ${sectionIndex + 1}, item ${itemIndex + 1} must be text values.` };
      }
      items.push({
        heading: item.heading as string | undefined,
        subheading: item.subheading as string | undefined,
        dateRange: item.dateRange as string | undefined,
        bullets: item.bullets as string[] | undefined,
      });
    }
    sections.push({ title: section.title as string | undefined, items });
  }

  const stringFields = ['phone', 'linkedinUrl', 'location', 'headline'] as const;
  for (const field of stringFields) {
    if (parsed.candidate[field] !== undefined && typeof parsed.candidate[field] !== 'string') {
      return { error: `Candidate ${field} must be text.` };
    }
  }
  if (parsed.summary !== undefined && typeof parsed.summary !== 'string') {
    return { error: 'Resume summary must be text.' };
  }
  if (parsed.targetRole !== undefined && typeof parsed.targetRole !== 'string') {
    return { error: 'Target role must be text.' };
  }
  if (parsed.targetCompany !== undefined && typeof parsed.targetCompany !== 'string') {
    return { error: 'Target company must be text.' };
  }

  return {
    resume: {
      candidate: {
        fullName: parsed.candidate.fullName,
        email: parsed.candidate.email,
        phone: parsed.candidate.phone as string | undefined,
        linkedinUrl: parsed.candidate.linkedinUrl as string | undefined,
        location: parsed.candidate.location as string | undefined,
        headline: parsed.candidate.headline as string | undefined,
      },
      targetRole: (parsed.targetRole as string | undefined) || '',
      targetCompany: parsed.targetCompany as string | undefined,
      summary: parsed.summary as string | undefined,
      sections,
    },
  };
}

function safePathSegment(value: string | undefined, fallback: string): string {
  return (value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || fallback;
}

function getSuggestedPath(value: unknown): { directories: string[]; fileName: string; relativePath: string } {
  const resume = isRecord(value) ? value : {};
  const candidate = isRecord(resume.candidate) ? resume.candidate : {};
  const account = safePathSegment(typeof candidate.fullName === 'string' ? candidate.fullName : '', 'Account');
  const role = safePathSegment(typeof resume.targetRole === 'string' ? resume.targetRole : '', 'Job');
  const company = safePathSegment(typeof resume.targetCompany === 'string' ? resume.targetCompany : '', 'Company');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const directories = [
    '$_QTS_RESUME_$',
    'Custom',
    account,
    `${date}_${time}_${role}_${company}`,
  ];
  return {
    directories,
    fileName: `${account}.pdf`,
    relativePath: [...directories, `${account}.pdf`].join('/'),
  };
}

export function ManagerPdfsView() {
  const [template, setTemplate] = useState<ResumeTemplate>('qts_resume_2');
  const [resumeJson, setResumeJson] = useState<Record<ResumeTemplate, string>>({
    qts_resume_1: defaultJson,
    qts_resume_2: defaultJson,
    classic: defaultJson,
    compact: defaultJson,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [livePreviewError, setLivePreviewError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLivePreviewReady, setIsLivePreviewReady] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [liveResume, setLiveResume] = useState<QtsResumeDocument>(sampleResume);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [suggestedPath, setSuggestedPath] = useState('');
  const [downloadDirectory, setDownloadDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const livePreviewFrameRef = useRef<HTMLIFrameElement>(null);
  const json = resumeJson[template];
  const isLiveTemplate = template === 'qts_resume_1' || template === 'qts_resume_2';
  const parsedResume = parseResumeJson(json);

  useEffect(() => {
    if (isLiveTemplate) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const parsed = parseResumeJson(json);
      if (!parsed.resume) {
        if (!cancelled) {
          setPreviewError(parsed.error || 'Enter valid resume JSON to update the PDF.');
          setIsLoading(false);
        }
        return;
      }

      const result = await requestPdf('/api/v2/resume-pdfs/preview', { template, resume: parsed.resume }, controller.signal);
      if (cancelled) return;
      setIsLoading(false);
      if (!result.success || !result.pdf) {
        setPreviewError(result.message || 'Could not generate resume preview.');
        return;
      }

      const nextUrl = URL.createObjectURL(result.pdf);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setPreviewPdf(result.pdf);
      setPreviewError('');
      setDownloadUrl('');
      setSuggestedPath('');
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isLiveTemplate, json, template]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
  }, []);

  async function chooseDownloadFolder() {
    setDownloadError('');
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setDownloadError('Your browser does not support choosing a download folder. Use the browser Downloads folder instead.');
      return;
    }

    try {
      const directory = await picker.call(window, { id: 'manager-resume-pdfs', mode: 'readwrite' });
      setDownloadDirectory(directory);
      setDownloadStatus(`PDFs will be saved in ${directory.name} for this session.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDownloadError(error instanceof Error ? error.message : 'Could not access the selected download folder.');
    }
  }

  async function download() {
    const parsed = parseResumeJson(json);
    if (!parsed.resume) {
      setPreviewError(parsed.error || 'Enter valid resume JSON before downloading.');
      return;
    }
    if ((!isLiveTemplate && (!previewUrl || !previewPdf || isLoading)) || isDownloading) return;
    const account = safePathSegment(parsed.resume.candidate.fullName, 'Resume');
    const destination = getSuggestedPath(parsed.resume);
    setDownloadError('');
    setDownloadStatus('');
    setSuggestedPath(destination.relativePath);

    setIsDownloading(true);
    try {
      let pdf = previewPdf;
      if (isLiveTemplate) {
        if (!isLivePreviewReady || !renderedHtml) {
          setDownloadError('The live resume preview is not ready to download yet.');
          return;
        }
        const result = await requestPdf('/api/v2/resume-pdfs/preview', {
          template,
          resume: parsed.resume,
          renderedHtml,
        });
        if (!result.success || !result.pdf) {
          setDownloadError(result.message || 'Could not generate the matching PDF.');
          return;
        }
        pdf = result.pdf;
      }
      if (!pdf) {
        setDownloadError('The PDF preview is not ready to download yet.');
        return;
      }

      if (downloadDirectory) {
        let directory = downloadDirectory;
        for (const segment of destination.directories) {
          directory = await directory.getDirectoryHandle(segment, { create: true });
        }
        const file = await directory.getFileHandle(destination.fileName, { create: true });
        const writable = await file.createWritable();
        try {
          await writable.write(pdf);
          await writable.close();
        } catch (error) {
          await writable.abort().catch((abortError: unknown) => {
            console.error('Could not clean up a failed PDF download', abortError);
          });
          throw error;
        }
        setDownloadUrl('');
        setDownloadStatus(`PDF saved to ${downloadDirectory.name}/${destination.relativePath}`);
        return;
      }

      let fileUrl = previewUrl;
      if (isLiveTemplate) {
        if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
        fileUrl = URL.createObjectURL(pdf);
        downloadUrlRef.current = fileUrl;
      }
      if (!fileUrl) {
        setDownloadError('The generated PDF is not available to download.');
        return;
      }
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `${account}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadUrl(fileUrl);
      setDownloadStatus('PDF download started. Check your browser downloads.');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not save the generated PDF.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="manager-pdfs">
      <div className="manager-pdfs__workspace">
        <section className="manager-pdfs__controls card" aria-labelledby="resume-pdf-inputs">
          <div className="form-group">
            <label htmlFor="resume-pdf-template">PDF template</label>
            <select
              id="resume-pdf-template"
              value={template}
              onChange={(event) => {
                const selected = templates.find((item) => item.id === event.target.value);
                if (selected) {
                  const selectedJson = resumeJson[selected.id];
                  if (selected.id === 'qts_resume_1' || selected.id === 'qts_resume_2') {
                    const parsed = parseResumeJson(selectedJson);
                    if (parsed.resume) setLiveResume(parsed.resume);
                    setPreviewError(parsed.error || '');
                    setLivePreviewError('');
                    setIsLoading(false);
                    setIsLivePreviewReady(false);
                    setRenderedHtml('');
                    setPreviewUrl(null);
                    setPreviewPdf(null);
                  } else {
                    setIsLoading(true);
                    setIsLivePreviewReady(false);
                  }
                  setDownloadUrl('');
                  setSuggestedPath('');
                  setDownloadError('');
                  setDownloadStatus('');
                  setTemplate(selected.id);
                }
              }}
            >
              {templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="form-group manager-pdfs__json-field">
            <label htmlFor="resume-pdf-json">Resume JSON data</label>
            <textarea
              id="resume-pdf-json"
              spellCheck={false}
              value={json}
              onChange={(event) => {
                const nextJson = event.target.value;
                setResumeJson((current) => ({ ...current, [template]: nextJson }));
                setDownloadUrl('');
                setSuggestedPath('');
                setDownloadError('');
                setDownloadStatus('');
                if (isLiveTemplate) {
                  const parsed = parseResumeJson(nextJson);
                  if (parsed.resume) setLiveResume(parsed.resume);
                  setPreviewError(parsed.error || '');
                  setLivePreviewError('');
                  setIsLoading(false);
                  setIsLivePreviewReady(false);
                  setRenderedHtml('');
                } else {
                  setIsLoading(true);
                }
              }}
            />
            <p className="text-muted">
              Each template starts with its own copy of the example resume JSON. Edit the selected copy;
              {isLiveTemplate ? ' the resume updates as you type.' : ' the PDF preview refreshes automatically.'}
            </p>
          </div>
          {previewError && <div className="alert alert-error" role="alert">{previewError}</div>}
          <button className="btn btn-primary" type="button" onClick={download}
            disabled={!parsedResume.resume || (isLiveTemplate ? (!isLivePreviewReady || !renderedHtml) : !previewUrl) || isLoading || isDownloading || Boolean(previewError)}>
            {isDownloading ? 'Generating PDF…' : isLoading ? 'Preparing preview…' : 'Download PDF'}
          </button>
          <button className="btn" type="button" onClick={chooseDownloadFolder}>
            {downloadDirectory ? `Change folder (${downloadDirectory.name})` : 'Choose download folder'}
          </button>
          {downloadError && <div className="alert alert-error" role="alert">{downloadError}</div>}
          <p className="manager-pdfs__path-note">
            {downloadDirectory ? `Path inside ${downloadDirectory.name}:` : 'Suggested folder path:'}{' '}
            <code>{suggestedPath || '$_QTS_RESUME_$/Custom/…'}</code>
          </p>
            {downloadStatus && <p role="status" className="manager-pdfs__path-note">{downloadStatus}</p>}

          {downloadUrl && (
            <p className="manager-pdfs__download-url">
              Download URL (temporary; available while this page is open):{' '}
              <a href={downloadUrl} target="_blank" rel="noreferrer">Open generated PDF</a>
              <br />
              <code>{downloadUrl}</code>
            </p>
          )}
        </section>
        <section className="manager-pdfs__preview card" aria-labelledby="resume-pdf-preview-title">
          <div className="manager-pdfs__preview-header">
            <h3 id="resume-pdf-preview-title">{isLiveTemplate ? 'Live resume preview' : 'PDF preview'}</h3>
            {isLoading && <span className="text-muted" role="status">Generating PDF…</span>}
            {isLiveTemplate && !isLivePreviewReady && <span className="text-muted" role="status">Preparing live preview…</span>}
          </div>
          {isLiveTemplate ? (
            <>
              {livePreviewError && <div className="alert alert-error" role="alert">{livePreviewError}</div>}
              <div className="manager-pdfs__live-resume">
                {template === 'qts_resume_2' ? (
                  <QtsResume2Preview
                    key={template}
                    resume={liveResume}
                    iframeRef={livePreviewFrameRef}
                    scaleMode="fit"
                    onReady={setIsLivePreviewReady}
                    onError={setLivePreviewError}
                    onDocumentReady={setRenderedHtml}
                  />
                ) : (
                  <QtsResumePreview
                    resume={liveResume}
                    iframeRef={livePreviewFrameRef}
                    onReady={setIsLivePreviewReady}
                    onError={setLivePreviewError}
                    onDocumentReady={setRenderedHtml}
                  />
                )}
              </div>
            </>
          ) : (
            <ManagerPdfCanvasPreview key={previewUrl ?? 'empty-preview'} pdf={previewPdf} />
          )}
        </section>
      </div>
    </section>
  );
}
