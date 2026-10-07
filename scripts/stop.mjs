import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let apiPort = 1028;
const webPort = 1027;

const envPath = join(root, 'server', '.env');
if (existsSync(envPath)) {
  const match = readFileSync(envPath, 'utf8').match(/^PORT=(\d+)/m);
  if (match) apiPort = Number(match[1]);
}

const isWin = process.platform === 'win32';

function stopPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { encoding: 'utf8' });
      const pids = new Set(
        out
          .split('\n')
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid))
      );
      for (const pid of pids) {
        console.log(`Stopping port ${port} PID ${pid}...`);
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
      }
      return pids.size > 0;
    }

    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!out) return false;
    for (const pid of out.split('\n')) {
      console.log(`Stopping port ${port} PID ${pid}...`);
      execSync(`kill ${pid}`);
    }
    return true;
  } catch {
    return false;
  }
}

let stopped = false;
for (const port of [apiPort, webPort]) {
  if (stopPort(port)) stopped = true;
}

if (!stopped) {
  console.log(`No servers listening on ports ${apiPort}, ${webPort}.`);
} else {
  console.log('Servers stopped.');
}
