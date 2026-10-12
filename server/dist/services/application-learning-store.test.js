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
let temporaryDatabasePath = '';
let sessionId = 0;
let database;
let learningStore;
(0, node_test_1.before)(async () => {
    temporaryDatabasePath = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'qts-learning-store-test-'));
    process.env.EMBEDDED_PG = 'true';
    process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
    process.env.APPLICATION_SESSION_PERSIST_DB = 'true';
    process.env.JWT_SECRET = 'learning-store-test-secret';
    process.env.NODE_ENV = 'test';
    database = await Promise.resolve().then(() => __importStar(require('../database/connection')));
    learningStore = await Promise.resolve().then(() => __importStar(require('./application-learning-store')));
    const uniqueSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await database.initDb();
    const user = await database.queryOne(`INSERT INTO users (username, name, role, password_hash)
     VALUES ($1, $2, 'super', 'test-hash')
     RETURNING u_id`, [`learning-store-user-${uniqueSeed}`, `Learning Store User ${uniqueSeed}`]);
    strict_1.default.ok(user);
    const account = await database.queryOne(`INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, $2, TRUE, NULL, NULL)
     RETURNING id`, [`Learning Account ${uniqueSeed}`, 'test account']);
    strict_1.default.ok(account);
    const candidate = await database.queryOne(`INSERT INTO candidates (name, email, phone, linkedin_url, notes, color, stack, is_active, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
     RETURNING id`, [
        `Test Candidate ${uniqueSeed}`,
        'candidate@example.com',
        '123-456-7890',
        'https://linkedin.com/in/test',
        'test notes',
        'green',
        'full-stack',
        account.id,
    ]);
    strict_1.default.ok(candidate);
    const row = await database.queryOne(`INSERT INTO application_sessions (
      candidate_id, job_id, user_id, account_id,
      job_url, normalized_url, job_title, company,
      job_description, platform, current_step,
      discovered_pages, metadata, status
    ) VALUES (
      $1, NULL, $2, $3,
      'https://apply.example.com/jobs/test', 'https://apply.example.com/jobs/test',
      'Software Engineer', 'Example Co',
      'Role description', 'workable', 'scan',
      '[]'::jsonb, '{}'::jsonb, 'scanning'
    ) RETURNING id`, [candidate.id, user.u_id, account.id]);
    strict_1.default.ok(row);
    sessionId = row.id;
});
(0, node_test_1.after)(async () => {
    await database.closeDb();
    if (temporaryDatabasePath) {
        await (0, promises_1.rm)(temporaryDatabasePath, { recursive: true, force: true });
    }
});
(0, node_test_1.it)('normalizes semantic aliases and scores field matches conservatively', () => {
    strict_1.default.equal(learningStore.normalizeQuestion('Given Name'), 'first name');
    strict_1.default.equal(learningStore.normalizeQuestion('Mobile Number'), 'phone number');
    strict_1.default.ok(learningStore.scoreSemanticMatch({ question: 'Given Name', fieldType: 'text', sectionHeading: 'Personal Details' }, { question: 'First Name', fieldType: 'text', sectionHeading: 'Personal Details' }) >= 0.72);
    strict_1.default.ok(learningStore.scoreSemanticMatch({ question: 'LinkedIn URL', fieldType: 'url', sectionHeading: 'Profile' }, { question: 'LinkedIn', fieldType: 'url', sectionHeading: 'Profile' }) >= 0.72);
});
(0, node_test_1.it)('allows only approved high-confidence matches and blocks review-only matches', async () => {
    const approvedSemantic = await learningStore.upsertSemanticMapping({
        stableFieldId: 'first-name-demo',
        question: 'Given Name',
        fieldType: 'text',
        sectionHeading: 'Personal Details',
        confidence: 0.92,
        sourceSessionId: sessionId,
        inferredSemanticGroup: 'candidate_profile',
    });
    strict_1.default.ok(approvedSemantic);
    await learningStore.upsertAnswerPolicy({
        semanticId: approvedSemantic.id,
        policyType: 'reusable_profile',
        confidence: 0.92,
        approvedByUser: true,
        observedAnswer: 'Alice',
        editedAnswer: 'Alice',
    });
    const approved = await learningStore.evaluateAssistDecision(sessionId, {
        stableFieldId: 'first-name-demo',
        question: 'First Name',
        fieldType: 'text',
        sectionHeading: 'Personal Details',
    });
    strict_1.default.equal(approved.allowed, true);
    strict_1.default.equal(approved.requiresReview, false);
    strict_1.default.ok(approved.confidence >= 0.75);
    const blockedSemantic = await learningStore.upsertSemanticMapping({
        stableFieldId: 'visa-status-demo',
        question: 'Visa Status',
        fieldType: 'select',
        sectionHeading: 'Authorization',
        confidence: 0.45,
        sourceSessionId: sessionId,
        inferredSemanticGroup: 'requires_review',
    });
    strict_1.default.ok(blockedSemantic);
    await learningStore.upsertAnswerPolicy({
        semanticId: blockedSemantic.id,
        policyType: 'requires_review',
        confidence: 0.45,
        approvedByUser: false,
        observedAnswer: 'Not available',
        editedAnswer: null,
    });
    const blocked = await learningStore.evaluateAssistDecision(sessionId, {
        stableFieldId: 'visa-status-demo',
        question: 'Work authorization',
        fieldType: 'select',
        sectionHeading: 'Authorization',
    });
    strict_1.default.equal(blocked.allowed, false);
    strict_1.default.equal(blocked.requiresReview, true);
    strict_1.default.equal(blocked.policyType, 'requires_review');
});
(0, node_test_1.it)('removes fields from the pending review queue once a policy is saved', async () => {
    await database.execute(`
    INSERT INTO application_session_fields (
      session_id, stable_field_id, label, field_type, field_fingerprint,
      category, fill_value, fill_status, section_heading, page_step
    ) VALUES
      ($1, 'pending-learning-field', 'Preferred name', 'text', 'pending-fingerprint',
       'candidate_profile', 'Alex', 'filled', 'Personal Details', 'step-1'),
      ($1, 'reviewed-learning-field', 'Work authorization', 'select', 'reviewed-fingerprint',
       'needs_review', 'Yes', 'needs_review', 'Authorization', 'step-2')
  `, [sessionId]);
    const reviewedSemantic = await learningStore.upsertSemanticMapping({
        stableFieldId: 'reviewed-learning-field',
        question: 'Work authorization',
        fieldType: 'select',
        sectionHeading: 'Authorization',
        confidence: 0.9,
        sourceSessionId: sessionId,
        inferredSemanticGroup: 'requires_review',
    });
    strict_1.default.ok(reviewedSemantic);
    await learningStore.upsertAnswerPolicy({
        semanticId: reviewedSemantic.id,
        policyType: 'requires_review',
        confidence: 0.9,
        approvedByUser: false,
        observedAnswer: 'Yes',
    });
    const queue = await learningStore.listLearningQueue(sessionId);
    strict_1.default.deepEqual(queue.map((field) => field.stableFieldId), ['pending-learning-field']);
    strict_1.default.equal(queue[0].currentAnswer, 'Alex');
    strict_1.default.equal(queue[0].sectionHeading, 'Personal Details');
});
//# sourceMappingURL=application-learning-store.test.js.map