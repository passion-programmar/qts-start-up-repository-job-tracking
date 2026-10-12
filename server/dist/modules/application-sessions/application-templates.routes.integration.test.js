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
let reviewerToken = '';
let adminToken = '';
let reviewerId = 0;
(0, node_test_1.before)(async () => {
    temporaryDatabasePath = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'qts-template-api-db-'));
    process.env.EMBEDDED_PG = 'true';
    process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
    process.env.JWT_SECRET = 'isolated-template-api-test-secret';
    process.env.NODE_ENV = 'test';
    const database = await Promise.resolve().then(() => __importStar(require('../../database/connection')));
    closeDatabase = database.closeDb;
    await database.initDb();
    const reviewer = await database.queryOne(`INSERT INTO users (username, name, role, password_hash)
     VALUES ('template-reviewer-test', 'Template Reviewer Test', 'super', 'test-hash')
     RETURNING u_id`);
    strict_1.default.ok(reviewer);
    reviewerId = Number(reviewer.u_id);
    const [{ default: express }, { default: templatesRouter }, { errorHandler }, jwtModule, { config }] = await Promise.all([
        Promise.resolve().then(() => __importStar(require('express'))),
        Promise.resolve().then(() => __importStar(require('./application-templates.routes'))),
        Promise.resolve().then(() => __importStar(require('../../middleware/error-handler'))),
        Promise.resolve().then(() => __importStar(require('jsonwebtoken'))),
        Promise.resolve().then(() => __importStar(require('../../config/env'))),
    ]);
    const jwt = jwtModule.default;
    reviewerToken = jwt.sign({ id: reviewerId, username: 'template-reviewer-test', role: 'super' }, config.jwtSecret);
    adminToken = jwt.sign({ id: reviewerId, username: 'template-reviewer-test', role: 'admin' }, config.jwtSecret);
    const app = express();
    app.use(express.json());
    app.use('/api/application-templates', templatesRouter);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server?.once('error', reject);
        server?.once('listening', resolve);
    });
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
    serverUrl = `http://127.0.0.1:${address.port}/api/application-templates`;
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
async function request(route, token, body) {
    return fetch(`${serverUrl}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
(0, node_test_1.it)('authorizes reviewers and persists failed and successful template validation reports', async () => {
    const unauthenticated = await request('/1/validate', undefined, {});
    strict_1.default.equal(unauthenticated.status, 401);
    const evidence = {
        observationSignatures: ['step-one', 'step-two'],
        validatedFieldIds: ['full-name'],
        authorizedTestEnvironmentConfirmed: true,
        manualReviewConfirmed: true,
        verificationReviewConfirmed: true,
    };
    const forbidden = await request('/1/validate', adminToken, evidence);
    strict_1.default.equal(forbidden.status, 403);
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
    strict_1.default.equal(createResponse.status, 201);
    const created = await createResponse.json();
    strict_1.default.equal(created.template.status, 'partial');
    const failedResponse = await request(`/${created.template.id}/validate`, reviewerToken, {
        ...evidence,
        observationSignatures: ['step-one', 'unobserved-step'],
    });
    strict_1.default.equal(failedResponse.status, 422);
    const failed = await failedResponse.json();
    strict_1.default.equal(failed.template.status, 'partial');
    strict_1.default.equal(failed.template.validationReport.passed, false);
    strict_1.default.deepEqual(failed.template.validationReport.unobservedSignatures, ['unobserved-step']);
    const persistedResponse = await request(`/${created.template.id}`, reviewerToken);
    strict_1.default.equal(persistedResponse.status, 200);
    const persisted = await persistedResponse.json();
    strict_1.default.equal(persisted.template.status, 'partial');
    strict_1.default.equal(persisted.template.validationReport.passed, false);
    const promotedResponse = await request(`/${created.template.id}/validate`, reviewerToken, evidence);
    strict_1.default.equal(promotedResponse.status, 200);
    const promoted = await promotedResponse.json();
    strict_1.default.equal(promoted.template.status, 'active');
    strict_1.default.equal(promoted.template.promotedBy, reviewerId);
    strict_1.default.ok(promoted.template.promotedAt);
    strict_1.default.equal(promoted.template.validationReport.passed, true);
});
//# sourceMappingURL=application-templates.routes.integration.test.js.map