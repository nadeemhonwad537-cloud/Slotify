import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { query } from '../db/pool';
import { getRoles, Role, verifyAccessToken } from '../services/authService';
import { HttpError } from '../utils/errors';
import { COOKIE } from './security';

export interface AuthUser { userId: number; username: string; name: string; roles: Role[] }
declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

/** Authenticates from the HttpOnly access cookie; re-checks account status and roles in the DB on every request. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE.access];
    if (!token) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    let userId: number;
    try { userId = verifyAccessToken(token); } catch { throw new HttpError(401, 'Session expired or invalid', 'UNAUTHENTICATED'); }
    const rows = await query<RowDataPacket>('SELECT user_id, username, name, status FROM users WHERE user_id = ?', [userId]);
    const u = rows[0];
    if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'Account unavailable', 'UNAUTHENTICATED');
    req.user = { userId: u.user_id, username: u.username, name: u.name, roles: await getRoles(u.user_id) };
    next();
  } catch (e) { next(e); }
}

/** Permission-based authorization using the configurable role_permissions table. */
export function requirePermission(...permissions: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
      if (req.user.roles.length === 0) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
      const rows = await query<RowDataPacket>(
        'SELECT 1 FROM role_permissions WHERE role IN (?) AND permission IN (?) LIMIT 1', [req.user.roles, permissions]);
      if (rows.length === 0) throw new HttpError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
      next();
    } catch (e) { next(e); }
  };
}
