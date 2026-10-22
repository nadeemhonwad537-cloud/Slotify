import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { exec, pool, query } from '../src/db/pool';

const app = createApp();
const PW = 'Test-Password-12345'; // test-only
const ORIGIN = 'http://localhost:5173';

async function mkUser(username: string, roles: string[], password = PW) {
  const hash = await bcrypt.hash(password, 4);
  const r = await exec('INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)', [username, `${username}@example.test`, hash, `Test ${username}`]);
  for (const role of roles) await exec('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [r.insertId, role]);
  return r.insertId;
}

/** An agent that keeps cookies and sends the CSRF header on every unsafe request. */
async function client() {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/auth/csrf');
  const token: string = body.data.csrfToken;
  const post = (url: string, data: object = {}) => agent.post(url).set('Origin', ORIGIN).set('x-csrf-token', token).send(data);
  const patch = (url: string, data: object = {}) => agent.patch(url).set('Origin', ORIGIN).set('x-csrf-token', token).send(data);
  return { agent, token, post, patch };
}
const loginAs = async (u: string, pw = PW) => { const c = await client(); const r = await c.post('/api/auth/login', { identifier: u, password: pw }); return { c, r }; };
const cookieValue = (res: request.Response, name: string) => {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((s) => s.startsWith(name + '='));
  return raw ? raw.split(';')[0].slice(name.length + 1) : undefined;
};

let adminId: number;
beforeAll(async () => {
  await exec("DELETE FROM users WHERE username LIKE 'test\\_%'");
  adminId = await mkUser('test_admin', ['ADMIN']);
  await mkUser('test_faculty', ['FACULTY']);
  await mkUser('test_student', ['STUDENT']);
  await mkUser('test_coord', ['COORDINATOR']);
  await mkUser('test_norole', []);
  await mkUser('test_locky', ['STUDENT']);
});
afterAll(async () => { await exec("DELETE FROM users WHERE username LIKE 'test\\_%'"); await pool.end(); });

describe('security basics', () => {
  it('health endpoint is public', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { status: 'up' } });
  });
  it('rejects state-changing requests without a CSRF token', async () => {
    const r = await request(app).post('/api/auth/login').send({ identifier: 'test_admin', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF');
  });
  it('rejects a mismatched CSRF token', async () => {
    const agent = request.agent(app); await agent.get('/api/auth/csrf');
    const r = await agent.post('/api/auth/login').set('x-csrf-token', 'wrong').send({ identifier: 'test_admin', password: PW });
    expect(r.status).toBe(403);
  });
  it('rejects a disallowed Origin', async () => {
    const c = await client();
    const r = await c.agent.post('/api/auth/login').set('Origin', 'http://evil.example').set('x-csrf-token', c.token).send({ identifier: 'test_admin', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('BAD_ORIGIN');
  });
  it('unknown routes return a JSON 404', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
  });
});

describe('login / logout / session', () => {
  it('logs in, sets HttpOnly cookies, and never returns the password hash', async () => {
    const { r } = await loginAs('test_admin');
    expect(r.status).toBe(200);
    expect(r.body.data.user.roles).toEqual(['ADMIN']);
    expect(JSON.stringify(r.body)).not.toMatch(/password/i);
    const cookies = (r.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/slotify_at=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/slotify_rt=[^;]+;.*Path=\/api\/auth;.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Strict/i);
  });
  it('gives the same error for an unknown user and a wrong password', async () => {
    const a = (await loginAs('no_such_user_xyz')).r;
    const b = (await loginAs('test_admin', 'wrong-password-123')).r;
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
  });
  it('accepts email as the identifier', async () => {
    expect((await loginAs('test_student@example.test')).r.status).toBe(200);
  });
  it('/me requires authentication and returns the user and roles', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const { c } = await loginAs('test_faculty');
    const me = await c.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ username: 'test_faculty', roles: ['FACULTY'] });
  });
  it('logout revokes the refresh session and clears access', async () => {
    const { c, r } = await loginAs('test_student');
    const oldRt = cookieValue(r, 'slotify_rt')!;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.agent.get('/api/auth/me')).status).toBe(401);
    const replay = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', [`slotify_rt=${oldRt}`, `slotify_csrf=${c.token}`]).set('x-csrf-token', c.token);
    expect(replay.status).toBe(401);
  });
  it('rotates refresh tokens and revokes everything if an old token is replayed', async () => {
    const { c, r } = await loginAs('test_student');
    const rt1 = cookieValue(r, 'slotify_rt')!;
    const r2 = await c.post('/api/auth/refresh');
    expect(r2.status).toBe(200);
    const rt2 = cookieValue(r2, 'slotify_rt')!;
    expect(rt2).not.toBe(rt1);
    const replay = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', [`slotify_rt=${rt1}`, `slotify_csrf=${c.token}`]).set('x-csrf-token', c.token);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REUSE');
    const afterReuse = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', [`slotify_rt=${rt2}`, `slotify_csrf=${c.token}`]).set('x-csrf-token', c.token);
    expect(afterReuse.status).toBe(401);
  });
  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) expect((await loginAs('test_locky', 'wrong-password-123')).r.status).toBe(401);
    const locked = await loginAs('test_locky');
    expect(locked.r.status).toBe(423);
    expect(locked.r.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('role-based authorization (enforced in the backend)', () => {
  it('denies user management to FACULTY, STUDENT, COORDINATOR and role-less users', async () => {
    for (const u of ['test_faculty', 'test_student', 'test_coord', 'test_norole']) {
      const { c } = await loginAs(u);
      expect((await c.agent.get('/api/users')).status, `${u} GET`).toBe(403);
      const post = await c.post('/api/users', { username: 'test_x', email: 'x@example.test', name: 'X', password: 'Another-Pass-12345', roles: ['ADMIN'] });
      expect(post.status, `${u} POST`).toBe(403);
    }
    const anon = await request(app).get('/api/users');
    expect(anon.status).toBe(401);
  });
  it('ADMIN creates accounts; the new account can log in with its role', async () => {
    const { c } = await loginAs('test_admin');
    const res = await c.post('/api/users', { username: 'test_new', email: 'test_new@example.test', name: 'New User', password: 'Another-Pass-12345', roles: ['FACULTY', 'FACULTY'] });
    expect(res.status).toBe(201);
    expect(res.body.data.roles).toEqual(['FACULTY']);
    const l = await loginAs('test_new', 'Another-Pass-12345');
    expect(l.r.status).toBe(200);
    const [row] = await query<any>('SELECT password_hash FROM users WHERE username = ?', ['test_new']);
    expect(row.password_hash).toMatch(/^\$2[aby]\$/); // hashed, not plaintext
  });
  it('validates input: short password, bad role, bad username, duplicates', async () => {
    const { c } = await loginAs('test_admin');
    const base = { username: 'test_v', email: 'test_v@example.test', name: 'V', password: 'Another-Pass-12345', roles: ['STUDENT'] };
    expect((await c.post('/api/users', { ...base, password: 'short' })).status).toBe(400);
    expect((await c.post('/api/users', { ...base, roles: ['SUPERUSER'] })).status).toBe(400);
    expect((await c.post('/api/users', { ...base, username: 'a b' })).status).toBe(400);
    expect((await c.post('/api/users', { ...base, roles: [] })).status).toBe(400);
    expect((await c.post('/api/users', base)).status).toBe(201);
    expect((await c.post('/api/users', base)).status).toBe(409);
  });
  it('disabling a user blocks their existing session immediately', async () => {
    const victim = await mkUser('test_victim', ['STUDENT']);
    const v = await loginAs('test_victim');
    expect((await v.c.agent.get('/api/auth/me')).status).toBe(200);
    const { c } = await loginAs('test_admin');
    expect((await c.patch(`/api/users/${victim}/status`, { status: 'DISABLED' })).status).toBe(200);
    expect((await v.c.agent.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs('test_victim')).r.status).toBe(403);
  });
  it('an admin cannot disable their own account', async () => {
    const { c } = await loginAs('test_admin');
    expect((await c.patch(`/api/users/${adminId}/status`, { status: 'DISABLED' })).status).toBe(400);
  });
});

describe('change-password (self-service)', () => {
  const NEW_PW = 'NewPassword-9876!';

  it('requires authentication', async () => {
    const c = await client();
    const r = await c.post('/api/auth/change-password', { current_password: PW, new_password: NEW_PW });
    expect(r.status).toBe(401);
  });

  it('rejects wrong current password', async () => {
    await mkUser('test_cpw1', ['FACULTY']);
    const { c } = await loginAs('test_cpw1');
    const r = await c.post('/api/auth/change-password', { current_password: 'wrong-password-XYZ', new_password: NEW_PW });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a new password shorter than 12 characters', async () => {
    await mkUser('test_cpw2', ['FACULTY']);
    const { c } = await loginAs('test_cpw2');
    const r = await c.post('/api/auth/change-password', { current_password: PW, new_password: 'short' });
    expect(r.status).toBe(400);
  });

  it('changes the password, revokes all sessions, and the old password no longer works', async () => {
    await mkUser('test_cpw3', ['FACULTY']);
    const { c, r: loginRes } = await loginAs('test_cpw3');
    // Verify logged in
    expect((await c.agent.get('/api/auth/me')).status).toBe(200);
    // Change password
    const change = await c.post('/api/auth/change-password', { current_password: PW, new_password: NEW_PW });
    expect(change.status).toBe(200);
    expect(change.body.data.changed).toBe(true);
    // Old session is revoked — refresh should fail
    const refresh = await c.post('/api/auth/refresh');
    expect(refresh.status).toBe(401);
    // Old password no longer works
    expect((await loginAs('test_cpw3', PW)).r.status).toBe(401);
    // New password works
    expect((await loginAs('test_cpw3', NEW_PW)).r.status).toBe(200);
  });
});
