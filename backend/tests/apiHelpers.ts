import bcrypt from 'bcryptjs';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { exec, pool } from '../src/db/pool';

export const app = createApp();
export const PW = 'Test-Password-12345'; // test-only
const ORIGIN = 'http://localhost:5173';

export async function mkUser(username: string, roles: string[]) {
  const r = await exec('INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [username, `${username}@example.test`, await bcrypt.hash(PW, 4), `Test ${username}`]);
  for (const role of roles) await exec('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [r.insertId, role]);
  return r.insertId;
}

/** Cookie-keeping API client that sends the CSRF header on unsafe methods; logs in when a username is given. */
export async function client(username?: string) {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/auth/csrf');
  const t: string = body.data.csrfToken;
  const w = (m: 'post' | 'patch' | 'put' | 'delete') => (url: string, data?: object) => agent[m](url).set('Origin', ORIGIN).set('x-csrf-token', t).send(data ?? {});
  const c = { get: (u: string) => agent.get(u), post: w('post'), patch: w('patch'), put: w('put'), del: w('delete') };
  if (username) {
    const r = await c.post('/api/auth/login', { identifier: username, password: PW });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`);
  }
  return c;
}
export type Client = Awaited<ReturnType<typeof client>>;

/** Creates through the real API and returns the record (fails the test unless 201). */
export async function mkVia(c: Client, url: string, body: object) {
  const r = await c.post(url, body);
  expect(r.status, `${url}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body.data as Record<string, any>;
}

/** Removes data created by API test suites. Reference seed tables (room_types, designations, workload rules, ...) are kept. */
export async function wipeTestData() {
  const c = await pool.getConnection();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['audit_logs', 'faculty_source_subject_preferences', 'workload_import_rows', 'workload_import_batches', 'discrepancy_log', 'data_provenance', 'source_documents',
      'faculty_availability', 'faculty_subject_preferences', 'faculty_assignments', 'faculty_submissions',
      'elective_group_offerings', 'elective_groups', 'offering_audiences', 'course_offerings', 'curriculum_courses', 'course_components', 'courses',
      'batches', 'sections', 'room_availability', 'term_day_slots', 'time_slots', 'term_teaching_days', 'faculty_profiles', 'rooms',
      'semesters', 'curriculum_schemes', 'programs', 'terms', 'academic_years', 'departments']) {
      await c.query('DELETE FROM ??', [t]);
    }
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { c.release(); }
}
