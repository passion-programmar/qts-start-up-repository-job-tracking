import { spawn } from 'node:child_process';
import readline from 'node:readline';
import app from './app';
import { initDb, closeDb } from './database/connection';
import { seedAdmin } from './database/seed-admin';
import { config } from './config/env';
import { APP_NAME } from './config/branding';
import { logger } from './utilities/logger';

function openBrowser(url: string): void {
  let command: string;
  let args: string[];

  if (process.platform === 'win32') {
    command = process.env.ComSpec || 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.on('error', (error) => {
      logger.warn(`Could not open ${APP_NAME} automatically`, {
        message: error.message,
      });
    });

    child.unref();
  } catch (error) {
    logger.warn(`Could not open ${APP_NAME} automatically`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  try {
    await initDb();
    await seedAdmin();

    const server = app.listen(config.port, config.host, () => {
      const serverUrl = `http://localhost:${config.port}`;
      const adminUrl = config.adminWebUrl;

      logger.info(`${APP_NAME} API started on ${serverUrl}`);
      logger.info(`API available at ${serverUrl}/api`);
      logger.info(`${APP_NAME} UI: ${adminUrl}`);
      logger.info('Close this terminal window to stop the server.');

      if (config.autoOpenBrowser) {
        openBrowser(adminUrl);
      }
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(
          `Port ${config.port} is already in use. Stop the other server first ` +
          `(run stop-server.bat or close its terminal window).`
        );
      } else {
        logger.error('Server error', error.message);
      }
      process.exit(1);
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Shutting down server...');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
      process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    // When the Windows console window is closed (X button), stdin closes.
    if (process.platform === 'win32' && process.stdin.isTTY) {
      readline.createInterface({ input: process.stdin, output: process.stdout })
        .on('close', () => { void shutdown(); });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Failed to start server', message);
    if (stack) console.error(stack);
    process.exit(1);
  }
}

void main();
