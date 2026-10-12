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
let server;
let serverUrl = '';
let sessionId = 0;
let otherAccountSessionId = 0;
let accountToken = '';
let database;
let memoryStore;
let learningStore;
(0, node_test_1.before)(async () => {
    process.env.APPLICATION_SESSION_PERSIST_DB = 'false';
    process.env.JWT_SECRET = 'in-memory-learning-test-secret';
    process.env.NODE_ENV = 'test';
    database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    const [{ default: express }, { default: learningRouter }, { default: sessionsRouter }, { errorHandler }, jwtModule, { config }, loadedMemoryStore, loadedLearningStore,] = await Promise.all([
        Promise.resolve().then(() => __importStar(require('express'))),
        Promise.resolve().then(() => __importStar(require('./application-learning.routes'))),
        Promise.resolve().then(() => __importStar(require('./application-sessions.routes'))),
        Promise.resolve().then(() => __importStar(require('../../middleware/error-handler'))),
        Promise.resolve().then(() => __importStar(require('jsonwebtoken'))),
        Promise.resolve().then(() => __importStar(require('../../config/env'))),
        Promise.resolve().then(() => __importStar(require('../../services/application-session-store'))),
        Promise.resolve().then(() => __importStar(require('../../services/application-learning-store'))),
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
    accountToken = jwtModule.default.sign({ id: 1, username: 'memory-account', role: 'account', accountId: 501 }, config.jwtSecret);
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
        await database.closeDb();
    }
});
async function request(route, method, body) {
    return fetch(`${serverUrl}${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${accountToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
(0, node_test_1.it)('supports learning review and the assist gate for account-scoped in-memory sessions', async () => {
    const initialQueueResponse = await request(`/${sessionId}/learning-queue`, 'GET');
    strict_1.default.equal(initialQueueResponse.status, 200);
    const initialQueue = await initialQueueResponse.json();
    strict_1.default.equal(initialQueue.success, true);
    strict_1.default.deepEqual(initialQueue.queue.map((field) => field.stableFieldId), ['memory-first-name']);
    strict_1.default.equal(initialQueue.queue[0].currentAnswer, 'Alice');
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
    strict_1.default.equal(confirmationResponse.status, 200);
    const summaryResponse = await request(`/${sessionId}/learning-summary`, 'GET');
    strict_1.default.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    strict_1.default.equal(summary.summary.totalFields, 1);
    strict_1.default.equal(summary.summary.reusableProfileCount, 1);
    strict_1.default.ok(summary.summary.confidenceAverage >= 0.75);
    const replayResponse = await request(`/${sessionId}/replay-confidence`, 'GET');
    strict_1.default.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    strict_1.default.equal(replay.matches[0].policyType, 'reusable_profile');
    strict_1.default.ok(replay.matches[0].confidence >= 0.75);
    const assistDecisionResponse = await request(`/${sessionId}/assist-decision`, 'POST', {
        stableFieldId: 'memory-first-name',
        question: 'First name',
        fieldType: 'text',
        sectionHeading: 'Personal details',
    });
    strict_1.default.equal(assistDecisionResponse.status, 200);
    const assistDecision = await assistDecisionResponse.json();
    strict_1.default.equal(assistDecision.decision.allowed, true);
    strict_1.default.equal(assistDecision.decision.requiresReview, false);
    const queueAfterDecisionResponse = await request(`/${sessionId}/learning-queue`, 'GET');
    const queueAfterDecision = await queueAfterDecisionResponse.json();
    strict_1.default.deepEqual(queueAfterDecision.queue, []);
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
    strict_1.default.equal(patchResponse.status, 200);
    const patch = await patchResponse.json();
    strict_1.default.equal(patch.fields[0].stableFieldId, 'memory-first-name');
    strict_1.default.equal(patch.fields[0].category, 'candidate_profile');
    strict_1.default.equal(patch.fields[0].requiresReview, false);
    const deniedQueue = await request(`/${otherAccountSessionId}/learning-queue`, 'GET');
    strict_1.default.equal(deniedQueue.status, 404);
    const deniedConfirmation = await request(`/${otherAccountSessionId}/learning-confirmation`, 'POST', {
        fieldStableId: 'cross-account-memory-field',
        policyType: 'reusable_profile',
        confidence: 0.9,
    });
    strict_1.default.equal(deniedConfirmation.status, 404);
});
(0, node_test_1.it)('expires process-local learning data when its application session expires', async () => {
    const existingReplay = await learningStore.getReplayConfidence(sessionId);
    strict_1.default.equal(existingReplay.length, 1);
    const expiringSession = memoryStore.getMemoryApplicationSession(sessionId);
    strict_1.default.ok(expiringSession);
    expiringSession.last_activity_at = new Date(Date.now() - 4 * 60 * 60 * 1000 - 1).toISOString();
    memoryStore.createMemoryApplicationSession({
        candidateId: 103,
        userId: 1,
        accountId: 501,
        jobUrl: 'https://new.apply.example.test/job',
    });
    strict_1.default.equal(memoryStore.getMemoryApplicationSession(sessionId), null);
    strict_1.default.deepEqual(memoryStore.listMemorySessionFields(sessionId), []);
    strict_1.default.deepEqual(await learningStore.getReplayConfidence(sessionId), []);
    const expiredSessionQueue = await request(`/${sessionId}/learning-queue`, 'GET');
    strict_1.default.equal(expiredSessionQueue.status, 404);
});
//# sourceMappingURL=application-learning.memory.integration.test.js.map