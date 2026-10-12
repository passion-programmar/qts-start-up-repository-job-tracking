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
let reviewerToken = '';
let adminToken = '';
let reviewerId = 0;

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-template-api-db-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-template-api-test-secret';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();

  const reviewer = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('template-reviewer-test', 'Template Reviewer Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(reviewer);
  reviewerId = Number(reviewer.u_id);

  const [{ default: express }, { default: templatesRouter }, { errorHandler }, jwtModule, { config }] =
    await Promise.all([
      import('express'),
      import('./application-templates.routes'),
      import('../../middleware/error-handler'),
      import('jsonwebtoken'),
      import('../../config/env'),
    ]);
  const jwt = jwtModule.default;
  reviewerToken = jwt.sign({ id: reviewerId, username: 'template-reviewer-test', role: 'super' }, config.jwtSecret);
  adminToken = jwt.sign({ id: reviewerId, username: 'template-reviewer-test', role: 'admin' }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/application-templates', templatesRouter);
  app.use(errorHandler as ErrorRequestHandler);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}/api/application-templates`;
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
      if (temporaryDatabasePath) {
        await rm(temporaryDatabasePath, { recursive: true, force: true });
      }
    }
  }
});

async function request(
  route: string,
  token?: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${serverUrl}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it('authorizes reviewers and persists failed and successful template validation reports', async () => {
  const unauthenticated = await request('/1/validate', undefined, {});
  assert.equal(unauthenticated.status, 401);

  const evidence = {
    observationSignatures: ['step-one', 'step-two'],
    validatedFieldIds: ['full-name'],
    authorizedTestEnvironmentConfirmed: true,
    manualReviewConfirmed: true,
    verificationReviewConfirmed: true,
  };
  const forbidden = await request('/1/validate', adminToken, evidence);
  assert.equal(forbidden.status, 403);

  const createResponse = await request('/from-discovery', reviewerToken, {
    siteKey: `template-api-test-${Date.now()}`,
    platform: 'test-ats',
    host: 'apply.example.test',
    status: 'partial',
    fields: [{
      fieldId: 'full-name',
      question: 'Full name',
      fieldType: 'text',
      required: true,
      matchMethod: 'stable_name',
      confidence: 0.95,
      status: 'matched',
      selectorHints: { name: 'fullName' },
    }],
    navigation: {
      discoveryCheckpoint: {
        steps: [
          { stepId: 'step-one', fields: [], fieldCount: 1 },
          { stepId: 'step-two', fields: [], fieldCount: 0 },
        ],
      },
    },
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { template: { id: number; status: string } };
  assert.equal(created.template.status, 'partial');

  const failedResponse = await request(`/${created.template.id}/validate`, reviewerToken, {
    ...evidence,
    observationSignatures: ['step-one', 'unobserved-step'],
  });
  assert.equal(failedResponse.status, 422);
  const failed = await failedResponse.json() as {
    template: { status: string; validationReport: { passed: boolean; unobservedSignatures: string[] } };
  };
  assert.equal(failed.template.status, 'partial');
  assert.equal(failed.template.validationReport.passed, false);
  assert.deepEqual(failed.template.validationReport.unobservedSignatures, ['unobserved-step']);

  const persistedResponse = await request(`/${created.template.id}`, reviewerToken);
  assert.equal(persistedResponse.status, 200);
  const persisted = await persistedResponse.json() as {
    template: { status: string; validationReport: { passed: boolean } };
  };
  assert.equal(persisted.template.status, 'partial');
  assert.equal(persisted.template.validationReport.passed, false);

  const promotedResponse = await request(`/${created.template.id}/validate`, reviewerToken, evidence);
  assert.equal(promotedResponse.status, 200);
  const promoted = await promotedResponse.json() as {
    template: { status: string; promotedBy: number; promotedAt: string | null; validationReport: { passed: boolean } };
  };
  assert.equal(promoted.template.status, 'active');
  assert.equal(promoted.template.promotedBy, reviewerId);
  assert.ok(promoted.template.promotedAt);
  assert.equal(promoted.template.validationReport.passed, true);
});
