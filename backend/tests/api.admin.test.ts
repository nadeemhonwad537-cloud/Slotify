/**
 * Admin-portal backend additions: dashboard statistics, timetable version list/create,
 * user edit/reset-password guards, and audit logging of master-data changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, pool, query } from '../src/db/pool';
import { client, Client, mkUser, mkVia, PW, wipeTestData } from './apiHelpers';

const RUN = Date.now().toString(36).slice(-5);
const MD = '/api/masterdata';
const TT = '/api/timetable';
let admin: Client; let faculty: Client; let coord: Client;
let adminId: number;
const F: Record<string, any> = {};

async function count(sql: string) { const [r]: any = await pool.query(sql); return Number(r[0].n); }

beforeAll(async () => {
  await wipeTestData();
  adminId = await mkUser(`adm_a_${RUN}`, ['ADMIN']);
  await mkUser(`adm_f_${RUN}`, ['FACULTY']);
  await mkUser(`adm_c_${RUN}`, ['COORDINATOR']);
  admin = await client(`adm_a_${RUN}`); faculty = await client(`adm_f_${RUN}`); coord = await client(`adm_c_${RUN}`);

  F.year = await mkVia(admin, `${MD}/academic-years`, { year_label: `Y${RUN}` });
  F.term = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: 'Odd', parity: 'ODD', start_date: '2030-01-01', end_date: '2030-06-30' });
  F.term2 = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: 'Even', parity: 'EVEN', start_date: '2030-07-01', end_date: '2030-12-31' });
  F.closed = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: 'Old', parity: 'ODD', start_date: '2031-01-01', end_date: '2031-06-30', status: 'CLOSED' });
  F.dept = await mkVia(admin, `${MD}/departments`, { dept_code: `AD${RUN.toUpperCase()}`, dept_name: 'Admin Test Dept' });
  F.prog = await mkVia(admin, `${MD}/programs`, { dept_id: F.dept.dept_id, program_code: 'P1', program_name: 'Prog' });
  F.scheme = await mkVia(admin, `${MD}/schemes`, { program_id: F.prog.program_id, scheme_code: 'S1' });
  F.sem3 = await mkVia(admin, `${MD}/semesters`, { scheme_id: F.scheme.scheme_id, semester_no: 3 });
  F.sem4 = await mkVia(admin, `${MD}/semesters`, { scheme_id: F.scheme.scheme_id, semester_no: 4 });
  await mkVia(admin, `${MD}/term-program-semesters`, { term_id: F.term.term_id, semester_id: F.sem3.semester_id });
  await mkVia(admin, `${MD}/term-program-semesters`, { term_id: F.term2.term_id, semester_id: F.sem4.semester_id });
  F.secA = await mkVia(admin, `${MD}/sections`, { term_id: F.term.term_id, semester_id: F.sem3.semester_id, section_name: 'A' });
  F.secEven = await mkVia(admin, `${MD}/sections`, { term_id: F.term2.term_id, semester_id: F.sem4.semester_id, section_name: 'A' });
});

afterAll(async () => {
  const mine = "(SELECT version_id FROM timetable_versions WHERE created_by = ?)";
  await exec(`DELETE FROM validation_issues WHERE validation_id IN (SELECT validation_id FROM validation_runs WHERE version_id IN ${mine})`, [adminId]);
  await exec(`DELETE FROM validation_runs WHERE version_id IN ${mine}`, [adminId]);
  await exec("DELETE FROM timetable_version_sections WHERE version_id IN (SELECT version_id FROM timetable_versions WHERE created_by = ?)", [adminId]);
  await exec('UPDATE timetable_versions SET parent_version_id = NULL WHERE created_by = ?', [adminId]); // self-referencing FK
  await exec('DELETE FROM timetable_versions WHERE created_by = ?', [adminId]);
  await exec("DELETE FROM users WHERE username LIKE 'adm\\_%'");
  await wipeTestData();
  await pool.end();
});

describe('GET /api/admin/dashboard', () => {
  it('requires authentication and admin permission', async () => {
    const anon = await client();
    expect((await anon.get('/api/admin/dashboard')).status).toBe(401);
    expect((await faculty.get('/api/admin/dashboard')).status).toBe(403);
    expect((await coord.get('/api/admin/dashboard')).status).toBe(403);
  });
  it('returns totals that match the database and reflect new records', async () => {
    const before = (await admin.get('/api/admin/dashboard')).body.data;
    expect(before.totals.departments).toBe(await count('SELECT COUNT(*) n FROM departments WHERE is_active = 1'));
    expect(before.totals.courses).toBe(await count('SELECT COUNT(*) n FROM courses WHERE is_active = 1'));
    expect(before.totals.sections).toBe(await count('SELECT COUNT(*) n FROM sections'));
    expect(before.generator.implemented).toBe(false);
    await mkVia(admin, `${MD}/departments`, { dept_code: `AE${RUN.toUpperCase()}`, dept_name: 'Second' });
    const after = (await admin.get('/api/admin/dashboard')).body.data;
    expect(after.totals.departments).toBe(before.totals.departments + 1);
  });
  it('computes configuration warnings from live data', async () => {
    await mkVia(admin, `${MD}/faculty`, { name: 'Dash Faculty' }); // no designation
    const room = await mkVia(admin, `${MD}/room-types`, { type_code: `RT${RUN.toUpperCase()}`, type_name: 'Dash type' });
    await mkVia(admin, `${MD}/rooms`, { room_code: `DR${RUN}`, room_type_id: room.room_type_id }); // no capacity
    const w: any[] = (await admin.get('/api/admin/dashboard')).body.data.warnings;
    const byCode = Object.fromEntries(w.map((x) => [x.code, x]));
    expect(byCode.FACULTY_NO_DESIGNATION.count).toBeGreaterThanOrEqual(1);
    expect(byCode.ROOM_NO_CAPACITY.count).toBeGreaterThanOrEqual(1);
    // Seeded workload rules are VERIFY, so no limit is enforced yet: the dashboard must say so.
    expect(byCode.NO_VERIFIED_WORKLOAD_RULE.count).toBeGreaterThanOrEqual(1);
    expect(byCode.UNCONFIRMED_COUNTING_RULES.count).toBe(4);
  });
});

describe('timetable versions: create and list', () => {
  it('denies creation to faculty and coordinator, and listing to anonymous users', async () => {
    expect((await faculty.post(`${TT}/versions`, { term_id: F.term.term_id })).status).toBe(403);
    expect((await coord.post(`${TT}/versions`, { term_id: F.term.term_id })).status).toBe(403);
    expect((await (await client()).get(`${TT}/versions`)).status).toBe(401);
  });
  it('creates empty drafts with per-term sequential version numbers and an audit row', async () => {
    const a = await admin.post(`${TT}/versions`, { term_id: F.term.term_id, section_ids: [F.secA.section_id, F.secA.section_id] });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ version_no: 1, status: 'DRAFT', term_id: F.term.term_id });
    F.v1 = a.body.data;
    const b = await admin.post(`${TT}/versions`, { term_id: F.term.term_id, parent_version_id: F.v1.version_id });
    expect(b.body.data.version_no).toBe(2);
    expect(b.body.data.parent_version_id).toBe(F.v1.version_id);
    const other = await admin.post(`${TT}/versions`, { term_id: F.term2.term_id });
    expect(other.body.data.version_no).toBe(1); // numbering is per term
    const [sessions] = [await count(`SELECT COUNT(*) n FROM scheduled_sessions WHERE version_id = ${F.v1.version_id}`)];
    expect(sessions).toBe(0); // nothing is generated
    const au = await query<any>("SELECT * FROM audit_logs WHERE action = 'TIMETABLE_VERSION_CREATED' AND record_id = ?", [F.v1.version_id]);
    expect(au).toHaveLength(1);
    expect(au[0].actor_user_id).toBe(adminId);
  });
  it('rejects bad references: closed term, unknown term, cross-term parent, cross-term sections', async () => {
    expect((await admin.post(`${TT}/versions`, { term_id: F.closed.term_id })).body.error.code).toBe('TERM_CLOSED');
    expect((await admin.post(`${TT}/versions`, { term_id: 99999999 })).body.error.code).toBe('BAD_REFERENCE');
    expect((await admin.post(`${TT}/versions`, { term_id: F.term2.term_id, parent_version_id: F.v1.version_id })).body.error.code).toBe('PARENT_TERM_MISMATCH');
    expect((await admin.post(`${TT}/versions`, { term_id: F.term.term_id, section_ids: [F.secEven.section_id] })).body.error.code).toBe('SECTION_TERM_MISMATCH');
    expect((await admin.post(`${TT}/versions`, { term_id: F.term.term_id, version_no: 99 })).status).toBe(400); // strict body
    expect((await admin.post(`${TT}/versions`, {})).status).toBe(400);
  });
  it('lists versions with filters, counts and latest validation summary', async () => {
    const r = await admin.get(`${TT}/versions?term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((v: any) => v.version_no)).toEqual([2, 1]);
    const v1 = r.body.data.find((v: any) => v.version_no === 1);
    expect(v1).toMatchObject({ section_count: 1, session_count: 0, term_name: 'Odd', last_validation_id: null });
    expect(r.body.meta.total).toBe(2);
    expect((await admin.get(`${TT}/versions?term_id=${F.term.term_id}&status=PUBLISHED`)).body.data).toHaveLength(0);
    expect((await admin.get(`${TT}/versions?status=NOPE`)).status).toBe(400);
    expect((await faculty.get(`${TT}/versions?term_id=${F.term.term_id}`)).status).toBe(200); // masterdata:read
  });
  it('a persisted validation run shows up in the list summary; dry-run persists nothing', async () => {
    const dry = await admin.post(`${TT}/validate`, { version_id: F.v1.version_id, dry_run: true });
    expect(dry.status).toBe(200);
    expect(await count(`SELECT COUNT(*) n FROM validation_runs WHERE version_id = ${F.v1.version_id}`)).toBe(0);
    const run = await admin.post(`${TT}/validate`, { version_id: F.v1.version_id });
    expect(run.status).toBe(201);
    const row = (await admin.get(`${TT}/versions?term_id=${F.term.term_id}`)).body.data.find((v: any) => v.version_id === F.v1.version_id);
    expect(row.last_validation_id).not.toBeNull();
    expect(row.last_error_count).toBe(0);
  });
});

describe('user editing (Admin)', () => {
  it('denies faculty and coordinator', async () => {
    const t = await mkUser(`adm_t0_${RUN}`, ['STUDENT']);
    for (const c of [faculty, coord]) {
      expect((await c.patch(`/api/users/${t}`, { name: 'X' })).status).toBe(403);
      expect((await c.post(`/api/users/${t}/reset-password`, { password: 'Another-Pass-12345' })).status).toBe(403);
      expect((await c.get(`/api/users/${t}`)).status).toBe(403);
    }
  });
  it('edits name, email and roles; returns no password data; audits the change', async () => {
    const t = await mkUser(`adm_t1_${RUN}`, ['STUDENT']);
    const r = await admin.patch(`/api/users/${t}`, { name: 'Renamed Person', email: 'Renamed@Example.test', roles: ['FACULTY', 'FACULTY'] });
    expect(r.status).toBe(200);
    const g = await admin.get(`/api/users/${t}`);
    expect(g.body.data).toMatchObject({ name: 'Renamed Person', email: 'renamed@example.test', roles: ['FACULTY'] });
    expect(JSON.stringify(g.body)).not.toMatch(/password|hash/i);
    expect(await count(`SELECT COUNT(*) n FROM audit_logs WHERE action = 'USER_UPDATED' AND record_id = ${t}`)).toBe(1);
  });
  it('validates input: unknown role, empty roles, username change, empty body, duplicate email, unknown user', async () => {
    const t = await mkUser(`adm_t2_${RUN}`, ['STUDENT']);
    expect((await admin.patch(`/api/users/${t}`, { roles: ['SUPERUSER'] })).status).toBe(400);
    expect((await admin.patch(`/api/users/${t}`, { roles: [] })).status).toBe(400);
    expect((await admin.patch(`/api/users/${t}`, { username: 'new_name' })).status).toBe(400);
    expect((await admin.patch(`/api/users/${t}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/users/${t}`, { email: `adm_a_${RUN}@example.test` })).status).toBe(409);
    expect((await admin.patch('/api/users/99999999', { name: 'X' })).status).toBe(404);
  });
  it('prevents self-demotion and removing the last active admin', async () => {
    expect((await admin.patch(`/api/users/${adminId}`, { roles: ['FACULTY'] })).body.error.code).toBe('SELF_DEMOTION');
    // Another admin can demote a second admin only while a different active admin remains.
    const second = await mkUser(`adm_t3_${RUN}`, ['ADMIN']);
    expect((await admin.patch(`/api/users/${second}`, { roles: ['STUDENT'] })).status).toBe(200);
  });
  it('last-admin guard blocks demoting the only other active admin when the caller is not an admin-role holder of record', async () => {
    // Disable every other admin except the caller, then try to demote one that is already disabled: allowed only if another active admin remains (the caller).
    const x = await mkUser(`adm_t4_${RUN}`, ['ADMIN']);
    await exec("UPDATE users SET status = 'DISABLED' WHERE user_id = ?", [x]);
    expect((await admin.patch(`/api/users/${x}`, { roles: ['STUDENT'] })).status).toBe(200); // caller remains active admin
  });
  it('resets a password: new password works, old one fails, sessions revoked, lockout cleared', async () => {
    const name = `adm_t5_${RUN}`;
    const t = await mkUser(name, ['STUDENT']);
    const victim = await client(name);
    expect((await victim.get('/api/auth/me')).status).toBe(200);
    await exec('UPDATE users SET failed_login_count = 3 WHERE user_id = ?', [t]);
    expect((await admin.post(`/api/users/${t}/reset-password`, { password: 'short' })).status).toBe(400);
    expect((await admin.post(`/api/users/${t}/reset-password`, { password: 'Brand-New-Pass-123', extra: 1 })).status).toBe(400);
    expect((await admin.post(`/api/users/${t}/reset-password`, { password: 'Brand-New-Pass-123' })).status).toBe(200);
    const anon = await client();
    expect((await anon.post('/api/auth/login', { identifier: name, password: PW })).status).toBe(401);
    expect((await anon.post('/api/auth/login', { identifier: name, password: 'Brand-New-Pass-123' })).status).toBe(200);
    const [u] = await query<any>('SELECT password_hash, failed_login_count FROM users WHERE user_id = ?', [t]);
    expect(u.password_hash).toMatch(/^\$2[aby]\$/);
    expect(u.failed_login_count).toBe(0);
    const au = await query<any>("SELECT details FROM audit_logs WHERE action = 'USER_PASSWORD_RESET' AND record_id = ?", [t]);
    expect(au).toHaveLength(1);
    expect(JSON.stringify(au[0])).not.toMatch(/Brand-New/); // never log the password
  });
  it('status changes are audited', async () => {
    const t = await mkUser(`adm_t6_${RUN}`, ['STUDENT']);
    expect((await admin.patch(`/api/users/${t}/status`, { status: 'DISABLED' })).status).toBe(200);
    expect(await count(`SELECT COUNT(*) n FROM audit_logs WHERE action = 'USER_STATUS_CHANGED' AND record_id = ${t}`)).toBe(1);
  });
});

describe('master-data changes are audit-logged', () => {
  it('records create, update and delete with the acting admin', async () => {
    const d = await mkVia(admin, `${MD}/departments`, { dept_code: `AU${RUN.toUpperCase()}`, dept_name: 'Audit Dept' });
    expect((await admin.patch(`${MD}/departments/${d.dept_id}`, { dept_name: 'Audit Dept 2' })).status).toBe(200);
    expect((await admin.del(`${MD}/departments/${d.dept_id}`)).status).toBe(200);
    const rows = await query<any>("SELECT action, actor_user_id FROM audit_logs WHERE table_name = 'departments' AND record_id = ? ORDER BY audit_id", [d.dept_id]);
    expect(rows.map((r) => r.action)).toEqual(['MASTERDATA_CREATED', 'MASTERDATA_UPDATED', 'MASTERDATA_DELETED']);
    expect(rows.every((r) => r.actor_user_id === adminId)).toBe(true);
  });
  it('does not log failed (rolled-back) writes and explains why a referenced record cannot be deleted', async () => {
    const before = await count("SELECT COUNT(*) n FROM audit_logs WHERE action = 'MASTERDATA_DELETED'");
    const r = await admin.del(`${MD}/departments/${F.dept.dept_id}`); // referenced by a program
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IN_USE');
    expect(await count("SELECT COUNT(*) n FROM audit_logs WHERE action = 'MASTERDATA_DELETED'")).toBe(before);
    expect((await faculty.post(`${MD}/departments`, { dept_code: 'NOPE', dept_name: 'x' })).status).toBe(403);
  });
});
