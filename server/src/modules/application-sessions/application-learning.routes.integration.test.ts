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
let database: typeof import('../../database/connection');
let sessionId = 0;
let otherAccountSessionId = 0;
let reviewerToken = '';
let accountToken = '';

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-learning-api-db-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.APPLICATION_SESSION_PERSIST_DB = 'true';
  process.env.JWT_SECRET = 'isolated-learning-api-test-secret';
  process.env.NODE_ENV = 'test';

  database = await import('../../database/connection');
  await database.initDb();

  const uniqueSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ($1, $2, 'super', 'test-hash')
     RETURNING u_id`,
    [`learning-reviewer-${uniqueSeed}`, `Learning Reviewer ${uniqueSeed}`]
  );
  assert.ok(user);

  const account = await database.queryOne<{ id: number }>(
    `INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, 'test account', TRUE, NULL, NULL)
     RETURNING id`,
    [`Learning Test Account ${uniqueSeed}`]
  );
  assert.ok(account);

  const candidate = await database.queryOne<{ id: number }>(
    `INSERT INTO candidates (account_id, name, email, phone, is_active)
     VALUES ($1, $2, $3, '123-456-7890', TRUE)
     RETURNING id`,
    [account.id, `Learning Test Candidate ${uniqueSeed}`, `learning-${uniqueSeed}@example.test`]
  );
  assert.ok(candidate);

  const session = await database.queryOne<{ id: number }>(
    `INSERT INTO application_sessions (
      candidate_id, user_id, account_id, job_url, normalized_url, current_step, status
    ) VALUES (
      $1, $2, $3, 'https://apply.example.test/job', 'https://apply.example.test/job', 'scan', 'scanning'
    ) RETURNING id`,
    [candidate.id, user.u_id, account.id]
  );
  assert.ok(session);
  sessionId = Number(session.id);

  const otherAccount = await database.queryOne<{ id: number }>(
    `INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, 'other account', TRUE, NULL, NULL)
     RETURNING id`,
    [`Other Learning Test Account ${uniqueSeed}`]
  );
  assert.ok(otherAccount);

  const otherCandidate = await database.queryOne<{ id: number }>(
    `INSERT INTO candidates (account_id, name, email, phone, is_active)
     VALUES ($1, $2, $3, '123-456-7890', TRUE)
     RETURNING id`,
    [otherAccount.id, `Other Learning Candidate ${uniqueSeed}`, `other-${uniqueSeed}@example.test`]
  );
  assert.ok(otherCandidate);

  const otherSession = await database.queryOne<{ id: number }>(
    `INSERT INTO application_sessions (
      candidate_id, user_id, account_id, job_url, normalized_url, current_step, status
    ) VALUES (
      $1, $2, $3, 'https://other.apply.example.test/job', 'https://other.apply.example.test/job', 'scan', 'scanning'
    ) RETURNING id`,
    [otherCandidate.id, user.u_id, otherAccount.id]
  );
  assert.ok(otherSession);
  otherAccountSessionId = Number(otherSession.id);

  await database.execute(`
    INSERT INTO application_session_fields (
      session_id, stable_field_id, label, field_type, field_fingerprint,
      category, fill_value, fill_status
    ) VALUES ($1, 'other-account-field', 'Other account field', 'text', 'other-account-fingerprint',
      'candidate_profile', 'Private answer', 'filled')
  `, [otherAccountSessionId]);

  const [{ default: express }, { default: learningRouter }, { default: sessionsRouter }, { errorHandler }, jwtModule, { config }] =
    await Promise.all([
      import('express'),
      import('./application-learning.routes'),
      import('./application-sessions.routes'),
      import('../../middleware/error-handler'),
      import('jsonwebtoken'),
      import('../../config/env'),
    ]);

  reviewerToken = jwtModule.default.sign(
    { id: Number(user.u_id), username: `learning-reviewer-${uniqueSeed}`, role: 'super' },
    config.jwtSecret
  );
  accountToken = jwtModule.default.sign(
    {
      id: Number(user.u_id),
      username: `account-reviewer-${uniqueSeed}`,
      role: 'account',
      accountId: Number(account.id),
    },
    config.jwtSecret
  );

  const app = express();
  app.use(express.json());
  app.use('/api/application-sessions', sessionsRouter);
  app.use('/api/application-sessions', learningRouter);
  app.use(errorHandler as ErrorRequestHandler);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}/api/application-sessions`;

  await database.execute(`
    INSERT INTO application_session_fields (
      session_id, stable_field_id, label, field_type, field_fingerprint,
      category, fill_value, fill_status, section_heading
    ) VALUES
      ($1, 'reusable-name', 'First name', 'text', 'reusable-name-fingerprint',
       'candidate_profile', 'Alice', 'filled', 'Personal details'),
      ($1, 'manual-authorization', 'Work authorization', 'text', 'authorization-fingerprint',
       'candidate_profile', 'Yes', 'filled', 'Authorization')
  `, [sessionId]);
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
      await database.closeDb();
    } finally {
      if (temporaryDatabasePath) {
        await rm(temporaryDatabasePath, { recursive: true, force: true });
      }
    }
  }
});

async function request(
  route: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: Record<string, unknown>,
  authenticated = true,
): Promise<Response> {
  return fetch(`${serverUrl}${route}`, {
    method,
    headers: {
      ...(authenticated ? { Authorization: `Bearer ${reviewerToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function confirmation(fieldStableId: string, policyType: string, userApproved: boolean) {
  return {
    fieldStableId,
    question: fieldStableId === 'reusable-name' ? 'First name' : 'Work authorization',
    currentAnswer: fieldStableId === 'reusable-name' ? 'Alice' : 'Yes',
    editedAnswer: fieldStableId === 'reusable-name' ? 'Alice' : 'Yes',
    policyType,
    confidence: 0.9,
    userApproved,
    fieldType: 'text',
    sectionHeading: fieldStableId === 'reusable-name' ? 'Personal details' : 'Authorization',
  };
}

async function requestAsAccount(
  route: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${serverUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${accountToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it('saves learning decisions, removes reviewed fields from the queue, and gates blocked fields on patch', async () => {
  const unauthenticated = await request(`/${sessionId}/learning-queue`, 'GET', undefined, false);
  assert.equal(unauthenticated.status, 401);

  const initialQueueResponse = await request(`/${sessionId}/learning-queue`, 'GET');
  assert.equal(initialQueueResponse.status, 200);
  const initialQueue = await initialQueueResponse.json() as {
    success: boolean;
    queue: Array<{ stableFieldId: string; currentAnswer: string; sectionHeading: string }>;
  };
  assert.equal(initialQueue.success, true);
  assert.deepEqual(initialQueue.queue.map((field) => field.stableFieldId).sort(), [
    'manual-authorization',
    'reusable-name',
  ]);

  const reusableConfirmation = await request(
    `/${sessionId}/learning-confirmation`,
    'POST',
    confirmation('reusable-name', 'reusable_profile', true)
  );
  assert.equal(reusableConfirmation.status, 200);
  const reusableResult = await reusableConfirmation.json() as { success: boolean; policyType: string };
  assert.equal(reusableResult.success, true);
  assert.equal(reusableResult.policyType, 'reusable_profile');

  const afterConfirmationResponse = await request(`/${sessionId}/learning-queue`, 'GET');
  const afterConfirmation = await afterConfirmationResponse.json() as {
    queue: Array<{ stableFieldId: string; currentAnswer: string; sectionHeading: string }>;
  };
  assert.equal(afterConfirmation.queue.length, 1);
  assert.equal(afterConfirmation.queue[0].stableFieldId, 'manual-authorization');
  assert.equal(afterConfirmation.queue[0].currentAnswer, 'Yes');
  assert.equal(afterConfirmation.queue[0].sectionHeading, 'Authorization');

  const manualConfirmation = await request(
    `/${sessionId}/learning-confirmation`,
    'POST',
    confirmation('manual-authorization', 'manual_only', true)
  );
  assert.equal(manualConfirmation.status, 200);

  const patchResponse = await request(`/${sessionId}/fields`, 'PATCH', {
    fields: [
      {
        stableFieldId: 'reusable-name',
        label: 'First name',
        fieldType: 'text',
        fieldFingerprint: 'reusable-name-fingerprint',
        category: 'candidate_profile',
        currentValue: '',
        fillValue: 'Alice',
        fillStatus: 'filled',
        sectionHeading: 'Personal details',
      },
      {
        stableFieldId: 'manual-authorization',
        label: 'Work authorization',
        fieldType: 'text',
        fieldFingerprint: 'authorization-fingerprint',
        category: 'candidate_profile',
        currentValue: '',
        fillValue: 'Yes',
        fillStatus: 'filled',
        sectionHeading: 'Authorization',
      },
    ],
  });
  assert.equal(patchResponse.status, 200);
  const patchResult = await patchResponse.json() as {
    fields: Array<{
      stableFieldId: string;
      category: string;
      fillStatus: string;
      requiresReview: boolean;
    }>;
  };
  const reusableField = patchResult.fields.find((field) => field.stableFieldId === 'reusable-name');
  const blockedField = patchResult.fields.find((field) => field.stableFieldId === 'manual-authorization');
  assert.ok(reusableField);
  assert.equal(reusableField.category, 'candidate_profile');
  assert.equal(reusableField.requiresReview, false);
  assert.ok(blockedField);
  assert.equal(blockedField.category, 'needs_review');
  assert.equal(blockedField.fillStatus, 'needs_review');
  assert.equal(blockedField.requiresReview, true);
});

it('restricts learning reads and confirmations to the owning account', async () => {
  const ownQueue = await requestAsAccount(`/${sessionId}/learning-queue`, 'GET');
  assert.equal(ownQueue.status, 200);

  for (const route of [
    `/${otherAccountSessionId}/learning-summary`,
    `/${otherAccountSessionId}/learning-queue`,
    `/${otherAccountSessionId}/replay-confidence`,
  ]) {
    const response = await requestAsAccount(route, 'GET');
    assert.equal(response.status, 404, `Expected account-scoped read ${route} to be hidden`);
  }

  const deniedAssistDecision = await requestAsAccount(
    `/${otherAccountSessionId}/assist-decision`,
    'POST',
    { stableFieldId: 'other-account-field' }
  );
  assert.equal(deniedAssistDecision.status, 404);

  const deniedConfirmation = await requestAsAccount(
    `/${otherAccountSessionId}/learning-confirmation`,
    'POST',
    confirmation('cross-account-learning-write', 'reusable_profile', true)
  );
  assert.equal(deniedConfirmation.status, 404);

  const leakedMapping = await database.queryOne<{ id: number }>(
    `SELECT id
     FROM application_field_semantics
     WHERE source_session_id = $1
       AND stable_field_id = 'cross-account-learning-write'`,
    [otherAccountSessionId]
  );
  assert.equal(leakedMapping, null);
});
