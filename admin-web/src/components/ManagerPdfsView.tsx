'use client';

import { useEffect, useRef, useState } from 'react';
import { requestPdf } from '@/lib/api';
import { ManagerPdfCanvasPreview } from '@/components/ManagerPdfCanvasPreview';
import { createQtsCoverLetterHtml, QtsCoverLetterPreview } from '@/components/QtsCoverLetterPreview';
import { QtsResumePreview, type QtsResumeDocument } from '@/components/QtsResumePreview';
import { QtsResume2Preview } from '@/components/QtsResume2Preview';
import { QtsResume3Preview } from '@/components/QtsResume3Preview';
import type { QtsCoverLetterDocument } from '@/components/ResumeDocumentTypes';

type ResumeTemplate = 'qts_resume_1' | 'qts_resume_2' | 'qts_resume_3' | 'classic' | 'compact';
type PreviewDocument = 'resume' | 'cover-letter';

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type PermissionedDirectoryHandle = IterableDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'music';
  }) => Promise<PermissionedDirectoryHandle>;
};

const directoryDatabaseName = 'qts-resume-pdf-settings';
const directoryStoreName = 'settings';
const directoryStorageKey = 'download-directory';
const resumeOutputFolderName = '$_QTS_Resume_$';

function isDirectoryNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function openDirectoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(directoryDatabaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(directoryStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open saved folder settings.'));
    request.onblocked = () => reject(new Error('Saved folder settings are blocked by another page.'));
  });
}

async function loadSavedDirectory(): Promise<PermissionedDirectoryHandle | undefined> {
  const database = await openDirectoryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(directoryStoreName, 'readonly')
        .objectStore(directoryStoreName)
        .get(directoryStorageKey);
      request.onsuccess = () => resolve(request.result as PermissionedDirectoryHandle | undefined);
      request.onerror = () => reject(request.error || new Error('Could not load the saved download folder.'));
    });
  } finally {
    database.close();
  }
}

async function saveDirectory(directory: PermissionedDirectoryHandle): Promise<void> {
  const database = await openDirectoryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(directoryStoreName, 'readwrite');
      transaction.objectStore(directoryStoreName).put(directory, directoryStorageKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the download folder.'));
      transaction.onabort = () => reject(transaction.error || new Error('Saving the download folder was cancelled.'));
    });
  } finally {
    database.close();
  }
}

async function removeSavedDirectory(): Promise<void> {
  const database = await openDirectoryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(directoryStoreName, 'readwrite');
      transaction.objectStore(directoryStoreName).delete(directoryStorageKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not remove the unavailable download folder.'));
      transaction.onabort = () => reject(transaction.error || new Error('Removing the unavailable download folder was cancelled.'));
    });
  } finally {
    database.close();
  }
}

async function verifyDirectoryHandle(directory: PermissionedDirectoryHandle): Promise<void> {
  await directory.entries().next();
}

async function requestPersistentStorage(): Promise<{ granted: boolean; message: string }> {
  if (!navigator.storage?.persist) {
    return { granted: false, message: 'Persistent storage is not supported by this browser.' };
  }

  try {
    const granted = await navigator.storage.persist();
    return granted
      ? { granted: true, message: 'Browser storage persistence is enabled.' }
      : { granted: false, message: 'Browser storage persistence was not granted.' };
  } catch (error) {
    return {
      granted: false,
      message: error instanceof Error ? `Could not enable browser storage persistence: ${error.message}` : 'Could not enable browser storage persistence.',
    };
  }
}

const templates: Array<{ id: ResumeTemplate; label: string }> = [
  { id: 'qts_resume_1', label: 'QTS_Resume_1' },
  { id: 'qts_resume_2', label: 'QTS_Resume_2' },
  { id: 'qts_resume_3', label: 'QTS_Resume_3' },
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
  targetCompany: 'Example Company',
  targetJobsite: 'Example Jobsite',
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
        {
          heading: 'Previous Company',
          subheading: 'Junior Software Engineer',
          dateRange: '2022 – 2024 | Example City',
          bullets: [
            'Implemented and tested features across the company web application.',
            'Worked with senior engineers to improve code quality and team documentation.',
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

const defaultJson = JSON.stringify({
  ...sampleResume,
  coverLetter: {
    salutation: 'Dear Hiring Manager,',
    bodyParagraphs: [
      'I am excited to apply for the Software Engineer role at Example Company. My background building dependable web applications and collaborating across product and engineering teams aligns well with this opportunity.',
      'In my recent work, I have delivered user-facing features, improved application quality through testing, and communicated technical decisions clearly. I would bring that same practical, team-focused approach to your engineering group.',
      'Thank you for considering my application. I would welcome the opportunity to discuss how my experience can support Example Company.',
    ],
    closing: 'Sincerely,',
  },
}, null, 2);

const sampleResume3: QtsResumeDocument = {
  candidate: {
    fullName: 'Taylor Morgan',
    email: 'taylor.morgan@example.com',
    phone: '+1 202-555-0148',
    linkedinUrl: 'https://example.com/in/taylor-morgan',
    location: 'Portland, Oregon',
    headline: 'Data Scientist | Applied Machine Learning | Product Analytics',
  },
  targetRole: 'Data Scientist',
  targetCompany: 'Northstar Analytics',
  targetJobsite: 'Example Jobsite',
  summary: 'Data scientist with experience turning complex product data into reliable models, experiments, and clear decisions. Enjoys partnering with engineers and product teams to deliver measurable improvements.',
  sections: [
    {
      title: 'Professional Experience',
      items: [
        {
          heading: 'Northstar Analytics',
          subheading: 'Data Scientist',
          dateRange: '2023 – Present | Portland, Oregon',
          bullets: [
            'Built and evaluated forecasting and classification models for product and operations teams.',
            'Partnered with engineering to improve data quality and publish reusable model insights.',
          ],
        },
        {
          heading: 'Juniper Labs',
          subheading: 'Associate Data Scientist',
          dateRange: '2021 – 2023 | Seattle, Washington',
          bullets: [
            'Designed controlled experiments and translated results into practical product recommendations.',
          ],
        },
      ],
    },
    {
      title: 'Education',
      items: [
        {
          heading: 'B.S. in Applied Mathematics',
          subheading: 'Cascadia State University',
          dateRange: '2017 – 2021 | Portland, Oregon',
        },
      ],
    },
    {
      title: 'Projects',
      items: [
        {
          heading: 'Customer Retention Insights',
          subheading: 'Independent Project',
          bullets: [
            'Created a reproducible analysis pipeline and interactive report using a fictional public dataset.',
          ],
        },
      ],
    },
    {
      title: 'Skills',
      items: [
        { heading: 'Analytics', subheading: 'Experiment Design, Product Metrics, Statistical Modeling' },
        { heading: 'Technology', subheading: 'Python, SQL, scikit-learn, pandas, Jupyter' },
        { heading: 'Collaboration', subheading: 'Data Storytelling, Documentation, Cross-functional Delivery' },
      ],
    },
  ],
};

const defaultJson3 = JSON.stringify({
  ...sampleResume3,
  coverLetter: {
    salutation: 'Dear Hiring Manager,',
    bodyParagraphs: [
      'I am writing to apply for the Data Scientist role at Northstar Analytics. My experience translating product data into reliable models and clear recommendations fits the role’s focus on measurable, collaborative work.',
      'I have built forecasting and classification models, designed experiments, and partnered with engineering teams to improve data quality. I would be glad to bring this blend of analytical and practical experience to your team.',
      'Thank you for your time and consideration. I look forward to the possibility of discussing the role with you.',
    ],
    closing: 'Sincerely,',
  },
}, null, 2);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResumeJson(value: string): {
  resume?: QtsResumeDocument;
  coverLetter?: QtsCoverLetterDocument;
  error?: string;
  coverLetterError?: string;
} {
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
  if (parsed.targetJobsite !== undefined && typeof parsed.targetJobsite !== 'string') {
    return { error: 'Target jobsite must be text.' };
  }

  let coverLetter: QtsCoverLetterDocument | undefined;
  let coverLetterError: string | undefined;
  const rawCoverLetter = parsed.coverLetter;
  if (!isRecord(rawCoverLetter)) {
    coverLetterError = 'Add a coverLetter object with a bodyParagraphs array to generate both PDFs.';
  } else {
    const bodyParagraphs = rawCoverLetter.bodyParagraphs;
    const validBodyParagraphs = Array.isArray(bodyParagraphs)
      ? bodyParagraphs.filter((paragraph): paragraph is string =>
        typeof paragraph === 'string' && Boolean(paragraph.trim()) && paragraph.length <= 900
      )
      : [];
    if (
      validBodyParagraphs.length < 1
      || validBodyParagraphs.length > 6
      || !Array.isArray(bodyParagraphs)
      || validBodyParagraphs.length !== bodyParagraphs.length
    ) {
      coverLetterError = 'coverLetter.bodyParagraphs must contain 1–6 non-empty text paragraphs of at most 900 characters each.';
    } else if (
      ['date', 'salutation', 'closing'].some((field) =>
        rawCoverLetter[field] !== undefined && typeof rawCoverLetter[field] !== 'string'
      )
    ) {
      coverLetterError = 'Cover letter date, salutation, and closing values must be text.';
    } else {
      coverLetter = {
        date: typeof rawCoverLetter.date === 'string' ? rawCoverLetter.date : undefined,
        salutation: typeof rawCoverLetter.salutation === 'string' ? rawCoverLetter.salutation : undefined,
        bodyParagraphs: validBodyParagraphs,
        closing: typeof rawCoverLetter.closing === 'string' ? rawCoverLetter.closing : undefined,
      };
    }
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
      targetJobsite: parsed.targetJobsite as string | undefined,
      summary: parsed.summary as string | undefined,
      sections,
    },
    coverLetter,
    coverLetterError,
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

function getSuggestedPath(value: unknown): {
  directories: string[];
  fileName: string;
  coverLetterFileName: string;
  relativePath: string;
  titleCompanyKey: string;
} {
  const resume = isRecord(value) ? value : {};
  const candidate = isRecord(resume.candidate) ? resume.candidate : {};
  const account = safePathSegment(typeof candidate.fullName === 'string' ? candidate.fullName : '', 'Account');
  const role = safePathSegment(typeof resume.targetRole === 'string' ? resume.targetRole : '', 'Job');
  const company = safePathSegment(typeof resume.targetCompany === 'string' ? resume.targetCompany : '', 'Company');
  const jobsite = safePathSegment(typeof resume.targetJobsite === 'string' ? resume.targetJobsite : '', 'Unknown');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const directories = [resumeOutputFolderName, account, `${date}_${time}_${role}_${company}_${jobsite}`];
  return {
    directories,
    fileName: `${account}.pdf`,
    coverLetterFileName: `${account}_Cover_Letter.pdf`,
    relativePath: [...directories, `${account}.pdf`].join('/'),
    titleCompanyKey: `${role}_${company}`,
  };
}

async function findExistingTitleCompanyFolder(
  selectedFolder: PermissionedDirectoryHandle,
  accountName: string,
  titleCompanyKey: string
): Promise<string | undefined> {
  let resumeFolder: FileSystemDirectoryHandle;
  try {
    resumeFolder = await selectedFolder.getDirectoryHandle(resumeOutputFolderName);
  } catch (error) {
    if (isDirectoryNotFound(error)) return undefined;
    throw error;
  }

  let accountFolder: FileSystemDirectoryHandle;
  try {
    accountFolder = await resumeFolder.getDirectoryHandle(accountName);
  } catch (error) {
    if (isDirectoryNotFound(error)) return undefined;
    throw error;
  }

  const expectedPrefix = `${titleCompanyKey}_`.toLocaleLowerCase();
  for await (const [name, handle] of (accountFolder as IterableDirectoryHandle).entries()) {
    if (handle.kind !== 'directory') continue;
    const datedFolder = name.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(.+)$/);
    if (datedFolder?.[1].toLocaleLowerCase().startsWith(expectedPrefix)) return name;
  }
  return undefined;
}

export function ManagerPdfsView() {
  const [template, setTemplate] = useState<ResumeTemplate>('qts_resume_2');
  const [previewDocument, setPreviewDocument] = useState<PreviewDocument>('resume');
  const [resumeJson, setResumeJson] = useState<Record<ResumeTemplate, string>>({
    qts_resume_1: defaultJson,
    qts_resume_2: defaultJson,
    qts_resume_3: defaultJson3,
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
  const [suggestedPath, setSuggestedPath] = useState('');
  const [downloadDirectory, setDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const [savedDownloadDirectory, setSavedDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const [isRestoringDownloadDirectory, setIsRestoringDownloadDirectory] = useState(true);
  const previewUrlRef = useRef<string | null>(null);
  const livePreviewFrameRef = useRef<HTMLIFrameElement>(null);
  const json = resumeJson[template];
  const isLiveTemplate = template === 'qts_resume_1' || template === 'qts_resume_2' || template === 'qts_resume_3';
  const parsedResume = parseResumeJson(json);
  const coverLetterHtml = parsedResume.resume && parsedResume.coverLetter
    ? createQtsCoverLetterHtml(parsedResume.resume, parsedResume.coverLetter)
    : '';

  useEffect(() => {
    let cancelled = false;
    loadSavedDirectory()
      .then(async (directory) => {
        if (!directory || cancelled) return;
        setSavedDownloadDirectory(directory);
        const permission = await directory.queryPermission({ mode: 'readwrite' });
        if (cancelled) return;
        if (permission === 'granted') {
          try {
            await verifyDirectoryHandle(directory);
          } catch (error) {
            if (!isDirectoryNotFound(error)) throw error;
            await removeSavedDirectory();
            if (cancelled) return;
            setSavedDownloadDirectory(null);
            setDownloadStatus('The saved folder is no longer available. Choose a folder to continue.');
            return;
          }
          setDownloadDirectory(directory);
          setDownloadStatus(`Saved folder restored: ${directory.name}.`);
        } else {
          setDownloadStatus(`Saved folder found: ${directory.name}. Reconnect it to allow PDF downloads.`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDownloadError(error instanceof Error ? error.message : 'Could not restore the saved download folder.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsRestoringDownloadDirectory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, []);

  async function chooseDownloadFolder() {
    setDownloadError('');
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setDownloadError('Your browser does not support choosing a folder. Use a browser that supports the File System Access API to save the paired PDFs.');
      return;
    }

    try {
      const directory = await picker.call(window, {
        id: 'manager-resume-pdfs',
        mode: 'readwrite',
        startIn: 'music',
      });
      setDownloadDirectory(directory);
      setDownloadStatus(`PDFs will be saved in ${directory.name}.`);
      const persistence = await requestPersistentStorage();
      try {
        await saveDirectory(directory);
        setSavedDownloadDirectory(directory);
        setDownloadStatus(`PDFs will be saved in ${directory.name}. This folder is remembered in this browser. ${persistence.message} Clearing site data can still remove it.`);
      } catch (error) {
        setDownloadError(error instanceof Error
          ? `Folder selected for this session, but it could not be remembered: ${error.message}`
          : 'Folder selected for this session, but it could not be remembered.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDownloadError(error instanceof Error ? error.message : 'Could not access the selected download folder.');
    }
  }

  async function reconnectDownloadFolder() {
    if (!savedDownloadDirectory) return;
    setDownloadError('');
    try {
      const permission = await savedDownloadDirectory.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setDownloadError('Folder access was not granted. Allow access in your browser, then reconnect the saved folder.');
        return;
      }
      try {
        await verifyDirectoryHandle(savedDownloadDirectory);
      } catch (error) {
        if (!isDirectoryNotFound(error)) throw error;
        await removeSavedDirectory();
        setSavedDownloadDirectory(null);
        setDownloadStatus('The saved folder is no longer available. Choose a folder to continue.');
        return;
      }
      setDownloadDirectory(savedDownloadDirectory);
      setDownloadStatus(`PDFs will be saved in ${savedDownloadDirectory.name}.`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not reconnect the saved download folder.');
    }
  }

  async function download() {
    const parsed = parseResumeJson(json);
    if (!parsed.resume) {
      setPreviewError(parsed.error || 'Enter valid resume JSON before downloading.');
      return;
    }
    if (!parsed.coverLetter) {
      setDownloadError(parsed.coverLetterError || 'Enter valid cover letter content before downloading.');
      return;
    }
    if (savedDownloadDirectory && !downloadDirectory) {
      setDownloadError('Reconnect the saved download folder before downloading.');
      return;
    }
    if (!downloadDirectory) {
      setDownloadError('Choose a folder before downloading so both PDFs can be saved together and checked for duplicates.');
      return;
    }
    if ((!isLiveTemplate && (!previewUrl || !previewPdf || isLoading)) || isDownloading) return;
    const account = safePathSegment(parsed.resume.candidate.fullName, 'Resume');
    const destination = getSuggestedPath(parsed.resume);
    setDownloadError('');
    setDownloadStatus('');
    setSuggestedPath(destination.relativePath);

    setIsDownloading(true);
    const savedFiles: string[] = [];
    try {
      const existingFolder = await findExistingTitleCompanyFolder(
        downloadDirectory,
        account,
        destination.titleCompanyKey
      );
      if (existingFolder) {
        setDownloadError(
          `Download stopped. A folder for this title and company already exists for ${account}: ${existingFolder}.`
        );
        return;
      }

      let resumePdf = previewPdf;
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
        resumePdf = result.pdf;
      }
      if (!resumePdf) {
        setDownloadError('The PDF preview is not ready to download yet.');
        return;
      }

      if (!coverLetterHtml) {
        setDownloadError('The QTS cover letter preview is not ready to download.');
        return;
      }

      const coverLetterResult = await requestPdf('/api/v2/resume-pdfs/preview', {
        template: 'qts_cover_letter',
        resume: parsed.resume,
        renderedHtml: coverLetterHtml,
      });
      if (!coverLetterResult.success || !coverLetterResult.pdf) {
        setDownloadError(coverLetterResult.message || 'Could not generate the cover letter PDF.');
        return;
      }

      let outputDirectory: FileSystemDirectoryHandle = downloadDirectory;
      for (const segment of destination.directories) {
        outputDirectory = await outputDirectory.getDirectoryHandle(segment, { create: true });
      }

      for (const [fileName, pdf] of [
        [destination.fileName, resumePdf],
        [destination.coverLetterFileName, coverLetterResult.pdf],
      ] as const) {
        const file = await outputDirectory.getFileHandle(fileName, { create: true });
        const writable = await file.createWritable();
        try {
          await writable.write(pdf);
          await writable.close();
          savedFiles.push(fileName);
        } catch (error) {
          await writable.abort().catch((abortError: unknown) => {
            console.error('Could not clean up a failed PDF download', abortError);
          });
          throw error;
        }
      }

      const savedFolder = `${downloadDirectory.name}/${destination.directories.join('/')}`;
      setDownloadStatus(`Saved both PDFs to ${savedFolder}: ${destination.fileName} and ${destination.coverLetterFileName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the generated PDFs.';
      setDownloadError(savedFiles.length
        ? `Only ${savedFiles.join(', ')} was saved. Could not save the second PDF: ${message}`
        : message);
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
                  if (selected.id === 'qts_resume_1' || selected.id === 'qts_resume_2' || selected.id === 'qts_resume_3') {
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
              {isLiveTemplate
                ? 'Valid JSON updates the resume preview as you type. Add skill or experience entries as objects in that section’s items array.'
                : 'The PDF preview refreshes automatically.'}
            </p>
          </div>
          {previewError && <div className="alert alert-error" role="alert">{previewError}</div>}
          {parsedResume.coverLetterError && (
            <div className="alert alert-error" role="alert">{parsedResume.coverLetterError}</div>
          )}
          <button className="btn btn-primary" type="button" onClick={download}
            disabled={!parsedResume.resume || !parsedResume.coverLetter || !downloadDirectory
              || (isLiveTemplate ? (!isLivePreviewReady || !renderedHtml) : !previewUrl)
              || isLoading || isDownloading || Boolean(previewError) || Boolean(parsedResume.coverLetterError)}>
            {isDownloading ? 'Generating PDFs…' : isLoading ? 'Preparing preview…' : 'Download Resume + Cover Letter PDFs'}
          </button>
          {!isRestoringDownloadDirectory && savedDownloadDirectory && !downloadDirectory && (
            <button className="btn" type="button" onClick={reconnectDownloadFolder}>Reconnect saved folder</button>
          )}
          {!isRestoringDownloadDirectory && !savedDownloadDirectory && (
            <button className="btn" type="button" onClick={chooseDownloadFolder}>Choose a folder</button>
          )}
          {downloadError && <div className="alert alert-error" role="alert">{downloadError}</div>}
          <p className="manager-pdfs__path-note">
            {downloadDirectory ? `Path inside ${downloadDirectory.name}:` : 'Suggested folder structure:'}{' '}
            <code>{suggestedPath || '$_QTS_Resume_$/Account/date_time_title_company_jobsite/Account.pdf and Account_Cover_Letter.pdf'}</code>
          </p>
          <p className="text-muted">Every resume template, including QTS Resume 1–3, uses this same paired-PDF folder and duplicate-check rule.</p>
          {!downloadDirectory && <p className="text-muted">Choose any folder on your computer; both PDFs are saved under $_QTS_Resume_$/account/date_time_title_company_jobsite. Add targetJobsite to the resume JSON; if blank, the folder uses Unknown. An existing folder for the same title and company under that account stops the download. The picker starts in Music, and your selected folder is remembered in this browser when supported.</p>}
          {downloadStatus && <p role="status" className="manager-pdfs__path-note">{downloadStatus}</p>}
        </section>
        <section className="manager-pdfs__preview card" aria-labelledby="resume-pdf-preview-title">
          <div className="manager-pdfs__preview-header">
            <h3 id="resume-pdf-preview-title">{previewDocument === 'resume' && isLiveTemplate ? 'Live resume preview' : `${previewDocument === 'resume' ? 'Resume' : 'Cover letter'} preview`}</h3>
            {previewDocument === 'resume' && isLoading && <span className="text-muted" role="status">Generating PDF…</span>}
            {previewDocument === 'resume' && isLiveTemplate && !isLivePreviewReady && <span className="text-muted" role="status">Preparing live preview…</span>}
          </div>
          <div className="manager-pdfs__preview-tabs" role="tablist" aria-label="PDF preview">
            <button
              className={`manager-pdfs__preview-tab${previewDocument === 'resume' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={previewDocument === 'resume'}
              onClick={() => setPreviewDocument('resume')}
            >
              Resume
            </button>
            <button
              className={`manager-pdfs__preview-tab${previewDocument === 'cover-letter' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={previewDocument === 'cover-letter'}
              disabled={!parsedResume.resume || !parsedResume.coverLetter}
              onClick={() => setPreviewDocument('cover-letter')}
            >
              Cover letter
            </button>
          </div>
          {previewDocument === 'cover-letter' && parsedResume.resume && parsedResume.coverLetter ? (
            <div className="manager-pdfs__live-resume manager-pdfs__cover-letter">
              <QtsCoverLetterPreview resume={parsedResume.resume} coverLetter={parsedResume.coverLetter} />
            </div>
          ) : isLiveTemplate ? (
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
                ) : template === 'qts_resume_3' ? (
                  <QtsResume3Preview
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
                    key={template}
                    resume={liveResume}
                    iframeRef={livePreviewFrameRef}
                    scaleMode="fit"
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
