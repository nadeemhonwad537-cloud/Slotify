import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, pool, query } from '../src/db/pool';
import { client, Client, mkUser, mkVia, wipeTestData } from './apiHelpers';

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const MD = '/api/masterdata';
const SUB = '/api/faculty-submissions';
const AV = '/api/faculty-availability';

let admin: Client, f1: Client, f2: Client, f3: Client, noProfile: Client, student: Client, coord: Client, adminWithProfile: Client;
const F: Record<string, any> = {};
const win = (day: string, s: string, e: string, t: string) => ({ day, start_time: s, end_time: e, availability_type: t });

beforeAll(async () => {
  await exec("DELETE FROM users WHERE username LIKE 'sub\\_%'");
  await mkUser('sub_admin', ['ADMIN']);
  const u1 = await mkUser('sub_f1', ['FACULTY']); const u2 = await mkUser('sub_f2', ['FACULTY']); const u3 = await mkUser('sub_f3', ['FACULTY']);
  await mkUser('sub_noprofile', ['FACULTY']); await mkUser('sub_student', ['STUDENT']); await mkUser('sub_coord', ['COORDINATOR']);
  const uAdmin2 = await mkUser('sub_admin2', ['ADMIN', 'FACULTY']);
  admin = await client('sub_admin'); f1 = await client('sub_f1'); f2 = await client('sub_f2'); f3 = await client('sub_f3');
  noProfile = await client('sub_noprofile'); student = await client('sub_student'); coord = await client('sub_coord'); adminWithProfile = await client('sub_admin2');

  F.year = await mkVia(admin, `${MD}/academic-years`, { year_label: `SY${RUN}` });
  F.term = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: 'Odd', parity: 'ODD', start_date: '2030-01-01', end_date: '2030-06-30', status: 'ACTIVE' });
  F.closedTerm = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: 'Closed', parity: 'EVEN', start_date: '2030-07-01', end_date: '2030-12-31', status: 'CLOSED' });
  F.dept = await mkVia(admin, `${MD}/departments`, { dept_code: `DP${RUN}`, dept_name: 'Synthetic Preference Department' });
  F.program = await mkVia(admin, `${MD}/programs`, { dept_id: F.dept.dept_id, program_code: `PG${RUN}`, program_name: 'Synthetic Preference Program' });
  F.scheme = await mkVia(admin, `${MD}/schemes`, { program_id: F.program.program_id, scheme_code: `SC${RUN}` });
  F.semester = await mkVia(admin, `${MD}/semesters`, { scheme_id: F.scheme.scheme_id, semester_no: 1 });
  await mkVia(admin, `${MD}/term-program-semesters`, { term_id: F.term.term_id, semester_id: F.semester.semester_id });
  for (const [k, n] of [['c1', 'Synthetic Course 1'], ['c2', 'Synthetic Course 2'], ['c3', 'Synthetic Course 3'], ['c4', 'Synthetic Course 4']]) {
    F[k] = await mkVia(admin, `${MD}/courses`, { course_name: n, data_status: 'SYNTHETIC' });
  }
  F.c1lab = await mkVia(admin, `${MD}/components`, { course_id: F.c1.course_id, component_type: 'LAB', weekly_hours: 2 });
  F.c1theory = await mkVia(admin, `${MD}/components`, { course_id: F.c1.course_id, component_type: 'THEORY', weekly_hours: 3 });
  F.c2theory = await mkVia(admin, `${MD}/components`, { course_id: F.c2.course_id, component_type: 'THEORY', weekly_hours: 3 });
  F.c3theory = await mkVia(admin, `${MD}/components`, { course_id: F.c3.course_id, component_type: 'THEORY', weekly_hours: 2 });
  F.c4theory = await mkVia(admin, `${MD}/components`, { course_id: F.c4.course_id, component_type: 'THEORY', weekly_hours: 1 });
  for (const [course, component] of [[F.c1, F.c1lab], [F.c1, F.c1theory], [F.c2, F.c2theory], [F.c3, F.c3theory], [F.c4, F.c4theory]]) {
    await mkVia(admin, `${MD}/curriculum-courses`, { semester_id: F.semester.semester_id, course_id: course.course_id });
    await mkVia(admin, `${MD}/offerings`, { component_id: component.component_id, term_id: F.term.term_id, status: 'OFFERED' });
  }
  F.unpublished = await mkVia(admin, `${MD}/courses`, { course_name: 'Synthetic Draft-only Course' });
  F.unpublishedComponent = await mkVia(admin, `${MD}/components`, { course_id: F.unpublished.course_id, component_type: 'THEORY' });
  await mkVia(admin, `${MD}/curriculum-courses`, { semester_id: F.semester.semester_id, course_id: F.unpublished.course_id });
  await mkVia(admin, `${MD}/offerings`, { component_id: F.unpublishedComponent.component_id, term_id: F.term.term_id, status: 'DRAFT' });
  F.inactive = await mkVia(admin, `${MD}/courses`, { course_name: 'Retired Course', is_active: false });
  F.fac1 = await mkVia(admin, `${MD}/faculty`, { name: 'Synthetic Faculty One', user_id: u1, data_status: 'SYNTHETIC' });
  F.fac2 = await mkVia(admin, `${MD}/faculty`, { name: 'Synthetic Faculty Two', user_id: u2, data_status: 'SYNTHETIC' });
  F.fac3 = await mkVia(admin, `${MD}/faculty`, { name: 'Synthetic Faculty Three', user_id: u3, data_status: 'SYNTHETIC' });
  F.facAdmin = await mkVia(admin, `${MD}/faculty`, { name: 'Admin Who Teaches', user_id: uAdmin2 });
});
afterAll(async () => { await wipeTestData(); await exec("DELETE FROM users WHERE username LIKE 'sub\\_%'"); await pool.end(); });

const draft = (over: Record<string, any> = {}) => ({
  term_id: F.term.term_id,
  program_id: F.program.program_id,
  semester_id: F.semester.semester_id,
  // Exactly 3 preferences — required at submit time; allowed to be fewer in drafts
  preferences: [
    { course_id: F.c1.course_id },
    { course_id: F.c2.course_id, component_id: F.c2theory.component_id, note: 'prefer theory' },
    { course_id: F.c3.course_id },
  ],
  availability: [win('MON', '09:00', '11:00', 'AVAILABLE'), win('TUE', '09:00', '10:00', 'UNAVAILABLE'), win('WED', '14:00', '16:00', 'UNKNOWN')],
  ...over,
});

describe('authorization and identity', () => {
  it('requires authentication', async () => {
    expect((await (await client()).get(`${SUB}/mine?term_id=1`)).status).toBe(401);
  });
  it('only faculty can use the faculty form; students and coordinators cannot', async () => {
    expect((await student.get(`${SUB}/mine?term_id=${F.term.term_id}`)).status).toBe(403);
    expect((await student.get(`${SUB}/mine/source-subjects`)).status).toBe(403);
    expect((await f1.get(`${SUB}/mine/source-subjects`)).status).toBe(403);
    expect((await coord.put(`${SUB}/mine`, draft())).status).toBe(403);
    expect((await admin.put(`${SUB}/mine`, draft())).status).toBe(403);
  });
  it('a faculty login without a linked profile is refused', async () => {
    const r = await noProfile.put(`${SUB}/mine`, draft());
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('NO_FACULTY_PROFILE');
  });
  it('faculty can read only their own linked profile', async () => {
    const ownProfile = await f1.get(`${SUB}/mine/profile`);
    expect(ownProfile.status).toBe(200);
    expect(ownProfile.body.data.faculty_id).toBe(F.fac1.faculty_id);

    const missingProfile = await noProfile.get(`${SUB}/mine/profile`);
    expect(missingProfile.status).toBe(200);
    expect(missingProfile.body.data).toBeNull();
  });
  it('faculty cannot review, list all submissions or enter availability for others', async () => {
    expect((await f1.get(SUB)).status).toBe(403);
    expect((await f1.post(`${SUB}/1/review`, { action: 'ACCEPT' })).status).toBe(403);
    expect((await f1.post(AV, { faculty_id: F.fac1.faculty_id, term_id: F.term.term_id, ...win('MON', '09:00', '10:00', 'AVAILABLE') })).status).toBe(403);
  });
  it('a faculty member cannot target another faculty member (identity comes from the session)', async () => {
    expect((await f1.put(`${SUB}/mine`, { ...draft(), faculty_id: F.fac2.faculty_id })).status).toBe(400);
  });
});

describe('draft: preferences and availability', () => {
  it('returns an empty form with UNKNOWN availability before anything is saved', async () => {
    const r = await f1.get(`${SUB}/mine?term_id=${F.term.term_id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.submission).toBeNull();
    expect(r.body.data.unrecordedAvailability).toBe('UNKNOWN');
  });
  it('saves a draft with ordered preferences and explicit availability states', async () => {
    const r = await f1.put(`${SUB}/mine`, draft());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.submission.submission_status).toBe('DRAFT');
    expect(d.preferences.map((p: any) => [p.preference_order, p.course_id, p.component_id])).toEqual([
      [1, F.c1.course_id, null],
      [2, F.c2.course_id, F.c2theory.component_id],
      [3, F.c3.course_id, null],
    ]);
    expect(d.availability.map((a: any) => a.availability_type)).toEqual(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);
    expect(d.availability.every((a: any) => a.source === 'FACULTY_SUBMISSION' && a.data_status === 'VERIFY')).toBe(true);
    F.sub1 = d.submission.submission_id;
  });
  it('saving again replaces the previous draft', async () => {
    const r = await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.c3.course_id }], availability: [] }));
    expect(r.status).toBe(200);
    expect(r.body.data.preferences).toHaveLength(1);  // draft allows <3
    expect(r.body.data.availability).toHaveLength(0);
    expect(r.body.data.submission.submission_id).toBe(F.sub1);
  });
  it('offers imported source labels as pending requests without creating canonical course preferences', async () => {
    const [document]: any = await pool.query(
      "INSERT INTO source_documents (file_name, source_type) VALUES ('test-workload.png', 'TEST_FIXTURE')",
    );
    const [batch]: any = await pool.query(
      "INSERT INTO workload_import_batches (source_key, content_sha256, source_document_id) VALUES (?, ?, ?)",
      [`source-pref-${RUN}`, 'a'.repeat(64), document.insertId],
    );
    const sourceSubjects = [
      { column: 'Subject-I', rawLabel: 'Unmapped AI-SD', weeklyHours: 5 },
      { column: 'Subject-II', rawLabel: 'Known Acronym', weeklyHours: 3 },
    ];
    const [sourceRow]: any = await pool.query(
      `INSERT INTO workload_import_rows
       (batch_id, source_row_number, source_page, raw_source_line, source_name, group_label, faculty_category,
        subjects, lab_duty, printed_load_source_text, source_snapshot, unresolved_fields, issues)
       VALUES (?, 1, 1, 'test source row', 'Test Source Faculty', 'Test block', 'REGULAR_CANDIDATE',
        ?, JSON_OBJECT('rawLabel', NULL, 'weeklyHours', NULL), 'unknown', JSON_OBJECT(), JSON_ARRAY(), JSON_ARRAY())`,
      [batch.insertId, JSON.stringify(sourceSubjects)],
    );
    F.sourceRow = sourceRow.insertId;
    const [duplicateRow]: any = await pool.query(
      `INSERT INTO workload_import_rows
       (batch_id, source_row_number, source_page, raw_source_line, source_name, group_label, faculty_category,
        subjects, lab_duty, printed_load_source_text, source_snapshot, unresolved_fields, issues)
       VALUES (?, 2, 1, 'duplicate test source row', 'Test Source Faculty Two', 'Test block', 'REGULAR_CANDIDATE',
        ?, JSON_OBJECT('rawLabel', NULL, 'weeklyHours', NULL), 'unknown', JSON_OBJECT(), JSON_ARRAY(), JSON_ARRAY())`,
      [batch.insertId, JSON.stringify([{ column: 'Subject-I', rawLabel: 'unmapped ai-sd', weeklyHours: 5 }])],
    );

    const available = await admin.get(`${SUB}/mine/source-subjects`);
    expect(available.status).toBe(200);
    expect(available.body.data).toContainEqual(expect.objectContaining({
      source_row_id: sourceRow.insertId,
      source_label: 'Unmapped AI-SD',
      weekly_hours: 5,
      occurrences: 2,
      verification_status: 'PENDING_ADMIN_VERIFICATION',
    }));
    const unsupported = await f1.put(`${SUB}/mine`, draft({
      preferences: [{ source_row_id: sourceRow.insertId, subject_column: 'Subject-I' }],
    }));
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error.code).toBe('SUBJECT_NOT_PUBLISHED_FOR_TERM');
    void duplicateRow;
  });
  it('rejects a fourth preference at the API (backend) level', async () => {
    const four = [F.c1, F.c2, F.c3, F.c4].map((c) => ({ course_id: c.course_id }));
    const r = await f1.put(`${SUB}/mine`, draft({ preferences: four }));
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('the database itself refuses a fourth preference row and a duplicate order', async () => {
    await exec('DELETE FROM faculty_subject_preferences WHERE submission_id = ?', [F.sub1]);
    await exec('DELETE FROM faculty_source_subject_preferences WHERE submission_id = ?', [F.sub1]);
    const ins = (order: number, course: number) => pool.query(
      'INSERT INTO faculty_subject_preferences (submission_id, preference_order, course_id) VALUES (?, ?, ?)', [F.sub1, order, course]);
    await ins(2, F.c2.course_id); await ins(3, F.c4.course_id);
    await expect(ins(4, F.c1.course_id)).rejects.toMatchObject({ errno: 3819 });
    await expect(ins(3, F.c1.course_id)).rejects.toMatchObject({ errno: 1062 });
    await exec('DELETE FROM faculty_subject_preferences WHERE submission_id = ?', [F.sub1]);
  });
  it('rejects duplicate subjects, unknown/inactive courses and components of another course', async () => {
    const dup = await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.c1.course_id }, { course_id: F.c1.course_id }] }));
    expect(dup.status).toBe(400); expect(dup.body.error.code).toBe('DUPLICATE_PREFERENCE');
    const duplicateDifferentComponent = await f1.put(`${SUB}/mine`, draft({ preferences: [
      { course_id: F.c1.course_id, component_id: F.c1lab.component_id },
      { course_id: F.c1.course_id, component_id: F.c1theory.component_id },
    ] }));
    expect(duplicateDifferentComponent.status).toBe(400);
    expect(duplicateDifferentComponent.body.error.code).toBe('DUPLICATE_PREFERENCE');
    expect((await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: 99999999 }] }))).body.error.code).toBe('BAD_REFERENCE');
    expect((await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.inactive.course_id }] }))).body.error.code).toBe('COURSE_INACTIVE');
    const mismatch = await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.c1.course_id, component_id: F.c2theory.component_id }] }));
    expect(mismatch.status).toBe(422); expect(mismatch.body.error.code).toBe('COMPONENT_COURSE_MISMATCH');
    const unpublished = await f1.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.unpublished.course_id }] }));
    expect(unpublished.status).toBe(422);
    expect(unpublished.body.error.code).toBe('SUBJECT_NOT_PUBLISHED_FOR_TERM');
    const invalidContext = await f1.put(`${SUB}/mine`, draft({ program_id: 99999999 }));
    expect(invalidContext.status).toBe(422);
    expect(invalidContext.body.error.code).toBe('TERM_CURRICULUM_NOT_APPLICABLE');
  });
  it('allows zero preferences and requires an explicit availability state per window', async () => {
    expect((await f2.put(`${SUB}/mine`, draft({ preferences: [], availability: [] }))).status).toBe(200);
    const missing = await f2.put(`${SUB}/mine`, draft({ availability: [{ day: 'MON', start_time: '09:00', end_time: '10:00' }] }));
    expect(missing.status).toBe(400);
    const bad = await f2.put(`${SUB}/mine`, draft({ availability: [win('MON', '09:00', '10:00', 'MAYBE')] }));
    expect(bad.status).toBe(400);
  });
  it('rejects overlapping or backwards availability windows', async () => {
    const overlap = await f2.put(`${SUB}/mine`, draft({ availability: [win('MON', '09:00', '11:00', 'AVAILABLE'), win('MON', '10:00', '12:00', 'UNAVAILABLE')] }));
    expect(overlap.status).toBe(422); expect(overlap.body.error.code).toBe('AVAILABILITY_OVERLAP');
    const back = await f2.put(`${SUB}/mine`, draft({ availability: [win('MON', '11:00', '10:00', 'AVAILABLE')] }));
    expect(back.status).toBe(422); expect(back.body.error.code).toBe('TIME_ORDER');
  });
  it('refuses edits to a closed term', async () => {
    const r = await f2.put(`${SUB}/mine`, draft({ term_id: F.closedTerm.term_id }));
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('TERM_CLOSED');
  });
  it('isolates faculty from each other', async () => {
    const r = await f3.get(`${SUB}/mine?term_id=${F.term.term_id}`);
    expect(r.body.data.submission).toBeNull();
  });
});

describe('available-courses endpoint', () => {
  const query = () => `term_id=${F.term.term_id}&program_id=${F.program.program_id}&semester_id=${F.semester.semester_id}`;
  it('requires faculty authentication', async () => {
    expect((await student.get(`${SUB}/mine/available-courses?${query()}`)).status).toBe(403);
    expect((await admin.get(`${SUB}/mine/available-courses?${query()}`)).status).toBe(403);
    expect((await student.get(`${SUB}/mine/term-program-semesters?term_id=${F.term.term_id}`)).status).toBe(403);
    expect((await admin.get(`${SUB}/mine/term-program-semesters?term_id=${F.term.term_id}`)).status).toBe(403);
  });
  it('returns only active mapped program semesters for an active term', async () => {
    const response = await f1.get(`${SUB}/mine/term-program-semesters?term_id=${F.term.term_id}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toContainEqual(expect.objectContaining({
      program_id: F.program.program_id,
      semester_id: F.semester.semester_id,
    }));
  });
  it('lists only offered courses in the selected mapped curriculum', async () => {
    const r = await f1.get(`${SUB}/mine/available-courses?${query()}`);
    expect(r.status).toBe(200);
    const c = r.body.data.find((x: any) => x.course_id === F.c1.course_id);
    expect(c).toBeTruthy();
    expect(c.components.some((component: any) => component.component_type === 'LAB' && Number(component.weekly_hours) === 2)).toBe(true);
    expect(r.body.data.some((x: any) => x.course_id === F.unpublished.course_id)).toBe(false);
    const unavailable = await mkVia(admin, `${MD}/courses`, { course_name: 'Unpublished Course' });
    const component = await mkVia(admin, `${MD}/components`, { course_id: unavailable.course_id, component_type: 'THEORY' });
    await mkVia(admin, `${MD}/curriculum-courses`, { semester_id: F.semester.semester_id, course_id: unavailable.course_id });
    await mkVia(admin, `${MD}/offerings`, { component_id: component.component_id, term_id: F.term.term_id, status: 'DRAFT' });
    const refreshed = await f1.get(`${SUB}/mine/available-courses?${query()}`);
    expect(refreshed.body.data.some((x: any) => x.course_id === unavailable.course_id)).toBe(false);
    const wrongContext = await f1.get(`${SUB}/mine/available-courses?term_id=${F.term.term_id}&program_id=99999999&semester_id=${F.semester.semester_id}`);
    expect(wrongContext.status).toBe(422);
    expect(wrongContext.body.error.code).toBe('TERM_CURRICULUM_NOT_APPLICABLE');
  });
});

describe('submit, review, return and resubmit', () => {  it('cannot submit before saving anything', async () => {
    const r = await f3.post(`${SUB}/mine/submit`, { term_id: F.term.term_id });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('NOTHING_TO_SUBMIT');
  });
  it('cannot submit with fewer than 3 preferences (WRONG_PREFERENCE_COUNT)', async () => {
    // f2 currently has a draft with 0 prefs (from earlier test)
    // Save a draft with only 1 pref
    await f2.put(`${SUB}/mine`, draft({ preferences: [{ course_id: F.c1.course_id }] }));
    const r = await f2.post(`${SUB}/mine/submit`, { term_id: F.term.term_id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('WRONG_PREFERENCE_COUNT');
    // Restore f2 back to zero prefs so other tests aren't affected
    await f2.put(`${SUB}/mine`, draft({ preferences: [], availability: [] }));
  });
  it('submits and then locks the form', async () => {
    await f1.put(`${SUB}/mine`, draft({ preferences: [
      { course_id: F.c1.course_id },
      { course_id: F.c2.course_id },
      { course_id: F.c3.course_id },
    ] }));
    const r = await f1.post(`${SUB}/mine/submit`, { term_id: F.term.term_id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.submission).toMatchObject({ submission_status: 'SUBMITTED', review_status: 'PENDING' });
    expect(r.body.data.submission.submitted_at).toBeTruthy();
    const edit = await f1.put(`${SUB}/mine`, draft({ preferences: [] }));
    expect(edit.status).toBe(409); expect(edit.body.error.code).toBe('SUBMISSION_LOCKED');
    expect((await f1.post(`${SUB}/mine/submit`, { term_id: F.term.term_id })).body.error.code).toBe('INVALID_STATE');
  });
  it('lists submissions for the reviewer with filters', async () => {
    const r = await admin.get(`${SUB}?term_id=${F.term.term_id}&submission_status=SUBMITTED`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((s: any) => s.submission_id)).toContain(F.sub1);
    expect(r.body.data[0].faculty_name).toBeTruthy();
    const detail = await admin.get(`${SUB}/${F.sub1}`);
    expect(detail.body.data.preferences).toHaveLength(3);
    expect(detail.body.data.preferences[1]).toMatchObject({ preference_kind: 'COURSE', course_id: F.c2.course_id });
    expect((await admin.get(`${SUB}/99999999`)).status).toBe(404);
  });
  it('cannot review a form that is still a draft', async () => {
    await f3.put(`${SUB}/mine`, draft());
    const [row] = await query<any>('SELECT submission_id FROM faculty_submissions WHERE faculty_id = ?', [F.fac3.faculty_id]);
    const r = await admin.post(`${SUB}/${row.submission_id}/review`, { action: 'ACCEPT' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('INVALID_STATE');
  });
  it('moves through START_REVIEW and records the reviewer', async () => {
    const r = await admin.post(`${SUB}/${F.sub1}/review`, { action: 'START_REVIEW' });
    expect(r.status).toBe(200);
    expect(r.body.data.submission.review_status).toBe('IN_REVIEW');
    expect(r.body.data.submission.reviewed_by).toBeTruthy();
    expect((await admin.post(`${SUB}/${F.sub1}/review`, { action: 'START_REVIEW' })).status).toBe(409);
  });
  it('requires a comment to return a form, then lets the faculty correct it', async () => {
    expect((await admin.post(`${SUB}/${F.sub1}/review`, { action: 'RETURN' })).body.error.code).toBe('COMMENT_REQUIRED');
    const r = await admin.post(`${SUB}/${F.sub1}/review`, { action: 'RETURN', comment: 'Please list Tuesday availability' });
    expect(r.status).toBe(200);
    expect(r.body.data.submission).toMatchObject({ submission_status: 'RETURNED', review_status: 'CHANGES_REQUESTED', review_comment: 'Please list Tuesday availability' });
    const seen = await f1.get(`${SUB}/mine?term_id=${F.term.term_id}`);
    expect(seen.body.data.submission.review_comment).toBe('Please list Tuesday availability');
    const fix = await f1.put(`${SUB}/mine`, draft({ availability: [win('TUE', '09:00', '12:00', 'AVAILABLE')] }));
    expect(fix.status).toBe(200);
    expect(fix.body.data.submission.submission_status).toBe('RETURNED'); // stays returned until resubmitted
  });
  it('resubmission resets the review and accepting is final', async () => {
    const re = await f1.post(`${SUB}/mine/submit`, { term_id: F.term.term_id });
    expect(re.body.data.submission).toMatchObject({ submission_status: 'SUBMITTED', review_status: 'PENDING', reviewed_by: null, review_comment: null });
    const acc = await admin.post(`${SUB}/${F.sub1}/review`, { action: 'ACCEPT', comment: 'Looks fine' });
    expect(acc.status).toBe(200);
    expect(acc.body.data.submission).toMatchObject({ review_status: 'ACCEPTED', review_comment: 'Looks fine' });
    expect(acc.body.data.submission.reviewed_at).toBeTruthy();
    expect((await admin.post(`${SUB}/${F.sub1}/review`, { action: 'ACCEPT' })).body.error.code).toBe('INVALID_STATE');
    expect((await admin.post(`${SUB}/${F.sub1}/review`, { action: 'RETURN', comment: 'No longer valid' })).body.error.code).toBe('INVALID_STATE');
    const persisted = await admin.get(`${SUB}/${F.sub1}`);
    expect(persisted.body.data.submission).toMatchObject({
      review_status: 'ACCEPTED',
      reviewed_by: acc.body.data.submission.reviewed_by,
      reviewer_name: expect.any(String),
      review_comment: 'Looks fine',
    });
    expect((await admin.post(`${SUB}/${F.sub1}/review`, { action: 'BOGUS' })).status).toBe(400);
  });
  it('accepting preferences never creates an assignment (preferences are requests)', async () => {
    const [n] = await query<any>('SELECT COUNT(*) AS n FROM faculty_assignments WHERE faculty_id = ?', [F.fac1.faculty_id]);
    expect(n.n).toBe(0);
  });
  it('a reviewer cannot review their own submission', async () => {
    const [r]: any = await pool.query("INSERT INTO faculty_submissions (faculty_id, term_id, submission_status, submitted_at) VALUES (?, ?, 'SUBMITTED', UTC_TIMESTAMP())",
      [F.facAdmin.faculty_id, F.term.term_id]);
    const res = await adminWithProfile.post(`${SUB}/${r.insertId}/review`, { action: 'ACCEPT' });
    expect(res.status).toBe(403); expect(res.body.error.code).toBe('SELF_REVIEW');
  });
  it('writes an audit trail for each step', async () => {
    const rows = await query<any>("SELECT action FROM audit_logs WHERE table_name = 'faculty_submissions' AND record_id = ? ORDER BY audit_id", [F.sub1]);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('SUBMISSION_DRAFT_SAVED');
    expect(actions).toEqual(expect.arrayContaining(['SUBMISSION_SUBMITTED', 'SUBMISSION_START_REVIEW', 'SUBMISSION_RETURN', 'SUBMISSION_ACCEPT']));
    expect(actions.filter((a) => a === 'SUBMISSION_SUBMITTED')).toHaveLength(2);
  });
});

describe('admin-entered availability', () => {
  const body = (over: Record<string, any> = {}) => ({ faculty_id: F.fac2.faculty_id, term_id: F.term.term_id, ...win('FRI', '09:00', '11:00', 'UNKNOWN'), ...over });
  it('stores UNKNOWN explicitly and requires an explicit state (no default)', async () => {
    const r = await admin.post(AV, body());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ availability_type: 'UNKNOWN', source: 'ADMIN_ENTRY', submission_id: null });
    F.adm = r.body.data;
    const { availability_type, ...noType } = body({ day: 'SAT' });
    expect((await admin.post(AV, noType)).status).toBe(400);
  });
  it('rejects overlaps, unknown faculty and closed terms', async () => {
    expect((await admin.post(AV, body({ start_time: '10:00', end_time: '12:00' }))).body.error.code).toBe('AVAILABILITY_OVERLAP');
    expect((await admin.post(AV, body({ faculty_id: 99999999, day: 'SAT' }))).body.error.code).toBe('BAD_REFERENCE');
    expect((await admin.post(AV, body({ term_id: F.closedTerm.term_id, day: 'SAT' }))).body.error.code).toBe('TERM_CLOSED');
  });
  it('a faculty draft cannot overlap what the department entered', async () => {
    const r = await f2.put(`${SUB}/mine`, draft({ availability: [win('FRI', '10:00', '12:00', 'AVAILABLE')] }));
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('AVAILABILITY_OVERLAP');
  });
  it('can change an admin entry but not a faculty-submitted one', async () => {
    const p = await admin.patch(`${AV}/${F.adm.faculty_availability_id}`, { availability_type: 'AVAILABLE' });
    expect(p.status).toBe(200); expect(p.body.data.availability_type).toBe('AVAILABLE');
    const [sub] = await query<any>("SELECT faculty_availability_id FROM faculty_availability WHERE source = 'FACULTY_SUBMISSION' LIMIT 1");
    const blocked = await admin.patch(`${AV}/${sub.faculty_availability_id}`, { availability_type: 'AVAILABLE' });
    expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('NOT_ADMIN_ENTRY');
    expect((await admin.del(`${AV}/${sub.faculty_availability_id}`)).status).toBe(409);
  });
  it('lists with filters and deletes admin entries', async () => {
    const l = await admin.get(`${AV}?faculty_id=${F.fac2.faculty_id}&term_id=${F.term.term_id}`);
    expect(l.status).toBe(200); expect(l.body.data.length).toBeGreaterThanOrEqual(1);
    expect((await admin.del(`${AV}/${F.adm.faculty_availability_id}`)).status).toBe(200);
    expect((await admin.del(`${AV}/${F.adm.faculty_availability_id}`)).status).toBe(404);
  });
});
