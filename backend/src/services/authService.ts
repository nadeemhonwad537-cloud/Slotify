import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
import { env } from '../config/env';
import { exec, query, withTransaction } from '../db/pool';
import { HttpError } from '../utils/errors';

export type Role = 'ADMIN' | 'FACULTY' | 'STUDENT' | 'COORDINATOR';
export const ROLES: Role[] = ['ADMIN', 'FACULTY', 'STUDENT', 'COORDINATOR'];

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the user does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', env.BCRYPT_COST);

export const hashPassword = (pw: string) => bcrypt.hash(pw, env.BCRYPT_COST);
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

interface UserRow extends RowDataPacket {
  user_id: number; username: string; email: string; password_hash: string; name: string;
  status: 'ACTIVE' | 'DISABLED'; failed_login_count: number; locked_until: string | null;
}

export async function getRoles(userId: number): Promise<Role[]> {
  const rows = await query<RowDataPacket>('SELECT role FROM user_roles WHERE user_id = ?', [userId]);
  return rows.map((r) => r.role as Role);
}

export function signAccessToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60, algorithm: 'HS256' });
}

export function verifyAccessToken(token: string): number {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  return Number(payload.sub);
}

export async function issueRefreshToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
  await exec('INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [userId, sha256(token), expires]);
  return token;
}

export async function login(identifier: string, password: string) {
  const users = await query<UserRow>('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [identifier, identifier]);
  const user = users[0];
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }
  if (user.locked_until && new Date(user.locked_until + 'Z') > new Date()) {
    throw new HttpError(423, 'Account temporarily locked. Try again later.', 'ACCOUNT_LOCKED');
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const failed = user.failed_login_count + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await exec('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE user_id = ?', [lock ? 0 : failed, lock, user.user_id]);
    throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'Account is disabled', 'ACCOUNT_DISABLED');
  await exec('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE user_id = ?', [user.user_id]);
  const roles = await getRoles(user.user_id);
  return {
    user: { userId: user.user_id, username: user.username, name: user.name, email: user.email, roles },
    accessToken: signAccessToken(user.user_id),
    refreshToken: await issueRefreshToken(user.user_id),
  };
}

/** Rotates a refresh token. Presenting an already-revoked token revokes ALL of that user's sessions (reuse detection). */
export async function rotateRefresh(token: string) {
  const hash = sha256(token);
  const rows = await query<RowDataPacket>('SELECT session_id, user_id, expires_at, revoked_at FROM refresh_sessions WHERE token_hash = ?', [hash]);
  const s = rows[0];
  if (!s) throw new HttpError(401, 'Invalid session', 'INVALID_SESSION');
  if (s.revoked_at) {
    await exec('UPDATE refresh_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [s.user_id]);
    throw new HttpError(401, 'Session reuse detected; please log in again', 'SESSION_REUSE');
  }
  if (new Date(s.expires_at + 'Z') < new Date()) throw new HttpError(401, 'Session expired', 'SESSION_EXPIRED');
  const users = await query<UserRow>('SELECT * FROM users WHERE user_id = ?', [s.user_id]);
  if (!users[0] || users[0].status !== 'ACTIVE') throw new HttpError(403, 'Account is disabled', 'ACCOUNT_DISABLED');
  const newToken = await withTransaction(async (conn) => {
    await conn.query('UPDATE refresh_sessions SET revoked_at = NOW() WHERE session_id = ?', [s.session_id]);
    const t = crypto.randomBytes(48).toString('hex');
    const expires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await conn.query('INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [s.user_id, sha256(t), expires]);
    return t;
  });
  return { userId: s.user_id as number, accessToken: signAccessToken(s.user_id), refreshToken: newToken };
}

export async function revokeRefresh(token: string | undefined) {
  if (token) await exec('UPDATE refresh_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [sha256(token)]);
}

export async function revokeAllForUser(userId: number) {
  await exec('UPDATE refresh_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

/**
 * Self-service password change. Verifies the current password before updating.
 * Revokes all active sessions after a successful change so the user must re-authenticate.
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const users = await query<UserRow>('SELECT * FROM users WHERE user_id = ?', [userId]);
  const user = users[0];
  if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new HttpError(401, 'Current password is incorrect', 'INVALID_CREDENTIALS');
  const newHash = await hashPassword(newPassword);
  await exec('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE user_id = ?', [newHash, userId]);
  await revokeAllForUser(userId);
}
