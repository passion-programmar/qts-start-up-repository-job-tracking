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
const existingTaskId = 'task_00000000-0000-4000-8000-000000000001';

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-workable-disabled-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.JWT_SECRET = 'isolated-workable-removal-test-secret';
  process.env.GPT_ACTION_API_KEY = 'isolated-workable-test-action-key';
  process.env.NODE_ENV = 'test';

  const database = await import('../../database/connection');
  closeDatabase = database.closeDb;
  await database.initDb();

  const superUser = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ('workable-removal-super-test', 'Workable Removal Super Test', 'super', 'test-hash')
     RETURNING u_id`
  );
  assert.ok(superUser);
  const manager = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('workable-removal-manager-test', 'Workable Removal Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`,
    [superUser.u_id]
  );
  assert.ok(manager);
  managerId = Number(manager.u_id);

  const category = await database.queryOne<{ category_id: number }>(
    `INSERT INTO categories (category_title)
     VALUES ('Workable Removal Test Category') RETURNING category_id`
  );
  assert.ok(category);
  const account = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (
       username, name, role, parent_user_id, category_id, email, address, sex,
       birthday, phone, country, city
     ) VALUES (
       'workable-removal-account-test', 'Workable Removal Account Test', 'account',
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

it('keeps Workable rows unclaimable and blocks their application context and GPT tasks', async () => {
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
  assert.deepEqual(await claimResponse.json(), { success: true, claimed: false });

  const database = await import('../../database/connection');
  const unclaimed = await database.queryOne<{ status: string }>(
    'SELECT status FROM job_list WHERE j_id = $1',
    [jobId]
  );
  assert.equal(unclaimed?.status, 'todo');

  const supportedJob = await database.queryOne<{ j_id: number }>(
    `INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://boards.greenhouse.io/example/jobs/456', 'greenhouse.io', 'Test Company', 'Supported Role')
     RETURNING j_id`,
    [managerId]
  );
  assert.ok(supportedJob);
  await database.execute(
    `INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`,
    [supportedJob.j_id, accountId]
  );
  const otherSupportedJob = await database.queryOne<{ j_id: number }>(
    `INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://boards.greenhouse.io/example/jobs/789', 'greenhouse.io', 'Test Company', 'Other Supported Role')
     RETURNING j_id`,
    [managerId]
  );
  assert.ok(otherSupportedJob);
  await database.execute(
    `INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`,
    [otherSupportedJob.j_id, accountId]
  );
  const supportedClaimResponse = await fetch(`${serverUrl}/api/v2/jobs/claim-next`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountUserId: accountId,
      applyRunId: '8b75db44-c7d4-4f57-b8d4-0a2a9c04dc76',
      supportedTypes: ['greenhouse.io'],
      jobId: Number(supportedJob.j_id),
    }),
  });
  const supportedClaim = await supportedClaimResponse.json() as {
    success: boolean;
    claimed: boolean;
    job?: { id: number; applicationType: string };
  };
  assert.equal(supportedClaimResponse.status, 200);
  assert.equal(supportedClaim.success, true);
  assert.equal(supportedClaim.claimed, true);
  assert.equal(supportedClaim.job?.id, Number(supportedJob.j_id));
  assert.equal(supportedClaim.job?.applicationType, 'greenhouse.io');
  const otherJobStatus = await database.queryOne<{ status: string }>(
    'SELECT status FROM job_list WHERE j_id = $1',
    [otherSupportedJob.j_id]
  );
  assert.equal(otherJobStatus?.status, 'todo');
  const resumeResponse = await fetch(`${serverUrl}/api/v2/jobs/claim-next`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountUserId: accountId,
      applyRunId: '8b75db44-c7d4-4f57-b8d4-0a2a9c04dc76',
      supportedTypes: ['greenhouse.io'],
      jobId: Number(supportedJob.j_id),
    }),
  });
  const resumedClaim = await resumeResponse.json() as {
    success: boolean;
    claimed: boolean;
    resumed?: boolean;
    job?: { id: number };
  };
  assert.equal(resumeResponse.status, 200);
  assert.equal(resumedClaim.success, true);
  assert.equal(resumedClaim.claimed, true);
  assert.equal(resumedClaim.resumed, true);
  assert.equal(resumedClaim.job?.id, Number(supportedJob.j_id));

  const conflictingRunResponse = await fetch(`${serverUrl}/api/v2/jobs/claim-next`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountUserId: accountId,
      applyRunId: '7cd489f0-3cb8-4e11-97b2-62345f7699a2',
      supportedTypes: ['greenhouse.io'],
      jobId: Number(supportedJob.j_id),
    }),
  });
  assert.equal(conflictingRunResponse.status, 409);

  await database.execute('UPDATE job_list SET status = $1 WHERE j_id = $2', ['processing', jobId]);

  const contextResponse = await fetch(`${serverUrl}/api/v2/jobs/${jobId}/application-context`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(contextResponse.status, 404);

  const taskResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${jobId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert.equal(taskResponse.status, 404);

  await database.execute(
    `INSERT INTO gpt_application_tasks (task_id, job_id)
     VALUES ($1, $2)`,
    [existingTaskId, jobId]
  );
  const existingTaskResponse = await fetch(
    `${serverUrl}/api/v2/gpt-application-tasks/${existingTaskId}/extension-status`,
    { headers: { Authorization: `Bearer ${managerToken}` } }
  );
  assert.equal(existingTaskResponse.status, 404);
});
