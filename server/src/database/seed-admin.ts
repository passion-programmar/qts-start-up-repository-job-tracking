import bcrypt from 'bcryptjs';
import { queryOne, execute } from './connection';
import { config } from '../config/env';
import { logger } from '../utilities/logger';
import { encryptCredential } from '../utilities/credential-crypto';
import {
  serializeCandidateStacks,
  CANDIDATE_STACKS_SETTING_KEY,
  DEFAULT_CANDIDATE_STACKS,
} from '../config/candidate-stacks';
import type { UserRole } from '../lib/roles';

const BCRYPT_ROUNDS = 12;

async function ensureUser(
  username: string,
  password: string,
  role: UserRole,
  bidderId: number | null = null
): Promise<number> {
  if (!password) {
    logger.warn(`No password configured for ${username}, skipping account seed`);
    return 0;
  }

  const existing = await queryOne<{
    id: number;
    password_hash: string;
    role: string;
    bidder_id: number | null;
    password_encrypted: string | null;
  }>(
    'SELECT id, password_hash, role, bidder_id, password_encrypted FROM admins WHERE username = $1',
    [username]
  );

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const passwordEncrypted = encryptCredential(password);

  if (existing) {
    const needsHashMigration = !existing.password_hash.startsWith('$2');
    const needsRoleUpdate = existing.role !== role;
    const needsBidderUpdate = existing.bidder_id !== bidderId;
    const passwordMatches = await bcrypt.compare(password, existing.password_hash);
    const needsPasswordUpdate = !passwordMatches;
    const needsEncryptedBackfill = !existing.password_encrypted;

    if (needsHashMigration || needsRoleUpdate || needsBidderUpdate || needsPasswordUpdate || needsEncryptedBackfill) {
      const nextHash = needsHashMigration || needsPasswordUpdate
        ? passwordHash
        : existing.password_hash;
      const nextEncrypted = needsPasswordUpdate || needsEncryptedBackfill
        ? passwordEncrypted
        : existing.password_encrypted;

      await execute(
        `UPDATE admins SET password_hash = $1, password_encrypted = $2, role = $3, bidder_id = $4, updated_at = NOW() WHERE id = $5`,
        [nextHash, nextEncrypted, role, bidderId, existing.id]
      );
      logger.info('User account updated', { username, role });
    }
    return existing.id;
  }

  const row = await queryOne<{ id: number }>(
    'INSERT INTO admins (username, password_hash, password_encrypted, role, bidder_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [username, passwordHash, passwordEncrypted, role, bidderId]
  );
  logger.info('User account created', { username, role });
  return row!.id;
}

async function ensureDefaultSettings(): Promise<void> {
  const existing = await queryOne<{ key: string }>(
    'SELECT key FROM settings WHERE key = $1',
    ['admin_ui_mode']
  );
  if (!existing) {
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())`,
      ['admin_ui_mode', 'mode1']
    );
    logger.info('Default setting created', { key: 'admin_ui_mode', value: 'mode1' });
  }

  const stacks = await queryOne<{ key: string }>(
    'SELECT key FROM settings WHERE key = $1',
    [CANDIDATE_STACKS_SETTING_KEY]
  );
  if (!stacks) {
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())`,
      [CANDIDATE_STACKS_SETTING_KEY, serializeCandidateStacks([...DEFAULT_CANDIDATE_STACKS])]
    );
    logger.info('Default setting created', { key: CANDIDATE_STACKS_SETTING_KEY });
  }
}

export async function seedAdminOnly(): Promise<void> {
  await ensureUser(config.adminUsername, config.adminPassword, 'admin', null);
  await ensureDefaultSettings();
}

export async function seedAdmin(): Promise<void> {
  await seedAdminOnly();
}
