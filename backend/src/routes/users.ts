import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import { hashPassword, revokeAllForUser, ROLES } from '../services/authService';
import { HttpError } from '../utils/errors';

export const usersRouter = Router();
usersRouter.use(authenticate, requirePermission('users:manage'));

const idParam = z.coerce.number().int().positive();
const roleEnum = z.enum(ROLES as [string, ...string[]]);

const createSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,50}$/, '3-50 chars: letters, digits, . _ -'),
  email: z.string().email().max(255),
  name: z.string().min(1).max(150),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  roles: z.array(roleEnum).min(1).max(4),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  email: z.string().email().max(255).optional(),
  roles: z.array(roleEnum).min(1).max(4).optional(),
}).strict();

// Admin-created accounts only (there is no self-registration).
usersRouter.post('/', async (req, res, next) => {
  try {
    const b = createSchema.parse(req.body);
    const hash = await hashPassword(b.password);
    const userId = await withTransaction(async (conn) => {
      const [r]: any = await conn.query('INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)', [b.username, b.email.toLowerCase(), hash, b.name]);
      for (const role of new Set(b.roles)) await conn.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [r.insertId, role]);
      return r.insertId as number;
    });
    res.status(201).json(ok({ userId, username: b.username, roles: [...new Set(b.roles)] }));
  } catch (e) { next(e); }
});

usersRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await query<RowDataPacket>(
      `SELECT u.user_id AS userId, u.username, u.email, u.name, u.status, u.created_at AS createdAt,
              GROUP_CONCAT(r.role ORDER BY r.role) AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.user_id GROUP BY u.user_id ORDER BY u.user_id`);
    res.json(ok(rows.map((r) => ({ ...r, roles: r.roles ? String(r.roles).split(',') : [] }))));
  } catch (e) { next(e); }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const rows = await query<RowDataPacket>(
      `SELECT u.user_id AS userId, u.username, u.email, u.name, u.status, u.created_at AS createdAt, u.locked_until AS lockedUntil,
              GROUP_CONCAT(r.role ORDER BY r.role) AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.user_id WHERE u.user_id = ? GROUP BY u.user_id`, [id]);
    if (!rows[0]) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    res.json(ok({ ...rows[0], roles: rows[0].roles ? String(rows[0].roles).split(',') : [] }));
  } catch (e) { next(e); }
});

usersRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const { status } = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(req.body);
    if (id === req.user!.userId) throw new HttpError(400, 'You cannot change your own status', 'SELF_CHANGE');
    await withTransaction(async (conn) => {
      const [r]: any = await conn.query('UPDATE users SET status = ? WHERE user_id = ?', [status, id]);
      if (r.affectedRows === 0) throw new HttpError(404, 'User not found', 'NOT_FOUND');
      await audit(conn, req.user!.userId, 'USER_STATUS_CHANGED', 'users', id, { status });
    });
    if (status === 'DISABLED') await revokeAllForUser(id);
    res.json(ok({ userId: id, status }));
  } catch (e) { next(e); }
});

// Edit name / email / roles. Username is immutable; password reset is a separate endpoint.
usersRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const b = patchSchema.parse(req.body);
    if (Object.keys(b).length === 0) throw new HttpError(400, 'No updatable fields supplied', 'EMPTY_UPDATE');
    const newRoles = b.roles ? [...new Set(b.roles)] : undefined;
    await withTransaction(async (conn) => {
      const [[u]]: any = await conn.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [id]);
      if (!u) throw new HttpError(404, 'User not found', 'NOT_FOUND');
      if (newRoles) {
        const [cur]: any = await conn.query('SELECT role FROM user_roles WHERE user_id = ?', [id]);
        const wasAdmin = cur.some((r: any) => r.role === 'ADMIN');
        if (wasAdmin && !newRoles.includes('ADMIN')) {
          if (id === req.user!.userId) throw new HttpError(400, 'You cannot remove your own ADMIN role', 'SELF_DEMOTION');
          const [[a]]: any = await conn.query(
            `SELECT COUNT(*) AS n FROM user_roles r JOIN users x ON x.user_id = r.user_id
             WHERE r.role = 'ADMIN' AND x.status = 'ACTIVE' AND r.user_id <> ?`, [id]);
          if (a.n === 0) throw new HttpError(409, 'At least one active ADMIN must remain', 'LAST_ADMIN');
        }
        await conn.query('DELETE FROM user_roles WHERE user_id = ? AND role NOT IN (?)', [id, newRoles]);
        for (const role of newRoles) await conn.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [id, role]);
      }
      const set: Record<string, unknown> = {};
      if (b.name !== undefined) set.name = b.name;
      if (b.email !== undefined) set.email = b.email.toLowerCase();
      if (Object.keys(set).length) await conn.query('UPDATE users SET ? WHERE user_id = ?', [set, id]);
      await audit(conn, req.user!.userId, 'USER_UPDATED', 'users', id, { fields: Object.keys(b), roles: newRoles });
    });
    if (newRoles) await revokeAllForUser(id); // role change takes effect on next login
    res.json(ok({ userId: id }));
  } catch (e) { next(e); }
});

// Admin sets a new password (min 12 chars). Existing sessions are revoked and any lockout cleared.
usersRouter.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const { password } = z.object({ password: z.string().min(12, 'Password must be at least 12 characters').max(128) }).strict().parse(req.body);
    const hash = await hashPassword(password);
    await withTransaction(async (conn) => {
      const [r]: any = await conn.query('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE user_id = ?', [hash, id]);
      if (r.affectedRows === 0) throw new HttpError(404, 'User not found', 'NOT_FOUND');
      await audit(conn, req.user!.userId, 'USER_PASSWORD_RESET', 'users', id);
    });
    await revokeAllForUser(id);
    res.json(ok({ userId: id, reset: true }));
  } catch (e) { next(e); }
});
