import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { baseFixture, ERR, expectErrno, inTx, ins } from './helpers';

afterAll(() => pool.end());

describe('schema inventory', () => {
  it('creates 52 application tables plus schema_migrations and 10 triggers', async () => {
    const [t]: any = await pool.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'");
    const [g]: any = await pool.query('SELECT COUNT(*) n FROM information_schema.triggers WHERE trigger_schema = DATABASE()');
    expect(t[0].n).toBe(53);
    expect(g[0].n).toBe(10);
  });
  it('seeds only reference data (no departments, faculty, courses, rooms or slots)', async () => {
    for (const tbl of ['departments', 'faculty_profiles', 'courses', 'rooms', 'time_slots', 'sections']) {
      const [r]: any = await pool.query('SELECT COUNT(*) n FROM ??', [tbl]);
      expect(r[0].n, tbl).toBe(0);
    }
    const [w]: any = await pool.query('SELECT COUNT(*) n FROM faculty_workload_rules WHERE data_status = "VERIFY"');
    expect(w[0].n).toBe(2);
    const [p]: any = await pool.query("SELECT COUNT(*) n FROM workload_counting_policy WHERE counts_toward_limit <> 'UNCONFIRMED'");
    expect(p[0].n).toBe(0);
  });
});

describe('faculty submissions and preferences (max three, requests only)', () => {
  it('allows one submission per faculty per term', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'faculty_submissions', { faculty_id: b.facultyId, term_id: b.termId }), ERR.DUP);
  }));

  it('accepts preference orders 1..3 and rejects a 4th (structural limit)', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const courses = [b.courseId];
    for (let i = 2; i <= 4; i++) courses.push(await ins(c, 'courses', { course_name: `Synthetic Course ${i}`, data_status: 'SYNTHETIC' }));
    for (let order = 1; order <= 3; order++) await ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: order, course_id: courses[order - 1] });
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 4, course_id: courses[3] }), ERR.CHECK);
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 3, course_id: courses[3] }), ERR.DUP);
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 0, course_id: courses[3] }), ERR.CHECK);
    const [r]: any = await c.query('SELECT COUNT(*) n FROM faculty_subject_preferences WHERE submission_id = ?', [b.submissionId]);
    expect(r[0].n).toBe(3);
  }));

  it('rejects duplicate course/component targets within a submission', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 1, course_id: b.courseId });
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 2, course_id: b.courseId }), ERR.DUP);
    await ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 2, course_id: b.courseId, component_id: b.labComponentId });
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 3, course_id: b.courseId, component_id: b.labComponentId }), ERR.DUP);
  }));

  it('requires a component to belong to the preferred course', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const other = await ins(c, 'courses', { course_name: 'Synthetic Other', data_status: 'SYNTHETIC' });
    await expectErrno(ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 1, course_id: other, component_id: b.theoryComponentId }), ERR.FK);
  }));

  it('a preference does not create an assignment; assignments can trace a preference', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const pref = await ins(c, 'faculty_subject_preferences', { submission_id: b.submissionId, preference_order: 1, course_id: b.courseId });
    const [a0]: any = await c.query('SELECT COUNT(*) n FROM faculty_assignments');
    expect(a0[0].n).toBe(0);
    await ins(c, 'faculty_assignments', { audience_id: b.audienceId, faculty_id: b.facultyId, source_preference_id: pref });
    await ins(c, 'faculty_assignments', { audience_id: b.audienceId, faculty_id: b.facultyId, role: 'LECTURER' }); // nullable source
  }));

  it('an approved assignment needs an approver and timestamp', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'faculty_assignments', { audience_id: b.audienceId, faculty_id: b.facultyId, is_approved: 1 }), ERR.CHECK);
    await ins(c, 'faculty_assignments', { audience_id: b.audienceId, faculty_id: b.facultyId, is_approved: 1, approved_by: b.userId, approved_at: '2026-01-01 10:00:00' });
  }));
});

describe('faculty availability (explicit AVAILABLE / UNAVAILABLE / UNKNOWN)', () => {
  const row = (b: any, extra: object = {}) => ({ faculty_id: b.facultyId, term_id: b.termId, source: 'ADMIN_ENTRY', day: 'MON', start_time: '08:00:00', end_time: '09:00:00', ...extra });

  it('stores all three states and defaults to UNKNOWN', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await ins(c, 'faculty_availability', row(b, { availability_type: 'AVAILABLE' }));
    await ins(c, 'faculty_availability', row(b, { start_time: '09:00:00', end_time: '10:00:00', availability_type: 'UNAVAILABLE' }));
    const id = await ins(c, 'faculty_availability', row(b, { start_time: '10:30:00', end_time: '11:30:00' }));
    const [r]: any = await c.query('SELECT availability_type t FROM faculty_availability WHERE faculty_availability_id = ?', [id]);
    expect(r[0].t).toBe('UNKNOWN');
  }));
  it('rejects invalid states and reversed time ranges', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'faculty_availability', row(b, { availability_type: 'MAYBE' })), ERR.ENUM);
    await expectErrno(ins(c, 'faculty_availability', row(b, { start_time: '10:00:00', end_time: '09:00:00' })), ERR.CHECK);
  }));
  it('ties submission-sourced rows to the same faculty and term', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'faculty_availability', row(b, { source: 'FACULTY_SUBMISSION' })), ERR.CHECK);
    await ins(c, 'faculty_availability', row(b, { source: 'FACULTY_SUBMISSION', submission_id: b.submissionId }));
    const other = await ins(c, 'faculty_profiles', { name: 'Synthetic Faculty F2', data_status: 'SYNTHETIC' });
    await expectErrno(ins(c, 'faculty_availability', { ...row(b, { source: 'FACULTY_SUBMISSION', submission_id: b.submissionId }), faculty_id: other, start_time: '12:00:00', end_time: '13:00:00' }), ERR.FK);
  }));
});

describe('term-consistency rules', () => {
  it('rejects a section whose semester belongs to a different scheme', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const scheme2 = await ins(c, 'curriculum_schemes', { program_id: b.programId, scheme_code: 'S2' });
    await expectErrno(ins(c, 'sections', { term_id: b.termId, scheme_id: scheme2, semester_id: b.semesterId, section_name: 'S-B' }), ERR.FK);
  }));
  it('rejects an audience whose section is from another term than the offering', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const term2 = await ins(c, 'terms', { year_id: b.yearId, term_name: 'Other Term', parity: 'EVEN' });
    await ins(c, 'term_program_semesters', { term_id: term2, scheme_id: b.schemeId, semester_id: b.semesterId });
    const sec2 = await ins(c, 'sections', { term_id: term2, scheme_id: b.schemeId, semester_id: b.semesterId, section_name: 'S-A' });
    await expectErrno(ins(c, 'offering_audiences', { offering_id: b.offeringId, term_id: b.termId, section_id: sec2 }), ERR.FK);
  }));
  it('rejects a batch audience whose batch belongs to another section', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const sec2 = await ins(c, 'sections', { term_id: b.termId, scheme_id: b.schemeId, semester_id: b.semesterId, section_name: 'S-B' });
    const batch2 = await ins(c, 'batches', { section_id: sec2, batch_name: 'B1' });
    await expectErrno(ins(c, 'offering_audiences', { offering_id: b.offeringId, term_id: b.termId, section_id: b.sectionId, batch_id: batch2 }), ERR.FK);
  }));
  it('supports section-wide, batch and cross-section audiences on one offering', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const sec2 = await ins(c, 'sections', { term_id: b.termId, scheme_id: b.schemeId, semester_id: b.semesterId, section_name: 'S-B' });
    const batch = await ins(c, 'batches', { section_id: b.sectionId, batch_name: 'G1' });
    const off2 = await ins(c, 'course_offerings', { component_id: b.labComponentId, term_id: b.termId });
    await ins(c, 'offering_audiences', { offering_id: off2, term_id: b.termId, section_id: b.sectionId, batch_id: batch }); // batch session
    await ins(c, 'offering_audiences', { offering_id: off2, term_id: b.termId, section_id: sec2 }); // another section (cross-section)
    await expectErrno(ins(c, 'offering_audiences', { offering_id: off2, term_id: b.termId, section_id: sec2 }), ERR.DUP);
  }));
  it('keeps elective groups within one term', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const term2 = await ins(c, 'terms', { year_id: b.yearId, term_name: 'Other Term', parity: 'EVEN' });
    const g2 = await ins(c, 'elective_groups', { term_id: term2, group_name: 'Synthetic Basket' });
    await expectErrno(ins(c, 'elective_group_offerings', { elective_group_id: g2, offering_id: b.offeringId, term_id: b.termId }), ERR.FK);
    const g1 = await ins(c, 'elective_groups', { term_id: b.termId, group_name: 'Synthetic Basket' });
    await ins(c, 'elective_group_offerings', { elective_group_id: g1, offering_id: b.offeringId, term_id: b.termId });
  }));
});

describe('timetable versions, generation runs and approvals', () => {
  const version = (b: any, extra: object = {}) => ({ term_id: b.termId, version_no: 1, created_by: b.userId, ...extra });

  it('version numbers are unique within a term; only one published version per term', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await ins(c, 'timetable_versions', version(b));
    await expectErrno(ins(c, 'timetable_versions', version(b)), ERR.DUP);
    await ins(c, 'timetable_versions', version(b, { version_no: 2, status: 'PUBLISHED', published_at: '2026-01-01 00:00:00' }));
    await expectErrno(ins(c, 'timetable_versions', version(b, { version_no: 3, status: 'PUBLISHED', published_at: '2026-01-02 00:00:00' })), ERR.DUP);
    await expectErrno(ins(c, 'timetable_versions', version(b, { version_no: 4, status: 'PUBLISHED' })), ERR.CHECK);
  }));

  it('blocks review/approval/publish while unknown availability is OPEN', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'timetable_versions', version(b, { availability_unknown_status: 'OPEN', status: 'IN_REVIEW' })), ERR.CHECK);
    const v = await ins(c, 'timetable_versions', version(b, { availability_unknown_status: 'OPEN' }));
    await expectErrno(ins(c, 'approval_actions', { version_id: v, action_type: 'SUBMIT_FOR_REVIEW', actor_id: b.userId, actor_role: 'ADMIN' }), ERR.SIGNAL);
    await expectErrno(c.query("UPDATE timetable_versions SET status = 'APPROVED' WHERE version_id = ?", [v]), ERR.CHECK);
    // Resolving unlocks the workflow.
    await c.query("UPDATE timetable_versions SET availability_unknown_status = 'RESOLVED' WHERE version_id = ?", [v]);
    await ins(c, 'approval_actions', { version_id: v, action_type: 'SUBMIT_FOR_REVIEW', actor_id: b.userId, actor_role: 'ADMIN' });
  }));

  it('an OVERRIDDEN version needs a recorded reason and actor', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'timetable_versions', version(b, { availability_unknown_status: 'OVERRIDDEN' })), ERR.CHECK);
    await ins(c, 'timetable_versions', version(b, { availability_unknown_status: 'OVERRIDDEN', unknown_override_reason: 'Synthetic test reason', unknown_override_by: b.userId, status: 'IN_REVIEW' }));
  }));

  it('a generation run that allows unknown availability must record reason and actor', () => inTx(async (c) => {
    const b = await baseFixture(c);
    await expectErrno(ins(c, 'generation_runs', { term_id: b.termId, created_by: b.userId, allow_unknown_availability: 1 }), ERR.CHECK);
    await ins(c, 'generation_runs', { term_id: b.termId, created_by: b.userId, allow_unknown_availability: 1, unknown_override_reason: 'Synthetic', unknown_override_by: b.userId });
    await ins(c, 'generation_runs', { term_id: b.termId, created_by: b.userId }); // default: not allowed
  }));

  it('stores actual start/end times for irregular and fractional-duration sessions', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const v = await ins(c, 'timetable_versions', version(b));
    const s = await ins(c, 'scheduled_sessions', { version_id: v, term_id: b.termId, offering_id: b.offeringId, room_id: b.roomId, day: 'SAT', session_date: '2026-10-24', start_time: '09:00:00', end_time: '09:45:00' });
    const [r]: any = await c.query('SELECT start_time, end_time, start_slot_id FROM scheduled_sessions WHERE session_id = ?', [s]);
    expect(r[0]).toMatchObject({ start_time: '09:00:00', end_time: '09:45:00', start_slot_id: null });
    await expectErrno(ins(c, 'scheduled_sessions', { version_id: v, term_id: b.termId, offering_id: b.offeringId, room_id: b.roomId, day: 'MON', start_time: '10:00:00', end_time: '10:00:00' }), ERR.CHECK);
  }));

  it('rejects sessions whose offering is from a different term than the version', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const term2 = await ins(c, 'terms', { year_id: b.yearId, term_name: 'Other Term', parity: 'EVEN' });
    const v2 = await ins(c, 'timetable_versions', { term_id: term2, version_no: 1, created_by: b.userId });
    await expectErrno(ins(c, 'scheduled_sessions', { version_id: v2, term_id: term2, offering_id: b.offeringId, room_id: b.roomId, day: 'MON', start_time: '08:00:00', end_time: '09:00:00' }), ERR.FK);
  }));

  it('published versions are immutable (sessions, audiences, faculty, status, delete)', () => inTx(async (c) => {
    const b = await baseFixture(c);
    const v = await ins(c, 'timetable_versions', version(b));
    const s = await ins(c, 'scheduled_sessions', { version_id: v, term_id: b.termId, offering_id: b.offeringId, room_id: b.roomId, day: 'MON', start_time: '08:00:00', end_time: '09:00:00' });
    await ins(c, 'session_audiences', { session_id: s, version_id: v, section_id: b.sectionId });
    await ins(c, 'session_faculty', { session_id: s, version_id: v, faculty_id: b.facultyId });
    await c.query("UPDATE timetable_versions SET status = 'PUBLISHED', published_at = '2026-01-01 00:00:00' WHERE version_id = ?", [v]);

    await expectErrno(ins(c, 'scheduled_sessions', { version_id: v, term_id: b.termId, offering_id: b.offeringId, room_id: b.roomId, day: 'TUE', start_time: '08:00:00', end_time: '09:00:00' }), ERR.SIGNAL);
    await expectErrno(c.query("UPDATE scheduled_sessions SET room_id = room_id, day = 'WED' WHERE session_id = ?", [s]), ERR.SIGNAL);
    await expectErrno(c.query('DELETE FROM scheduled_sessions WHERE session_id = ?', [s]), ERR.SIGNAL);
    await expectErrno(c.query('DELETE FROM session_audiences WHERE session_id = ?', [s]), ERR.SIGNAL);
    await expectErrno(c.query('DELETE FROM session_faculty WHERE session_id = ?', [s]), ERR.SIGNAL);
    await expectErrno(c.query("UPDATE timetable_versions SET status = 'DRAFT' WHERE version_id = ?", [v]), ERR.SIGNAL);
    await expectErrno(c.query('DELETE FROM timetable_versions WHERE version_id = ?', [v]), ERR.SIGNAL);
    // Archiving a published version is the only permitted transition.
    await c.query("UPDATE timetable_versions SET status = 'ARCHIVED' WHERE version_id = ?", [v]);
  }));
});
