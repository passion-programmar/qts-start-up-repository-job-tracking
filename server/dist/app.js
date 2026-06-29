"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const candidates_routes_1 = __importDefault(require("./modules/candidates/candidates.routes"));
const jobs_routes_1 = __importDefault(require("./modules/jobs/jobs.routes"));
const bidders_routes_1 = __importDefault(require("./modules/bidders/bidders.routes"));
const users_routes_1 = __importDefault(require("./modules/users/users.routes"));
const interviews_routes_1 = __importDefault(require("./modules/interviews/interviews.routes"));
const settings_routes_1 = __importDefault(require("./modules/settings/settings.routes"));
const application_sessions_routes_1 = __importDefault(require("./modules/application-sessions/application-sessions.routes"));
const application_tasks_routes_1 = __importDefault(require("./modules/application-sessions/application-tasks.routes"));
const admin_records_routes_1 = __importDefault(require("./modules/admin-records/admin-records.routes"));
const job_sites_routes_1 = __importDefault(require("./modules/job-sites/job-sites.routes"));
const error_handler_1 = require("./middleware/error-handler");
const paths_1 = require("./config/paths");
const env_1 = require("./config/env");
const branding_1 = require("./config/branding");
const app = (0, express_1.default)();
const allowedOrigins = [
    'http://localhost:1027',
    'http://127.0.0.1:1027',
    'http://localhost:1028',
    'http://127.0.0.1:1028',
    /^chrome-extension:\/\//,
    /^https:\/\/.*\.vercel\.app$/,
    /^https:\/\/.*\.trycloudflare\.com$/,
];
try {
    const adminOrigin = new URL(env_1.config.adminWebUrl).origin;
    if (!allowedOrigins.includes(adminOrigin)) {
        allowedOrigins.push(adminOrigin);
    }
}
catch {
    // ignore invalid ADMIN_WEB_URL
}
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        const allowed = allowedOrigins.some((allowedOrigin) => typeof allowedOrigin === 'string'
            ? allowedOrigin === origin
            : allowedOrigin.test(origin));
        callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '2mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/api/auth', auth_routes_1.default);
app.use('/api/candidates', candidates_routes_1.default);
app.use('/api/jobs', jobs_routes_1.default);
app.use('/api/bidders', bidders_routes_1.default);
app.use('/api/users', users_routes_1.default);
app.use('/api/interviews', interviews_routes_1.default);
app.use('/api/settings', settings_routes_1.default);
app.use('/api/application-sessions', application_sessions_routes_1.default);
app.use('/api/application-tasks', application_tasks_routes_1.default);
app.use('/api/admin-records', admin_records_routes_1.default);
app.use('/api/job-sites', job_sites_routes_1.default);
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        status: 'online',
        timestamp: new Date().toISOString(),
        apiVersion: '1.6.0',
        features: {
            documentUploadCategory: true,
            applicationDocuments: true,
            applicationTasks: true,
        },
    });
});
app.get('/logo.png', (_req, res) => {
    const logoPath = (0, paths_1.getLogoPath)();
    if (!logoPath) {
        res.status(404).end();
        return;
    }
    res.sendFile(logoPath);
});
app.get('/bidder-logo.png', (_req, res) => {
    const logoPath = (0, paths_1.getBidderLogoPath)();
    if (!logoPath) {
        res.status(404).end();
        return;
    }
    res.sendFile(logoPath);
});
app.get('/', (_req, res) => {
    res.json({
        success: true,
        message: `${branding_1.APP_NAME} API`,
        ui: env_1.config.adminWebUrl,
    });
});
app.use(error_handler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map