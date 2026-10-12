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
let database;
let sessionId = 0;
let otherAccountSessionId = 0;
let reviewerToken = '';
let accountToken = '';
(0, node_test_1.before)(async () => {
    temporaryDatabasePath = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'qts-learning-api-db-'));
    process.env.EMBEDDED_PG = 'true';
    process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
    process.env.APPLICATION_SESSION_PERSIST_DB = 'true';
    process.env.JWT_SECRET = 'isolated-learning-api-test-secret';
    process.env.NODE_ENV = 'test';
    database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    await database.initDb();
    const uniqueSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await database.queryOne(`INSERT INTO users (username, name, role, password_hash)
     VALUES ($1, $2, 'super', 'test-hash')
     RETURNING u_id`, [`learning-reviewer-${uniqueSeed}`, `Learning Reviewer ${uniqueSeed}`]);
    strict_1.default.ok(user);
    const account = await database.queryOne(`INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, 'test account', TRUE, NULL, NULL)
     RETURNING id`, [`Learning Test Account ${uniqueSeed}`]);
    strict_1.default.ok(account);
    const candidate = await database.queryOne(`INSERT INTO candidates (account_id, name, email, phone, is_active)
     VALUES ($1, $2, $3, '123-456-7890', TRUE)
     RETURNING id`, [account.id, `Learning Test Candidate ${uniqueSeed}`, `learning-${uniqueSeed}@example.test`]);
    strict_1.default.ok(candidate);
    const session = await database.queryOne(`INSERT INTO application_sessions (
      candidate_id, user_id, account_id, job_url, normalized_url, current_step, status
    ) VALUES (
      $1, $2, $3, 'https://apply.example.test/job', 'https://apply.example.test/job', 'scan', 'scanning'
    ) RETURNING id`, [candidate.id, user.u_id, account.id]);
    strict_1.default.ok(session);
    sessionId = Number(session.id);
    const otherAccount = await database.queryOne(`INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, 'other account', TRUE, NULL, NULL)
     RETURNING id`, [`Other Learning Test Account ${uniqueSeed}`]);
    strict_1.default.ok(otherAccount);
    const otherCandidate = await database.queryOne(`INSERT INTO candidates (account_id, name, email, phone, is_active)
     VALUES ($1, $2, $3, '123-456-7890', TRUE)
     RETURNING id`, [otherAccount.id, `Other Learning Candidate ${uniqueSeed}`, `other-${uniqueSeed}@example.test`]);
    strict_1.default.ok(otherCandidate);
    const otherSession = await database.queryOne(`INSERT INTO application_sessions (
      candidate_id, user_id, account_id, job_url, normalized_url, current_step, status
    ) VALUES (
      $1, $2, $3, 'https://other.apply.example.test/job', 'https://other.apply.example.test/job', 'scan', 'scanning'
    ) RETURNING id`, [otherCandidate.id, user.u_id, otherAccount.id]);
    strict_1.default.ok(otherSession);
    otherAccountSessionId = Number(otherSession.id);
    await database.execute(`
    INSERT INTO application_session_fields (
      session_id, stable_field_id, label, field_type, field_fingerprint,
      category, fill_value, fill_status
    ) VALUES ($1, 'other-account-field', 'Other account field', 'text', 'other-account-fingerprint',
      'candidate_profile', 'Private answer', 'filled')
  `, [otherAccountSessionId]);
    const [{ default: express }, { default: learningRouter }, { default: sessionsRouter }, { errorHandler }, jwtModule, { config }] = await Promise.all([
        Promise.resolve().then(() => __importStar(require('express'))),
        Promise.resolve().then(() => __importStar(require('./application-learning.routes'))),
        Promise.resolve().then(() => __importStar(require('./application-sessions.routes'))),
        Promise.resolve().then(() => __importStar(require('../../middleware/error-handler'))),
        Promise.resolve().then(() => __importStar(require('jsonwebtoken'))),
        Promise.resolve().then(() => __importStar(require('../../config/env'))),
    ]);
    reviewerToken = jwtModule.default.sign({ id: Number(user.u_id), username: `learning-reviewer-${uniqueSeed}`, role: 'super' }, config.jwtSecret);
    accountToken = jwtModule.default.sign({
        id: Number(user.u_id),
        username: `account-reviewer-${uniqueSeed}`,
        role: 'account',
        accountId: Number(account.id),
    }, config.jwtSecret);
    const app = express();
    app.use(express.json());
    app.use('/api/application-sessions', sessionsRouter);
    app.use('/api/application-sessions', learningRouter);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server?.once('error', reject);
        server?.once('listening', resolve);
    });
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
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
            await database.closeDb();
        }
        finally {
            if (temporaryDatabasePath) {
                await (0, promises_1.rm)(temporaryDatabasePath, { recursive: true, force: true });
            }
        }
    }
});
async function request(route, method, body, authenticated = true) {
    return fetch(`${serverUrl}${route}`, {
        method,
        headers: {
            ...(authenticated ? { Authorization: `Bearer ${reviewerToken}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
function confirmation(fieldStableId, policyType, userApproved) {
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
async function requestAsAccount(route, method, body) {
    return fetch(`${serverUrl}${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${accountToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
(0, node_test_1.it)('saves learning decisions, removes reviewed fields from the queue, and gates blocked fields on patch', async () => {
    const unauthenticated = await request(`/${sessionId}/learning-queue`, 'GET', undefined, false);
    strict_1.default.equal(unauthenticated.status, 401);
    const initialQueueResponse = await request(`/${sessionId}/learning-queue`, 'GET');
    strict_1.default.equal(initialQueueResponse.status, 200);
    const initialQueue = await initialQueueResponse.json();
    strict_1.default.equal(initialQueue.success, true);
    strict_1.default.deepEqual(initialQueue.queue.map((field) => field.stableFieldId).sort(), [
        'manual-authorization',
        'reusable-name',
    ]);
    const reusableConfirmation = await request(`/${sessionId}/learning-confirmation`, 'POST', confirmation('reusable-name', 'reusable_profile', true));
    strict_1.default.equal(reusableConfirmation.status, 200);
    const reusableResult = await reusableConfirmation.json();
    strict_1.default.equal(reusableResult.success, true);
    strict_1.default.equal(reusableResult.policyType, 'reusable_profile');
    const afterConfirmationResponse = await request(`/${sessionId}/learning-queue`, 'GET');
    const afterConfirmation = await afterConfirmationResponse.json();
    strict_1.default.equal(afterConfirmation.queue.length, 1);
    strict_1.default.equal(afterConfirmation.queue[0].stableFieldId, 'manual-authorization');
    strict_1.default.equal(afterConfirmation.queue[0].currentAnswer, 'Yes');
    strict_1.default.equal(afterConfirmation.queue[0].sectionHeading, 'Authorization');
    const manualConfirmation = await request(`/${sessionId}/learning-confirmation`, 'POST', confirmation('manual-authorization', 'manual_only', true));
    strict_1.default.equal(manualConfirmation.status, 200);
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
    strict_1.default.equal(patchResponse.status, 200);
    const patchResult = await patchResponse.json();
    const reusableField = patchResult.fields.find((field) => field.stableFieldId === 'reusable-name');
    const blockedField = patchResult.fields.find((field) => field.stableFieldId === 'manual-authorization');
    strict_1.default.ok(reusableField);
    strict_1.default.equal(reusableField.category, 'candidate_profile');
    strict_1.default.equal(reusableField.requiresReview, false);
    strict_1.default.ok(blockedField);
    strict_1.default.equal(blockedField.category, 'needs_review');
    strict_1.default.equal(blockedField.fillStatus, 'needs_review');
    strict_1.default.equal(blockedField.requiresReview, true);
});
(0, node_test_1.it)('restricts learning reads and confirmations to the owning account', async () => {
    const ownQueue = await requestAsAccount(`/${sessionId}/learning-queue`, 'GET');
    strict_1.default.equal(ownQueue.status, 200);
    for (const route of [
        `/${otherAccountSessionId}/learning-summary`,
        `/${otherAccountSessionId}/learning-queue`,
        `/${otherAccountSessionId}/replay-confidence`,
    ]) {
        const response = await requestAsAccount(route, 'GET');
        strict_1.default.equal(response.status, 404, `Expected account-scoped read ${route} to be hidden`);
    }
    const deniedAssistDecision = await requestAsAccount(`/${otherAccountSessionId}/assist-decision`, 'POST', { stableFieldId: 'other-account-field' });
    strict_1.default.equal(deniedAssistDecision.status, 404);
    const deniedConfirmation = await requestAsAccount(`/${otherAccountSessionId}/learning-confirmation`, 'POST', confirmation('cross-account-learning-write', 'reusable_profile', true));
    strict_1.default.equal(deniedConfirmation.status, 404);
    const leakedMapping = await database.queryOne(`SELECT id
     FROM application_field_semantics
     WHERE source_session_id = $1
       AND stable_field_id = 'cross-account-learning-write'`, [otherAccountSessionId]);
    strict_1.default.equal(leakedMapping, null);
});
//# sourceMappingURL=application-learning.routes.integration.test.js.map