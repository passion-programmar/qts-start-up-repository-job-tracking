import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import authRoutes from './modules/auth/auth.routes';
import candidateRoutes from './modules/candidates/candidates.routes';
import jobRoutes from './modules/jobs/jobs.routes';
import biddersRoutes from './modules/bidders/bidders.routes';
import usersRoutes from './modules/users/users.routes';
import interviewsRoutes from './modules/interviews/interviews.routes';
import settingsRoutes from './modules/settings/settings.routes';
import { errorHandler } from './middleware/error-handler';
import { getBidderLogoPath, getLogoPath } from './config/paths';
import { config } from './config/env';
import { APP_NAME } from './config/branding';

const app = express();

const allowedOrigins = [
  'http://localhost:1027',
  'http://127.0.0.1:1027',
  'http://localhost:1028',
  'http://127.0.0.1:1028',
  /^chrome-extension:\/\//,
];

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

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/bidders', biddersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/interviews', interviewsRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    status: 'online',
    timestamp: new Date().toISOString(),
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

app.get('/bidder-logo.png', (_req, res) => {
  const logoPath = getBidderLogoPath();
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
