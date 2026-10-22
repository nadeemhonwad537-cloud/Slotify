import { PoolConnection } from 'mysql2/promise';
import { expect } from 'vitest';
import { pool } from '../src/db/pool';

/** Runs fn inside a transaction that is ALWAYS rolled back, so tests leave no data behind. */
export async function inTx(fn: (c: PoolConnection) => Promise<void>) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await fn(c);
  } finally {
    await c.rollback();
    c.release();
  }
}

export async function ins(c: PoolConnection, table: string, row: Record<string, unknown>): Promise<number> {
  const [r]: any = await c.query('INSERT INTO ?? SET ?', [table, row]);
  return r.insertId;
}

/** Asserts a statement fails with a MySQL errno (e.g. 1062 dup, 3819 CHECK, 1452 FK, 1644 SIGNAL). */
export async function expectErrno(p: Promise<unknown>, errno: number) {
  let err: any;
  try { await p; } catch (e) { err = e; }
  expect(err, 'expected the statement to fail').toBeDefined();
  expect(err.errno, `got errno ${err?.errno}: ${err?.sqlMessage}`).toBe(errno);
}

export const ERR = { DUP: 1062, FK: 1452, CHECK: 3819, SIGNAL: 1644, ENUM: 1265 };

export interface Base {
  deptId: number; yearId: number; termId: number; programId: number; schemeId: number; semesterId: number;
  sectionId: number; courseId: number; theoryComponentId: number; labComponentId: number;
  offeringId: number; audienceId: number; facultyId: number; submissionId: number; userId: number; roomId: number;
}

/** Minimal SYNTHETIC fixture with neutral names. Never real college data. */
export async function baseFixture(c: PoolConnection, tag = 'T'): Promise<Base> {
  const userId = await ins(c, 'users', { username: `fx_${tag}_${Math.random().toString(36).slice(2, 8)}`, email: `${tag}${Math.random().toString(36).slice(2, 8)}@example.test`, password_hash: 'x', name: 'Fixture User' });
  const deptId = await ins(c, 'departments', { dept_code: `D${tag}${Math.random().toString(36).slice(2, 6)}`, dept_name: 'Synthetic Dept' });
  const yearId = await ins(c, 'academic_years', { year_label: `Y${Math.random().toString(36).slice(2, 8)}` });
  const termId = await ins(c, 'terms', { year_id: yearId, term_name: 'Synthetic Term', parity: 'ODD' });
  const programId = await ins(c, 'programs', { dept_id: deptId, program_code: 'P1', program_name: 'Synthetic Program' });
  const schemeId = await ins(c, 'curriculum_schemes', { program_id: programId, scheme_code: 'S1' });
  const semesterId = await ins(c, 'semesters', { scheme_id: schemeId, semester_no: 3 });
  await ins(c, 'term_program_semesters', { term_id: termId, scheme_id: schemeId, semester_id: semesterId });
  const sectionId = await ins(c, 'sections', { term_id: termId, scheme_id: schemeId, semester_id: semesterId, section_name: 'S-A', data_status: 'SYNTHETIC' });
  const courseId = await ins(c, 'courses', { course_name: 'Synthetic Course 1', data_status: 'SYNTHETIC' });
  const theoryComponentId = await ins(c, 'course_components', { course_id: courseId, component_type: 'THEORY', weekly_hours: 3, data_status: 'SYNTHETIC' });
  const labComponentId = await ins(c, 'course_components', { course_id: courseId, component_type: 'LAB', weekly_hours: 2, periods_per_session: 2, is_consecutive: 1, data_status: 'SYNTHETIC' });
  const offeringId = await ins(c, 'course_offerings', { component_id: theoryComponentId, term_id: termId, data_status: 'SYNTHETIC' });
  const audienceId = await ins(c, 'offering_audiences', { offering_id: offeringId, term_id: termId, section_id: sectionId, data_status: 'SYNTHETIC' });
  const facultyId = await ins(c, 'faculty_profiles', { name: 'Synthetic Faculty F1', data_status: 'SYNTHETIC' });
  const submissionId = await ins(c, 'faculty_submissions', { faculty_id: facultyId, term_id: termId });
  const [[rt]]: any = await c.query("SELECT room_type_id FROM room_types WHERE type_code = 'CLASSROOM'");
  const roomId = await ins(c, 'rooms', { room_code: `R${Math.random().toString(36).slice(2, 8)}`, room_type_id: rt.room_type_id, data_status: 'SYNTHETIC' });
  return { deptId, yearId, termId, programId, schemeId, semesterId, sectionId, courseId, theoryComponentId, labComponentId, offeringId, audienceId, facultyId, submissionId, userId, roomId };
}
