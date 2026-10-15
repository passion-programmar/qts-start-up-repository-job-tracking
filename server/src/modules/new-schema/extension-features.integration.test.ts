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

type FeatureTestResponse = {
  success?: boolean;
  message?: string;
  managers?: unknown[];
  rules?: Array<{ id: string; text: string; textColor: string; backgroundColor: string }>;
  features?: { canManageTextHighlights: boolean; canUseScanner: boolean };
};

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-extension-features-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-extension-features-test-secret';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();
  const superUser = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('extension-features-super-test', 'Feature Super Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(superUser);
  const manager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('extension-features-manager-test', 'Feature Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  const otherManager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('extension-features-other-manager-test', 'Other Feature Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  const admin = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('extension-features-admin-test', 'Feature Admin Test', 'admin', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  assert.ok(manager);
  assert.ok(otherManager);
  assert.ok(admin);
  managerId = Number(manager.u_id);

  const [{ default: express }, { default: featureRouter }, jwtModule, { config }, { errorHandler }] = await Promise.all([
    import('express'),
    import('./extension-features.routes'),
    import('jsonwebtoken'),
    import('../../config/env'),
    import('../../middleware/error-handler'),
  ]);
  superToken = jwtModule.default.sign({ id: Number(superUser.u_id), schema: 'new' }, config.jwtSecret);
  managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);
  otherManagerToken = jwtModule.default.sign({ id: Number(otherManager.u_id), schema: 'new' }, config.jwtSecret);
  adminToken = jwtModule.default.sign({ id: Number(admin.u_id), schema: 'new' }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/v2/extension-features', featureRouter);
  app.use(errorHandler as ErrorRequestHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}/api/v2/extension-features`;
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
  return { response, body: await response.json() as FeatureTestResponse };
}

it('allows only Super to assign feature access to valid Managers', async () => {
  const assignments = await request('/assignments', superToken);
  assert.equal(assignments.response.status, 200);
  assert.equal(Array.isArray(assignments.body.managers), true);

  const denied = await request(`/assignments/${managerId}`, adminToken, 'PUT', {
    canManageTextHighlights: true,
    canUseScanner: true,
  });
  assert.equal(denied.response.status, 403);

  const invalidTarget = await request('/assignments/1', superToken, 'PUT', {
    canManageTextHighlights: true,
    canUseScanner: false,
  });
  assert.ok([400, 404].includes(invalidTarget.response.status));

  const saved = await request(`/assignments/${managerId}`, superToken, 'PUT', {
    canManageTextHighlights: true,
    canUseScanner: false,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.success, true);
});

it('serves shared highlight rules to all Managers while restricting CRUD by assignment', async () => {
  const deniedCreate = await request('/highlights', otherManagerToken, 'POST', {
    id: 'global-rule-test',
    text: 'Shared test phrase',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  });
  assert.equal(deniedCreate.response.status, 403);

  const created = await request('/highlights', managerToken, 'POST', {
    id: 'global-rule-test',
    text: 'Shared test phrase',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  });
  assert.equal(created.response.status, 201);

  const visibleToUnassigned = await request('/highlights', otherManagerToken);
  assert.equal(visibleToUnassigned.response.status, 200);
  assert.deepEqual(visibleToUnassigned.body.rules, [{
    id: 'global-rule-test',
    text: 'Shared test phrase',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  }]);
});

it('reports independent Manager permissions and revokes highlight CRUD immediately', async () => {
  const assignedPermissions = await request('/me', managerToken);
  assert.deepEqual(assignedPermissions.body.features, {
    canManageTextHighlights: true,
    canUseScanner: false,
  });

  const updated = await request('/highlights/global-rule-test', managerToken, 'PUT', {
    text: 'Updated shared phrase',
    textColor: '#223344',
    backgroundColor: '#bbccdd',
  });
  assert.equal(updated.response.status, 200);
  const updatedVisibleToUnassigned = await request('/highlights', otherManagerToken);
  assert.equal(updatedVisibleToUnassigned.body.rules?.[0]?.text, 'Updated shared phrase');

  const savedPermissions = await request(`/assignments/${managerId}`, superToken, 'PUT', {
    canManageTextHighlights: false,
    canUseScanner: true,
  });
  assert.equal(savedPermissions.response.status, 200);
  const revokedPermissions = await request('/me', managerToken);
  assert.deepEqual(revokedPermissions.body.features, {
    canManageTextHighlights: false,
    canUseScanner: true,
  });

  const deniedDelete = await request('/highlights/global-rule-test', managerToken, 'DELETE');
  assert.equal(deniedDelete.response.status, 403);
  const remainingRules = await request('/highlights', otherManagerToken);
  assert.equal(remainingRules.body.rules?.[0]?.text, 'Updated shared phrase');

  const deniedCreate = await request('/highlights', managerToken, 'POST', {
    id: 'revoked-rule',
    text: 'Revoked write',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  });
  assert.equal(deniedCreate.response.status, 403);
});

it('rejects non-Managers from shared highlight features', async () => {
  const permissions = await request('/me', adminToken);
  const rules = await request('/highlights', adminToken);
  assert.equal(permissions.response.status, 403);
  assert.equal(rules.response.status, 403);
});
