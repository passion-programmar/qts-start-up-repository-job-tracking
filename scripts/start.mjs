import { spawn } from 'node:child_process';

const apiUrl = 'http://127.0.0.1:1028';

async function hasRunningApi() {
  let healthResponse;
  try {
    healthResponse = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return false;
  }

  if (!healthResponse.ok) {
    throw new Error(`A service is already responding on port 1028, but its health check returned ${healthResponse.status}.`);
  }

  const health = await healthResponse.json();
  if (health.success !== true) {
    throw new Error('A service is already responding on port 1028, but it is not a healthy QTS API.');
  }

  const authResponse = await fetch(`${apiUrl}/api/auth/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2000),
  });
  if (authResponse.status === 404) {
    throw new Error('The QTS API on port 1028 is outdated. Restart that server to load the latest API routes.');
  }
  if (authResponse.status !== 401) {
    throw new Error(`The QTS API authentication route returned an unexpected status: ${authResponse.status}.`);
  }

  return true;
}

async function main() {
  const apiAlreadyRunning = await hasRunningApi();
  const args = apiAlreadyRunning
    ? ['run', 'dev', '--prefix', 'admin-web']
    : ['run', 'start:all'];

  if (apiAlreadyRunning) {
    console.log('QTS API is already running on port 1028. Starting the UI without launching a duplicate API.');
  }

  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Could not locate the npm CLI path.');
  }

  const child = spawn(process.execPath, [npmCli, ...args], {
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`Could not start QTS: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch((error) => {
  console.error(`Could not start QTS: ${error.message}`);
  process.exitCode = 1;
});
