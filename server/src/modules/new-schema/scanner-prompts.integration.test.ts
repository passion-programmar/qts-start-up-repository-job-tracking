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
let superToken = '';
let managerToken = '';
let otherManagerToken = '';
let adminToken = '';
let managerId = 0;
let otherManagerId = 0;

type PromptResponse = {
  success?: boolean;
  message?: string;
  defaultPrompt?: string;
  prompt?: { id: number; name: string; content: string } | null;
  prompts?: Array<{ id: number; name: string; content: string }>;
};

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-scanner-prompts-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-scanner-prompts-test-secret';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();
  const superUser = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('scanner-prompts-super-test', 'Prompt Super Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(superUser);
  const manager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-prompts-manager-test', 'Prompt Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  const otherManager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-prompts-other-manager-test', 'Other Prompt Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  const admin = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-prompts-admin-test', 'Prompt Admin Test', 'admin', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  assert.ok(manager);
  assert.ok(otherManager);
  assert.ok(admin);
  managerId = Number(manager.u_id);
  otherManagerId = Number(otherManager.u_id);

  const [{ default: express }, { default: promptRouter }, jwtModule, { config }, { errorHandler }] = await Promise.all([
    import('express'),
    import('./scanner-prompts.routes'),
    import('jsonwebtoken'),
    import('../../config/env'),
    import('../../middleware/error-handler'),
  ]);
  superToken = jwtModule.default.sign({ id: Number(superUser.u_id), schema: 'new' }, config.jwtSecret);
  managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);
  otherManagerToken = jwtModule.default.sign({ id: otherManagerId, schema: 'new' }, config.jwtSecret);
  adminToken = jwtModule.default.sign({ id: Number(admin.u_id), schema: 'new' }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/v2/scanner-prompts', promptRouter);
  app.use(errorHandler as ErrorRequestHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}/api/v2/scanner-prompts`;
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

async function request(pathname: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${serverUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() as PromptResponse };
}

it('restricts prompt library management to Super', async () => {
  const deniedAdmin = await request('/', adminToken);
  const deniedManager = await request('/', managerToken);
  assert.equal(deniedAdmin.response.status, 403);
  assert.equal(deniedManager.response.status, 403);

  const created = await request('/', superToken, 'POST', {
    name: 'Engineering prompt',
    content: 'Write an accurate engineering resume.',
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.success, true);
  assert.equal(created.body.prompt?.content, 'Write an accurate engineering resume.');

  const duplicate = await request('/', superToken, 'POST', {
    name: 'ENGINEERING PROMPT',
    content: 'Duplicate prompt.',
  });
  assert.equal(duplicate.response.status, 409);
});

it('allows only Super to update the default Scanner instructions', async () => {
  const initial = await request('/', superToken);
  assert.equal(initial.response.status, 200);
  assert.equal(
    initial.body.defaultPrompt,
    'Write safe, concise, ATS-friendly application materials using only verified candidate profile information and the supplied job description.'
  );

  const denied = await request('/default', managerToken, 'PUT', {
    content: 'Manager should not change the global default.',
  });
  assert.equal(denied.response.status, 403);

  const invalid = await request('/default', superToken, 'PUT', { content: '   ' });
  assert.equal(invalid.response.status, 400);

  const saved = await request('/default', superToken, 'PUT', {
    content: 'Use the Super-configured global Scanner instructions.',
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.defaultPrompt, 'Use the Super-configured global Scanner instructions.');

  const reloaded = await request('/', superToken);
  assert.equal(reloaded.body.defaultPrompt, 'Use the Super-configured global Scanner instructions.');
});

it('allows one shared prompt per Manager, updates and unassigns it safely', async () => {
  const promptList = await request('/', superToken);
  assert.equal(promptList.response.status, 200);
  const sharedPrompt = promptList.body.prompts?.find((prompt) => prompt.name === 'Engineering prompt');
  assert.ok(sharedPrompt);

  const initialAssignment = await request('/assigned', managerToken);
  assert.equal(initialAssignment.response.status, 200);
  assert.equal(initialAssignment.body.prompt, null);

  const firstAssignment = await request(`/assignments/${managerId}`, superToken, 'PUT', {
    promptId: sharedPrompt.id,
  });
  const sharedAssignment = await request(`/assignments/${otherManagerId}`, superToken, 'PUT', {
    promptId: sharedPrompt.id,
  });
  assert.equal(firstAssignment.response.status, 200);
  assert.equal(sharedAssignment.response.status, 200);

  const assignedToManager = await request('/assigned', managerToken);
  assert.equal(assignedToManager.body.prompt?.id, sharedPrompt.id);

  const replacement = await request('/', superToken, 'POST', {
    name: 'Alternate prompt',
    content: 'Write a concise cover letter.',
  });
  assert.equal(replacement.response.status, 201);
  assert.ok(replacement.body.prompt);

  const updatedAssignment = await request(`/assignments/${managerId}`, superToken, 'PUT', {
    promptId: replacement.body.prompt.id,
  });
  assert.equal(updatedAssignment.response.status, 200);
  const current = await request('/assigned', managerToken);
  assert.equal(current.body.prompt?.id, replacement.body.prompt.id);

  const retainedSharedAssignment = await request('/assigned', otherManagerToken);
  assert.equal(retainedSharedAssignment.body.prompt?.id, sharedPrompt.id);
  const cannotDeleteAssigned = await request(`/${sharedPrompt.id}`, superToken, 'DELETE');
  assert.equal(cannotDeleteAssigned.response.status, 409);

  const unassigned = await request(`/assignments/${managerId}`, superToken, 'PUT', { promptId: null });
  assert.equal(unassigned.response.status, 200);
  const fallback = await request('/assigned', managerToken);
  assert.equal(fallback.body.prompt, null);
});
