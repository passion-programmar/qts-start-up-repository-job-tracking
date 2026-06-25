import crypto from 'node:crypto';
import { config } from '../config/env';

const ALGO = 'aes-256-gcm';
const KEY = crypto.scryptSync(config.jwtSecret, 'qts-managed-credential', 32);

export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptCredential(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, KEY, new Uint8Array(iv));
    decipher.setAuthTag(new Uint8Array(tag));
    const decrypted = Buffer.concat([
      decipher.update(new Uint8Array(data)),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
