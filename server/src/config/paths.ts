import path from 'node:path';
import fs from 'node:fs';

export function isPackaged(): boolean {
  return 'pkg' in process;
}

export function getAppRoot(): string {
  if (isPackaged()) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

function getAssetPath(filename: string): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'src', filename),
    path.join(getAppRoot(), 'src', filename),
    path.join(getAppRoot(), filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

export function getLogoPath(): string | null {
  return getAssetPath('logo.png');
}

export function getBidderLogoPath(): string | null {
  return getAssetPath('bidder-logo.png');
}
