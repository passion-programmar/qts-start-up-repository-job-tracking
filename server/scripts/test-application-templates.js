const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const serverRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qts-template-api-test-'));
const testSource = path.join(
  serverRoot,
  'src',
  'modules',
  'application-sessions',
  'application-templates.routes.integration.test.ts'
);
const validationTestSource = path.join(serverRoot, 'src', 'services', 'application-template-validation.test.ts');
const workableGuardTestSource = path.join(
  serverRoot,
  'src',
  'modules',
  'new-schema',
  'jobs.routes.workable-disabled.integration.test.ts'
);
const compiler = path.join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const compiledTest = path.join(
  outputDirectory,
  'modules',
  'application-sessions',
  'application-templates.routes.integration.test.js'
);
const compiledValidationTest = path.join(
  outputDirectory,
  'services',
  'application-template-validation.test.js'
);
const compiledWorkableGuardTest = path.join(
  outputDirectory,
  'modules',
  'new-schema',
  'jobs.routes.workable-disabled.integration.test.js'
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const compileStatus = run(process.execPath, [
    compiler,
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
    '--types', 'node',
    '--rootDir', path.join(serverRoot, 'src'),
    '--outDir', outputDirectory,
    testSource,
    validationTestSource,
    workableGuardTestSource,
  ], { cwd: serverRoot });

  if (compileStatus !== 0) {
    process.exitCode = compileStatus;
  } else {
    const modulePath = path.join(serverRoot, 'node_modules');
    const env = {
      ...process.env,
      NODE_PATH: [modulePath, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    };
    process.exitCode = run(process.execPath, [
      '--test',
      compiledTest,
      compiledValidationTest,
      compiledWorkableGuardTest,
    ], {
      cwd: serverRoot,
      env,
    });
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}
