"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
let server;
let serverUrl = '';
let temporaryDatabasePath = '';
let closeDatabase;
let managerToken = '';
let managerId = 0;
let accountId = 0;
let jobId = 0;
const existingTaskId = 'task_00000000-0000-4000-8000-000000000001';
(0, node_test_1.before)(async () => {
    temporaryDatabasePath = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'qts-workable-disabled-test-'));
    process.env.EMBEDDED_PG = 'true';
    process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
    process.env.JWT_SECRET = 'isolated-workable-removal-test-secret';
    process.env.GPT_ACTION_API_KEY = 'isolated-workable-test-action-key';
    process.env.NODE_ENV = 'test';
    const database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    closeDatabase = database.closeDb;
    await database.initDb();
    const superUser = await database.queryOne(`INSERT INTO users (username, name, role, password_hash)
     VALUES ('workable-removal-super-test', 'Workable Removal Super Test', 'super', 'test-hash')
     RETURNING u_id`);
    strict_1.default.ok(superUser);
    const manager = await database.queryOne(`INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('workable-removal-manager-test', 'Workable Removal Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`, [superUser.u_id]);
    strict_1.default.ok(manager);
    managerId = Number(manager.u_id);
    const category = await database.queryOne(`INSERT INTO categories (category_title)
     VALUES ('Workable Removal Test Category') RETURNING category_id`);
    strict_1.default.ok(category);
    const account = await database.queryOne(`INSERT INTO users (
       username, name, role, parent_user_id, category_id, email, address, sex,
       birthday, phone, country, city
     ) VALUES (
       'workable-removal-account-test', 'Workable Removal Account Test', 'account',
       $1, $2, 'workable-test@example.invalid', 'Test Address', 'unspecified',
       '1990-01-01', '0000000000', 'Test Country', 'Test City'
     ) RETURNING u_id`, [managerId, category.category_id]);
    strict_1.default.ok(account);
    accountId = Number(account.u_id);
    const job = await database.queryOne(`INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://apply.workable.com/example/j/123', 'workable', 'Test Company', 'Test Role')
     RETURNING j_id`, [managerId]);
    strict_1.default.ok(job);
    jobId = Number(job.j_id);
    await database.execute(`INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`, [jobId, accountId]);
    const [{ default: express }, { default: jobsRouter }, { default: gptTasksRouter }, { errorHandler }, jwtModule, { config },] = await Promise.all([
        Promise.resolve().then(() => __importStar(require('express'))),
        Promise.resolve().then(() => __importStar(require('./jobs.routes'))),
        Promise.resolve().then(() => __importStar(require('./gpt-application-tasks.routes'))),
        Promise.resolve().then(() => __importStar(require('../../middleware/error-handler'))),
        Promise.resolve().then(() => __importStar(require('jsonwebtoken'))),
        Promise.resolve().then(() => __importStar(require('../../config/env'))),
    ]);
    managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);
    const app = express();
    app.use(express.json());
    app.use('/api/v2/jobs', jobsRouter);
    app.use('/api/v2/gpt-application-tasks', gptTasksRouter);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server?.once('error', reject);
        server?.once('listening', resolve);
    });
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
    serverUrl = `http://127.0.0.1:${address.port}`;
});
(0, node_test_1.after)(async () => {
    try {
        if (server?.listening) {
            await new Promise((resolve, reject) => {
                server?.close((error) => error ? reject(error) : resolve());
            });
        }
    }
    finally {
        try {
            await closeDatabase?.();
        }
        finally {
            if (temporaryDatabasePath) {
                await (0, promises_1.rm)(temporaryDatabasePath, { recursive: true, force: true });
            }
        }
    }
});
(0, node_test_1.it)('keeps Workable rows unclaimable and blocks their application context and GPT tasks', async () => {
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
    strict_1.default.equal(claimResponse.status, 200);
    strict_1.default.deepEqual(await claimResponse.json(), { success: true, claimed: false });
    const database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    const unclaimed = await database.queryOne('SELECT status FROM job_list WHERE j_id = $1', [jobId]);
    strict_1.default.equal(unclaimed?.status, 'todo');
    const supportedJob = await database.queryOne(`INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://boards.greenhouse.io/example/jobs/456', 'greenhouse.io', 'Test Company', 'Supported Role')
     RETURNING j_id`, [managerId]);
    strict_1.default.ok(supportedJob);
    await database.execute(`INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`, [supportedJob.j_id, accountId]);
    const otherSupportedJob = await database.queryOne(`INSERT INTO job_list (u_id, url, application_type, company, title)
     VALUES ($1, 'https://boards.greenhouse.io/example/jobs/789', 'greenhouse.io', 'Test Company', 'Other Supported Role')
     RETURNING j_id`, [managerId]);
    strict_1.default.ok(otherSupportedJob);
    await database.execute(`INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`, [otherSupportedJob.j_id, accountId]);
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
    const supportedClaim = await supportedClaimResponse.json();
    strict_1.default.equal(supportedClaimResponse.status, 200);
    strict_1.default.equal(supportedClaim.success, true);
    strict_1.default.equal(supportedClaim.claimed, true);
    strict_1.default.equal(supportedClaim.job?.id, Number(supportedJob.j_id));
    strict_1.default.equal(supportedClaim.job?.applicationType, 'greenhouse.io');
    const otherJobStatus = await database.queryOne('SELECT status FROM job_list WHERE j_id = $1', [otherSupportedJob.j_id]);
    strict_1.default.equal(otherJobStatus?.status, 'todo');
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
    const resumedClaim = await resumeResponse.json();
    strict_1.default.equal(resumeResponse.status, 200);
    strict_1.default.equal(resumedClaim.success, true);
    strict_1.default.equal(resumedClaim.claimed, true);
    strict_1.default.equal(resumedClaim.resumed, true);
    strict_1.default.equal(resumedClaim.job?.id, Number(supportedJob.j_id));
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
    strict_1.default.equal(conflictingRunResponse.status, 409);
    await database.execute('UPDATE job_list SET status = $1 WHERE j_id = $2', ['processing', jobId]);
    const contextResponse = await fetch(`${serverUrl}/api/v2/jobs/${jobId}/application-context`, {
        headers: { Authorization: `Bearer ${managerToken}` },
    });
    strict_1.default.equal(contextResponse.status, 404);
    const taskResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${jobId}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
    strict_1.default.equal(taskResponse.status, 404);
    await database.execute(`INSERT INTO gpt_application_tasks (task_id, job_id)
     VALUES ($1, $2)`, [existingTaskId, jobId]);
    const existingTaskResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${existingTaskId}/extension-status`, { headers: { Authorization: `Bearer ${managerToken}` } });
    strict_1.default.equal(existingTaskResponse.status, 404);
});
//# sourceMappingURL=jobs.routes.workable-disabled.integration.test.js.map