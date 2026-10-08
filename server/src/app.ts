import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import authRoutes from './modules/auth/auth.routes';
import candidateRoutes from './modules/candidates/candidates.routes';
import jobRoutes from './modules/jobs/jobs.routes';
import accountsRoutes from './modules/accounts/accounts.routes';
import usersRoutes from './modules/users/users.routes';
import interviewsRoutes from './modules/interviews/interviews.routes';
import settingsRoutes from './modules/settings/settings.routes';
import applicationSessionsRoutes from './modules/application-sessions/application-sessions.routes';
import applicationTasksRoutes from './modules/application-sessions/application-tasks.routes';
import adminRecordsRoutes from './modules/admin-records/admin-records.routes';
import jobSitesRoutes from './modules/job-sites/job-sites.routes';
import newSchemaAuthRoutes from './modules/new-schema/auth.routes';
import newSchemaUsersRoutes from './modules/new-schema/users.routes';
import newSchemaInterviewsRoutes from './modules/new-schema/interviews.routes';
import newSchemaCategoriesRoutes from './modules/new-schema/categories.routes';
import newSchemaSettingsRoutes from './modules/new-schema/settings.routes';
import newSchemaJobsRoutes from './modules/new-schema/jobs.routes';
import newSchemaBidsRoutes from './modules/new-schema/bids.routes';
import newSchemaAnalyticsRoutes from './modules/new-schema/analytics.routes';
import newSchemaDatabaseRoutes from './modules/new-schema/database.routes';
import { errorHandler } from './middleware/error-handler';
import { getAccountLogoPath, getLogoPath } from './config/paths';
import { config } from './config/env';
import { APP_NAME } from './config/branding';
import { logger } from './utilities/logger';
import { ensureServerlessDatabaseReady } from './services/serverless-bootstrap';

const app = express();

const allowedOrigins: Array<string | RegExp> = [
  'http://localhost:1027',
  'http://127.0.0.1:1027',
  'http://localhost:1028',
  'http://127.0.0.1:1028',
  /^chrome-extension:\/\//,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.trycloudflare\.com$/,
];

try {
  const adminOrigin = new URL(config.adminWebUrl).origin;
  if (!allowedOrigins.includes(adminOrigin)) {
    allowedOrigins.push(adminOrigin);
  }
} catch {
  // ignore invalid ADMIN_WEB_URL
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = allowedOrigins.some((allowedOrigin) =>
      typeof allowedOrigin === 'string'
        ? allowedOrigin === origin
        : allowedOrigin.test(origin)
    );
    callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.VERCEL) {
  app.use(async (_req, res, next) => {
    try {
      await ensureServerlessDatabaseReady();
      next();
    } catch (error) {
      logger.error('Vercel API initialization failed', error);
      res.status(503).json({
        success: false,
        message: 'The API is not ready. Check the Vercel API environment variables and logs.',
      });
    }
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/interviews', interviewsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/application-sessions', applicationSessionsRoutes);
app.use('/api/application-tasks', applicationTasksRoutes);
app.use('/api/admin-records', adminRecordsRoutes);
app.use('/api/job-sites', jobSitesRoutes);
app.use('/api/v2/auth', newSchemaAuthRoutes);
app.use('/api/v2/users', newSchemaUsersRoutes);
app.use('/api/v2/interviews', newSchemaInterviewsRoutes);
app.use('/api/v2/categories', newSchemaCategoriesRoutes);
app.use('/api/v2/settings', newSchemaSettingsRoutes);
app.use('/api/v2/jobs', newSchemaJobsRoutes);
app.use('/api/v2/bids', newSchemaBidsRoutes);
app.use('/api/v2/analytics', newSchemaAnalyticsRoutes);
app.use('/api/v2/database', newSchemaDatabaseRoutes);

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
  const logoPath = getLogoPath();
  if (!logoPath) {
    res.status(404).end();
    return;
  }
  res.sendFile(logoPath);
});

app.get('/account-logo.png', (_req, res) => {
  const logoPath = getAccountLogoPath();
  if (!logoPath) {
    res.status(404).end();
    return;
  }
  res.sendFile(logoPath);
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: `${APP_NAME} API`,
    ui: config.adminWebUrl,
  });
});

app.use(errorHandler as express.ErrorRequestHandler);

export default app;
