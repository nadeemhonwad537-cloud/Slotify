import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import { ok } from '../middleware/error';
import { COOKIE, cookieBase, newCsrfToken } from '../middleware/security';
import * as auth from '../services/authService';
import { HttpError } from '../utils/errors';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(COOKIE.access, accessToken, { ...cookieBase, httpOnly: true, path: '/', maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000 });
  res.cookie(COOKIE.refresh, refreshToken, { ...cookieBase, httpOnly: true, path: '/api/auth', maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000 });
}
function clearSessionCookies(res: Response) {
  res.clearCookie(COOKIE.access, { ...cookieBase, httpOnly: true, path: '/' });
  res.clearCookie(COOKIE.refresh, { ...cookieBase, httpOnly: true, path: '/api/auth' });
}

// Clients call this first; it sets a readable CSRF cookie and returns the same token.
authRouter.get('/csrf', (_req, res) => {
  const token = newCsrfToken();
  res.cookie(COOKIE.csrf, token, { ...cookieBase, httpOnly: false, path: '/' });
  res.json(ok({ csrfToken: token }));
});

const loginSchema = z.object({ identifier: z.string().min(1).max(255), password: z.string().min(1).max(128) });

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { identifier, password } = loginSchema.parse(req.body);
    const r = await auth.login(identifier, password);
    setSessionCookies(res, r.accessToken, r.refreshToken);
    res.json(ok({ user: r.user }));
  } catch (e) { next(e); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE.refresh];
    if (!token) throw new HttpError(401, 'No session', 'INVALID_SESSION');
    const r = await auth.rotateRefresh(token);
    setSessionCookies(res, r.accessToken, r.refreshToken);
    res.json(ok({ refreshed: true }));
  } catch (e) { clearSessionCookies(res); next(e); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await auth.revokeRefresh(req.cookies?.[COOKIE.refresh]);
    clearSessionCookies(res);
    res.json(ok({ loggedOut: true }));
  } catch (e) { next(e); }
});

authRouter.get('/me', authenticate, (req, res) => res.json(ok({ user: req.user })));

/**
 * POST /api/auth/change-password
 * Self-service password change for the authenticated user.
 * Requires the correct current password (unlike admin reset-password).
 * Revokes all sessions after success so the user re-authenticates with the new password.
 */
authRouter.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      current_password: z.string().min(1).max(128),
      new_password: z.string().min(12, 'Password must be at least 12 characters').max(128),
    }).strict();
    const { current_password, new_password } = schema.parse(req.body);
    await auth.changePassword(req.user!.userId, current_password, new_password);
    clearSessionCookies(res);
    res.json(ok({ changed: true, message: 'Password updated. Please log in again.' }));
  } catch (e) { next(e); }
});
