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
let managerId = 0;
let accountId = 0;
let jobId = 0;

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-workable-acceptance-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-workable-acceptance-test-secret';
  process.env.GPT_ACTION_API_KEY = 'isolated-workable-test-action-key';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();

  const superUser = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('workable-acceptance-super-test', 'Workable Acceptance Super Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(superUser);
  const manager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('workable-acceptance-manager-test', 'Workable Acceptance Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  assert.ok(manager);
  managerId = Number(manager.u_id);

  const category = await database.queryOne<{ category_id: number }>(
    `INSERT INTO categories (category_title)
     VALUES ('Workable Acceptance Category') RETURNING category_id`
  );
  assert.ok(category);
  const account = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (
       username, name, role, parent_user_id, category_id, email, address, sex,
       birthday, phone, country, city
     ) VALUES (
       'workable-acceptance-account-test', 'Workable Acceptance Account Test', 'account',
       $1, $2, 'workable-test@example.invalid', 'Test Address', 'unspecified',
       '1990-01-01', '0000000000', 'Test Country', 'Test City'
     ) RETURNING u_id`,
    [managerId, category.category_id]
  );
  assert.ok(account);
  accountId = Number(account.u_id);

  const job = await database.queryOne<{ j_id: number }>(
    `INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://apply.workable.com/example/j/123', 'workable', 'Test Company', 'Test Role')
     RETURNING j_id`,
    [managerId]
  );
  assert.ok(job);
  jobId = Number(job.j_id);
  await database.execute(
    `INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`,
    [jobId, accountId]
  );

  const [
    { default: express },
    { default: jobsRouter },
    { default: gptTasksRouter },
    { errorHandler },
    jwtModule,
    { config },
  ] = await Promise.all([
    import('express'),
    import('./jobs.routes'),
    import('./gpt-application-tasks.routes'),
    import('../../middleware/error-handler'),
    import('jsonwebtoken'),
    import('../../config/env'),
  ]);
  managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);

  const app = express();
  app.use(express.json());
  app.use('/api/v2/jobs', jobsRouter);
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
      if (temporaryDatabasePath) {
        await rm(temporaryDatabasePath, { recursive: true, force: true });
      }
    }
  }
});

it('allows Workable jobs to be claimed and used for application-context and GPT task flows', async () => {
  const claimResponse = await fetch(`${serverUrl}/api/v2/jobs/claim-next`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountUserId: accountId,
      applyRunId: '8b75db44-c7d4-4f57-b8d4-0a2a9c04dc76',
      supportedTypes: ['workable'],
    }),
  });
  assert.equal(claimResponse.status, 200);
  const claim = await claimResponse.json() as {
    success: boolean;
    claimed: boolean;
    job?: { id: number; applicationType: string };
  };
  assert.equal(claim.success, true);
  assert.equal(claim.claimed, true);
  assert.equal(claim.job?.id, jobId);
  assert.equal(claim.job?.applicationType, 'workable');

  const contextResponse = await fetch(`${serverUrl}/api/v2/jobs/${jobId}/application-context`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json() as {
    success: boolean;
    job?: { application_type?: string };
  };
  assert.equal(context.success, true);
  assert.equal(context.job?.application_type, 'workable');

  const taskResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${jobId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert.ok([200, 201].includes(taskResponse.status));
  const task = await taskResponse.json() as { success: boolean; taskId?: string };
  assert.equal(task.success, true);
  assert.ok(task.taskId);
});
