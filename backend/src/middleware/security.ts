import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { HttpError } from '../utils/errors';

export const COOKIE = { access: 'slotify_at', refresh: 'slotify_rt', csrf: 'slotify_csrf' } as const;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const cookieBase = { sameSite: 'strict' as const, secure: env.cookieSecure };

/** Double-submit CSRF token + Origin check on every state-changing request. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.allowedOrigins.includes(origin)) return next(new HttpError(403, 'Origin not allowed', 'BAD_ORIGIN'));
  const cookie = req.cookies?.[COOKIE.csrf];
  const header = req.get('x-csrf-token');
  if (!cookie || !header) return next(new HttpError(403, 'CSRF token missing', 'CSRF'));
  const a = Buffer.from(cookie), b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return next(new HttpError(403, 'CSRF token invalid', 'CSRF'));
  next();
}

export function newCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
