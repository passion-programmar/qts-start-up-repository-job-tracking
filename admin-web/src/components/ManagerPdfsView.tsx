'use client';

import { useEffect, useRef, useState } from 'react';
import { api, requestPdf } from '@/lib/api';
import { ManagerPdfCanvasPreview } from '@/components/ManagerPdfCanvasPreview';
import { QtsResumePreview, type QtsResumeDocument } from '@/components/QtsResumePreview';
import { QtsResume2Preview } from '@/components/QtsResume2Preview';
import { QtsResume3Preview } from '@/components/QtsResume3Preview';

type ResumeTemplate = 'qts_resume_1' | 'qts_resume_2' | 'qts_resume_3' | 'classic' | 'compact';
type PdfMode = 'resume' | 'cover-letter';
type ManagerPdfAccount = {
  u_id: number;
  name: string;
  first_name: string;
  last_name: string;
  default_resume_template: ResumeTemplate;
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

const defaultCoverLetterJson = JSON.stringify(sampleCoverLetter, null, 2);

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

function normalizeAccountName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function getSuggestedPath(
  value: unknown,
  mode: PdfMode = 'resume'
): { directories: string[]; fileName: string; relativePath: string } {
  const resume = isRecord(value) ? value : {};
  const candidate = isRecord(resume.candidate) ? resume.candidate : {};
  const account = safePathSegment(typeof candidate.fullName === 'string' ? candidate.fullName : '', 'Account');
  const role = safePathSegment(typeof resume.targetRole === 'string' ? resume.targetRole : '', 'Job');
  const company = safePathSegment(typeof resume.targetCompany === 'string' ? resume.targetCompany : '', 'Company');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const documentFolder = mode === 'resume' ? '$_QTS_Resume_$' : '$_QTS_Cover_Letter_$';
  const directories = [
    documentFolder,
    account,
    `${date}_${time}_${role}_${company}`,
  ];
  return {
    directories,
    fileName: `${account}${mode === 'cover-letter' ? '_Cover_Letter' : ''}.pdf`,
    relativePath: [...directories, `${account}${mode === 'cover-letter' ? '_Cover_Letter' : ''}.pdf`].join('/'),
  };
}

export function ManagerPdfsView() {
  const [mode, setMode] = useState<PdfMode>('resume');
  const [template, setTemplate] = useState<ResumeTemplate>('qts_resume_2');
  const [resumeJson, setResumeJson] = useState(defaultJson);
  const [coverLetterJson, setCoverLetterJson] = useState(defaultCoverLetterJson);
  const [accounts, setAccounts] = useState<ManagerPdfAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountMatchStatus, setAccountMatchStatus] = useState('');
  const [preferenceError, setPreferenceError] = useState('');
  const [preferenceStatus, setPreferenceStatus] = useState('');
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
  const [downloadDirectory, setDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const [savedDownloadDirectory, setSavedDownloadDirectory] = useState<PermissionedDirectoryHandle | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const livePreviewFrameRef = useRef<HTMLIFrameElement>(null);
  const lastMatchedNameRef = useRef('');
  const json = mode === 'resume' ? resumeJson : coverLetterJson;
  const isLiveTemplate = mode === 'resume' &&
    (template === 'qts_resume_1' || template === 'qts_resume_2' || template === 'qts_resume_3');
  const parsedResume = parseResumeJson(resumeJson);
  const parsedCoverLetter = parseCoverLetterJson(coverLetterJson);
  const accountFullName = mode === 'resume'
    ? parsedResume.resume?.candidate.fullName || ''
    : parsedCoverLetter.coverLetter?.candidate.fullName || '';
  const selectedAccount = accounts.find((account) => String(account.u_id) === selectedAccountId);
  const activeValidationError = mode === 'resume' ? parsedResume.error : parsedCoverLetter.error;
  const activeDocumentValid = mode === 'resume' ? Boolean(parsedResume.resume) : Boolean(parsedCoverLetter.coverLetter);
  const previewIsReady = mode === 'resume' && isLiveTemplate
    ? isLivePreviewReady && Boolean(renderedHtml)
    : Boolean(previewPdf) && !isLoading;

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
    if (!accountsLoaded || !accountFullName.trim()) return;
    const timeout = window.setTimeout(() => {
      const normalizedName = normalizeAccountName(accountFullName);
      const matchKey = `${mode}:${normalizedName}`;
      if (lastMatchedNameRef.current === matchKey) return;
      lastMatchedNameRef.current = matchKey;

      const matches = accounts.filter((account) => normalizeAccountName(account.name) === normalizedName);
      if (matches.length === 1) {
        const match = matches[0];
        setSelectedAccountId(String(match.u_id));
        const preferredTemplate = match.default_resume_template || 'qts_resume_2';
        setTemplate(preferredTemplate);
        const matchedResume = parseResumeJson(resumeJson).resume;
        if (matchedResume) setLiveResume(matchedResume);
        setIsLoading(mode === 'cover-letter' ||
          !['qts_resume_1', 'qts_resume_2', 'qts_resume_3'].includes(preferredTemplate));
        setIsLivePreviewReady(false);
        setRenderedHtml('');
        setPreviewUrl(null);
        setPreviewPdf(null);
        setDownloadUrl('');
        setSuggestedPath('');
        setAccountMatchStatus(`Matched Account: ${match.name}.`);
        setPreferenceError('');
        setPreferenceStatus('');
      } else {
        setSelectedAccountId('');
        setAccountMatchStatus(matches.length > 1
          ? `More than one Account matches “${accountFullName}”. Select the correct Account.`
          : `No Account matches “${accountFullName}”. Select an Account to use its saved resume template.`);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [accountFullName, accounts, accountsLoaded, mode, resumeJson]);

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
    if (mode !== 'resume' || isLiveTemplate) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const parsed = parseResumeJson(resumeJson);
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
  }, [isLiveTemplate, mode, resumeJson, template]);

  useEffect(() => {
    if (mode !== 'cover-letter') return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const parsed = parseCoverLetterJson(coverLetterJson);
      if (!parsed.coverLetter) {
        if (!cancelled) {
          setPreviewError(parsed.error || 'Enter valid cover-letter JSON to update the PDF.');
          setIsLoading(false);
        }
        return;
      }

      const result = await requestPdf(
        '/api/v2/resume-pdfs/cover-letter-preview',
        { coverLetter: parsed.coverLetter },
        controller.signal
      );
      if (cancelled) return;
      setIsLoading(false);
      if (!result.success || !result.pdf) {
        setPreviewError(result.message || 'Could not generate cover-letter preview.');
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
  }, [coverLetterJson, mode]);

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
    setPreferenceError('');
    setPreferenceStatus('');
    const account = accounts.find((item) => String(item.u_id) === accountId);
    if (account) {
      const preferredTemplate = account.default_resume_template || 'qts_resume_2';
      setTemplate(preferredTemplate);
      const parsed = parseResumeJson(resumeJson);
      if (parsed.resume) setLiveResume(parsed.resume);
      setIsLoading(mode === 'cover-letter' || !['qts_resume_1', 'qts_resume_2', 'qts_resume_3'].includes(preferredTemplate));
      setIsLivePreviewReady(false);
      setRenderedHtml('');
      setPreviewUrl(null);
      setPreviewPdf(null);
      setDownloadUrl('');
      setSuggestedPath('');
    }
  }

  async function selectResumeTemplate(nextTemplate: ResumeTemplate) {
    setTemplate(nextTemplate);
    setIsLoading(!['qts_resume_1', 'qts_resume_2', 'qts_resume_3'].includes(nextTemplate));
    const parsed = parseResumeJson(resumeJson);
    if (parsed.resume) setLiveResume(parsed.resume);
    setPreferenceError('');
    setPreferenceStatus('');
    setIsLivePreviewReady(false);
    setRenderedHtml('');
    setPreviewUrl(null);
    setPreviewPdf(null);
    setDownloadUrl('');
    setSuggestedPath('');

    if (!selectedAccount) return;
    const result = await api<{ success: boolean; resumeTemplate?: ResumeTemplate; message?: string }>(
      'PUT',
      `/api/v2/resume-pdfs/accounts/${selectedAccount.u_id}/preferences`,
      { resumeTemplate: nextTemplate }
    );
    if (!result.success) {
      setPreferenceError(result.message || 'Could not save the Account resume template preference.');
      return;
    }
    setAccounts((current) => current.map((account) => (
      account.u_id === selectedAccount.u_id
        ? { ...account, default_resume_template: nextTemplate }
        : account
    )));
    setPreferenceStatus(`Saved ${nextTemplate.replaceAll('_', ' ')} as ${selectedAccount.name}'s default resume template.`);
  }

  async function download() {
    const resume = mode === 'resume' ? parseResumeJson(resumeJson).resume : undefined;
    const coverLetter = mode === 'cover-letter' ? parseCoverLetterJson(coverLetterJson).coverLetter : undefined;
    const validationError = mode === 'resume'
      ? parseResumeJson(resumeJson).error
      : parseCoverLetterJson(coverLetterJson).error;
    if (!resume && !coverLetter) {
      setPreviewError(validationError || 'Enter valid JSON before downloading.');
      return;
    }
    if (savedDownloadDirectory && !downloadDirectory) {
      setDownloadError('Reconnect the saved download folder before downloading, or choose a different folder.');
      return;
    }
    if ((mode === 'resume' && !isLiveTemplate && (!previewUrl || !previewPdf || isLoading)) ||
        (mode === 'cover-letter' && (!previewPdf || isLoading)) || isDownloading) return;
    const documentData = resume ?? coverLetter;
    if (!documentData) {
      setDownloadError('Enter valid document JSON before downloading.');
      return;
    }
    const destination = getSuggestedPath(documentData, mode);
    setDownloadError('');
    setDownloadStatus('');
    setSuggestedPath(destination.relativePath);

    setIsDownloading(true);
    try {
      let pdf = previewPdf;
      if (mode === 'resume' && isLiveTemplate) {
        if (!isLivePreviewReady || !renderedHtml) {
          setDownloadError('The live resume preview is not ready to download yet.');
          return;
        }
        const result = await requestPdf('/api/v2/resume-pdfs/preview', {
          template,
          resume,
          renderedHtml,
        });
        if (!result.success || !result.pdf) {
          setDownloadError(result.message || 'Could not generate the matching PDF.');
          return;
        }
        pdf = result.pdf;
      } else if (coverLetter) {
        const result = await requestPdf('/api/v2/resume-pdfs/cover-letter-preview', { coverLetter });
        if (!result.success || !result.pdf) {
          setDownloadError(result.message || 'Could not generate the cover-letter PDF.');
          return;
        }
        pdf = result.pdf;
      }
      if (!pdf) {
        setDownloadError('The PDF preview is not ready to download yet.');
        return;
      }

      if (downloadDirectory) {
        let directory: FileSystemDirectoryHandle = downloadDirectory;
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
      if (isLiveTemplate || mode === 'cover-letter') {
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
      link.download = destination.fileName;
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
            <label htmlFor="resume-pdf-mode">Document type</label>
            <select
              id="resume-pdf-mode"
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as PdfMode;
                setMode(nextMode);
                setPreviewError('');
                setDownloadError('');
                setDownloadStatus('');
                setDownloadUrl('');
                setSuggestedPath('');
                setIsLoading(nextMode === 'cover-letter' || !['qts_resume_1', 'qts_resume_2', 'qts_resume_3'].includes(template));
                setIsLivePreviewReady(false);
                setRenderedHtml('');
              }}
            >
              <option value="resume">Resume</option>
              <option value="cover-letter">Cover Letter</option>
            </select>
          </div>

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
            {selectedAccount && <p className="text-muted">Selected Account: {selectedAccount.name}</p>}
          </div>

          {mode === 'resume' ? (
            <div className="form-group">
              <label htmlFor="resume-pdf-template">Resume template</label>
              <select
                id="resume-pdf-template"
                value={template}
                onChange={(event) => {
                  const selected = templates.find((item) => item.id === event.target.value);
                  if (selected) void selectResumeTemplate(selected.id);
                }}
              >
                {templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {selectedAccount && <p className="text-muted">This template is saved as the default for {selectedAccount.name}.</p>}
              {preferenceError && <div className="alert alert-error" role="alert">{preferenceError}</div>}
              {preferenceStatus && <p className="text-muted" role="status">{preferenceStatus}</p>}
            </div>
          ) : (
            <p className="text-muted">Template: QTS Cover Letter (standard).</p>
          )}

          <div className="form-group manager-pdfs__json-field">
            <label htmlFor="resume-pdf-json">{mode === 'resume' ? 'Resume JSON data' : 'Cover letter JSON data'}</label>
            <textarea
              id="resume-pdf-json"
              spellCheck={false}
              value={json}
              onChange={(event) => {
                const nextJson = event.target.value;
                if (mode === 'resume') {
                  setResumeJson(nextJson);
                  const parsed = parseResumeJson(nextJson);
                  if (parsed.resume && isLiveTemplate) setLiveResume(parsed.resume);
                  setPreviewError(parsed.error || '');
                  setLivePreviewError('');
                  setIsLivePreviewReady(false);
                  setRenderedHtml('');
                  setIsLoading(!isLiveTemplate);
                } else {
                  setCoverLetterJson(nextJson);
                  const parsed = parseCoverLetterJson(nextJson);
                  setPreviewError(parsed.error || '');
                  setIsLoading(true);
                }
                setDownloadUrl('');
                setSuggestedPath('');
                setDownloadError('');
                setDownloadStatus('');
              }}
            />
            <p className="text-muted">
              Paste JSON with <code>candidate.fullName</code> matching an Account’s full name to select it automatically.
              {mode === 'resume'
                ? ` The resume preview ${isLiveTemplate ? 'updates as you type.' : 'refreshes automatically.'}`
                : ' The cover-letter PDF preview refreshes automatically.'}
            </p>
          </div>
          {(activeValidationError || previewError) && <div className="alert alert-error" role="alert">{activeValidationError || previewError}</div>}
          <button className="btn btn-primary" type="button" onClick={download}
            disabled={!activeDocumentValid || !previewIsReady || isLoading || isDownloading || Boolean(activeValidationError || previewError)}>
            {isDownloading ? 'Generating PDF…' : isLoading ? 'Preparing preview…' : `Download ${mode === 'resume' ? 'Resume' : 'Cover Letter'} PDF`}
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
            <code>{suggestedPath || `Selected folder/${mode === 'resume' ? '$_QTS_Resume_$' : '$_QTS_Cover_Letter_$'}/…`}</code>
          </p>
          {!downloadDirectory && <p className="text-muted">Choose any folder on your computer; PDFs will be saved there in organized subfolders. The picker starts in Music for convenience, and your selected folder is remembered in this browser when supported.</p>}
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
          ) : (
            <ManagerPdfCanvasPreview key={previewUrl ?? 'empty-preview'} pdf={previewPdf} />
          )}
        </section>
      </div>
    </section>
  );
}
