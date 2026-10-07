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
  accountId: number | null = null
): Promise<number> {
  if (!password) {
    logger.warn(`No password configured for ${username}, skipping account seed`);
    return 0;
  }

  const existing = await queryOne<{
    id: number;
    password_hash: string;
    role: string;
    account_id: number | null;
    password_encrypted: string | null;
  }>(
    'SELECT id, password_hash, role, account_id, password_encrypted FROM admins WHERE username = $1',
    [username]
  );

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const passwordEncrypted = encryptCredential(password);

  if (existing) {
    const needsHashMigration = !existing.password_hash.startsWith('$2');
    const needsRoleUpdate = existing.role !== role;
    const needsAccountUpdate = existing.account_id !== accountId;
    const passwordMatches = await bcrypt.compare(password, existing.password_hash);
    const needsPasswordUpdate = needsHashMigration && !passwordMatches;
    const needsEncryptedBackfill = !existing.password_encrypted && passwordMatches;

    if (needsHashMigration || needsRoleUpdate || needsAccountUpdate || needsPasswordUpdate || needsEncryptedBackfill) {
      const nextHash = needsHashMigration || needsPasswordUpdate
        ? passwordHash
        : existing.password_hash;
      const nextEncrypted = needsPasswordUpdate || needsEncryptedBackfill
        ? passwordEncrypted
        : existing.password_encrypted;

      await execute(
        `UPDATE admins SET password_hash = $1, password_encrypted = $2, role = $3, account_id = $4, updated_at = NOW() WHERE id = $5`,
        [nextHash, nextEncrypted, role, accountId, existing.id]
      );
      logger.info('User account updated', { username, role });
    }
    return existing.id;
  }

  const row = await queryOne<{ id: number }>(
    'INSERT INTO admins (username, password_hash, password_encrypted, role, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [username, passwordHash, passwordEncrypted, role, accountId]
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
  const existingSuper = await queryOne<{ id: number; username: string }>(
    `SELECT id, username FROM admins WHERE role = 'super' ORDER BY id ASC LIMIT 1`
  );
  if (existingSuper) {
    if (config.adminUsername === 'super' && existingSuper.username === 'admin') {
      await execute(
        `UPDATE admins SET username = $1, updated_at = NOW()
         WHERE username = $2 AND role = 'super'`,
        ['super', 'admin']
      );
      existingSuper.username = 'super';
    }
    await ensureUser(existingSuper.username, config.adminPassword, 'super', null);
  } else {
    await ensureUser(config.adminUsername, config.adminPassword, 'super', null);
  }
  await ensureDefaultSettings();
}

export async function seedAdmin(): Promise<void> {
  await seedAdminOnly();
}
