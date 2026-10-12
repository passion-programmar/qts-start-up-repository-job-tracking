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
let otherManagerToken = '';
let accountToken = '';
let templateId = 0;
let managerId = 0;
let processingJobId = 0;
(0, node_test_1.before)(async () => {
    temporaryDatabasePath = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'qts-scanner-rules-test-'));
    process.env.EMBEDDED_PG = 'true';
    process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
    process.env.JWT_SECRET = 'isolated-scanner-rules-test-secret';
    process.env.GPT_ACTION_API_KEY = 'isolated-scanner-rules-action-secret';
    process.env.NODE_ENV = 'test';
    const database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    closeDatabase = database.closeDb;
    await database.initDb();
    const superUser = await database.queryOne(`INSERT INTO users (username, name, role, password_hash)
     VALUES ('scanner-rules-super-test', 'Scanner Rules Super Test', 'super', 'test-hash')
     RETURNING u_id`);
    strict_1.default.ok(superUser);
    const manager = await database.queryOne(`INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-rules-manager-test', 'Scanner Rules Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`, [superUser.u_id]);
    const otherManager = await database.queryOne(`INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ('scanner-rules-other-manager-test', 'Scanner Rules Other Manager Test', 'manager', 'test-hash', $1)
     RETURNING u_id`, [superUser.u_id]);
    strict_1.default.ok(manager);
    strict_1.default.ok(otherManager);
    managerId = Number(manager.u_id);
    const category = await database.queryOne(`INSERT INTO categories (category_title)
     VALUES ('Scanner Rules Test Category')
     RETURNING category_id`);
    strict_1.default.ok(category);
    const account = await database.queryOne(`INSERT INTO users (
       username, name, role, password_hash, parent_user_id, email, address, sex,
       birthday, phone, country, city, category_id
     ) VALUES (
       'scanner-rules-account-test', 'Scanner Rules Account Test', 'account', NULL,
       $1, 'scanner-test@example.invalid', 'Test Address', 'unspecified',
       '1990-01-01', '0000000000', 'Test Country', 'Test City', $2
     ) RETURNING u_id`, [managerId, category.category_id]);
    strict_1.default.ok(account);
    const template = await database.queryOne(`INSERT INTO application_site_templates (site_key, platform, host, template_version, status)
     VALUES ('generic:scanner.example', 'generic', 'scanner.example', 'scanner-test-v1', 'partial')
     RETURNING template_id`);
    strict_1.default.ok(template);
    templateId = Number(template.template_id);
    const job = await database.queryOne(`INSERT INTO job_list (u_id, url, application_type, company, title, status)
     VALUES ($1, 'https://scanner.example/apply', 'scanner.example', 'Scanner Test Company', 'Scanner Test Job', 'processing')
     RETURNING j_id`, [managerId]);
    strict_1.default.ok(job);
    processingJobId = Number(job.j_id);
    await database.execute(`INSERT INTO job_account_assignments (j_id, account_user_id, position)
     VALUES ($1, $2, 1)`, [processingJobId, account.u_id]);
    const [{ default: express }, { default: profileRouter }, { default: gptTasksRouter }, { errorHandler }, jwtModule, { config }] = await Promise.all([
        Promise.resolve().then(() => __importStar(require('express'))),
        Promise.resolve().then(() => __importStar(require('./manager-application-profile.routes'))),
        Promise.resolve().then(() => __importStar(require('./gpt-application-tasks.routes'))),
        Promise.resolve().then(() => __importStar(require('../../middleware/error-handler'))),
        Promise.resolve().then(() => __importStar(require('jsonwebtoken'))),
        Promise.resolve().then(() => __importStar(require('../../config/env'))),
    ]);
    managerToken = jwtModule.default.sign({ id: managerId, schema: 'new' }, config.jwtSecret);
    otherManagerToken = jwtModule.default.sign({ id: Number(otherManager.u_id), schema: 'new' }, config.jwtSecret);
    accountToken = jwtModule.default.sign({ id: Number(account.u_id), schema: 'new' }, config.jwtSecret);
    const app = express();
    app.use(express.json());
    app.use('/api/v2/manager-application-profile', profileRouter);
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
            if (temporaryDatabasePath)
                await (0, promises_1.rm)(temporaryDatabasePath, { recursive: true, force: true });
        }
    }
});
(0, node_test_1.it)('saves reusable question/answers with Manager-scoped template rules and keeps revisions', async () => {
    const scannerObservation = {
        label: 'Are you willing to relocate to Japan?',
        fieldType: 'select',
        required: true,
        options: ['Yes', 'No'],
        section: 'Location',
        selectorHints: { tag: 'select', name: 'relocation' },
        domEvidence: {
            control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
            ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
        },
    };
    const createResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            templateId,
            fieldId: 'relocation-question',
            semanticKey: 'relocation willingness',
            question: 'Are you willing to relocate to Japan?',
            strategy: 'reusable',
            reusableAnswer: 'Yes, I am willing to relocate.',
            context: { destination: 'Japan' },
            fieldSnapshot: {
                fieldType: 'select',
                required: true,
                options: ['Yes', 'No'],
                section: 'Location',
                selectorHints: { tag: 'select', name: 'relocation' },
                domEvidence: {
                    control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
                    ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                },
                captureCount: 2,
                captureVerified: true,
                managerReviewed: false,
                observations: [
                    {
                        selectorHints: { tag: 'select', name: 'relocation' },
                        domEvidence: {
                            control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
                            ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                        },
                    },
                    {
                        selectorHints: { tag: 'select', name: 'relocation' },
                        domEvidence: {
                            control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
                            ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                        },
                    },
                ],
                fieldSnapshots: [scannerObservation, scannerObservation],
            },
        }),
    });
    strict_1.default.equal(createResponse.status, 200);
    const created = await createResponse.json();
    strict_1.default.equal(created.success, true);
    strict_1.default.ok(created.rule.reusable_answer_id > 0);
    const updateResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            templateId,
            fieldId: 'relocation-question',
            semanticKey: created.rule.semantic_key,
            question: 'Are you willing to relocate to Canada?',
            strategy: 'reusable',
            reusableAnswerId: created.rule.reusable_answer_id,
            context: { destination: 'Canada' },
            fieldSnapshot: { fieldType: 'select', required: true, options: ['Yes', 'No'], section: 'Location' },
        }),
    });
    strict_1.default.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    strict_1.default.equal(updated.success, true);
    strict_1.default.equal(updated.rule.reusable_answer_id, created.rule.reusable_answer_id);
    strict_1.default.equal(updated.rule.history.length, 1);
    const listResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules/${templateId}`, { headers: { Authorization: `Bearer ${managerToken}` } });
    const listed = await listResponse.json();
    strict_1.default.equal(listed.success, true);
    strict_1.default.equal(listed.rules.length, 1);
    strict_1.default.equal(listed.rules[0].reusable_answer, 'Yes, I am willing to relocate.');
    strict_1.default.equal(listed.rules[0].question, 'Are you willing to relocate to Canada?');
    strict_1.default.equal(listed.rules[0].context.destination, 'Canada');
    const evidenceUpdateResponse = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules/evidence`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            templateId,
            fieldId: 'relocation-question',
            fieldSnapshot: {
                fieldType: 'select',
                required: true,
                options: ['Yes', 'No'],
                section: 'Location',
                selectorHints: { tag: 'select', name: 'relocation' },
                domEvidence: {
                    control: { tag: 'select', role: '', classNames: ['application-select-v2'], testId: '', automationId: '' },
                    ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                },
                captureCount: 2,
                captureVerified: true,
                managerReviewed: false,
                observations: [
                    {
                        selectorHints: { tag: 'select', name: 'relocation' },
                        domEvidence: {
                            control: { tag: 'select', role: '', classNames: ['application-select'], testId: '', automationId: '' },
                            ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                        },
                    },
                    {
                        selectorHints: { tag: 'select', name: 'relocation' },
                        domEvidence: {
                            control: { tag: 'select', role: '', classNames: ['application-select-v2'], testId: '', automationId: '' },
                            ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'relocation-field', automationId: '' }],
                        },
                    },
                ],
                fieldSnapshots: [
                    scannerObservation,
                    { ...scannerObservation, label: 'Are you willing to relocate to Canada?' },
                ],
            },
        }),
    });
    strict_1.default.equal(evidenceUpdateResponse.status, 200);
    const evidenceUpdate = await evidenceUpdateResponse.json();
    strict_1.default.deepEqual(evidenceUpdate, { success: true, updated: true });
    const database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    const savedAnswers = await database.queryAll(`SELECT custom_answer_id FROM manager_custom_application_answers
     WHERE manager_user_id = $1 AND topic = 'relocation willingness'`, [managerId]);
    strict_1.default.equal(savedAnswers.length, 1);
});
(0, node_test_1.it)('rejects non-Manager writes and prevents reading another Manager’s rules', async () => {
    const deniedWrite = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accountToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            templateId,
            fieldId: 'unauthorized-field',
            semanticKey: 'unauthorized',
            question: 'Unauthorized question?',
            strategy: 'manual',
        }),
    });
    strict_1.default.equal(deniedWrite.status, 403);
    const otherManagerRules = await fetch(`${serverUrl}/api/v2/manager-application-profile/scanner-rules/${templateId}`, { headers: { Authorization: `Bearer ${otherManagerToken}` } });
    const response = await otherManagerRules.json();
    strict_1.default.equal(response.success, true);
    strict_1.default.deepEqual(response.rules, []);
});
(0, node_test_1.it)('keeps Scanner GPT generation scoped to the selected processing job and requires page acknowledgement', async () => {
    const createResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${processingJobId}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourcePlatform: 'scanner.example' }),
    });
    strict_1.default.equal(createResponse.status, 201);
    const created = await createResponse.json();
    strict_1.default.equal(created.success, true);
    strict_1.default.equal(created.status, 'waiting_for_page');
    const page = {
        pageUrl: 'https://scanner.example/apply',
        pageTitle: 'Scanner Test Job',
        pageNumber: 1,
        fields: [{
                stableFieldId: 'scanner-generated-answer',
                label: 'Why are you interested in this role?',
                fieldType: 'textarea',
                required: true,
                manualReview: true,
            }, {
                stableFieldId: 'scanner-resume-upload',
                label: 'Resume',
                fieldType: 'file',
                documentSlot: 'resume',
                required: true,
            }, {
                stableFieldId: 'scanner-cover-letter-upload',
                label: 'Cover letter',
                fieldType: 'file',
                documentSlot: 'cover_letter',
                required: true,
            }],
        jobDescription: 'A test role description.',
    };
    const pageResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/page`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(page),
    });
    strict_1.default.equal(pageResponse.status, 200);
    const activeStatusResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/extension-status`, { headers: { Authorization: `Bearer ${managerToken}` } });
    const activeStatus = await activeStatusResponse.json();
    strict_1.default.equal(activeStatus.success, true);
    strict_1.default.equal(activeStatus.status, 'waiting_for_gpt');
    strict_1.default.equal(activeStatus.page.pageUrl, page.pageUrl);
    strict_1.default.equal(activeStatus.page.fields[0].stableFieldId, 'scanner-generated-answer');
    const refreshWhileActive = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/jobs/${processingJobId}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourcePlatform: 'scanner.example', jobDescription: 'Must not replace active task context.' }),
    });
    strict_1.default.equal(refreshWhileActive.status, 409);
    const activeTaskConflict = await refreshWhileActive.json();
    strict_1.default.equal(activeTaskConflict.taskId, created.taskId);
    strict_1.default.equal(activeTaskConflict.status, 'waiting_for_gpt');
    const overwritePage = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/page`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...page, pageNumber: 2 }),
    });
    strict_1.default.equal(overwritePage.status, 409);
    const packageResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/package`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer isolated-scanner-rules-action-secret',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            answers: [{ stableFieldId: 'scanner-generated-answer', answer: 'Reviewed test response.' }],
            unresolvedFields: [],
            notes: 'Generated for the selected processing job.',
            resume: {
                candidate: { fullName: 'Scanner Test Account', email: 'scanner-test@example.invalid' },
                targetRole: 'Scanner Test Role',
                targetCompany: 'Scanner Test Company',
                sections: [{ title: 'Experience', items: [{ heading: 'Test Employer', bullets: ['Delivered test work.'] }] }],
            },
            coverLetter: {
                candidate: { fullName: 'Scanner Test Account', email: 'scanner-test@example.invalid' },
                targetRole: 'Scanner Test Role',
                targetCompany: 'Scanner Test Company',
                bodyParagraphs: ['I am interested in the Scanner Test Role.'],
            },
        }),
    });
    strict_1.default.equal(packageResponse.status, 200);
    for (const documentType of ['resume', 'cover_letter']) {
        const documentResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/documents/${documentType}`, { headers: { Authorization: `Bearer ${managerToken}` } });
        strict_1.default.equal(documentResponse.status, 200);
        strict_1.default.match(documentResponse.headers.get('content-type') || '', /application\/pdf/i);
        strict_1.default.ok((await documentResponse.arrayBuffer()).byteLength > 0);
    }
    const acknowledgeResponse = await fetch(`${serverUrl}/api/v2/gpt-application-tasks/${created.taskId}/scanner-acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
    });
    strict_1.default.equal(acknowledgeResponse.status, 200);
    const acknowledged = await acknowledgeResponse.json();
    strict_1.default.equal(acknowledged.success, true);
    strict_1.default.equal(acknowledged.status, 'waiting_for_page');
});
//# sourceMappingURL=manager-application-profile.scanner.integration.test.js.map