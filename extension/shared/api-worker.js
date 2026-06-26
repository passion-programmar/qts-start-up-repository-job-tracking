// Minimal API helpers for the service worker (GPT poll + document download).

const WORKER_DEFAULT_SERVER = 'https://qts-job-tracking.vercel.app';

async function workerReadAuth() {
  const stored = await chrome.storage.local.get(['authToken', 'serverUrl']);
  return {
    token: stored.authToken || '',
    serverUrl: String(stored.serverUrl || WORKER_DEFAULT_SERVER).replace(/\/$/, ''),
  };
}

async function workerApiRequest(method, path, body) {
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };

  const url = `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      return { success: false, message: 'Invalid server response.', _httpStatus: response.status };
    }
    if (!response.ok && data.success !== false) data.success = false;
    data._httpStatus = response.status;
    return data;
  } catch {
    return { success: false, message: 'Cannot connect to the server.' };
  }
}

async function workerFetchDocumentBase64(applicationId, docType) {
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };

  const url = `${serverUrl}/api/application-sessions/${applicationId}/documents/${encodeURIComponent(docType)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let message = `Document download failed (${response.status}).`;
      try {
        const err = await response.json();
        if (err.message) message = err.message;
      } catch {
        // ignore
      }
      return { success: false, message };
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    let fileName = docType === 'cover-letter' ? 'cover-letter.pdf' : 'resume.pdf';
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) fileName = match[1];

    return {
      success: true,
      fileName,
      mimeType: blob.type || 'application/pdf',
      base64: btoa(binary),
    };
  } catch {
    return { success: false, message: 'Cannot download document from server.' };
  }
}

function workerParseApplicationId(taskId) {
  const match = String(taskId || '').match(/^task_(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function workerInferFileDocumentType(field) {
  const slot = String(field.generatedAnswer || field.documentSlot || field.fillValue || '').toLowerCase();
  if (slot.includes('cover')) return 'cover-letter';
  const text = `${field.label || ''} ${field.nameAttr || ''} ${field.placeholder || ''}`.toLowerCase();
  if (/cover|message|letter/.test(text)) return 'cover-letter';
  return 'resume';
}

async function workerBuildFileUploadFields(applicationId, fields) {
  const fileFields = (fields || []).filter((field) => field.fieldType === 'file');
  const uploads = [];
  for (const field of fileFields) {
    const docType = workerInferFileDocumentType(field);
    const doc = await workerFetchDocumentBase64(applicationId, docType);
    if (!doc.success) {
      throw new Error(doc.message || `Could not load ${docType} PDF from server.`);
    }
    uploads.push({
      ...field,
      category: 'document_upload',
      fillStatus: 'filled',
      fillValue: doc.fileName,
      upload: {
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        base64: doc.base64,
      },
    });
  }
  return uploads;
}

if (typeof self !== 'undefined') {
  self.__qtsApiWorker = {
    workerApiRequest,
    workerFetchDocumentBase64,
    workerParseApplicationId,
    workerInferFileDocumentType,
    workerBuildFileUploadFields,
  };
}
