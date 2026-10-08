import bcrypt from 'bcryptjs';
import { queryOne, execute } from './connection';
import { config } from '../config/env';
import { logger } from '../utilities/logger';

const BCRYPT_ROUNDS = 12;

export async function seedAdminOnly(): Promise<void> {
  await ensureNewSchemaSuper();
}

async function ensureNewSchemaSuper(): Promise<void> {
  const existingSuper = await queryOne<{ u_id: number }>(
    `SELECT u_id FROM users WHERE role = 'super' ORDER BY u_id ASC LIMIT 1`
  );
  if (existingSuper) return;

  const existingUsername = await queryOne<{ u_id: number }>(
    'SELECT u_id FROM users WHERE username = $1',
    [config.adminUsername]
  );
  if (existingUsername) {
    throw new Error(
      `Cannot seed the new-schema Super account: username "${config.adminUsername}" is already used by a non-Super User.`
    );
  }
  if (!config.adminPassword) {
    throw new Error('ADMIN_PASSWORD is required to seed the new-schema Super account.');
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, BCRYPT_ROUNDS);
  await execute(
    `INSERT INTO users (username, name, role, password_hash, parent_user_id)
     VALUES ($1, $1, 'super', $2, NULL)`,
    [config.adminUsername, passwordHash]
  );
  logger.info('New-schema Super account created', { username: config.adminUsername });
}

export async function seedAdmin(): Promise<void> {
  await seedAdminOnly();
}
