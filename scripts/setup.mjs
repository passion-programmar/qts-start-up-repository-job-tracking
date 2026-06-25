import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'server');
const webDir = join(root, 'admin-web');

function runNpmInstall(cwd) {
  if (existsSync(join(cwd, 'node_modules'))) return;
  console.log(`Installing dependencies in ${cwd}...`);
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureServerEnv() {
  const envPath = join(serverDir, '.env');
  const examplePath = join(serverDir, '.env.example');

  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('Created server/.env from .env.example');
    return;
  }

  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  if (/^PORT=4000/m.test(content)) {
    writeFileSync(envPath, content.replace(/^PORT=4000/m, 'PORT=1028'));
    console.log('Updated server/.env: PORT=4000 -> PORT=1028');
  }
}

function ensureWebEnv() {
  const envPath = join(webDir, '.env.local');
  if (existsSync(envPath)) return;

  writeFileSync(envPath, 'API_URL=http://127.0.0.1:1028\nNEXT_PUBLIC_API_URL=\n');
  console.log('Created admin-web/.env.local');
}

function ensureLogoAssets() {
  const mainLogo = join(webDir, 'public', 'logo.png');
  const bidderLogo = join(webDir, 'public', 'bidder-logo.png');

  if (existsSync(mainLogo)) {
    const targets = [
      join(serverDir, 'src', 'logo.png'),
    ];
    for (const target of targets) {
      copyFileSync(mainLogo, target);
    }
  }

  if (existsSync(bidderLogo)) {
    const extAssets = join(root, 'extension', 'assets');
    const targets = [
      join(serverDir, 'src', 'bidder-logo.png'),
      join(extAssets, 'bidder-logo.png'),
    ];
    for (const target of targets) {
      copyFileSync(bidderLogo, target);
    }
    if (process.platform === 'win32') {
      const ps = `
        Add-Type -AssemblyName System.Drawing
        $src = '${join(extAssets, 'bidder-logo.png').replace(/\\/g, '\\\\')}'
        $img = [System.Drawing.Image]::FromFile($src)
        foreach ($size in 16,32,48,128) {
          $bmp = New-Object System.Drawing.Bitmap $size,$size
          $g = [System.Drawing.Graphics]::FromImage($bmp)
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.DrawImage($img, 0, 0, $size, $size)
          $g.Dispose()
          $bmp.Save((Join-Path (Split-Path $src) "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
          $bmp.Dispose()
        }
        $img.Dispose()
      `;
      spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    }
  }
}

runNpmInstall(serverDir);
runNpmInstall(webDir);
ensureServerEnv();
ensureWebEnv();
ensureLogoAssets();
