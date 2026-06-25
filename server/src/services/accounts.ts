import bcrypt from 'bcryptjs';
import { execute, queryOne } from '../database/connection';
import type { UserRole } from '../lib/roles';
import { encryptCredential } from '../utilities/credential-crypto';

const BCRYPT_ROUNDS = 12;

export interface CreateAccountInput {
  username: string;
  password: string;
  role: UserRole;
  bidderId?: number | null;
  isActive?: boolean;
}

export async function createAccount(input: CreateAccountInput): Promise<{ id: number } | null> {
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const encrypted = encryptCredential(input.password);
  const isActive = input.isActive ?? true;
  return queryOne<{ id: number }>(
    `INSERT INTO admins (username, password_hash, password_encrypted, role, bidder_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.username, hash, encrypted, input.role, input.bidderId ?? null, isActive]
  );
}

export async function updateAccountPassword(accountId: number, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const encrypted = encryptCredential(password);
  await execute(
    'UPDATE admins SET password_hash = $1, password_encrypted = $2, updated_at = NOW() WHERE id = $3',
    [hash, encrypted, accountId]
  );
}

export async function usernameExists(username: string): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM admins WHERE username = $1',
    [username]
  );
  return Boolean(row);
}
