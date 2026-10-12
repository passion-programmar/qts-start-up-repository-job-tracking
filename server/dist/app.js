"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./modules/new-schema/auth.routes"));
const users_routes_1 = __importDefault(require("./modules/new-schema/users.routes"));
const custom_gpts_routes_1 = __importDefault(require("./modules/new-schema/custom-gpts.routes"));
const interviews_routes_1 = __importDefault(require("./modules/new-schema/interviews.routes"));
const categories_routes_1 = __importDefault(require("./modules/new-schema/categories.routes"));
const settings_routes_1 = __importDefault(require("./modules/new-schema/settings.routes"));
const jobs_routes_1 = __importDefault(require("./modules/new-schema/jobs.routes"));
const bids_routes_1 = __importDefault(require("./modules/new-schema/bids.routes"));
const analytics_routes_1 = __importDefault(require("./modules/new-schema/analytics.routes"));
const database_routes_1 = __importDefault(require("./modules/new-schema/database.routes"));
const manager_application_profile_routes_1 = __importDefault(require("./modules/new-schema/manager-application-profile.routes"));
const resume_pdfs_routes_1 = __importDefault(require("./modules/new-schema/resume-pdfs.routes"));
const gpt_application_tasks_routes_1 = __importDefault(require("./modules/new-schema/gpt-application-tasks.routes"));
const application_sessions_routes_1 = __importDefault(require("./modules/application-sessions/application-sessions.routes"));
const application_learning_routes_1 = __importDefault(require("./modules/application-sessions/application-learning.routes"));
const application_templates_routes_1 = __importDefault(require("./modules/application-sessions/application-templates.routes"));
const error_handler_1 = require("./middleware/error-handler");
const paths_1 = require("./config/paths");
const env_1 = require("./config/env");
const branding_1 = require("./config/branding");
const logger_1 = require("./utilities/logger");
const serverless_bootstrap_1 = require("./services/serverless-bootstrap");
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
if (process.env.VERCEL) {
    app.use(async (_req, res, next) => {
        try {
            await (0, serverless_bootstrap_1.ensureServerlessDatabaseReady)();
            next();
        }
        catch (error) {
            logger_1.logger.error('Vercel API initialization failed', error);
            res.status(503).json({
                success: false,
                message: 'The API is not ready. Check the Vercel API environment variables and logs.',
            });
        }
    });
}
app.use('/api/v2/auth', auth_routes_1.default);
app.use('/api/v2/users', users_routes_1.default);
app.use('/api/v2/custom-gpts', custom_gpts_routes_1.default);
app.use('/api/v2/interviews', interviews_routes_1.default);
app.use('/api/v2/categories', categories_routes_1.default);
app.use('/api/v2/settings', settings_routes_1.default);
app.use('/api/v2/jobs', jobs_routes_1.default);
app.use('/api/v2/bids', bids_routes_1.default);
app.use('/api/v2/analytics', analytics_routes_1.default);
app.use('/api/v2/database', database_routes_1.default);
app.use('/api/v2/manager-application-profile', manager_application_profile_routes_1.default);
app.use('/api/v2/resume-pdfs', resume_pdfs_routes_1.default);
app.use('/api/v2/gpt-application-tasks', gpt_application_tasks_routes_1.default);
app.use('/api/application-sessions', application_sessions_routes_1.default);
app.use('/api/application-sessions', application_learning_routes_1.default);
app.use('/api/application-templates', application_templates_routes_1.default);
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        status: 'online',
        timestamp: new Date().toISOString(),
        apiVersion: '1.6.0',
        features: { schema: 'new' },
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
app.get('/account-logo.png', (_req, res) => {
    const logoPath = (0, paths_1.getAccountLogoPath)();
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