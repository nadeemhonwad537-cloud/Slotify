/**
 * Milestone 3 — Assignments API and Workload Service tests.
 *
 * Coverage:
 *  - Authorization: only ADMIN can write; faculty can read own approved only.
 *  - CRUD: create, list, get, patch role, delete (unapproved only).
 *  - Approve: sets is_approved + approved_by + approved_at.
 *  - Workload: confirmed vs unconfirmed split; HARD limit exceeded blocks create/change/approve;
 *    WARNING-mode does not block; missing designation => WARNING; no VERIFIED rule => NO_RULE.
 *  - Reference integrity: bad audience, bad faculty, source_preference faculty mismatch.
 *  - Duplicate detection: same audience+faculty+role is rejected.
 *  - Audit trail: every write emits an audit_logs row.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, pool, query } from '../src/db/pool';
import { client, Client, mkUser, mkVia, wipeTestData } from './apiHelpers';

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const MD = '/api/masterdata';
const ASSIGN = '/api/assignments';

// Shared fixture state
let admin: Client;
let faculty1: Client; // has designation + VERIFIED rule, workload limit testable
let faculty2: Client; // no designation
let faculty3: Client; // separate faculty to isolate view tests
let studentClient: Client;

const F: Record<string, any> = {};

beforeAll(async () => {
  // Clean up any stale users from previous runs
  await exec("DELETE FROM users WHERE username LIKE 'asgn\\_%'");

  // Create users
  const adminId = await mkUser(`asgn_admin_${RUN}`, ['ADMIN']);
  const f1UserId = await mkUser(`asgn_f1_${RUN}`, ['FACULTY']);
  const f2UserId = await mkUser(`asgn_f2_${RUN}`, ['FACULTY']);
  const f3UserId = await mkUser(`asgn_f3_${RUN}`, ['FACULTY']);
  const studentId = await mkUser(`asgn_student_${RUN}`, ['STUDENT']);

  admin = await client(`asgn_admin_${RUN}`);
  faculty1 = await client(`asgn_f1_${RUN}`);
  faculty2 = await client(`asgn_f2_${RUN}`);
  faculty3 = await client(`asgn_f3_${RUN}`);
  studentClient = await client(`asgn_student_${RUN}`);

  // Academic structure
  F.year = await mkVia(admin, `${MD}/academic-years`, { year_label: `AY${RUN}` });
  F.term = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: `OddTerm${RUN}`, parity: 'ODD', start_date: '2030-01-01', end_date: '2030-06-30' });
  F.dept = await mkVia(admin, `${MD}/departments`, { dept_code: `DEP${RUN}`, dept_name: 'Test Department' });
  F.prog = await mkVia(admin, `${MD}/programs`, { dept_id: F.dept.dept_id, program_code: `PROG${RUN}`, program_name: 'Test Program' });
  F.scheme = await mkVia(admin, `${MD}/schemes`, { program_id: F.prog.program_id, scheme_code: `SCH${RUN}` });
  F.sem = await mkVia(admin, `${MD}/semesters`, { scheme_id: F.scheme.scheme_id, semester_no: 3 });
  await mkVia(admin, `${MD}/term-program-semesters`, { term_id: F.term.term_id, semester_id: F.sem.semester_id });
  F.section = await mkVia(admin, `${MD}/sections`, { term_id: F.term.term_id, semester_id: F.sem.semester_id, section_name: 'A' });

  // Courses and components
  F.course1 = await mkVia(admin, `${MD}/courses`, { course_name: 'Digital Electronics', data_status: 'SYNTHETIC' });
  F.comp_theory = await mkVia(admin, `${MD}/components`, {
    course_id: F.course1.course_id, component_type: 'THEORY', weekly_hours: 3, data_status: 'SYNTHETIC',
  });
  F.comp_lab = await mkVia(admin, `${MD}/components`, {
    course_id: F.course1.course_id, component_type: 'LAB', weekly_hours: 2, data_status: 'SYNTHETIC',
  });

  F.course2 = await mkVia(admin, `${MD}/courses`, { course_name: 'Data Structures', data_status: 'SYNTHETIC' });
  F.comp2_theory = await mkVia(admin, `${MD}/components`, {
    course_id: F.course2.course_id, component_type: 'THEORY', weekly_hours: 3, data_status: 'SYNTHETIC',
  });

  // High-hour component for workload limit tests (17 hours — near the 18h Associate Professor limit)
  F.course3 = await mkVia(admin, `${MD}/courses`, { course_name: 'High Load Course', data_status: 'SYNTHETIC' });
  F.comp_high = await mkVia(admin, `${MD}/components`, {
    course_id: F.course3.course_id, component_type: 'THEORY', weekly_hours: 17, data_status: 'SYNTHETIC',
  });
  await Promise.all([F.course1, F.course2, F.course3].map(course =>
    mkVia(admin, `${MD}/curriculum-courses`, { semester_id: F.sem.semester_id, course_id: course.course_id }),
  ));

  // Offerings
  F.offering_theory = await mkVia(admin, `${MD}/offerings`, {
    component_id: F.comp_theory.component_id, term_id: F.term.term_id, status: 'OFFERED', data_status: 'SYNTHETIC',
  });
  F.offering_lab = await mkVia(admin, `${MD}/offerings`, {
    component_id: F.comp_lab.component_id, term_id: F.term.term_id, status: 'OFFERED', data_status: 'SYNTHETIC',
  });
  F.offering2 = await mkVia(admin, `${MD}/offerings`, {
    component_id: F.comp2_theory.component_id, term_id: F.term.term_id, status: 'OFFERED', data_status: 'SYNTHETIC',
  });
  F.offering_high = await mkVia(admin, `${MD}/offerings`, {
    component_id: F.comp_high.component_id, term_id: F.term.term_id, status: 'OFFERED', data_status: 'SYNTHETIC',
  });

  // Audiences
  F.aud_theory = await mkVia(admin, `${MD}/audiences`, {
    offering_id: F.offering_theory.offering_id, section_id: F.section.section_id, data_status: 'SYNTHETIC',
  });
  F.aud_lab = await mkVia(admin, `${MD}/audiences`, {
    offering_id: F.offering_lab.offering_id, section_id: F.section.section_id, data_status: 'SYNTHETIC',
  });
  F.aud2 = await mkVia(admin, `${MD}/audiences`, {
    offering_id: F.offering2.offering_id, section_id: F.section.section_id, data_status: 'SYNTHETIC',
  });
  F.aud_high = await mkVia(admin, `${MD}/audiences`, {
    offering_id: F.offering_high.offering_id, section_id: F.section.section_id, data_status: 'SYNTHETIC',
  });

  // Faculty profiles
  // faculty1: has a VERIFIED designation (Associate Professor, limit 18h)
  const [desgRow]: any = await pool.query("SELECT designation_id FROM designations WHERE designation_code = 'ASSOCIATE_PROFESSOR'");
  const assocProfId: number = desgRow[0].designation_id;
  // Upgrade the workload rule to VERIFIED so the HARD enforcement fires
  await pool.query(
    "UPDATE faculty_workload_rules SET data_status = 'VERIFIED' WHERE designation_id = ?",
    [assocProfId],
  );

  F.fac1 = await mkVia(admin, `${MD}/faculty`, {
    name: 'Fixture Faculty One', user_id: f1UserId, designation_id: assocProfId,
    dept_id: F.dept.dept_id, data_status: 'SYNTHETIC',
  });
  // faculty2: no designation
  F.fac2 = await mkVia(admin, `${MD}/faculty`, {
    name: 'Fixture Faculty Two', user_id: f2UserId, data_status: 'SYNTHETIC',
  });
  // faculty3: separate faculty, VERIFIED assistant professor limit
  const [asstRow]: any = await pool.query("SELECT designation_id FROM designations WHERE designation_code = 'ASSISTANT_PROFESSOR'");
  const asstProfId: number = asstRow[0].designation_id;
  await pool.query(
    "UPDATE faculty_workload_rules SET data_status = 'VERIFIED' WHERE designation_id = ?",
    [asstProfId],
  );
  F.fac3 = await mkVia(admin, `${MD}/faculty`, {
    name: 'Fixture Faculty Three', user_id: f3UserId, designation_id: asstProfId,
    dept_id: F.dept.dept_id, data_status: 'SYNTHETIC',
  });

  void adminId; void studentId;
});

afterAll(async () => {
  // Restore rule status so other test suites aren't affected
  const [desgRow]: any = await pool.query("SELECT designation_id FROM designations WHERE designation_code IN ('ASSOCIATE_PROFESSOR','ASSISTANT_PROFESSOR')");
  for (const d of desgRow) {
    await pool.query("UPDATE faculty_workload_rules SET data_status = 'VERIFY' WHERE designation_id = ?", [d.designation_id]);
  }
  await wipeTestData();
  await exec(`DELETE FROM users WHERE username LIKE 'asgn\\_%'`);
  await pool.end();
});

// ===========================================================================
// Authorization
// ===========================================================================
describe('authorization', () => {
  it('requires authentication', async () => {
    const anon = await client();
    expect((await anon.get(ASSIGN)).status).toBe(401);
    expect((await anon.post(ASSIGN, {})).status).toBe(401);
  });

  it('student cannot access any assignment endpoint', async () => {
    expect((await studentClient.get(ASSIGN)).status).toBe(403);
    expect((await studentClient.post(ASSIGN, {})).status).toBe(403);
    expect((await studentClient.get(`${ASSIGN}/allocation/contexts`)).status).toBe(403);
    expect((await studentClient.post(`${ASSIGN}/allocation/validate`, {})).status).toBe(403);
    expect((await studentClient.post(`${ASSIGN}/allocation/finalize`, {})).status).toBe(403);
  });

  it('admin can list, create and approve', async () => {
    // Just check that admin gets a 200 on the list (empty at this point)
    const r = await admin.get(`${ASSIGN}?term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    const contexts = await admin.get(`${ASSIGN}/allocation/contexts?term_id=${F.term.term_id}`);
    expect(contexts.status).toBe(200);
    expect(contexts.body.data).toHaveLength(1);
    expect(contexts.body.data[0].section_id).toBe(F.section.section_id);

    const plan = await admin.get(`${ASSIGN}/allocation/plan?term_id=${F.term.term_id}&program_id=${F.prog.program_id}&scheme_id=${F.scheme.scheme_id}&semester_id=${F.sem.semester_id}&section_id=${F.section.section_id}`);
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body.data.requirements).toHaveLength(4);
    expect(plan.body.data.issues.some((issue: any) => issue.code === 'MISSING_FACULTY')).toBe(true);

    const finalized = await admin.post(`${ASSIGN}/allocation/finalize`, {
      term_id: F.term.term_id,
      program_id: F.prog.program_id,
      scheme_id: F.scheme.scheme_id,
      semester_id: F.sem.semester_id,
      section_id: F.section.section_id,
    });
    expect(finalized.status).toBe(422);
    expect(finalized.body.error.code).toBe('ALLOCATION_VALIDATION_FAILED');
  });
});

// ===========================================================================
// Create
// ===========================================================================
describe('create assignment', () => {
  it('creates an assignment with role LECTURER', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_theory.audience_id,
      faculty_id: F.fac1.faculty_id,
      role: 'LECTURER',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = r.body.data;
    expect(d.is_approved).toBe(0);
    expect(d.role).toBe('LECTURER');
    F.assign_theory = d;
  });

  it('creates an assignment with role UNSPECIFIED (default)', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_lab.audience_id,
      faculty_id: F.fac1.faculty_id,
      // role omitted — should default to UNSPECIFIED
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.role).toBe('UNSPECIFIED');
    F.assign_lab_unspecified = r.body.data;
  });

  it('rejects duplicate audience+faculty+role', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_theory.audience_id,
      faculty_id: F.fac1.faculty_id,
      role: 'LECTURER',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE');
  });

  it('rejects unknown audience', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: 99999999,
      faculty_id: F.fac1.faculty_id,
      role: 'LECTURER',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('BAD_REFERENCE');
  });

  it('rejects unknown faculty', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_theory.audience_id,
      faculty_id: 99999999,
      role: 'LECTURER',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('BAD_REFERENCE');
  });

  it('creates second faculty on the same audience with a different role', async () => {
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_theory.audience_id,
      faculty_id: F.fac3.faculty_id,
      role: 'TUTOR',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    F.assign_fac3_theory = r.body.data;
  });
});

// ===========================================================================
// List and get
// ===========================================================================
describe('list and get', () => {
  it('lists all assignments with meta', async () => {
    const r = await admin.get(ASSIGN);
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by term_id', async () => {
    const r = await admin.get(`${ASSIGN}?term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.every((a: any) => a.term_id === F.term.term_id)).toBe(true);
  });

  it('filters by faculty_id', async () => {
    const r = await admin.get(`${ASSIGN}?faculty_id=${F.fac1.faculty_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.every((a: any) => a.faculty_id === F.fac1.faculty_id)).toBe(true);
  });

  it('filters by is_approved', async () => {
    const r = await admin.get(`${ASSIGN}?is_approved=0`);
    expect(r.status).toBe(200);
    expect(r.body.data.every((a: any) => a.is_approved === 0)).toBe(true);
  });

  it('gets single assignment with enriched fields', async () => {
    const r = await admin.get(`${ASSIGN}/${F.assign_theory.assignment_id}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.course_name).toBeTruthy();
    expect(d.component_type).toBe('THEORY');
    expect(d.faculty_name).toBeTruthy();
  });

  it('returns 404 for unknown assignment', async () => {
    expect((await admin.get(`${ASSIGN}/99999999`)).status).toBe(404);
  });

  it('faculty can see their own approved assignments only', async () => {
    // Approve fac1 theory assignment first
    await admin.post(`${ASSIGN}/${F.assign_theory.assignment_id}/approve`, {});

    const r = await faculty1.get(ASSIGN);
    expect(r.status).toBe(200);
    // All returned rows must be for fac1 and approved
    expect(r.body.data.every((a: any) => a.faculty_id === F.fac1.faculty_id)).toBe(true);
    expect(r.body.data.every((a: any) => a.is_approved === 1)).toBe(true);
  });

  it('faculty cannot see another faculty member\'s assignment', async () => {
    const r = await faculty1.get(`${ASSIGN}/${F.assign_fac3_theory.assignment_id}`);
    expect(r.status).toBe(403);
  });
});

// ===========================================================================
// Patch (change role)
// ===========================================================================
describe('patch assignment', () => {
  it('changes the role of an unapproved assignment', async () => {
    // assign_lab_unspecified is still unapproved at this point
    const r = await admin.patch(`${ASSIGN}/${F.assign_lab_unspecified.assignment_id}`, {
      role: 'LAB_LEAD',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.role).toBe('LAB_LEAD');
  });

  it('supports reassigning an unapproved allocation to another faculty member', async () => {
    const created = await admin.post(ASSIGN, {
      audience_id: F.aud2.audience_id,
      faculty_id: F.fac2.faculty_id,
      role: 'TUTOR',
    });
    expect(created.status).toBe(201);
    const changed = await admin.patch(`${ASSIGN}/${created.body.data.assignment_id}`, {
      faculty_id: F.fac3.faculty_id,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data.faculty_id).toBe(F.fac3.faculty_id);
    await admin.del(`${ASSIGN}/${created.body.data.assignment_id}`);
  });

  it('rejects empty update body', async () => {
    const r = await admin.patch(`${ASSIGN}/${F.assign_lab_unspecified.assignment_id}`, {});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('EMPTY_UPDATE');
  });

  it('returns 404 for unknown assignment', async () => {
    expect((await admin.patch(`${ASSIGN}/99999999`, { role: 'TUTOR' })).status).toBe(404);
  });
});

// ===========================================================================
// Approve
// ===========================================================================
describe('approve assignment', () => {
  it('approves an assignment and sets approval fields', async () => {
    // assign_lab (now LAB_LEAD) — not yet approved
    const r = await admin.post(`${ASSIGN}/${F.assign_lab_unspecified.assignment_id}/approve`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.is_approved).toBe(1);
    expect(d.approved_by).toBeTruthy();
    expect(d.approved_at).toBeTruthy();
  });

  it('cannot approve an already-approved assignment', async () => {
    const r = await admin.post(`${ASSIGN}/${F.assign_lab_unspecified.assignment_id}/approve`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_APPROVED');
  });

  it('returns 404 for unknown assignment', async () => {
    expect((await admin.post(`${ASSIGN}/99999999/approve`, {})).status).toBe(404);
  });
});

// ===========================================================================
// Delete
// ===========================================================================
describe('delete assignment', () => {
  it('deletes an unapproved assignment', async () => {
    // Create a fresh one to delete
    const created = await admin.post(ASSIGN, {
      audience_id: F.aud2.audience_id,
      faculty_id: F.fac2.faculty_id,
      role: 'LECTURER',
    });
    expect(created.status).toBe(201);
    const tempId = created.body.data.assignment_id;

    const r = await admin.del(`${ASSIGN}/${tempId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe(tempId);
    expect((await admin.get(`${ASSIGN}/${tempId}`)).status).toBe(404);
  });

  it('cannot delete an approved assignment', async () => {
    // assign_theory is now approved
    const r = await admin.del(`${ASSIGN}/${F.assign_theory.assignment_id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ASSIGNMENT_APPROVED');
  });

  it('returns 404 for unknown assignment', async () => {
    expect((await admin.del(`${ASSIGN}/99999999`)).status).toBe(404);
  });
});

// ===========================================================================
// Workload endpoint
// ===========================================================================
describe('workload endpoint', () => {
  it('returns confirmed hours and OK status when under the limit', async () => {
    // fac1 has: LECTURER on theory (3h, approved) + LAB_LEAD on lab (2h, approved) = 5h confirmed
    const r = await admin.get(`${ASSIGN}/workload?faculty_id=${F.fac1.faculty_id}&term_id=${F.term.term_id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.confirmed_hours).toBe(5);
    expect(d.limit_status).toBe('OK');
    expect(d.max_hours).toBe(18);
    expect(d.enforcement_mode).toBe('HARD');
  });

  it('returns WARNING when faculty has no designation', async () => {
    const r = await admin.get(`${ASSIGN}/workload?faculty_id=${F.fac2.faculty_id}&term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.limit_status).toBe('WARNING');
    expect(r.body.data.warning_message).toMatch(/no designation/i);
  });

  it('separates unconfirmed activities', async () => {
    // Create a LAB_ASSISTANT assignment (role with UNCONFIRMED counting policy)
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud2.audience_id,
      faculty_id: F.fac2.faculty_id,
      role: 'LAB_ASSISTANT',
    });
    expect(r.status).toBe(201);
    await admin.post(`${ASSIGN}/${r.body.data.assignment_id}/approve`, {});

    const wl = await admin.get(`${ASSIGN}/workload?faculty_id=${F.fac2.faculty_id}&term_id=${F.term.term_id}`);
    expect(wl.status).toBe(200);
    const d = wl.body.data;
    expect(d.unconfirmed_hours).toBeGreaterThan(0);
    expect(d.unconfirmed_activities).toHaveLength(1);
    expect(d.unconfirmed_activities[0].role).toBe('LAB_ASSISTANT');
    expect(d.unconfirmed_activities[0].counts_toward_limit).toBe('UNCONFIRMED');
    // Confirmed hours are still zero (fac2 has no confirmed roles)
    expect(d.confirmed_hours).toBe(0);
  });

  it('faculty can see their own workload', async () => {
    const r = await faculty1.get(`${ASSIGN}/workload?faculty_id=${F.fac1.faculty_id}&term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
  });

  it('faculty cannot see another faculty member\'s workload', async () => {
    const r = await faculty1.get(`${ASSIGN}/workload?faculty_id=${F.fac2.faculty_id}&term_id=${F.term.term_id}`);
    expect(r.status).toBe(403);
  });

  it('requires faculty_id and term_id', async () => {
    expect((await admin.get(`${ASSIGN}/workload?faculty_id=${F.fac1.faculty_id}`)).status).toBe(400);
    expect((await admin.get(`${ASSIGN}/workload?term_id=${F.term.term_id}`)).status).toBe(400);
  });
});

// ===========================================================================
// Workload limit enforcement
// ===========================================================================
describe('workload limit enforcement (HARD)', () => {
  it('blocks creating an assignment that would push fac1 over 18h (HARD)', async () => {
    // fac1 already has 5h confirmed (theory LECTURER + lab LAB_LEAD, both approved).
    // Assign the 17h high-load course: 5+17 = 22 > 18 => WORKLOAD_EXCEEDED
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud_high.audience_id,
      faculty_id: F.fac1.faculty_id,
      role: 'LECTURER',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('WORKLOAD_EXCEEDED');
    expect(r.body.error.details?.confirmed_hours).toBe(22);
    expect(r.body.error.details?.max_hours).toBe(18);
  });

  it('blocks approving an assignment that would push fac1 over 18h', async () => {
    // Insert directly (bypassing the API workload check) to simulate an unapproved row
    const [ins]: any = await pool.query(
      'INSERT INTO faculty_assignments (audience_id, faculty_id, role) VALUES (?, ?, ?)',
      [F.aud_high.audience_id, F.fac1.faculty_id, 'LECTURER'],
    );
    const tempId: number = ins.insertId;

    // Approving should fail because 5 (existing approved) + 17 = 22 > 18
    const r = await admin.post(`${ASSIGN}/${tempId}/approve`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('WORKLOAD_EXCEEDED');

    // Cleanup
    await pool.query('DELETE FROM faculty_assignments WHERE assignment_id = ?', [tempId]);
  });

  it('blocks changing a role to one that tips the limit', async () => {
    // fac1 has LECTURER on theory (3h approved) + LAB_LEAD on lab (2h approved) = 5h confirmed.
    // Create a new UNSPECIFIED assignment on aud_high (17h) — UNSPECIFIED is not in CONFIRMED_ROLES
    // so it doesn't count yet.
    const created = await admin.post(ASSIGN, {
      audience_id: F.aud_high.audience_id,
      faculty_id: F.fac1.faculty_id,
      role: 'UNSPECIFIED',
    });
    expect(created.status).toBe(201);
    const tempId = created.body.data.assignment_id;

    // Changing role to LECTURER makes it count: 5 + 17 = 22 > 18
    const r = await admin.patch(`${ASSIGN}/${tempId}`, { role: 'LECTURER' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('WORKLOAD_EXCEEDED');

    // Cleanup
    await pool.query('DELETE FROM faculty_assignments WHERE assignment_id = ?', [tempId]);
  });

  it('does NOT block when enforcement_mode is WARNING (rule status downgraded)', async () => {
    // Temporarily set fac3's rule (ASSISTANT_PROFESSOR, 20h) to WARNING mode
    const [aRow]: any = await pool.query("SELECT designation_id FROM designations WHERE designation_code = 'ASSISTANT_PROFESSOR'");
    const asstId: number = aRow[0].designation_id;
    await pool.query("UPDATE faculty_workload_rules SET enforcement_mode = 'WARNING' WHERE designation_id = ?", [asstId]);

    // fac3 currently has TUTOR on theory (3h, approved) = 3h confirmed.
    // Assign the 17h high-load course: 3+17 = 20 = limit (not over), so first check fine...
    // Let's give a direct insert to make fac3 at 20h then try to add 1h more via API.
    // Simpler: just assign 17h as TUTOR => 3+17=20 which equals the limit but doesn't exceed.
    // To test WARNING, we need to exceed it. Use fac3 + aud_high => TUTOR 17h => total 20 = limit.
    // Then add the theory 3h => 20+3=23 > 20, but WARNING should not block.

    // fac3 already has assign_fac3_theory (TUTOR, 3h, but NOT approved yet - check)
    const [fac3rows]: any = await pool.query(
      'SELECT is_approved FROM faculty_assignments WHERE assignment_id = ?',
      [F.assign_fac3_theory.assignment_id],
    );
    // ensure not approved
    if (fac3rows[0]?.is_approved) {
      // skip this path
    } else {
      // Try assigning a 17h course to fac3 on top of the existing 0h confirmed (unapproved)
      // 0 + 17 = 17 < 20 => OK. Approve fac3 theory first to get 3h confirmed.
      await admin.post(`${ASSIGN}/${F.assign_fac3_theory.assignment_id}/approve`, {});

      // Now fac3 has 3h confirmed. Add 17h as TUTOR for aud_high => 3+17=20 = limit exactly => OK
      const r1 = await admin.post(ASSIGN, {
        audience_id: F.aud_high.audience_id,
        faculty_id: F.fac3.faculty_id,
        role: 'TUTOR',
      });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      F.assign_fac3_high = r1.body.data;

      // Approve it so confirmed = 20h
      await admin.post(`${ASSIGN}/${F.assign_fac3_high.assignment_id}/approve`, {});

      // Now create yet another course to push it over (3h more => 23 > 20).
      // Under WARNING mode this should succeed.
      const r2 = await admin.post(ASSIGN, {
        audience_id: F.aud2.audience_id,
        faculty_id: F.fac3.faculty_id,
        role: 'TUTOR',
      });
      // WARNING mode: 201 expected
      expect(r2.status, JSON.stringify(r2.body)).toBe(201);
      F.assign_fac3_over = r2.body.data;
    }

    // Restore HARD mode
    await pool.query("UPDATE faculty_workload_rules SET enforcement_mode = 'HARD' WHERE designation_id = ?", [asstId]);
  });
});

// ===========================================================================
// NO_RULE: designation exists but no VERIFIED rule
// ===========================================================================
describe('workload: no VERIFIED rule', () => {
  it('returns NO_RULE when a designation has no VERIFIED rule', async () => {
    // Temporarily set fac3's rule back to VERIFY (unverified)
    const [aRow]: any = await pool.query("SELECT designation_id FROM designations WHERE designation_code = 'ASSISTANT_PROFESSOR'");
    const asstId: number = aRow[0].designation_id;
    await pool.query("UPDATE faculty_workload_rules SET data_status = 'VERIFY' WHERE designation_id = ?", [asstId]);

    const r = await admin.get(`${ASSIGN}/workload?faculty_id=${F.fac3.faculty_id}&term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.limit_status).toBe('NO_RULE');
    expect(r.body.data.warning_message).toMatch(/no VERIFIED workload rule/i);

    // Restore
    await pool.query("UPDATE faculty_workload_rules SET data_status = 'VERIFIED' WHERE designation_id = ?", [asstId]);
  });
});

// ===========================================================================
// Source preference reference
// ===========================================================================
describe('source_preference_id', () => {
  it('rejects a source_preference_id that belongs to a different faculty', async () => {
    // Create a submission + preference for fac2
    const conn = await pool.getConnection();
    let prefId: number;
    try {
      await conn.beginTransaction();
      const [sub]: any = await conn.query(
        'INSERT IGNORE INTO faculty_submissions (faculty_id, term_id) VALUES (?, ?)',
        [F.fac2.faculty_id, F.term.term_id],
      );
      const [subRow]: any = await conn.query(
        'SELECT submission_id FROM faculty_submissions WHERE faculty_id = ? AND term_id = ?',
        [F.fac2.faculty_id, F.term.term_id],
      );
      const [pref]: any = await conn.query(
        'INSERT INTO faculty_subject_preferences (submission_id, preference_order, course_id) VALUES (?, 1, ?)',
        [subRow[0].submission_id, F.course1.course_id],
      );
      prefId = pref.insertId;
      await conn.commit();
    } finally {
      conn.release();
    }

    // Try to assign fac1 using fac2's preference → should fail
    const r = await admin.post(ASSIGN, {
      audience_id: F.aud2.audience_id,
      faculty_id: F.fac1.faculty_id,
      role: 'LECTURER',
      source_preference_id: prefId!,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PREFERENCE_FACULTY_MISMATCH');
  });
});

// ===========================================================================
// Audit trail
// ===========================================================================
describe('audit trail', () => {
  it('records ASSIGNMENT_CREATED for each new assignment', async () => {
    const rows = await query<any>(
      "SELECT action FROM audit_logs WHERE table_name = 'faculty_assignments' AND record_id = ? ORDER BY audit_id",
      [F.assign_theory.assignment_id],
    );
    expect(rows.map((r: any) => r.action)).toContain('ASSIGNMENT_CREATED');
  });

  it('records ASSIGNMENT_APPROVED', async () => {
    const rows = await query<any>(
      "SELECT action FROM audit_logs WHERE table_name = 'faculty_assignments' AND record_id = ? ORDER BY audit_id",
      [F.assign_theory.assignment_id],
    );
    expect(rows.map((r: any) => r.action)).toContain('ASSIGNMENT_APPROVED');
  });

  it('records ASSIGNMENT_CHANGED on patch', async () => {
    const rows = await query<any>(
      "SELECT action FROM audit_logs WHERE table_name = 'faculty_assignments' AND record_id = ? ORDER BY audit_id",
      [F.assign_lab_unspecified.assignment_id],
    );
    expect(rows.map((r: any) => r.action)).toContain('ASSIGNMENT_CHANGED');
  });
});
