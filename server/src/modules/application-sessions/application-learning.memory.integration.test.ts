import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { Server } from 'node:http';
import type { ErrorRequestHandler } from 'express';

let server: Server | undefined;
let serverUrl = '';
let sessionId = 0;
let otherAccountSessionId = 0;
let accountToken = '';
let database: typeof import('../../database/connection');
let memoryStore: typeof import('../../services/application-session-store');
let learningStore: typeof import('../../services/application-learning-store');

before(async () => {
  process.env.APPLICATION_SESSION_PERSIST_DB = 'false';
  process.env.JWT_SECRET = 'in-memory-learning-test-secret';
  process.env.NODE_ENV = 'test';

  database = await import('../../database/connection');
  const [
    { default: express },
    { default: learningRouter },
    { default: sessionsRouter },
    { errorHandler },
    jwtModule,
    { config },
    loadedMemoryStore,
    loadedLearningStore,
  ] = await Promise.all([
    import('express'),
    import('./application-learning.routes'),
    import('./application-sessions.routes'),
    import('../../middleware/error-handler'),
    import('jsonwebtoken'),
    import('../../config/env'),
    import('../../services/application-session-store'),
    import('../../services/application-learning-store'),
  ]);
  memoryStore = loadedMemoryStore;
  learningStore = loadedLearningStore;

  const session = memoryStore.createMemoryApplicationSession({
    candidateId: 101,
    userId: 1,
    accountId: 501,
    jobUrl: 'https://apply.example.test/job',
    candidate: { name: 'In-memory candidate', email: 'memory@example.test' },
  });
  sessionId = session.id;
  memoryStore.upsertMemorySessionFields(sessionId, [{
    stableFieldId: 'memory-first-name',
    label: 'First name',
    fieldType: 'text',
    fieldFingerprint: 'memory-first-name-fingerprint',
    category: 'candidate_profile',
    fillValue: 'Alice',
    fillStatus: 'filled',
    sectionHeading: 'Personal details',
  }]);

  const otherAccountSession = memoryStore.createMemoryApplicationSession({
    candidateId: 102,
    userId: 1,
    accountId: 502,
    jobUrl: 'https://other.apply.example.test/job',
  });
  otherAccountSessionId = otherAccountSession.id;
  memoryStore.upsertMemorySessionFields(otherAccountSessionId, [{
    stableFieldId: 'other-account-field',
    label: 'Private field',
    fieldType: 'text',
    fieldFingerprint: 'other-account-field-fingerprint',
    category: 'candidate_profile',
    fillValue: 'Private answer',
    fillStatus: 'filled',
  }]);

  accountToken = jwtModule.default.sign(
    { id: 1, username: 'memory-account', role: 'account', accountId: 501 },
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
});

after(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await database.closeDb();
  }
});

async function request(
  route: string,
  method: 'GET' | 'POST' | 'PATCH',
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

it('supports learning review and the assist gate for account-scoped in-memory sessions', async () => {
  const initialQueueResponse = await request(`/${sessionId}/learning-queue`, 'GET');
  assert.equal(initialQueueResponse.status, 200);
  const initialQueue = await initialQueueResponse.json() as {
    success: boolean;
    queue: Array<{ stableFieldId: string; currentAnswer: string }>;
  };
  assert.equal(initialQueue.success, true);
  assert.deepEqual(initialQueue.queue.map((field) => field.stableFieldId), ['memory-first-name']);
  assert.equal(initialQueue.queue[0].currentAnswer, 'Alice');

  const confirmationResponse = await request(`/${sessionId}/learning-confirmation`, 'POST', {
    fieldStableId: 'memory-first-name',
    question: 'First name',
    currentAnswer: 'Alice',
    editedAnswer: 'Alice',
    policyType: 'reusable_profile',
    confidence: 0.9,
    userApproved: true,
    fieldType: 'text',
    sectionHeading: 'Personal details',
  });
  assert.equal(confirmationResponse.status, 200);

  const summaryResponse = await request(`/${sessionId}/learning-summary`, 'GET');
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json() as {
    summary: { totalFields: number; reusableProfileCount: number; confidenceAverage: number };
  };
  assert.equal(summary.summary.totalFields, 1);
  assert.equal(summary.summary.reusableProfileCount, 1);
  assert.ok(summary.summary.confidenceAverage >= 0.75);

  const replayResponse = await request(`/${sessionId}/replay-confidence`, 'GET');
  assert.equal(replayResponse.status, 200);
  const replay = await replayResponse.json() as {
    matches: Array<{ policyType: string; confidence: number }>;
  };
  assert.equal(replay.matches[0].policyType, 'reusable_profile');
  assert.ok(replay.matches[0].confidence >= 0.75);

  const assistDecisionResponse = await request(`/${sessionId}/assist-decision`, 'POST', {
    stableFieldId: 'memory-first-name',
    question: 'First name',
    fieldType: 'text',
    sectionHeading: 'Personal details',
  });
  assert.equal(assistDecisionResponse.status, 200);
  const assistDecision = await assistDecisionResponse.json() as {
    decision: { allowed: boolean; requiresReview: boolean };
  };
  assert.equal(assistDecision.decision.allowed, true);
  assert.equal(assistDecision.decision.requiresReview, false);

  const queueAfterDecisionResponse = await request(`/${sessionId}/learning-queue`, 'GET');
  const queueAfterDecision = await queueAfterDecisionResponse.json() as {
    queue: Array<{ stableFieldId: string }>;
  };
  assert.deepEqual(queueAfterDecision.queue, []);

  const patchResponse = await request(`/${sessionId}/fields`, 'PATCH', {
    fields: [{
      stableFieldId: 'memory-first-name',
      label: 'First name',
      fieldType: 'text',
      fieldFingerprint: 'memory-first-name-fingerprint',
      category: 'candidate_profile',
      currentValue: '',
      fillValue: 'Alice',
      fillStatus: 'filled',
      sectionHeading: 'Personal details',
    }],
  });
  assert.equal(patchResponse.status, 200);
  const patch = await patchResponse.json() as {
    fields: Array<{ stableFieldId: string; category: string; requiresReview: boolean }>;
  };
  assert.equal(patch.fields[0].stableFieldId, 'memory-first-name');
  assert.equal(patch.fields[0].category, 'candidate_profile');
  assert.equal(patch.fields[0].requiresReview, false);

  const deniedQueue = await request(`/${otherAccountSessionId}/learning-queue`, 'GET');
  assert.equal(deniedQueue.status, 404);
  const deniedConfirmation = await request(`/${otherAccountSessionId}/learning-confirmation`, 'POST', {
    fieldStableId: 'cross-account-memory-field',
    policyType: 'reusable_profile',
    confidence: 0.9,
  });
  assert.equal(deniedConfirmation.status, 404);
});

it('expires process-local learning data when its application session expires', async () => {
  const existingReplay = await learningStore.getReplayConfidence(sessionId);
  assert.equal(existingReplay.length, 1);

  const expiringSession = memoryStore.getMemoryApplicationSession(sessionId);
  assert.ok(expiringSession);
  expiringSession.last_activity_at = new Date(Date.now() - 4 * 60 * 60 * 1000 - 1).toISOString();

  memoryStore.createMemoryApplicationSession({
    candidateId: 103,
    userId: 1,
    accountId: 501,
    jobUrl: 'https://new.apply.example.test/job',
  });

  assert.equal(memoryStore.getMemoryApplicationSession(sessionId), null);
  assert.deepEqual(memoryStore.listMemorySessionFields(sessionId), []);
  assert.deepEqual(await learningStore.getReplayConfidence(sessionId), []);

  const expiredSessionQueue = await request(`/${sessionId}/learning-queue`, 'GET');
  assert.equal(expiredSessionQueue.status, 404);
});
