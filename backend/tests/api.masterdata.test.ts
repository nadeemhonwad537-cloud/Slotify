import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { exec, pool } from '../src/db/pool';

const app = createApp();
const PW = 'Test-Password-12345'; // test-only
const ORIGIN = 'http://localhost:5173';
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const BASE = '/api/masterdata';

async function mkUser(username: string, roles: string[]) {
  const r = await exec('INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [username, `${username}@example.test`, await bcrypt.hash(PW, 4), `Test ${username}`]);
  for (const role of roles) await exec('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [r.insertId, role]);
  return r.insertId;
}

async function client(username?: string) {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/auth/csrf');
  const t: string = body.data.csrfToken;
  const w = (m: 'post' | 'patch' | 'delete') => (url: string, data?: object) => agent[m](url).set('Origin', ORIGIN).set('x-csrf-token', t).send(data ?? {});
  const c = { get: (u: string) => agent.get(u), post: w('post'), patch: w('patch'), del: w('delete') };
  if (username) {
    const r = await c.post('/api/auth/login', { identifier: username, password: PW });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`);
  }
  return c;
}

let admin: Awaited<ReturnType<typeof client>>;
let faculty: Awaited<ReturnType<typeof client>>;
let coord: Awaited<ReturnType<typeof client>>;
let student: Awaited<ReturnType<typeof client>>;
let anon: Awaited<ReturnType<typeof client>>;
let facultyUserId: number;
let nonFacultyUserId: number;

/** Creates a record through the real API and returns it (fails the test if it is not 201). */
async function mk(path: string, body: object) {
  const r = await admin.post(`${BASE}/${path}`, body);
  expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data as Record<string, any>;
}

// Shared synthetic fixture (neutral names, never real college data).
const F: Record<string, any> = {};

beforeAll(async () => {
  await exec("DELETE FROM users WHERE username LIKE 'md\\_%'");
  F.adminUserId = await mkUser('md_admin', ['ADMIN']);
  facultyUserId = await mkUser('md_faculty', ['FACULTY']);
  await mkUser('md_coord', ['COORDINATOR']);
  await mkUser('md_student', ['STUDENT']);
  nonFacultyUserId = await mkUser('md_plain_student', ['STUDENT']);
  admin = await client('md_admin'); faculty = await client('md_faculty');
  coord = await client('md_coord'); student = await client('md_student'); anon = await client();

  F.dept = await mk('departments', { dept_code: `D${RUN}`, dept_name: 'Synthetic Department' });
  F.year = await mk('academic-years', { year_label: `AY${RUN}`, start_date: '2030-06-01', end_date: '2031-05-31' });
  F.oddTerm = await mk('terms', { year_id: F.year.year_id, term_name: 'Odd', parity: 'ODD', start_date: '2030-07-01', end_date: '2030-12-15' });
  F.evenTerm = await mk('terms', { year_id: F.year.year_id, term_name: 'Even', parity: 'EVEN', start_date: '2031-01-01', end_date: '2031-05-31' });
  F.program = await mk('programs', { dept_id: F.dept.dept_id, program_code: 'PRG', program_name: 'Synthetic Program' });
  F.scheme = await mk('schemes', { program_id: F.program.program_id, scheme_code: 'SCH' });
  F.sem3 = await mk('semesters', { scheme_id: F.scheme.scheme_id, semester_no: 3 });
  F.sem4 = await mk('semesters', { scheme_id: F.scheme.scheme_id, semester_no: 4 });
  F.oddSem3 = await mk('term-program-semesters', { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id });
  F.evenSem4 = await mk('term-program-semesters', { term_id: F.evenTerm.term_id, semester_id: F.sem4.semester_id });
});
/** Removes every row this suite created (reference seed tables such as room_types/designations are left alone). */
async function wipeMasterData() {
  const c = await pool.getConnection();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['elective_group_offerings', 'elective_groups', 'offering_audiences', 'course_offerings', 'curriculum_courses',
      'course_components', 'courses', 'batches', 'sections', 'room_availability', 'term_day_slots', 'time_slots', 'term_teaching_days',
      'faculty_profiles', 'rooms', 'term_program_semesters', 'semesters', 'curriculum_schemes', 'programs', 'terms', 'academic_years', 'departments']) {
      await c.query('DELETE FROM ??', [t]);
    }
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { c.release(); }
}
afterAll(async () => {
  await wipeMasterData();
  await exec("DELETE FROM users WHERE username LIKE 'md\\_%'");
  await pool.end();
});

describe('authentication and authorization', () => {
  it('rejects unauthenticated reads', async () => {
    expect((await anon.get(`${BASE}/departments`)).status).toBe(401);
  });
  it('STUDENT has no master-data access', async () => {
    expect((await student.get(`${BASE}/departments`)).status).toBe(403);
  });
  it('FACULTY can read but not write', async () => {
    expect((await faculty.get(`${BASE}/departments`)).status).toBe(200);
    const w = await faculty.post(`${BASE}/departments`, { dept_code: 'NOPE', dept_name: 'x' });
    expect(w.status).toBe(403);
    expect((await faculty.post(`${BASE}/term-program-semesters`, { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id })).status).toBe(403);
    expect((await faculty.patch(`${BASE}/departments/${F.dept.dept_id}`, { dept_name: 'hack' })).status).toBe(403);
    expect((await faculty.del(`${BASE}/departments/${F.dept.dept_id}`)).status).toBe(403);
    expect((await faculty.post(`${BASE}/rooms`, {})).status).toBe(403);
    expect((await faculty.post(`${BASE}/room-availability`, {})).status).toBe(403);
  });
  it('COORDINATOR (provisional) can read but not write master data', async () => {
    expect((await coord.get(`${BASE}/terms`)).status).toBe(200);
    expect((await coord.post(`${BASE}/departments`, { dept_code: 'NOPE', dept_name: 'x' })).status).toBe(403);
  });
  it('faculty contact details are not readable by plain readers', async () => {
    expect((await faculty.get(`${BASE}/faculty`)).status).toBe(403);
    expect((await admin.get(`${BASE}/faculty`)).status).toBe(200);
  });
  it('writes still require a CSRF token even for admins', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login'); // no csrf: rejected, nothing logged in
    const r = await agent.post(`${BASE}/departments`).send({ dept_code: 'X1', dept_name: 'x' });
    expect(r.status).toBe(403);
  });
  it('exposes the fixed rules via /meta', async () => {
    const r = await admin.get(`${BASE}/meta`);
    expect(r.status).toBe(200);
    expect(r.body.data.saturdayLatestEnd).toBe('12:30:00');
    expect(r.body.data.resources).toContain('sections');
    expect(r.body.data.resources).toContain('term-program-semesters');
  });
});

describe('input validation (Zod)', () => {
  it('rejects unknown fields', async () => {
    const r = await admin.post(`${BASE}/departments`, { dept_code: 'ZZ1', dept_name: 'x', hacked: true });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('rejects bad dates and codes', async () => {
    expect((await admin.post(`${BASE}/academic-years`, { year_label: 'BAD', start_date: '2030-02-31' })).status).toBe(400);
    expect((await admin.post(`${BASE}/departments`, { dept_code: 'lower case', dept_name: 'x' })).status).toBe(400);
  });
  it('rejects non-numeric ids, bad query strings and empty patches', async () => {
    expect((await admin.get(`${BASE}/departments/abc`)).status).toBe(400);
    expect((await admin.get(`${BASE}/terms?parity=SIDEWAYS`)).status).toBe(400);
    expect((await admin.get(`${BASE}/terms?limit=100000`)).status).toBe(400);
    const r = await admin.patch(`${BASE}/departments/${F.dept.dept_id}`, {});
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('EMPTY_UPDATE');
  });
  it('returns 404 for missing records and rejects client-supplied derived fields', async () => {
    expect((await admin.get(`${BASE}/departments/99999999`)).status).toBe(404);
    const r = await admin.post(`${BASE}/sections`, { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id, section_name: 'Q', scheme_id: 1 });
    expect(r.status).toBe(400);
  });
  it('lists with filters and pagination metadata', async () => {
    const r = await admin.get(`${BASE}/terms?year_id=${F.year.year_id}&limit=1`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.meta).toMatchObject({ total: 2, limit: 1, offset: 0 });
  });
});

describe('academic calendar, programs, schemes, semesters, sections', () => {
  it('rejects duplicate academic years and department codes (409)', async () => {
    expect((await admin.post(`${BASE}/academic-years`, { year_label: F.year.year_label })).status).toBe(409);
    expect((await admin.post(`${BASE}/departments`, { dept_code: F.dept.dept_code, dept_name: 'dup' })).status).toBe(409);
  });
  it('rejects end dates before start dates', async () => {
    const r = await admin.post(`${BASE}/academic-years`, { year_label: `BAD${RUN}`, start_date: '2030-06-01', end_date: '2030-01-01' });
    expect(r.status).toBe(422);
  });
  it('requires term dates to lie inside the academic year', async () => {
    const r = await admin.post(`${BASE}/terms`, { year_id: F.year.year_id, term_name: 'Late', parity: 'ODD', start_date: '2032-01-01', end_date: '2032-05-31' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('TERM_OUTSIDE_YEAR');
  });
  it('requires paired term dates and prevents duplicate active configurations', async () => {
    const missingEnd = await admin.post(`${BASE}/terms`, {
      year_id: F.year.year_id, term_name: 'Missing End', parity: 'ODD', start_date: '2030-07-01', status: 'ACTIVE',
    });
    expect(missingEnd.status).toBe(422); expect(missingEnd.body.error.code).toBe('TERM_DATE_PAIR');
    await admin.patch(`${BASE}/terms/${F.oddTerm.term_id}`, { status: 'ACTIVE' });
    const inactiveYear = await admin.patch(`${BASE}/academic-years/${F.year.year_id}`, { is_active: false });
    expect(inactiveYear.status).toBe(409); expect(inactiveYear.body.error.code).toBe('IN_USE');
    const conflict = await admin.post(`${BASE}/terms`, {
      year_id: F.year.year_id, term_name: 'Overlapping Active Term', parity: 'EVEN',
      start_date: '2030-12-01', end_date: '2031-01-15', status: 'ACTIVE',
    });
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe('TERM_CONFLICT');
    await admin.patch(`${BASE}/terms/${F.oddTerm.term_id}`, { status: 'DRAFT' });
  });
  it('prevents academic-year dates from excluding existing term dates', async () => {
    const update = await admin.patch(`${BASE}/academic-years/${F.year.year_id}`, { end_date: '2030-11-30' });
    expect(update.status).toBe(422); expect(update.body.error.code).toBe('YEAR_CONTAINS_TERMS');
  });
  it('validates configured term-program-semester references and duplicates', async () => {
    const missing = await admin.post(`${BASE}/term-program-semesters`, { term_id: 99999999, semester_id: F.sem3.semester_id });
    expect(missing.status).toBe(422); expect(missing.body.error.code).toBe('BAD_REFERENCE');
    const duplicate = await admin.post(`${BASE}/term-program-semesters`, { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id });
    expect(duplicate.status).toBe(409);
    const [rows]: any = await pool.query(
      'SELECT term_program_semester_id FROM term_program_semesters WHERE term_id = ? AND semester_id = ?',
      [F.oddTerm.term_id, F.sem3.semester_id]);
    expect(rows).toHaveLength(1);
  });
  it('rejects a scheme whose effective_to precedes effective_from', async () => {
    const r = await admin.post(`${BASE}/schemes`, { program_id: F.program.program_id, scheme_code: 'S2', effective_from: '2030-01-01', effective_to: '2029-01-01' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('SCHEME_DATES');
  });
  it('creates a section and derives scheme_id from the semester', async () => {
    F.secA = await mk('sections', { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id, section_name: 'A', strength: 60, data_status: 'SYNTHETIC' });
    expect(F.secA.scheme_id).toBe(F.scheme.scheme_id);
    expect(F.secA.data_status).toBe('SYNTHETIC');
    const [rows]: any = await pool.query('SELECT section_name, is_active FROM sections WHERE section_id = ?', [F.secA.section_id]);
    expect(rows[0]).toMatchObject({ section_name: 'A', is_active: 1 });
  });
  it('defaults data_status to VERIFY (nothing is silently marked verified)', async () => {
    F.secB = await mk('sections', { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id, section_name: 'B' });
    expect(F.secB.data_status).toBe('VERIFY');
  });
  it('requires configured semesters and permits explicit special parity arrangements', async () => {
    const r = await admin.post(`${BASE}/sections`, { term_id: F.oddTerm.term_id, semester_id: F.sem4.semester_id, section_name: 'A' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('TERM_SEMESTER_NOT_CONFIGURED');
    const inactiveWithoutMapping = await admin.post(`${BASE}/sections`, {
      term_id: F.oddTerm.term_id, semester_id: F.sem4.semester_id, section_name: 'INACTIVE', is_active: false,
    });
    expect(inactiveWithoutMapping.status).toBe(422);
    expect(inactiveWithoutMapping.body.error.code).toBe('TERM_SEMESTER_NOT_CONFIGURED');
    const configured = await admin.post(`${BASE}/term-program-semesters`, { term_id: F.evenTerm.term_id, semester_id: F.sem3.semester_id });
    expect(configured.status).toBe(201);
    const special = await admin.post(`${BASE}/sections`, { term_id: F.evenTerm.term_id, semester_id: F.sem3.semester_id, section_name: 'SPECIAL' });
    expect(special.status).toBe(201);
  });
  it('rejects duplicate sections (409)', async () => {
    const r = await admin.post(`${BASE}/sections`, { term_id: F.oddTerm.term_id, semester_id: F.sem3.semester_id, section_name: 'A' });
    expect(r.status).toBe(409);
  });
  it('locks term parity once sections exist', async () => {
    const r = await admin.patch(`${BASE}/terms/${F.oddTerm.term_id}`, { parity: 'EVEN' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('PARITY_LOCKED');
  });
  it('treats re-parenting fields as immutable', async () => {
    const r = await admin.patch(`${BASE}/sections/${F.secA.section_id}`, { term_id: F.evenTerm.term_id });
    expect(r.status).toBe(400);
  });
  it('blocks new sections in a closed term', async () => {
    const closed = await mk('terms', { year_id: F.year.year_id, term_name: 'Closed', parity: 'ODD', start_date: '2031-01-01', end_date: '2031-05-31', status: 'CLOSED' });
    const r = await admin.post(`${BASE}/sections`, { term_id: closed.term_id, semester_id: F.sem3.semester_id, section_name: 'A' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('TERM_CLOSED');
  });
  it('reports a missing parent as a 422 BAD_REFERENCE', async () => {
    const r = await admin.post(`${BASE}/sections`, { term_id: 99999999, semester_id: F.sem3.semester_id, section_name: 'Z' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('BAD_REFERENCE');
  });
  it('refuses to delete a department that is in use (409) and allows deactivation', async () => {
    const r = await admin.del(`${BASE}/departments/${F.dept.dept_id}`);
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('IN_USE');
    const p = await admin.patch(`${BASE}/departments/${F.dept.dept_id}`, { is_active: false });
    expect(p.status).toBe(200); expect(p.body.data.is_active).toBe(0);
    await admin.patch(`${BASE}/departments/${F.dept.dept_id}`, { is_active: true });
  });
  it('allows the same division name for distinct program schemes in a term', async () => {
    const program = await mk('programs', { dept_id: F.dept.dept_id, program_code: `AI${RUN}`, program_name: 'Synthetic AI Program' });
    const scheme = await mk('schemes', { program_id: program.program_id, scheme_code: `AI${RUN}` });
    const semester = await mk('semesters', { scheme_id: scheme.scheme_id, semester_no: 3 });
    await mk('term-program-semesters', { term_id: F.oddTerm.term_id, semester_id: semester.semester_id });
    const division = await mk('sections', { term_id: F.oddTerm.term_id, semester_id: semester.semester_id, section_name: 'A' });
    expect(division.scheme_id).toBe(scheme.scheme_id);
  });
  it('protects divisions and configured semesters from deletion or unsafe archival', async () => {
    const deactivation = await admin.patch(
      `${BASE}/term-program-semesters/${F.oddSem3.term_program_semester_id}`, { is_active: false });
    expect(deactivation.status).toBe(409); expect(deactivation.body.error.code).toBe('IN_USE');
    expect((await admin.patch(`${BASE}/programs/${F.program.program_id}`, { is_active: false })).status).toBe(409);
    expect((await admin.patch(`${BASE}/schemes/${F.scheme.scheme_id}`, { is_active: false })).status).toBe(409);
    expect((await admin.patch(`${BASE}/semesters/${F.sem3.semester_id}`, { is_active: false })).status).toBe(409);
    expect((await admin.del(`${BASE}/sections/${F.secA.section_id}`)).status).toBe(405);
    expect((await admin.del(`${BASE}/terms/${F.oddTerm.term_id}`)).status).toBe(405);
  });
});

describe('batches', () => {
  it('creates batches and rejects a batch larger than its section', async () => {
    F.batch1 = await mk('batches', { section_id: F.secA.section_id, batch_name: 'A1', strength: 30 });
    const r = await admin.post(`${BASE}/batches`, { section_id: F.secA.section_id, batch_name: 'A2', strength: 61 });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('BATCH_EXCEEDS_SECTION');
    const aggregate = await admin.post(`${BASE}/batches`, { section_id: F.secA.section_id, batch_name: 'A2', strength: 31 });
    expect(aggregate.status).toBe(422); expect(aggregate.body.error.code).toBe('BATCH_EXCEEDS_SECTION');
  });
  it('rejects duplicate batch names within a section', async () => {
    expect((await admin.post(`${BASE}/batches`, { section_id: F.secA.section_id, batch_name: 'A1' })).status).toBe(409);
  });
  it('validates the parent division and protects active division batches', async () => {
    const missing = await admin.post(`${BASE}/batches`, { section_id: 99999999, batch_name: 'Missing parent' });
    expect(missing.status).toBe(422); expect(missing.body.error.code).toBe('BAD_REFERENCE');
    const archive = await admin.patch(`${BASE}/sections/${F.secA.section_id}`, { is_active: false });
    expect(archive.status).toBe(409); expect(archive.body.error.code).toBe('IN_USE');
    await admin.patch(`${BASE}/batches/${F.batch1.batch_id}`, { is_active: false });
    await admin.patch(`${BASE}/sections/${F.secA.section_id}`, { is_active: false });
    const inactiveParent = await admin.post(`${BASE}/batches`, { section_id: F.secA.section_id, batch_name: 'Inactive Parent' });
    expect(inactiveParent.status).toBe(422); expect(inactiveParent.body.error.code).toBe('SECTION_INACTIVE');
    await admin.patch(`${BASE}/sections/${F.secA.section_id}`, { is_active: true });
  });
});

describe('courses, components, curriculum', () => {
  it('creates courses with a nullable, non-unique course code', async () => {
    F.course = await mk('courses', { course_name: 'Synthetic Course', course_code: `SC${RUN}`, data_status: 'SYNTHETIC' });
    const noCode = await mk('courses', { course_name: 'Course without a code yet' });
    expect(noCode.course_code).toBeNull();
    const dup = await admin.post(`${BASE}/courses`, { course_name: 'Same code, other title', course_code: `SC${RUN}` });
    expect(dup.status).toBe(201); // uniqueness policy is an open decision (S): not enforced
  });
  it('accepts fractional weekly hours and keeps the component type unique per course', async () => {
    F.theory = await mk('components', { course_id: F.course.course_id, component_type: 'THEORY', weekly_hours: 1.5 });
    expect(Number(F.theory.weekly_hours)).toBe(1.5);
    expect((await admin.post(`${BASE}/components`, { course_id: F.course.course_id, component_type: 'THEORY' })).status).toBe(409);
  });
  it('requires periods_per_session >= 2 for a consecutive component', async () => {
    const bad = await admin.post(`${BASE}/components`, { course_id: F.course.course_id, component_type: 'LAB', is_consecutive: true, periods_per_session: 1 });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('CONSECUTIVE_NEEDS_PERIODS');
    F.lab = await mk('components', { course_id: F.course.course_id, component_type: 'LAB', weekly_hours: 2, is_consecutive: true, periods_per_session: 2 });
    expect(F.lab.is_consecutive).toBe(1);
  });
  it('rejects a negative weekly_hours', async () => {
    const c2 = await mk('courses', { course_name: 'Neg hours course' });
    expect((await admin.post(`${BASE}/components`, { course_id: c2.course_id, component_type: 'THEORY', weekly_hours: -1 })).status).toBe(400);
  });
  it('maps courses into the curriculum and derives scheme_id', async () => {
    const cc = await mk('curriculum-courses', { semester_id: F.sem3.semester_id, course_id: F.course.course_id });
    expect(cc.scheme_id).toBe(F.scheme.scheme_id);
    const bad = await admin.post(`${BASE}/curriculum-courses`, { semester_id: F.sem4.semester_id, course_id: F.course.course_id, is_elective: false, group_id: 1 });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('GROUP_NEEDS_ELECTIVE');
  });
});

describe('offerings, audiences, elective groups', () => {
  it('creates an offering and an audience, deriving the audience term', async () => {
    F.offering = await mk('offerings', { component_id: F.theory.component_id, term_id: F.oddTerm.term_id });
    expect(F.offering.status).toBe('DRAFT');
    F.aud = await mk('audiences', { offering_id: F.offering.offering_id, section_id: F.secA.section_id });
    expect(F.aud.term_id).toBe(F.oddTerm.term_id);
  });
  it('rejects an audience whose section is in a different term', async () => {
    const evenSection = await mk('sections', { term_id: F.evenTerm.term_id, semester_id: F.sem4.semester_id, section_name: 'Z' });
    const r = await admin.post(`${BASE}/audiences`, { offering_id: F.offering.offering_id, section_id: evenSection.section_id });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('SECTION_TERM_MISMATCH');
  });
  it('rejects a batch that belongs to another section', async () => {
    const r = await admin.post(`${BASE}/audiences`, { offering_id: F.offering.offering_id, section_id: F.secB.section_id, batch_id: F.batch1.batch_id });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('BATCH_SECTION_MISMATCH');
  });
  it('rejects duplicate audiences (409) and audiences on cancelled offerings', async () => {
    expect((await admin.post(`${BASE}/audiences`, { offering_id: F.offering.offering_id, section_id: F.secA.section_id })).status).toBe(409);
    const cancelled = await mk('offerings', { component_id: F.lab.component_id, term_id: F.oddTerm.term_id, status: 'CANCELLED' });
    const r = await admin.post(`${BASE}/audiences`, { offering_id: cancelled.offering_id, section_id: F.secA.section_id });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('OFFERING_CANCELLED');
  });
  it('elective groups default to no parallel slots and no combined faculty', async () => {
    F.group = await mk('elective-groups', { term_id: F.oddTerm.term_id, group_name: 'Synthetic Elective Group' });
    expect(F.group.requires_parallel_slots).toBe(0);
    expect(F.group.allow_combined_faculty).toBe(0);
  });
  it('links offerings to a group only within the same term, and links cannot be edited', async () => {
    const link = await mk('elective-group-offerings', { elective_group_id: F.group.elective_group_id, offering_id: F.offering.offering_id });
    expect(link.term_id).toBe(F.oddTerm.term_id);
    const evenCourse = await mk('courses', { course_name: 'Even term course' });
    const evenComp = await mk('components', { course_id: evenCourse.course_id, component_type: 'THEORY' });
    const evenOff = await mk('offerings', { component_id: evenComp.component_id, term_id: F.evenTerm.term_id });
    const bad = await admin.post(`${BASE}/elective-group-offerings`, { elective_group_id: F.group.elective_group_id, offering_id: evenOff.offering_id });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('GROUP_TERM_MISMATCH');
    expect((await admin.patch(`${BASE}/elective-group-offerings/${link.group_offering_id}`, {})).status).toBe(405);
    expect((await admin.del(`${BASE}/elective-group-offerings/${link.group_offering_id}`)).status).toBe(200);
  });
});

describe('rooms and room availability', () => {
  it('creates rooms against reference room types, with optional capacity', async () => {
    const types = await admin.get(`${BASE}/room-types`);
    const classroom = types.body.data.find((t: any) => t.type_code === 'CLASSROOM');
    F.room = await mk('rooms', { room_code: `RM${RUN}`, room_type_id: classroom.room_type_id, equipment: 'Projector', location: 'North Wing' });
    expect(F.room.capacity).toBeNull();
    expect(F.room.data_status).toBe('VERIFY');
    expect(F.room.equipment).toBe('Projector');
    expect(F.room.location).toBe('North Wing');
    expect((await admin.post(`${BASE}/rooms`, { room_code: `RM${RUN}`, room_type_id: classroom.room_type_id })).status).toBe(409);
    expect((await admin.post(`${BASE}/rooms`, { room_code: `RX${RUN}`, room_type_id: classroom.room_type_id, capacity: 0 })).status).toBe(400);
    expect((await admin.post(`${BASE}/rooms`, { room_code: `RY${RUN}`, room_type_id: 99999999 })).status).toBe(422);
    expect((await admin.patch(`${BASE}/rooms/${F.room.room_id}`, { capacity: 0 })).status).toBe(400);
  });
  it('requires an explicit availability state and rejects overlapping windows', async () => {
    const base = { room_id: F.room.room_id, term_id: F.oddTerm.term_id, day: 'MON' };
    expect((await admin.post(`${BASE}/room-availability`, { ...base, start_time: '08:00', end_time: '10:00' })).status).toBe(400);
    await mk('room-availability', { ...base, start_time: '08:00', end_time: '10:00', availability_type: 'UNAVAILABLE' });
    const clash = await admin.post(`${BASE}/room-availability`, { ...base, start_time: '09:00', end_time: '11:00', availability_type: 'AVAILABLE' });
    expect(clash.status).toBe(422); expect(clash.body.error.code).toBe('AVAILABILITY_OVERLAP');
    const adjacent = await admin.post(`${BASE}/room-availability`, { ...base, start_time: '10:00', end_time: '11:00', availability_type: 'UNKNOWN' });
    expect(adjacent.status).toBe(201);
    const backwards = await admin.post(`${BASE}/room-availability`, { ...base, day: 'TUE', start_time: '10:00', end_time: '09:00', availability_type: 'AVAILABLE' });
    expect(backwards.status).toBe(422); expect(backwards.body.error.code).toBe('TIME_ORDER');
    const missingRoom = await admin.post(`${BASE}/room-availability`, { ...base, room_id: 99999999, start_time: '11:00', end_time: '12:00', availability_type: 'UNKNOWN' });
    expect(missingRoom.status).toBe(422); expect(missingRoom.body.error.code).toBe('BAD_REFERENCE');
  });
  it('prevents deactivating a room assigned in an active timetable', async () => {
    const course = await mk('courses', { course_name: `Room guard ${RUN}` });
    const component = await mk('components', { course_id: course.course_id, component_type: 'THEORY' });
    const offering = await mk('offerings', { component_id: component.component_id, term_id: F.oddTerm.term_id });
    const [[nextVersion]]: any = await pool.query(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no FROM timetable_versions WHERE term_id = ?',
      [F.oddTerm.term_id],
    );
    const version = await exec(
      "INSERT INTO timetable_versions (term_id, version_no, status, created_by) VALUES (?, ?, 'DRAFT', ?)",
      [F.oddTerm.term_id, nextVersion.version_no, F.adminUserId],
    );
    try {
      await exec(
        `INSERT INTO scheduled_sessions (version_id, term_id, offering_id, room_id, day, start_time, end_time)
         VALUES (?, ?, ?, ?, 'MON', '08:00:00', '09:00:00')`,
        [version.insertId, F.oddTerm.term_id, offering.offering_id, F.room.room_id],
      );
      const response = await admin.patch(`${BASE}/rooms/${F.room.room_id}`, { is_active: false });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ROOM_IN_USE');
    } finally {
      await exec('DELETE FROM scheduled_sessions WHERE version_id = ?', [version.insertId]);
      await exec('DELETE FROM timetable_versions WHERE version_id = ?', [version.insertId]);
    }
  });
});

describe('teaching days, time slots, Saturday cutoff', () => {
  it('requires Saturday to close by 12:30', async () => {
    const t = F.oddTerm.term_id;
    const none = await admin.post(`${BASE}/teaching-days`, { term_id: t, day_name: 'SAT' });
    expect(none.status).toBe(422); expect(none.body.error.code).toBe('SATURDAY_CLOSING_REQUIRED');
    const late = await admin.post(`${BASE}/teaching-days`, { term_id: t, day_name: 'SAT', closing_time: '14:00' });
    expect(late.status).toBe(422); expect(late.body.error.code).toBe('SATURDAY_AFTER_CUTOFF');
    F.sat = await mk('teaching-days', { term_id: t, day_name: 'SAT', closing_time: '12:30' });
    F.mon = await mk('teaching-days', { term_id: t, day_name: 'MON' });
    expect(F.mon.closing_time).toBeNull(); // no invented default closing time
    const nonTeachingSun = await admin.post(`${BASE}/teaching-days`, { term_id: t, day_name: 'SUN', is_teaching_day: false });
    expect(nonTeachingSun.status).toBe(201);
    F.sun = nonTeachingSun.body.data;
  });
  it('creates time slots with ordered times only', async () => {
    const t = F.oddTerm.term_id;
    F.s1 = await mk('time-slots', { term_id: t, slot_no: 1, start_time: '09:00', end_time: '10:00', data_status: 'SYNTHETIC' });
    F.s2 = await mk('time-slots', { term_id: t, slot_no: 2, start_time: '09:30', end_time: '10:30', data_status: 'SYNTHETIC' }); // overlaps s1 on purpose
    F.s3 = await mk('time-slots', { term_id: t, slot_no: 3, start_time: '13:00', end_time: '14:00', data_status: 'SYNTHETIC' }); // after the Saturday cutoff
    F.sLunch = await mk('time-slots', { term_id: t, slot_no: 4, start_time: '12:30', end_time: '13:30', slot_type: 'LUNCH' });
    expect((await admin.post(`${BASE}/time-slots`, { term_id: t, slot_no: 9, start_time: '10:00', end_time: '10:00' })).status).toBe(422);
    expect((await admin.post(`${BASE}/time-slots`, { term_id: t, slot_no: 1, start_time: '15:00', end_time: '16:00' })).status).toBe(409);
    expect(F.s1.start_time).toBe('09:00:00');
  });
  it('maps slots to days and blocks overlaps within the same day', async () => {
    await mk('term-day-slots', { term_day_id: F.mon.term_day_id, slot_id: F.s1.slot_id });
    const clash = await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.mon.term_day_id, slot_id: F.s2.slot_id });
    expect(clash.status).toBe(422); expect(clash.body.error.code).toBe('SLOT_OVERLAP');
    expect((await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.mon.term_day_id, slot_id: F.s1.slot_id })).status).toBe(409);
  });
  it('lets a slot that overlaps a Monday slot be used on Saturday (day-specific grids)', async () => {
    const r = await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.sat.term_day_id, slot_id: F.s2.slot_id });
    expect(r.status).toBe(201);
  });
  it('rejects a teaching slot that ends after the Saturday cutoff', async () => {
    const r = await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.sat.term_day_id, slot_id: F.s3.slot_id });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('SATURDAY_AFTER_CUTOFF');
    // the same slot is fine on a weekday, and a non-teaching LUNCH slot is not subject to the teaching cutoff
    expect((await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.mon.term_day_id, slot_id: F.s3.slot_id })).status).toBe(201);
    expect((await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.sat.term_day_id, slot_id: F.sLunch.slot_id })).status).toBe(201);
  });
  it('rejects teaching slots on a non-teaching day and slots from another term', async () => {
    const r = await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.sun.term_day_id, slot_id: F.s1.slot_id });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('NOT_A_TEACHING_DAY');
    const otherSlot = await mk('time-slots', { term_id: F.evenTerm.term_id, slot_no: 1, start_time: '09:00', end_time: '10:00' });
    const bad = await admin.post(`${BASE}/term-day-slots`, { term_day_id: F.mon.term_day_id, slot_id: otherSlot.slot_id });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('SLOT_TERM_MISMATCH');
  });
  it('refuses a later change that would push an active Saturday slot past the cutoff', async () => {
    const r = await admin.patch(`${BASE}/time-slots/${F.s2.slot_id}`, { end_time: '14:30' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('SATURDAY_AFTER_CUTOFF');
    const closing = await admin.patch(`${BASE}/teaching-days/${F.sat.term_day_id}`, { closing_time: '10:00' });
    expect(closing.status).toBe(422); expect(closing.body.error.code).toBe('CLOSING_BEFORE_SLOT_END');
    const raise = await admin.patch(`${BASE}/teaching-days/${F.sat.term_day_id}`, { closing_time: '15:00' });
    expect(raise.status).toBe(422); expect(raise.body.error.code).toBe('SATURDAY_AFTER_CUTOFF');
  });
});

describe('faculty master data', () => {
  it('creates faculty without inventing a designation, staff code or login', async () => {
    const f = await mk('faculty', { name: 'Synthetic Faculty One', data_status: 'SYNTHETIC' });
    expect(f.designation_id).toBeNull(); expect(f.staff_code).toBeNull(); expect(f.user_id).toBeNull();
    expect(f.data_status).toBe('SYNTHETIC');
  });
  it('links a login only if it has the FACULTY role', async () => {
    const bad = await admin.post(`${BASE}/faculty`, { name: 'Linked Wrongly', user_id: nonFacultyUserId });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('USER_NOT_FACULTY');
    const good = await mk('faculty', { name: 'Linked Correctly', user_id: facultyUserId, staff_code: `ST${RUN}` });
    expect(good.user_id).toBe(facultyUserId);
    expect((await admin.post(`${BASE}/faculty`, { name: 'Dup staff code', staff_code: `ST${RUN}` })).status).toBe(409);
    expect((await admin.post(`${BASE}/faculty`, { name: 'Same login', user_id: facultyUserId })).status).toBe(409);
  });
  it('lets an admin set a designation explicitly', async () => {
    const list = await admin.get(`${BASE}/designations`);
    const assoc = list.body.data.find((d: any) => d.designation_code === 'ASSOCIATE_PROFESSOR');
    expect(assoc.data_status).toBe('VERIFY');
    const f = await mk('faculty', { name: 'Has Designation', designation_id: assoc.designation_id });
    expect(f.designation_id).toBe(assoc.designation_id);
  });
});

describe('curriculum builder', () => {
  const url = `${BASE}/curriculum-builder`;
  const payload = {
    year_id: 0,
    term_id: 0,
    program_id: 0,
    scheme_id: 0,
    semester_id: 0,
    subjects: [{
      course_code: `CB${RUN}`,
      course_name: 'Synthetic Builder Subject',
      required_weekly_hours: 3,
      components: [
        { component_type: 'THEORY', weekly_hours: 2 },
        { component_type: 'LAB', weekly_hours: 1, periods_per_session: 2, is_consecutive: true },
      ],
    }],
  };

  it('protects validation and publish endpoints with ADMIN authorization', async () => {
    expect((await faculty.post(`${url}/validate`, {})).status).toBe(403);
    expect((await faculty.post(`${url}/publish`, {})).status).toBe(403);
  });

  it('rejects a term-semester combination that is not configured', async () => {
    const invalid = {
      ...payload,
      year_id: F.year.year_id,
      term_id: F.oddTerm.term_id,
      program_id: F.program.program_id,
      scheme_id: F.scheme.scheme_id,
      semester_id: F.sem4.semester_id,
    };
    const response = await admin.post(`${url}/validate`, invalid);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TERM_SEMESTER_NOT_CONFIGURED');
  });

  it('validates and atomically persists a curriculum without duplicating a repeated publish', async () => {
    const valid = {
      ...payload,
      year_id: F.year.year_id,
      term_id: F.oddTerm.term_id,
      program_id: F.program.program_id,
      scheme_id: F.scheme.scheme_id,
      semester_id: F.sem3.semester_id,
    };
    expect((await admin.post(`${url}/validate`, valid)).status).toBe(200);
    const published = await admin.post(`${url}/publish`, valid);
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(published.body.data.subjects).toHaveLength(1);
    expect(published.body.data.subjects[0].component_ids).toHaveLength(2);
    expect(published.body.data.subjects[0].offering_ids).toHaveLength(2);

    const [rows]: any = await pool.query(
      `SELECT c.course_id, c.data_status, cc.semester_id,
              COUNT(DISTINCT component.component_id) AS component_count,
              COUNT(DISTINCT offering.offering_id) AS offering_count
       FROM courses c
       JOIN curriculum_courses cc ON cc.course_id = c.course_id
       JOIN course_components component ON component.course_id = c.course_id
       JOIN course_offerings offering ON offering.component_id = component.component_id
       WHERE c.course_code = ? AND cc.semester_id = ?
       GROUP BY c.course_id, c.data_status, cc.semester_id`,
      [valid.subjects[0].course_code, F.sem3.semester_id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data_status: 'VERIFY', semester_id: F.sem3.semester_id, component_count: 2, offering_count: 2 });

    const repeated = await admin.post(`${url}/publish`, valid);
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('DUPLICATE_SUBJECT_CODE');
    const [courses]: any = await pool.query('SELECT course_id FROM courses WHERE course_code = ?', [valid.subjects[0].course_code]);
    expect(courses).toHaveLength(1);
  });
});
