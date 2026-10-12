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

it('keeps Scanner GPT generation scoped to the selected processing job and requires page acknowledgement', async () => {
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
      stableFieldId: 'scanner-resume-upload',
      label: 'Resume',
      fieldType: 'file',
      documentSlot: 'resume',
      required: true,
    }, {
      stableFieldId: 'scanner-cover-letter-upload',
      label: 'Cover letter',
      fieldType: 'file',
      documentSlot: 'cover_letter',
      required: true,
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

  const packageResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer isolated-scanner-rules-action-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      answers: [{ stableFieldId: 'scanner-generated-answer', answer: 'Reviewed test response.' }],
      unresolvedFields: [],
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
    }),
  });
  assert.equal(packageResponse.status, 200);

  for (const documentType of ['resume', 'cover_letter']) {
    const documentResponse = await fetch(
      `${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/documents/${documentType}`,
      { headers: { Authorization: `Bearer ${managerToken}` } }
    );
    assert.equal(documentResponse.status, 200);
    assert.match(documentResponse.headers.get('content-type') || '', /application\/pdf/i);
    assert.ok((await documentResponse.arrayBuffer()).byteLength > 0);
  }

  const acknowledgeResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/scanner-acknowledge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(acknowledgeResponse.status, 200);
  const acknowledged = await acknowledgeResponse.json() as { success: boolean; status: string };
  assert.equal(acknowledged.success, true);
  assert.equal(acknowledged.status, 'waiting_for_page');
});
