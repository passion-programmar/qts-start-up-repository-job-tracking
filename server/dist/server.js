"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const node_readline_1 = __importDefault(require("node:readline"));
const app_1 = __importDefault(require("./app"));
const connection_1 = require("./database/connection");
const seed_admin_1 = require("./database/seed-admin");
const env_1 = require("./config/env");
const branding_1 = require("./config/branding");
const logger_1 = require("./utilities/logger");
function openBrowser(url) {
    let command;
    let args;
    if (process.platform === 'win32') {
        command = process.env.ComSpec || 'cmd.exe';
        args = ['/c', 'start', '', url];
    }
    else if (process.platform === 'darwin') {
        command = 'open';
        args = [url];
    }
    else {
        command = 'xdg-open';
        args = [url];
    }
    try {
        const child = (0, node_child_process_1.spawn)(command, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.on('error', (error) => {
            logger_1.logger.warn(`Could not open ${branding_1.APP_NAME} automatically`, {
                message: error.message,
            });
        });
        child.unref();
    }
    catch (error) {
        logger_1.logger.warn(`Could not open ${branding_1.APP_NAME} automatically`, {
            message: error instanceof Error ? error.message : String(error),
        });
    }
}
async function main() {
    try {
        await (0, connection_1.initDb)();
        await (0, seed_admin_1.seedAdmin)();
        const server = app_1.default.listen(env_1.config.port, env_1.config.host, () => {
            const serverUrl = `http://localhost:${env_1.config.port}`;
            const adminUrl = env_1.config.adminWebUrl;
            logger_1.logger.info(`${branding_1.APP_NAME} API started on ${serverUrl}`);
            logger_1.logger.info(`API available at ${serverUrl}/api`);
            logger_1.logger.info(`${branding_1.APP_NAME} UI: ${adminUrl}`);
            logger_1.logger.info('Close this terminal window to stop the server.');
            if (env_1.config.autoOpenBrowser) {
                openBrowser(adminUrl);
            }
        });
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger_1.logger.error(`Port ${env_1.config.port} is already in use. Stop the other server first ` +
                    `(run stop-server.bat or close its terminal window).`);
            }
            else {
                logger_1.logger.error('Server error', error.message);
            }
            process.exit(1);
        });
        let shuttingDown = false;
        const shutdown = async () => {
            if (shuttingDown)
                return;
            shuttingDown = true;
            logger_1.logger.info('Shutting down server...');
            await new Promise((resolve) => server.close(() => resolve()));
            await (0, connection_1.closeDb)();
            process.exit(0);
        };
        process.on('SIGINT', () => { void shutdown(); });
        process.on('SIGTERM', () => { void shutdown(); });
        // When the Windows console window is closed (X button), stdin closes.
        if (process.platform === 'win32' && process.stdin.isTTY) {
            node_readline_1.default.createInterface({ input: process.stdin, output: process.stdout })
                .on('close', () => { void shutdown(); });
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger_1.logger.error('Failed to start server', message);
        if (stack)
            console.error(stack);
        process.exit(1);
    }
}
void main();
//# sourceMappingURL=server.js.map