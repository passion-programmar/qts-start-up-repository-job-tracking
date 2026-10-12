'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, requestPdf } from '@/lib/api';
import { ManagerPdfCanvasPreview } from '@/components/ManagerPdfCanvasPreview';
import { QtsResumePreview, type QtsResumeDocument } from '@/components/QtsResumePreview';
import { QtsResume2Preview } from '@/components/QtsResume2Preview';
import { QtsResume3Preview } from '@/components/QtsResume3Preview';

type ResumeTemplate = 'qts_resume_1' | 'qts_resume_2' | 'qts_resume_3' | 'classic' | 'compact';
type CoverLetterTemplate = 'qts_cover_letter_1';
type ManagerPdfAccount = {
  u_id: number;
  name: string;
  first_name: string;
  last_name: string;
  default_resume_template: ResumeTemplate;
  default_cover_letter_template: CoverLetterTemplate;
};
type CoverLetterDocument = {
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

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
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

async function requestPersistentStorage(): Promise<string> {
  if (!navigator.storage?.persist) {
    return 'Persistent browser storage is not supported.';
  }

  try {
    return await navigator.storage.persist()
      ? 'Persistent browser storage is enabled.'
      : 'Persistent browser storage was not granted.';
  } catch (error) {
    return error instanceof Error
      ? `Could not enable persistent browser storage: ${error.message}`
      : 'Could not enable persistent browser storage.';
  }
}

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

const sampleCoverLetter: CoverLetterDocument = {
  candidate: {
    fullName: 'Alex Morgan',
    email: 'alex.morgan@example.com',
    phone: '+1 202-555-0100',
    linkedinUrl: 'https://example.com/alex-morgan',
  },
  targetRole: 'Software Engineer',
  targetCompany: 'Example Company',
  date: 'October 11, 2026',
  salutation: 'Dear Hiring Manager,',
  bodyParagraphs: [
    'I am applying for the Software Engineer role at Example Company. My experience building and maintaining web applications has prepared me to contribute to your team.',
    'I value thoughtful collaboration, reliable delivery, and clear communication. I would welcome the opportunity to discuss how my skills could support your work.',
  ],
  closing: 'Sincerely,',
  signatureName: 'Alex Morgan',
};

const defaultApplicationJson = JSON.stringify({
  candidate: sampleResume.candidate,
  job: {
    title: sampleResume.targetRole,
    company: sampleCoverLetter.targetCompany,
  },
  resume: {
    summary: sampleResume.summary,
    sections: sampleResume.sections,
  },
  coverLetter: {
    date: sampleCoverLetter.date,
    salutation: sampleCoverLetter.salutation,
    bodyParagraphs: sampleCoverLetter.bodyParagraphs,
    closing: sampleCoverLetter.closing,
    signatureName: sampleCoverLetter.signatureName,
  },
}, null, 2);

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
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    return { error: 'Resume JSON must include at least one section.' };
  }

  const sections: QtsResumeDocument['sections'] = [];
  for (const [sectionIndex, section] of parsed.sections.entries()) {
    if (!isRecord(section) || typeof section.title !== 'string' || !section.title.trim()) {
      return { error: `Section ${sectionIndex + 1} must have a non-empty text title.` };
    }
    if (!Array.isArray(section.items) || section.items.length === 0) {
      return { error: `Section ${sectionIndex + 1} must include at least one item.` };
    }
    const items: NonNullable<QtsResumeDocument['sections'][number]['items']> = [];
    for (const [itemIndex, item] of (section.items as unknown[]).entries()) {
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
    sections.push({ title: section.title, items });
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

function parseCoverLetterJson(value: string): { coverLetter?: CoverLetterDocument; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'Enter valid JSON to update the cover letter.' };
  }

  if (!isRecord(parsed) || !isRecord(parsed.candidate)) {
    return { error: 'Cover letter JSON must include a candidate object.' };
  }
  if (typeof parsed.candidate.fullName !== 'string' || typeof parsed.candidate.email !== 'string') {
    return { error: 'Cover letter candidate must include a name and email address.' };
  }
  if (typeof parsed.targetRole !== 'string' || !parsed.targetRole.trim()) {
    return { error: 'Cover letter JSON must include a target role.' };
  }
  if (typeof parsed.targetCompany !== 'string' || !parsed.targetCompany.trim()) {
    return { error: 'Cover letter JSON must include a target company.' };
  }
  if (!Array.isArray(parsed.bodyParagraphs) || parsed.bodyParagraphs.length === 0 ||
      parsed.bodyParagraphs.some((paragraph) => typeof paragraph !== 'string')) {
    return { error: 'Cover letter JSON must include bodyParagraphs as an array of text.' };
  }
  for (const field of ['phone', 'linkedinUrl'] as const) {
    if (parsed.candidate[field] !== undefined && typeof parsed.candidate[field] !== 'string') {
      return { error: `Cover letter candidate ${field} must be text.` };
    }
  }
  for (const field of ['date', 'salutation', 'closing', 'signatureName'] as const) {
    if (parsed[field] !== undefined && typeof parsed[field] !== 'string') {
      return { error: `${field} must be text.` };
    }
  }

  return {
    coverLetter: {
      candidate: {
        fullName: parsed.candidate.fullName,
        email: parsed.candidate.email,
        phone: parsed.candidate.phone as string | undefined,
        linkedinUrl: parsed.candidate.linkedinUrl as string | undefined,
      },
      targetRole: parsed.targetRole,
      targetCompany: parsed.targetCompany,
      date: parsed.date as string | undefined,
      salutation: parsed.salutation as string | undefined,
      bodyParagraphs: parsed.bodyParagraphs as string[],
      closing: parsed.closing as string | undefined,
      signatureName: parsed.signatureName as string | undefined,
    },
  };
}

function parseApplicationJson(value: string): {
  resume?: QtsResumeDocument;
  coverLetter?: CoverLetterDocument;
  error?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'Enter valid application JSON.' };
  }

  if (!isRecord(parsed) || !isRecord(parsed.candidate) || !isRecord(parsed.job) ||
      !isRecord(parsed.resume) || !isRecord(parsed.coverLetter)) {
    return { error: 'Application JSON must include candidate, job, resume, and coverLetter objects.' };
  }
  if (typeof parsed.job.title !== 'string' || !parsed.job.title.trim()) {
    return { error: 'Job must include a title.' };
  }
  if (typeof parsed.job.company !== 'string' || !parsed.job.company.trim()) {
    return { error: 'Job must include a company.' };
  }

  const candidate = parsed.candidate;
  const job = { targetRole: parsed.job.title, targetCompany: parsed.job.company };
  const resumeResult = parseResumeJson(JSON.stringify({
    candidate,
    ...job,
    summary: parsed.resume.summary,
    sections: parsed.resume.sections,
  }));
  if (!resumeResult.resume) return { error: resumeResult.error || 'Resume data is invalid.' };

  const coverLetterResult = parseCoverLetterJson(JSON.stringify({
    candidate,
    ...job,
    ...parsed.coverLetter,
  }));
  if (!coverLetterResult.coverLetter) {
    return { error: coverLetterResult.error || 'Cover letter data is invalid.' };
  }

  return { resume: resumeResult.resume, coverLetter: coverLetterResult.coverLetter };
}

function normalizeAccountName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function candidateNameFromJson(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) && isRecord(parsed.candidate) && typeof parsed.candidate.fullName === 'string'
      ? parsed.candidate.fullName.trim()
      : '';
  } catch {
    return '';
  }
}

function getSuggestedPath(value: unknown): {
  accountDirectory: string;
  jobFolderName: string;
  jobFolderKey: string;
  directories: string[];
  resumeFileName: string;
  coverLetterFileName: string;
  relativePath: string;
} {
  const resume = isRecord(value) ? value : {};
  const candidate = isRecord(resume.candidate) ? resume.candidate : {};
  const fullName = typeof candidate.fullName === 'string' ? candidate.fullName.trim() : '';
  const account = safePathSegment(fullName, 'Account');
  const role = safePathSegment(typeof resume.targetRole === 'string' ? resume.targetRole : '', 'Job');
  const company = safePathSegment(typeof resume.targetCompany === 'string' ? resume.targetCompany : '', 'Company');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const jobFolderKey = `${role}_${company}`.normalize('NFKC').toLocaleLowerCase();
  const jobFolderName = `${date}_${time}_${role}_${company}`;
  const safeFullName = fullName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'Resume';
  const resumeFileName = `${safeFullName}.pdf`;
  const coverLetterFileName = `${safePathSegment(fullName, 'Account')}_Cover_Letter.pdf`;
  const directories = ['$_QTS_Resume_$', account, jobFolderName];
  return {
    accountDirectory: account,
    jobFolderName,
    jobFolderKey,
    directories,
    resumeFileName,
    coverLetterFileName,
    relativePath: `${directories.join('/')}/${resumeFileName} and ${coverLetterFileName}`,
  };
}

export function ManagerPdfsView() {
  const [applicationJson, setApplicationJson] = useState(defaultApplicationJson);
  const [accounts, setAccounts] = useState<ManagerPdfAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountMatchStatus, setAccountMatchStatus] = useState('');
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null);
  const [resumePreviewPdf, setResumePreviewPdf] = useState<Blob | null>(null);
  const [coverLetterPreviewUrl, setCoverLetterPreviewUrl] = useState<string | null>(null);
  const [coverLetterPreviewPdf, setCoverLetterPreviewPdf] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [livePreviewError, setLivePreviewError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [isResumeLoading, setIsResumeLoading] = useState(false);
  const [isCoverLetterLoading, setIsCoverLetterLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLivePreviewReady, setIsLivePreviewReady] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [liveResume, setLiveResume] = useState<QtsResumeDocument>(sampleResume);
  const [suggestedPath, setSuggestedPath] = useState('');
  const [downloadDirectory, setDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const [savedDownloadDirectory, setSavedDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const resumePreviewUrlRef = useRef<string | null>(null);
  const coverLetterPreviewUrlRef = useRef<string | null>(null);
  const livePreviewFrameRef = useRef<HTMLIFrameElement>(null);
  const lastMatchedNameRef = useRef('');
  const parsedApplication = useMemo(() => parseApplicationJson(applicationJson), [applicationJson]);
  const selectedAccount = accounts.find((account) => String(account.u_id) === selectedAccountId);
  const template = selectedAccount?.default_resume_template;
  const coverLetterTemplate = selectedAccount?.default_cover_letter_template;
  const isLiveTemplate = template === 'qts_resume_1' || template === 'qts_resume_2' || template === 'qts_resume_3';
  const resumeName = candidateNameFromJson(applicationJson);
  const activeValidationError = parsedApplication.error;
  const previewsReady = isLiveTemplate
    ? isLivePreviewReady && Boolean(renderedHtml) && Boolean(coverLetterPreviewPdf) && !isCoverLetterLoading
    : Boolean(resumePreviewPdf && coverLetterPreviewPdf) && !isResumeLoading && !isCoverLetterLoading;

  useEffect(() => {
    let cancelled = false;
    api<{ success: boolean; accounts?: ManagerPdfAccount[]; message?: string }>('GET', '/api/v2/users/accounts')
      .then((result) => {
        if (cancelled) return;
        if (!result.success || !result.accounts) {
          setAccountsError(result.message || 'Could not load Accounts.');
          return;
        }
        setAccounts(result.accounts);
        setAccountsLoaded(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAccountsError(error instanceof Error ? error.message : 'Could not load Accounts.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const accountFullName = resumeName;
    if (!accountsLoaded || !accountFullName) return;
    const timeout = window.setTimeout(() => {
      const normalizedName = normalizeAccountName(accountFullName);
      const matchKey = normalizedName;
      if (lastMatchedNameRef.current === matchKey) return;
      lastMatchedNameRef.current = matchKey;

      const matches = accounts.filter((account) => normalizeAccountName(account.name) === normalizedName);
      if (matches.length === 1) {
        const match = matches[0];
        setSelectedAccountId(String(match.u_id));
        const matchedResume = parsedApplication.resume;
        if (matchedResume) setLiveResume(matchedResume);
        setIsResumeLoading(false);
        setIsCoverLetterLoading(false);
        setIsLivePreviewReady(false);
        setRenderedHtml('');
        setResumePreviewUrl(null);
        setResumePreviewPdf(null);
        setCoverLetterPreviewUrl(null);
        setCoverLetterPreviewPdf(null);
        setSuggestedPath('');
        setAccountMatchStatus(`Matched Account: ${match.name}.`);
      } else {
        setSelectedAccountId('');
        setAccountMatchStatus(matches.length > 1
          ? `More than one Account matches “${accountFullName}”. Select the correct Account.`
          : `No Account matches “${accountFullName}”. Select an Account with assigned PDF templates.`);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [accounts, accountsLoaded, parsedApplication.resume, resumeName]);

  useEffect(() => {
    let cancelled = false;
    loadSavedDirectory()
      .then(async (directory) => {
        if (!directory || cancelled) return;
        setSavedDownloadDirectory(directory);
        const permission = await directory.queryPermission({ mode: 'readwrite' });
        if (cancelled) return;
        if (permission === 'granted') {
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
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const resumeDocument = parsedApplication.resume;
    const coverLetterDocument = parsedApplication.coverLetter;
    if (!selectedAccount || !resumeDocument || !coverLetterDocument || !template) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewError('');
      setIsCoverLetterLoading(true);
      if (!isLiveTemplate) setIsResumeLoading(true);
      try {
        const [resumeResult, coverLetterResult] = await Promise.all([
          isLiveTemplate
            ? Promise.resolve(null)
            : requestPdf('/api/v2/resume-pdfs/preview', {
                template,
                resume: resumeDocument,
              }, controller.signal),
          requestPdf('/api/v2/resume-pdfs/cover-letter-preview', {
            coverLetter: coverLetterDocument,
          }, controller.signal),
        ]);
        if (cancelled) return;
        if (resumeResult && (!resumeResult.success || !resumeResult.pdf)) {
          setPreviewError(resumeResult.message || 'Could not generate the resume preview.');
          return;
        }
        if (!coverLetterResult.success || !coverLetterResult.pdf) {
          setPreviewError(coverLetterResult.message || 'Could not generate the cover-letter preview.');
          return;
        }
        if (resumeResult?.pdf) {
          const nextUrl = URL.createObjectURL(resumeResult.pdf);
          if (resumePreviewUrlRef.current) URL.revokeObjectURL(resumePreviewUrlRef.current);
          resumePreviewUrlRef.current = nextUrl;
          setResumePreviewUrl(nextUrl);
          setResumePreviewPdf(resumeResult.pdf);
        } else {
          setLiveResume(resumeDocument);
        }
        const nextCoverLetterUrl = URL.createObjectURL(coverLetterResult.pdf);
        if (coverLetterPreviewUrlRef.current) URL.revokeObjectURL(coverLetterPreviewUrlRef.current);
        coverLetterPreviewUrlRef.current = nextCoverLetterUrl;
        setCoverLetterPreviewUrl(nextCoverLetterUrl);
        setCoverLetterPreviewPdf(coverLetterResult.pdf);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setPreviewError(error instanceof Error ? error.message : 'Could not generate both PDF previews.');
        }
      } finally {
        if (!cancelled) {
          setIsResumeLoading(false);
          setIsCoverLetterLoading(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    isLiveTemplate,
    parsedApplication.coverLetter,
    parsedApplication.resume,
    selectedAccount,
    template,
  ]);

  useEffect(() => () => {
    if (resumePreviewUrlRef.current) URL.revokeObjectURL(resumePreviewUrlRef.current);
    if (coverLetterPreviewUrlRef.current) URL.revokeObjectURL(coverLetterPreviewUrlRef.current);
  }, []);

  async function chooseDownloadFolder() {
    setDownloadError('');
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setDownloadError('Your browser does not support choosing a local folder. A supported browser is required for duplicate-application checks.');
      return;
    }

    try {
      const directory = await picker.call(window, {
        id: 'manager-resume-pdfs',
        mode: 'readwrite',
        startIn: 'music',
      });
      setDownloadDirectory(directory);
      setSavedDownloadDirectory(directory);
      setDownloadStatus(`PDFs will be saved in ${directory.name} for this session.`);
      const persistence = await requestPersistentStorage();
      try {
        await saveDirectory(directory);
        setDownloadStatus(`PDFs will be saved in ${directory.name}. This folder is remembered in this browser. ${persistence} Clearing site data can still remove it.`);
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
        setDownloadError('Folder access was not granted. Choose the folder again or allow access in your browser.');
        return;
      }
      setDownloadDirectory(savedDownloadDirectory);
      setDownloadStatus(`PDFs will be saved in ${savedDownloadDirectory.name}.`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not reconnect the saved download folder.');
    }
  }

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    setAccountMatchStatus('');
    setIsResumeLoading(false);
    setIsCoverLetterLoading(false);
    setResumePreviewPdf(null);
    setCoverLetterPreviewPdf(null);
    setIsLivePreviewReady(false);
    setRenderedHtml('');
    setSuggestedPath('');
  }

  async function download() {
    const resume = parsedApplication.resume;
    const coverLetter = parsedApplication.coverLetter;
    if (!resume || !coverLetter || !selectedAccount || !template || !coverLetterTemplate) return;
    if (normalizeAccountName(resume.candidate.fullName) !== normalizeAccountName(selectedAccount.name) ||
        normalizeAccountName(coverLetter.candidate.fullName) !== normalizeAccountName(selectedAccount.name)) {
      setDownloadError('Both documents must use the selected Account’s exact full name.');
      return;
    }
    if (!downloadDirectory) {
      setDownloadError('Choose or reconnect a download folder before generating PDFs. The folder is required to check for duplicate applications.');
      return;
    }
    if (!resume.targetRole?.trim() || normalizeAccountName(resume.targetRole) !== normalizeAccountName(coverLetter.targetRole)) {
      setDownloadError('The resume and cover letter must have the same target role.');
      return;
    }
    if (isDownloading || !previewsReady) return;

    const destination = getSuggestedPath({
      ...resume,
      candidate: { ...resume.candidate, fullName: selectedAccount.name },
      targetCompany: coverLetter.targetCompany,
    });
    setDownloadError('');
    setDownloadStatus('');
    setSuggestedPath(destination.relativePath);
    setIsDownloading(true);
    try {
      let rootDirectory: FileSystemDirectoryHandle = downloadDirectory;
      rootDirectory = await rootDirectory.getDirectoryHandle('$_QTS_Resume_$', { create: true });
      const accountDirectory = await rootDirectory.getDirectoryHandle(destination.accountDirectory, { create: true }) as PermissionedDirectoryHandle;
      const timestampPrefix = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/;
      for await (const [entryName] of accountDirectory.entries()) {
        const existingJobKey = entryName.replace(timestampPrefix, '').normalize('NFKC').toLocaleLowerCase();
        if (existingJobKey === destination.jobFolderKey) {
          setDownloadError(`An application folder for ${coverLetter.targetRole} at ${coverLetter.targetCompany} already exists. No PDFs were saved.`);
          return;
        }
      }

      const [resumeResult, coverLetterResult] = await Promise.all([
        requestPdf('/api/v2/resume-pdfs/preview', {
          template,
          resume,
          ...(isLiveTemplate ? { renderedHtml } : {}),
        }),
        requestPdf('/api/v2/resume-pdfs/cover-letter-preview', {
          coverLetter,
        }),
      ]);
      if (!resumeResult.success || !resumeResult.pdf) {
        setDownloadError(resumeResult.message || 'Could not generate the resume PDF.');
        return;
      }
      if (!coverLetterResult.success || !coverLetterResult.pdf) {
        setDownloadError(coverLetterResult.message || 'Could not generate the cover-letter PDF.');
        return;
      }

      const jobDirectory = await accountDirectory.getDirectoryHandle(destination.jobFolderName, { create: true });
      try {
        const writePdf = async (fileName: string, pdf: Blob) => {
          const file = await jobDirectory.getFileHandle(fileName, { create: true });
          const writable = await file.createWritable();
          try {
            await writable.write(pdf);
            await writable.close();
          } catch (error) {
            await writable.abort().catch((abortError: unknown) => {
              console.error('Could not abort an incomplete PDF file write', abortError);
            });
            throw error;
          }
        };
        await writePdf(destination.resumeFileName, resumeResult.pdf);
        await writePdf(destination.coverLetterFileName, coverLetterResult.pdf);
      } catch (error) {
        try {
          await accountDirectory.removeEntry(destination.jobFolderName, { recursive: true });
        } catch (cleanupError) {
          throw new Error(
            `PDF saving failed (${error instanceof Error ? error.message : 'unknown error'}), and the incomplete job folder could not be removed (${cleanupError instanceof Error ? cleanupError.message : 'unknown error'}).`
          );
        }
        throw error;
      }
      setDownloadStatus(`Resume and cover letter saved to ${downloadDirectory.name}/${destination.relativePath}`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not save both PDFs.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="manager-pdfs">
      <div className="manager-pdfs__workspace">
        <section className="manager-pdfs__controls card" aria-labelledby="resume-pdf-inputs">
          <h2 id="resume-pdf-inputs">Generate application PDFs</h2>
          <div className="form-group">
            <label htmlFor="resume-pdf-account">Account</label>
            <select
              id="resume-pdf-account"
              value={selectedAccountId}
              onChange={(event) => selectAccount(event.target.value)}
              disabled={!accountsLoaded || accounts.length === 0}
            >
              <option value="">{accountsLoaded ? 'Select an Account' : 'Loading Accounts…'}</option>
              {accounts.map((account) => (
                <option key={account.u_id} value={account.u_id}>{account.name}</option>
              ))}
            </select>
            {accountsError && <div className="alert alert-error" role="alert">{accountsError}</div>}
            {accountMatchStatus && <p className="text-muted" role="status">{accountMatchStatus}</p>}
            {selectedAccount && <p className="text-muted">
              Assigned templates: {template?.replaceAll('_', ' ') || 'not assigned'} and {coverLetterTemplate?.replaceAll('_', ' ') || 'not assigned'}.
            </p>}
          </div>

          <div className="form-group manager-pdfs__json-field">
            <label htmlFor="application-pdf-json">Application JSON data</label>
            <textarea
              id="application-pdf-json"
              spellCheck={false}
              value={applicationJson}
              onChange={(event) => {
                const nextJson = event.target.value;
                const parsed = parseApplicationJson(nextJson);
                setApplicationJson(nextJson);
                if (parsed.resume && isLiveTemplate) setLiveResume(parsed.resume);
                setPreviewError('');
                setLivePreviewError('');
                setIsLivePreviewReady(false);
                setRenderedHtml('');
                setIsResumeLoading(false);
                setIsCoverLetterLoading(false);
                setResumePreviewPdf(null);
                setCoverLetterPreviewPdf(null);
                setSuggestedPath('');
                setDownloadError('');
                setDownloadStatus('');
              }}
            />
            <p className="text-muted">
              Paste one JSON object with shared <code>candidate</code> and <code>job</code> details, plus separate <code>resume</code> and <code>coverLetter</code> content. The same candidate and job information is used to generate both PDFs.
            </p>
          </div>
          <p className="text-muted">
            Both documents must have <code>candidate.fullName</code> matching the selected Account. Resume and cover-letter templates are assigned in Account settings.
          </p>
          {activeValidationError && <div className="alert alert-error" role="alert">{activeValidationError}</div>}
          {previewError && <div className="alert alert-error" role="alert">{previewError}</div>}

          <button className="btn btn-primary" type="button" onClick={download}
            disabled={!selectedAccount || !template || !coverLetterTemplate || !resumeName ||
              normalizeAccountName(resumeName) !== normalizeAccountName(selectedAccount?.name || '') ||
              Boolean(activeValidationError || previewError) || !previewsReady || !downloadDirectory || isDownloading}>
            {isDownloading ? 'Generating both PDFs…' : !downloadDirectory ? 'Choose a folder first' : 'Save resume and cover letter together'}
          </button>
          {savedDownloadDirectory && !downloadDirectory && (
            <button className="btn" type="button" onClick={reconnectDownloadFolder}>Reconnect saved folder</button>
          )}
          <button className="btn" type="button" onClick={chooseDownloadFolder}>
            {downloadDirectory || savedDownloadDirectory ? 'Choose a different folder' : 'Choose download folder'}
          </button>
          {downloadError && <div className="alert alert-error" role="alert">{downloadError}</div>}
          <p className="manager-pdfs__path-note">
            {downloadDirectory ? `Path inside ${downloadDirectory.name}:` : 'Suggested folder structure:'}{' '}
            <code>{suggestedPath || 'Selected folder/$_QTS_Resume_$/Account/YYYY-MM-DD_HH-MM-SS_Job_Company/…'}</code>
          </p>
          {!downloadDirectory && <p className="text-muted">
            Choose any local folder. Both PDFs will be saved together in an Account/job folder, and existing job folders are checked to prevent duplicate applications.
          </p>}
          {downloadStatus && <p role="status" className="manager-pdfs__path-note">{downloadStatus}</p>}
        </section>

        <section className="manager-pdfs__preview card" aria-labelledby="resume-pdf-preview-title">
          <div className="manager-pdfs__preview-header">
            <h3 id="resume-pdf-preview-title">{isLiveTemplate ? 'Resume preview' : 'Resume PDF preview'}</h3>
            {isResumeLoading && <span className="text-muted" role="status">Generating resume preview…</span>}
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
                    resume={liveResume}
                    iframeRef={livePreviewFrameRef}
                    onReady={setIsLivePreviewReady}
                    onError={setLivePreviewError}
                    onDocumentReady={setRenderedHtml}
                  />
                )}
              </div>
            </>
          ) : <ManagerPdfCanvasPreview key={resumePreviewUrl ?? 'empty-resume-preview'} pdf={resumePreviewPdf} />}

          <div className="manager-pdfs__preview-header">
            <h3>Cover letter PDF preview</h3>
            {isCoverLetterLoading && <span className="text-muted" role="status">Generating cover-letter preview…</span>}
          </div>
          <ManagerPdfCanvasPreview key={coverLetterPreviewUrl ?? 'empty-cover-letter-preview'} pdf={coverLetterPreviewPdf} />
        </section>
      </div>
    </section>
  );
}
