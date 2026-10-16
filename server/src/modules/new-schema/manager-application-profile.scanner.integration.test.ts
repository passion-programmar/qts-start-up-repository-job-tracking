import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { Server } from 'node:http';
import type { ErrorRequestHandler } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let server: Server | undefined;
let serverUrl = '';
let temporaryDatabasePath = '';
let closeDatabase: (() => Promise<void>) | undefined;
let managerToken = '';
let otherManagerToken = '';
let accountToken = '';
let templateId = 0;
let managerId = 0;
let processingJobId = 0;

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-scanner-rules-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-scanner-rules-test-secret';
  process.env.GPT_ACTION_API_KEY = 'isolated-scanner-rules-action-secret';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();

  const superUser = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('scanner-rules-super-test', 'Scanner Rules Super Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(superUser);
  const manager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-rules-manager-test', 'Scanner Rules Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  const otherManager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-rules-other-manager-test', 'Scanner Rules Other Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  assert.ok(manager);
  assert.ok(otherManager);
  managerId = Number(manager.u_id);
  await database.execute(
    `INSERT INTO manager_extension_feature_assignments (manager_user_id, feature_key, assigned_by)
     VALUES ($1, 'job_site_scanner', $2), ($3, 'job_site_scanner', $2)`,
    [managerId, Number(superUser.u_id), Number(otherManager.u_id)]
  );

  const category = await database.queryOne<{ category_id: number }>(
    `INSERT INTO categories (category_title)
     VALUES ('Scanner Rules Test Category')
     RETURNING category_id`
  );
  assert.ok(category);
  const account = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (
       username, name, role, password_hash, parent_user_id, email, address, sex,
       birthday, phone, country, city, category_id
     ) VALUES (
       'scanner-rules-account-test', 'Scanner Rules Account Test', 'account', NULL,
       $1, 'scanner-test@example.invalid', 'Test Address', 'unspecified',
       '1990-01-01', '0000000000', 'Test Country', 'Test City', $2
     ) RETURNING u_id`,
    [managerId, category.category_id]
  );
  assert.ok(account);

  const template = await database.queryOne<{ template_id: number }>(
    `INSERT INTO application_site_templates (site_key, platform, host, template_version, status)
     VALUES ('generic:scanner.example', 'generic', 'scanner.example', 'scanner-test-v1', 'partial')
     RETURNING template_id`
  );
  assert.ok(template);
  templateId = Number(template.template_id);
  const job = await database.queryOne<{ j_id: number }>(
    `INSERT INTO job_list (u_id, url, application_type, company, title, status)
     VALUES ($1, 'https://scanner.example/apply', 'scanner.example', 'Scanner Test Company', 'Scanner Test Job', 'processing')
     RETURNING j_id`,
    [managerId]
  );
  assert.ok(job);
  processingJobId = Number(job.j_id);
  await database.execute(
    `INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`,
    [processingJobId, account.u_id]
  );

  const [{ default: express }, { default: profileRouter }, { default: gptTasksRouter }, { errorHandler }, jwtModule, { config }] = await Promise.all([
    import('express'),
    import('./manager-application-profile.routes'),
    import('./gpt-application-tasks.routes'),
    import('../../middleware/error-handler'),
    import('jsonwebtoken'),
    import('../../config/env'),
  ]);
  managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);
  otherManagerToken = jwtModule.default.sign({ id: Number(otherManager.u_id), schema: 'new' }, config.jwtSecret);
  accountToken = jwtModule.default.sign({ id: Number(account.u_id), schema: 'new' }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/v2/manager-application-profile', profileRouter);
  app.use('/api/v2/gpt-application-tasks', gptTasksRouter);
  app.use(errorHandler as ErrorRequestHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    try {
      await closeDatabase?.();
    } finally {
      if (temporaryDatabasePath) await rm(temporaryDatabasePath, { recursive: true, force: true });
    }
  }
});

it('auto-creates a missing template record when a manager saves scanner rules', async () => {
  const missingTemplateId = templateId + 1000;
  const createResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: missingTemplateId,
      fieldId: 'missing-template-field',
      semanticKey: 'missing template bootstrap',
      question: 'This should bootstrap a temporary template row.',
      strategy: 'manual',
    }),
  });

  assert.equal(createResponse.status, 200);
  const created = await createResponse.json() as { success: boolean; rule: { template_id: number } };
  assert.equal(created.success, true);
  assert.equal(created.rule.template_id, missingTemplateId);

  const database = await import('../../database/connection');
  const template = await database.queryOne<{ template_id: number }>(
    'SELECT template_id FROM application_site_templates WHERE template_id = $1',
    [missingTemplateId]
  );
  assert.ok(template);
  assert.equal(Number(template.template_id), missingTemplateId);
  const nextTemplate = await database.queryOne<{ template_id: number }>(
    `INSERT INTO application_site_templates (site_key, template_version)
     VALUES ('scanner-sequence-test', 'scanner-sequence-v1')
     RETURNING template_id`
  );
  assert.ok(nextTemplate);
  assert.ok(Number(nextTemplate.template_id) > missingTemplateId);
});

it('saves reusable question/answers with Manager-scoped template rules and keeps revisions', async () => {
  const scannerObservation = {
    label: 'Are you willing to relocate to Japan?',
    fieldType: 'select',
    required: true,
    options: ['Yes', 'No'],
    section: 'Location',
    selectorHints: { tag: 'select', name: 'relocation' },
    domEvidence: {
      control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
      ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
    },
  };
  const createResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId,
      fieldId: 'relocation-question',
      semanticKey: 'relocation willingness',
      question: 'Are you willing to relocate to Japan?',
      strategy: 'reusable',
      reusableAnswer: 'Yes, I am willing to relocate.',
      context: { destination: 'Japan' },
      fieldSnapshot: {
        fieldType: 'select',
        required: true,
        options: ['Yes', 'No'],
        section: 'Location',
        selectorHints: { tag: 'select', name: 'relocation' },
        domEvidence: {
          control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
          ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
        },
        captureCount: 2,
        captureVerified: true,
        managerReviewed: false,
        observations: [
          {
            selectorHints: { tag: 'select', name: 'relocation' },
            domEvidence: {
              control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
              ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
            },
          },
          {
            selectorHints: { tag: 'select', name: 'relocation' },
            domEvidence: {
              control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
              ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
            },
          },
        ],
        fieldSnapshots: [scannerObservation, scannerObservation],
      },
    }),
  });
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json() as {
    success: boolean;
    rule: { reusable_answer_id: number; semantic_key: string };
  };
  assert.equal(created.success, true);
  assert.ok(created.rule.reusable_answer_id > 0);

  const updateResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId,
      fieldId: 'relocation-question',
      semanticKey: created.rule.semantic_key,
      question: 'Are you willing to relocate to Canada?',
      strategy: 'reusable',
      reusableAnswerId: created.rule.reusable_answer_id,
      context: { destination: 'Canada' },
      fieldSnapshot: { fieldType: 'select', required: true, options: ['Yes', 'No'], section: 'Location' },
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json() as {
    success: boolean;
    rule: { history: Array<unknown>; reusable_answer_id: number };
  };
  assert.equal(updated.success, true);
  assert.equal(updated.rule.reusable_answer_id, created.rule.reusable_answer_id);
  assert.equal(updated.rule.history.length, 1);

  const listResponse = await fetch(
    `${serverUrl}/api/v2/manager-application-profile/scanner-rules/${templateId}`,
    { headers: { Authorization: `Bearer ${managerToken}` } }
  );
  const listed = await listResponse.json() as {
    success: boolean;
    rules: Array<{ reusable_answer: string; question: string; context: Record<string, string> }>;
  };
  assert.equal(listed.success, true);
  assert.equal(listed.rules.length, 1);
  assert.equal(listed.rules[0].reusable_answer, 'Yes, I am willing to relocate.');
  assert.equal(listed.rules[0].question, 'Are you willing to relocate to Canada?');
  assert.equal(listed.rules[0].context.destination, 'Canada');

  const evidenceUpdateResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules/evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId,
      fieldId: 'relocation-question',
      fieldSnapshot: {
        fieldType: 'select',
        required: true,
        options: ['Yes', 'No'],
        section: 'Location',
        selectorHints: { tag: 'select', name: 'relocation' },
        domEvidence: {
          control: { tag: 'select', role: '', classNames: ['application-select-v2'], testId: '', automationId: '' },
          ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
        },
        captureCount: 2,
        captureVerified: true,
        managerReviewed: false,
        observations: [
          {
            selectorHints: { tag: 'select', name: 'relocation' },
            domEvidence: {
              control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
              ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
            },
          },
          {
            selectorHints: { tag: 'select', name: 'relocation' },
            domEvidence: {
              control: { tag: 'select', role: '', classNames: ['application-select-v2'], testId: '', automationId: '' },
              ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
            },
          },
        ],
        fieldSnapshots: [
          scannerObservation,
          { ...scannerObservation, label: 'Are you willing to relocate to Canada?' },
        ],
      },
    }),
  });
  assert.equal(evidenceUpdateResponse.status, 200);
  const evidenceUpdate = await evidenceUpdateResponse.json() as { success: boolean; updated: boolean };
  assert.deepEqual(evidenceUpdate, { success: true, updated: true });

  const database = await import('../../database/connection');
  const savedAnswers = await database.queryAll<{ custom_answer_id: number }>(
    `SELECT custom_answer_id FROM manager_custom_application_answers
     WHERE manager_user_id = $1 AND topic = 'relocation willingness'`,
    [managerId]
  );
  assert.equal(savedAnswers.length, 1);
});

it('rejects non-Manager writes and prevents reading another Manager’s rules', async () => {
  const deniedWrite = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accountToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId,
      fieldId: 'unauthorized-field',
      semanticKey: 'unauthorized',
      question: 'Unauthorized question?',
      strategy: 'manual',
    }),
  });
  assert.equal(deniedWrite.status, 403);

  const otherManagerRules = await fetch(
    `${serverUrl}/api/v2/manager-application-profile/scanner-rules/${templateId}`,
    { headers: { Authorization: `Bearer ${otherManagerToken}` } }
  );
  const response = await otherManagerRules.json() as { success: boolean; rules: unknown[] };
  assert.equal(response.success, true);
  assert.deepEqual(response.rules, []);
});

it('keeps Scanner GPT generation scoped to the selected job and accepts documents without page upload fields', async () => {
  const createResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${processingJobId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourcePlatform: 'scanner.example' }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { success: boolean; taskId: string; status: string };
  assert.equal(created.success, true);
  assert.equal(created.status, 'waiting_for_page');

  const page = {
    pageUrl: 'https://scanner.example/apply',
    pageTitle: 'Scanner Test Job',
    pageNumber: 1,
    fields: [{
      stableFieldId: 'scanner-generated-answer',
      label: 'Why are you interested in this role?',
      fieldType: 'textarea',
      required: true,
      manualReview: true,
    }, {
      stableFieldId: 'scanner-unresolved-answer',
      label: 'How do your skills fit this position?',
      fieldType: 'textarea',
      required: true,
      manualReview: true,
    }],
    jobDescription: 'A test role description.',
  };
  const pageResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/page`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(page),
  });
  assert.equal(pageResponse.status, 200);

  const activeStatusResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/extension-status`,
    { headers: { Authorization: `Bearer ${managerToken}` } }
  );
  const activeStatus = await activeStatusResponse.json() as {
    success: boolean;
    status: string;
    page: { pageUrl: string; fields: Array<{ stableFieldId: string }> };
  };
  assert.equal(activeStatus.success, true);
  assert.equal(activeStatus.status, 'waiting_for_gpt');
  assert.equal(activeStatus.page.pageUrl, page.pageUrl);
  assert.equal(activeStatus.page.fields[0].stableFieldId, 'scanner-generated-answer');

  const refreshWhileActive = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${processingJobId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourcePlatform: 'scanner.example', jobDescription: 'Must not replace active task context.' }),
  });
  assert.equal(refreshWhileActive.status, 409);
  const activeTaskConflict = await refreshWhileActive.json() as { taskId: string; status: string };
  assert.equal(activeTaskConflict.taskId, created.taskId);
  assert.equal(activeTaskConflict.status, 'waiting_for_gpt');

  const overwritePage = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/page`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...page, pageNumber: 2 }),
  });
  assert.equal(overwritePage.status, 409);

  const packagePayload = {
    answers: [{ stableFieldId: 'scanner-generated-answer', answer: 'Reviewed test response.' }],
    unresolvedFields: [{
      stableFieldId: 'scanner-unresolved-answer',
      question: 'How do your skills fit this position?',
      reason: 'The response needs additional candidate-specific detail.',
    }],
    notes: 'Generated for the selected processing job.',
    resume: {
      candidate: { fullName: 'Scanner Test Account', email: 'scanner-test@example.invalid' },
      targetRole: 'Scanner Test Role',
      targetCompany: 'Scanner Test Company',
      sections: [{ title: 'Experience', items: [{ heading: 'Test Employer', bullets: ['Delivered test work.'] }] }],
    },
    coverLetter: {
      candidate: { fullName: 'Scanner Test Account', email: 'scanner-test@example.invalid' },
      targetRole: 'Scanner Test Role',
      targetCompany: 'Scanner Test Company',
      bodyParagraphs: ['I am interested in the Scanner Test Role.'],
    },
  };
  const invalidUnresolvedResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...packagePayload,
        unresolvedFields: [{
          ...packagePayload.unresolvedFields[0],
          stableFieldId: 'scanner-field-from-another-page',
        }],
      }),
    }
  );
  assert.equal(invalidUnresolvedResponse.status, 400);

  const packageResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer isolated-scanner-rules-action-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(packagePayload),
  });
  const acceptedPackage = await packageResponse.json() as { status?: string; message?: string };
  assert.equal(packageResponse.status, 200, acceptedPackage.message);
  assert.equal(acceptedPackage.status, 'waiting_for_gpt');

  const unchangedPackageResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(packagePayload),
    }
  );
  assert.equal(unchangedPackageResponse.status, 200);
  const unchangedPackage = await unchangedPackageResponse.json() as { idempotentReplay: boolean };
  assert.equal(unchangedPackage.idempotentReplay, true);

  const conflictingReplayResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...packagePayload, notes: 'Conflicting package.' }),
    }
  );
  assert.equal(conflictingReplayResponse.status, 409);

  const idempotentReplayResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(packagePayload),
    }
  );
  assert.equal(idempotentReplayResponse.status, 200);
  const replayedPackage = await idempotentReplayResponse.json() as {
    idempotentReplay: boolean;
    status: string;
  };
  assert.equal(replayedPackage.idempotentReplay, true);
  assert.equal(replayedPackage.status, 'waiting_for_gpt');

  for (const documentType of ['resume', 'cover_letter']) {
    const documentResponse = await fetch(
      `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/documents/${documentType}`,
      { headers: { Authorization: `Bearer ${managerToken}` } }
    );
    assert.equal(documentResponse.status, 200);
    assert.match(documentResponse.headers.get('content-type') || '', /application\/pdf/i);
    assert.ok((await documentResponse.arrayBuffer()).byteLength > 0);
  }

  const downloadPaths = [{
    documentType: 'resume',
    fileName: 'Scanner_Test_Account.pdf',
    localPath: 'Downloads/QTS_Startup/Scanner Manager/Scanner Test Account/2026-10-15_Test Job_Test Company/Scanner_Test_Account.pdf',
  }];
  const saveDownloadPathsResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/downloads`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ documents: downloadPaths }),
    }
  );
  assert.equal(saveDownloadPathsResponse.status, 200);
  const coverLetterPathResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/downloads`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documents: [{
          documentType: 'cover_letter',
          fileName: 'Scanner_Test_Account_Cover_Letter.pdf',
          localPath: 'Downloads/QTS_Startup/Scanner Manager/Scanner Test Account/Cover_Letter.pdf',
        }],
      }),
    }
  );
  assert.equal(coverLetterPathResponse.status, 400);
  const savedDownloadPathsResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/downloads`,
    { headers: { Authorization: `Bearer ${managerToken}` } }
  );
  const savedDownloadPaths = await savedDownloadPathsResponse.json() as {
    success: boolean;
    downloads: Array<{ document_type: string; local_path: string }>;
  };
  assert.equal(savedDownloadPathsResponse.status, 200);
  assert.equal(savedDownloadPaths.success, true);
  assert.deepEqual(
    savedDownloadPaths.downloads.map(({ document_type, local_path }) => ({ document_type, local_path })),
    downloadPaths.map(({ documentType, localPath }) => ({
      document_type: documentType,
      local_path: localPath,
    }))
  );

  const acknowledgeResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/scanner-acknowledge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(acknowledgeResponse.status, 200);
  const acknowledged = await acknowledgeResponse.json() as { success: boolean; status: string };
  assert.equal(acknowledged.success, true);
  assert.equal(acknowledged.status, 'waiting_for_page');

  const nextPageResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/page`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...page,
        pageNumber: 2,
        fields: [{
          stableFieldId: 'scanner-generated-answer-page-two',
          label: 'What interests you about this company?',
          fieldType: 'textarea',
          required: true,
          manualReview: true,
        }],
      }),
    }
  );
  assert.equal(nextPageResponse.status, 200);
  const nextPageStatusResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/extension-status`,
    { headers: { Authorization: `Bearer ${managerToken}` } }
  );
  const nextPageStatus = await nextPageStatusResponse.json() as {
    success: boolean;
    pageNumber: number;
    package: Record<string, unknown>;
    previousUnresolvedFields: Array<{ stableFieldId: string; question: string; reason: string }>;
  };
  assert.equal(nextPageStatus.success, true);
  assert.equal(nextPageStatus.pageNumber, 2);
  assert.deepEqual(nextPageStatus.package, {});
  assert.deepEqual(nextPageStatus.previousUnresolvedFields, packagePayload.unresolvedFields);
});
