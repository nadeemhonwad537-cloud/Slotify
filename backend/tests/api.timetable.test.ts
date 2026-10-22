/**
 * Milestone 4 — Timetable Validation Engine tests.
 *
 * Strategy: build minimal but complete timetable fixtures via direct DB inserts
 * (timetable_versions, scheduled_sessions, session_audiences, session_faculty),
 * then exercise the validation service and API endpoints.
 *
 * Each describe block tests one validation rule in isolation plus a combined
 * "clean draft" scenario that must produce zero errors.
 *
 * All data is inserted into slotify_test only (globalSetup guarantees this).
 * The inTx() helper rolls back after every DB-level test so nothing leaks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, pool } from '../src/db/pool';
import { computeValidation, RULE } from '../src/services/validationService';
import { client, Client, mkUser, mkVia, wipeTestData } from './apiHelpers';
import { ins, inTx } from './helpers';

const RUN   = Date.now().toString(36).slice(-5).toUpperCase();
const MD    = '/api/masterdata';
const TT    = '/api/timetable';

// ---------------------------------------------------------------------------
// Shared fixture state built once in beforeAll
// ---------------------------------------------------------------------------
let admin: Client;
let faculty1: Client;

/** Master-data fixture shared across all test groups. */
const F: Record<string, any> = {};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal timetable_versions row (DRAFT) and returns its version_id.
 * Uses a direct INSERT because there is no public API for creating versions yet
 * (that belongs to Milestone 5/7).
 */
async function mkVersion(termId: number, adminUserId: number): Promise<number> {
  // version_no must be unique per term — use a random suffix
  const versionNo = Math.floor(Math.random() * 900000) + 100000;
  const [r]: any = await pool.query(
    `INSERT INTO timetable_versions (term_id, version_no, status, created_by)
     VALUES (?, ?, 'DRAFT', ?)`,
    [termId, versionNo, adminUserId],
  );
  return r.insertId as number;
}

/**
 * Creates a scheduled_session and returns its session_id.
 * termId must match the version's termId (enforced by composite FK).
 */
async function mkSession(
  versionId: number,
  termId: number,
  offeringId: number,
  roomId: number,
  day: string,
  start: string,
  end: string,
  startSlotId?: number,
  slotCount?: number,
): Promise<number> {
  const [r]: any = await pool.query(
    `INSERT INTO scheduled_sessions
       (version_id, term_id, offering_id, room_id, \`day\`, start_time, end_time, start_slot_id, slot_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, termId, offeringId, roomId, day, start, end, startSlotId ?? null, slotCount ?? null],
  );
  return r.insertId as number;
}

async function mkSessionAudience(sessionId: number, versionId: number, sectionId: number, batchId?: number) {
  await pool.query(
    'INSERT INTO session_audiences (session_id, version_id, section_id, batch_id) VALUES (?, ?, ?, ?)',
    [sessionId, versionId, sectionId, batchId ?? null],
  );
}

async function mkSessionFaculty(sessionId: number, versionId: number, facultyId: number, role = 'LECTURER') {
  await pool.query(
    'INSERT INTO session_faculty (session_id, version_id, faculty_id, role) VALUES (?, ?, ?, ?)',
    [sessionId, versionId, facultyId, role],
  );
}

async function cleanVersion(versionId: number) {
  // Delete child rows in dependency order before removing the version.
  // scheduled_sessions → session_audiences / session_faculty (CASCADE on those two)
  // validation_runs → validation_issues (CASCADE)
  // timetable_version_sections has no cascade so delete explicitly.
  await pool.query('DELETE FROM validation_runs WHERE version_id = ?', [versionId]);
  await pool.query('DELETE FROM timetable_version_sections WHERE version_id = ?', [versionId]);
  await pool.query('DELETE FROM scheduled_sessions WHERE version_id = ?', [versionId]);
  await pool.query('DELETE FROM timetable_versions WHERE version_id = ?', [versionId]);
}

// ---------------------------------------------------------------------------
// beforeAll: build all master-data fixtures via API
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await exec(`DELETE FROM users WHERE username LIKE 'tt\\_%'`);

  const adminUserId = await mkUser(`tt_admin_${RUN}`, ['ADMIN']);
  const f1UserId    = await mkUser(`tt_f1_${RUN}`,    ['FACULTY']);

  admin    = await client(`tt_admin_${RUN}`);
  faculty1 = await client(`tt_f1_${RUN}`);

  // Academic structure
  F.year    = await mkVia(admin, `${MD}/academic-years`, { year_label: `TT${RUN}` });
  F.term    = await mkVia(admin, `${MD}/terms`, { year_id: F.year.year_id, term_name: `OddTT${RUN}`, parity: 'ODD', start_date: '2030-01-01', end_date: '2030-06-30' });
  F.dept    = await mkVia(admin, `${MD}/departments`, { dept_code: `TTD${RUN}`, dept_name: 'TT Dept' });
  F.prog    = await mkVia(admin, `${MD}/programs`, { dept_id: F.dept.dept_id, program_code: `TTP${RUN}`, program_name: 'TT Prog' });
  F.scheme  = await mkVia(admin, `${MD}/schemes`, { program_id: F.prog.program_id, scheme_code: `TTS${RUN}` });
  F.sem     = await mkVia(admin, `${MD}/semesters`, { scheme_id: F.scheme.scheme_id, semester_no: 1 });
  await mkVia(admin, `${MD}/term-program-semesters`, { term_id: F.term.term_id, semester_id: F.sem.semester_id });

  // Two sections for audience-overlap tests
  F.sec1    = await mkVia(admin, `${MD}/sections`, { term_id: F.term.term_id, semester_id: F.sem.semester_id, section_name: 'TTA' });
  F.sec2    = await mkVia(admin, `${MD}/sections`, { term_id: F.term.term_id, semester_id: F.sem.semester_id, section_name: 'TTB' });

  // Batch under sec1
  F.batch1  = await mkVia(admin, `${MD}/batches`, { section_id: F.sec1.section_id, batch_name: 'L1', batch_type: 'LAB' });

  // Room types
  const [rtClass]: any = await pool.query("SELECT room_type_id FROM room_types WHERE type_code = 'CLASSROOM'");
  const [rtLab]:   any = await pool.query("SELECT room_type_id FROM room_types WHERE type_code = 'LAB'");
  F.classroomTypeId = rtClass[0].room_type_id;
  F.labTypeId       = rtLab[0].room_type_id;

  // Rooms
  F.roomA = await mkVia(admin, `${MD}/rooms`, { room_code: `TRA${RUN}`, room_type_id: F.classroomTypeId, capacity: 60 });
  F.roomB = await mkVia(admin, `${MD}/rooms`, { room_code: `TRB${RUN}`, room_type_id: F.classroomTypeId, capacity: 60 });
  F.roomLab = await mkVia(admin, `${MD}/rooms`, { room_code: `TRL${RUN}`, room_type_id: F.labTypeId, capacity: 30 });

  // Courses and components
  F.courseT = await mkVia(admin, `${MD}/courses`, { course_name: 'TT Theory', data_status: 'SYNTHETIC' });
  F.compTheory = await mkVia(admin, `${MD}/components`, {
    course_id: F.courseT.course_id, component_type: 'THEORY', weekly_hours: 3, data_status: 'SYNTHETIC',
  });
  F.courseL = await mkVia(admin, `${MD}/courses`, { course_name: 'TT Lab', data_status: 'SYNTHETIC' });
  F.compLab = await mkVia(admin, `${MD}/components`, {
    course_id: F.courseL.course_id, component_type: 'LAB', weekly_hours: 2,
    periods_per_session: 2, is_consecutive: true, data_status: 'SYNTHETIC',
  });
  // Component that requires a LAB room
  F.courseLabReq = await mkVia(admin, `${MD}/courses`, { course_name: 'TT Lab Required', data_status: 'SYNTHETIC' });
  F.compLabReq = await mkVia(admin, `${MD}/components`, {
    course_id: F.courseLabReq.course_id, component_type: 'LAB', weekly_hours: 2,
    required_room_type_id: F.labTypeId, data_status: 'SYNTHETIC',
  });

  // Offerings
  F.offTheory  = await mkVia(admin, `${MD}/offerings`, { component_id: F.compTheory.component_id,  term_id: F.term.term_id, data_status: 'SYNTHETIC' });
  F.offLab     = await mkVia(admin, `${MD}/offerings`, { component_id: F.compLab.component_id,     term_id: F.term.term_id, data_status: 'SYNTHETIC' });
  F.offLabReq  = await mkVia(admin, `${MD}/offerings`, { component_id: F.compLabReq.component_id,  term_id: F.term.term_id, data_status: 'SYNTHETIC' });

  // Audiences (needed for capacity check)
  F.audTheory1 = await mkVia(admin, `${MD}/audiences`, {
    offering_id: F.offTheory.offering_id, section_id: F.sec1.section_id, strength: 55, data_status: 'SYNTHETIC',
  });

  // Faculty profile
  F.fac1 = await mkVia(admin, `${MD}/faculty`, { name: 'TT Faculty One', user_id: f1UserId, data_status: 'SYNTHETIC' });

  // Time slots for consecutive-lab tests (slot 1: 09:00–10:00, slot 2: 10:00–11:00)
  F.slot1 = await mkVia(admin, `${MD}/time-slots`, {
    term_id: F.term.term_id, slot_no: 1, start_time: '09:00', end_time: '10:00', slot_type: 'TEACHING',
  });
  F.slot2 = await mkVia(admin, `${MD}/time-slots`, {
    term_id: F.term.term_id, slot_no: 2, start_time: '10:00', end_time: '11:00', slot_type: 'TEACHING',
  });
  F.slot3 = await mkVia(admin, `${MD}/time-slots`, {
    term_id: F.term.term_id, slot_no: 3, start_time: '11:00', end_time: '12:00', slot_type: 'TEACHING',
  });
  // Saturday teaching day with closing_time 12:00 (earlier than SATURDAY_LATEST_END 12:30)
  F.satDay = await mkVia(admin, `${MD}/teaching-days`, {
    term_id: F.term.term_id, day_name: 'SAT', is_teaching_day: true, closing_time: '12:00',
  });

  F.adminUserId = adminUserId;
});

afterAll(async () => {
  if (F.term?.term_id) {
    // Delete in FK-safe order: validation_runs and sessions before versions,
    // versions before the term data that wipeTestData handles.
    const [versions]: any = await pool.query(
      'SELECT version_id FROM timetable_versions WHERE term_id = ?', [F.term.term_id],
    );
    for (const v of versions) {
      await pool.query('DELETE FROM validation_runs WHERE version_id = ?', [v.version_id]);
      await pool.query('DELETE FROM timetable_version_sections WHERE version_id = ?', [v.version_id]);
      await pool.query('DELETE FROM scheduled_sessions WHERE version_id = ?', [v.version_id]);
    }
    await pool.query('DELETE FROM timetable_versions WHERE term_id = ?', [F.term.term_id]);
  }
  await wipeTestData();
  await exec(`DELETE FROM users WHERE username LIKE 'tt\\_%'`);
  await pool.end();
});

// ===========================================================================
// Authorization
// ===========================================================================
describe('authorization', () => {
  it('unauthenticated requests are rejected', async () => {
    const anon = await client();
    expect((await anon.post(`${TT}/validate`, { version_id: 1 })).status).toBe(401);
    expect((await anon.get(`${TT}/validate/1`)).status).toBe(401);
  });

  it('faculty cannot trigger validation (needs timetable:generate)', async () => {
    expect((await faculty1.post(`${TT}/validate`, { version_id: 1 })).status).toBe(403);
  });

  it('admin can reach the validate endpoint (404 for unknown version)', async () => {
    const r = await admin.post(`${TT}/validate`, { version_id: 99999999 });
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// Clean draft — no violations
// ===========================================================================
describe('clean draft — zero errors', () => {
  it('reports PASSED with no issues for a valid single session', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    expect(result.passed).toBe(true);
    expect(result.error_count).toBe(0);
    expect(result.session_count).toBe(1);

    await cleanVersion(vId);
  });

  it('POST /api/timetable/validate returns 201 and PASSED for a clean version', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'TUE', '10:00:00', '11:00:00');
    await mkSessionAudience(sId, vId, F.sec2.section_id);
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const r = await admin.post(`${TT}/validate`, { version_id: vId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('PASSED');
    expect(r.body.data.error_count).toBe(0);

    await cleanVersion(vId);
  });

  it('dry_run=true returns results without persisting', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'WED', '09:00:00', '10:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const r = await admin.post(`${TT}/validate`, { version_id: vId, dry_run: true });
    expect(r.status).toBe(200);
    expect(r.body.data.dry_run).toBe(true);

    // No validation_run row should have been persisted
    const [runs]: any = await pool.query(
      'SELECT validation_id FROM validation_runs WHERE version_id = ?', [vId],
    );
    expect(runs).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK A: Faculty overlap
// ===========================================================================
describe('FACULTY_OVERLAP', () => {
  it('detects two sessions with same faculty on same day with overlapping times', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'MON', '10:00:00', '11:00:00');
    await mkSessionFaculty(s1, vId, F.fac1.faculty_id);
    await mkSessionFaculty(s2, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    expect(result.passed).toBe(false);
    const issue = result.issues.find(i => i.rule_code === RULE.FACULTY_OVERLAP);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');
    expect(issue!.details.faculty_id).toBe(F.fac1.faculty_id);

    await cleanVersion(vId);
  });

  it('does NOT flag different faculty on the same day at same time', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    // Create a second faculty directly
    const [r]: any = await pool.query(
      "INSERT INTO faculty_profiles (name, data_status) VALUES ('TT Faculty Two', 'SYNTHETIC')",
    );
    const fac2Id: number = r.insertId;

    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'MON', '09:00:00', '10:00:00');
    await mkSessionFaculty(s1, vId, F.fac1.faculty_id);
    await mkSessionFaculty(s2, vId, fac2Id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.FACULTY_OVERLAP)).toHaveLength(0);

    await cleanVersion(vId);
    await pool.query('DELETE FROM faculty_profiles WHERE faculty_id = ?', [fac2Id]);
  });

  it('does NOT flag same faculty on different days', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'TUE', '09:00:00', '10:00:00');
    await mkSessionFaculty(s1, vId, F.fac1.faculty_id);
    await mkSessionFaculty(s2, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.FACULTY_OVERLAP)).toHaveLength(0);

    await cleanVersion(vId);
  });

  it('does NOT flag adjacent (non-overlapping) sessions for same faculty', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'MON', '10:00:00', '11:00:00');
    await mkSessionFaculty(s1, vId, F.fac1.faculty_id);
    await mkSessionFaculty(s2, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.FACULTY_OVERLAP)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK B: Room double-booking
// ===========================================================================
describe('ROOM_DOUBLE_BOOKING', () => {
  it('detects two sessions in the same room at overlapping times', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'TUE', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomA.room_id, 'TUE', '10:00:00', '11:00:00');

    const result = await computeValidation(vId);
    expect(result.passed).toBe(false);
    const issue = result.issues.find(i => i.rule_code === RULE.ROOM_DOUBLE_BOOKING);
    expect(issue).toBeDefined();
    expect(issue!.details.room_id).toBe(F.roomA.room_id);

    await cleanVersion(vId);
  });

  it('does NOT flag different rooms at the same time', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'TUE', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'TUE', '09:00:00', '10:00:00');

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.ROOM_DOUBLE_BOOKING)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK C: Audience overlap
// ===========================================================================
describe('AUDIENCE_OVERLAP', () => {
  it('detects whole-section overlap (both sessions cover same section, no batch)', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'WED', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'WED', '10:00:00', '11:00:00');
    await mkSessionAudience(s1, vId, F.sec1.section_id);
    await mkSessionAudience(s2, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.AUDIENCE_OVERLAP);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');

    await cleanVersion(vId);
  });

  it('detects batch-level overlap', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'WED', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'WED', '10:00:00', '11:00:00');
    await mkSessionAudience(s1, vId, F.sec1.section_id, F.batch1.batch_id);
    await mkSessionAudience(s2, vId, F.sec1.section_id, F.batch1.batch_id);

    const result = await computeValidation(vId);
    expect(result.issues.find(i => i.rule_code === RULE.AUDIENCE_OVERLAP)).toBeDefined();

    await cleanVersion(vId);
  });

  it('does NOT flag different sections at same time', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'WED', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomB.room_id, 'WED', '09:00:00', '10:00:00');
    await mkSessionAudience(s1, vId, F.sec1.section_id);
    await mkSessionAudience(s2, vId, F.sec2.section_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.AUDIENCE_OVERLAP)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK D: Room capacity
// ===========================================================================
describe('ROOM_CAPACITY', () => {
  it('blocks when planned strength exceeds room capacity', async () => {
    // roomA capacity = 60; audTheory1 strength = 55 so this should be fine.
    // Create a small room with capacity 20 for this test.
    const smallRoom = await mkVia(admin, `${MD}/rooms`, {
      room_code: `TRSMALL${RUN}`, room_type_id: F.classroomTypeId, capacity: 20,
    });

    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    // offTheory has audTheory1 with strength 55 → exceeds capacity 20
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, smallRoom.room_id, 'THU', '09:00:00', '10:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.ROOM_CAPACITY);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR'); // capacity is a hard constraint
    expect(issue!.details.room_capacity).toBe(20);
    expect(issue!.details.planned_strength).toBe(55);

    await cleanVersion(vId);
  });

  it('does NOT warn when capacity is sufficient', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    // roomA capacity 60 >= strength 55
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'THU', '09:00:00', '10:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.ROOM_CAPACITY)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK E: Room type mismatch
// ===========================================================================
describe('ROOM_TYPE_MISMATCH', () => {
  it('flags a session where room type does not match the required type', async () => {
    // offLabReq requires labTypeId but roomA is CLASSROOM
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offLabReq.offering_id, F.roomA.room_id, 'FRI', '09:00:00', '11:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.ROOM_TYPE_MISMATCH);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');
    expect(issue!.details.required_room_type_id).toBe(F.labTypeId);
    expect(issue!.details.actual_room_type_id).toBe(F.classroomTypeId);

    await cleanVersion(vId);
  });

  it('does NOT flag when room type matches', async () => {
    // offLabReq requires labTypeId; roomLab is LAB type
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offLabReq.offering_id, F.roomLab.room_id, 'FRI', '09:00:00', '11:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.ROOM_TYPE_MISMATCH)).toHaveLength(0);

    await cleanVersion(vId);
  });

  it('does NOT flag when component has no required room type', async () => {
    // compTheory has no required_room_type_id
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'FRI', '09:00:00', '10:00:00');
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.ROOM_TYPE_MISMATCH)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK F: Faculty availability
// ===========================================================================
describe('FACULTY_UNAVAILABLE / FACULTY_UNKNOWN_AVAIL', () => {
  it('flags ERROR when faculty is UNAVAILABLE during the session', async () => {
    // Mark fac1 unavailable on MON 09:00–11:00
    const [avRow]: any = await pool.query(
      `INSERT INTO faculty_availability
         (faculty_id, term_id, source, \`day\`, start_time, end_time, availability_type)
       VALUES (?, ?, 'ADMIN_ENTRY', 'MON', '09:00:00', '11:00:00', 'UNAVAILABLE')`,
      [F.fac1.faculty_id, F.term.term_id],
    );
    const avId: number = avRow.insertId;

    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:00:00');
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.FACULTY_UNAVAILABLE);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');
    expect(issue!.details.faculty_id).toBe(F.fac1.faculty_id);

    await cleanVersion(vId);
    await pool.query('DELETE FROM faculty_availability WHERE faculty_availability_id = ?', [avId]);
  });

  it('flags ERROR when faculty availability is UNKNOWN during the session', async () => {
    const [avRow]: any = await pool.query(
      `INSERT INTO faculty_availability
         (faculty_id, term_id, source, \`day\`, start_time, end_time, availability_type)
       VALUES (?, ?, 'ADMIN_ENTRY', 'TUE', '09:00:00', '11:00:00', 'UNKNOWN')`,
      [F.fac1.faculty_id, F.term.term_id],
    );
    const avId: number = avRow.insertId;

    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'TUE', '09:00:00', '10:00:00');
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.FACULTY_UNKNOWN_AVAIL);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR'); // Decision H blocks UNKNOWN availability
    expect(issue!.details.availability_type).toBe('UNKNOWN');

    await cleanVersion(vId);
    await pool.query('DELETE FROM faculty_availability WHERE faculty_availability_id = ?', [avId]);
  });

  it('does NOT flag when faculty is AVAILABLE during the session', async () => {
    const [avRow]: any = await pool.query(
      `INSERT INTO faculty_availability
         (faculty_id, term_id, source, \`day\`, start_time, end_time, availability_type)
       VALUES (?, ?, 'ADMIN_ENTRY', 'WED', '08:00:00', '14:00:00', 'AVAILABLE')`,
      [F.fac1.faculty_id, F.term.term_id],
    );
    const avId: number = avRow.insertId;

    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'WED', '09:00:00', '10:00:00');
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    const avIssues = result.issues.filter(i =>
      i.rule_code === RULE.FACULTY_UNAVAILABLE || i.rule_code === RULE.FACULTY_UNKNOWN_AVAIL,
    );
    expect(avIssues).toHaveLength(0);

    await cleanVersion(vId);
    await pool.query('DELETE FROM faculty_availability WHERE faculty_availability_id = ?', [avId]);
  });

  it('blocks when no availability record exists because missing means UNKNOWN', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'THU', '09:00:00', '10:00:00');
    await mkSessionFaculty(sId, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    const avIssues = result.issues.filter(i =>
      i.rule_code === RULE.FACULTY_UNAVAILABLE || i.rule_code === RULE.FACULTY_UNKNOWN_AVAIL,
    );
    expect(avIssues.some(i => i.rule_code === RULE.FACULTY_UNKNOWN_AVAIL)).toBe(true);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK G: Consecutive lab periods
// ===========================================================================
describe('NON_CONSECUTIVE_LAB', () => {
  it('flags when two sessions of a consecutive offering are on non-adjacent slots', async () => {
    // offLab has is_consecutive=1
    // slots: slot1 (09–10, no=1), slot3 (11–12, no=3) → gap at slot 2
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(
      vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id,
      'MON', '09:00:00', '10:00:00', F.slot1.slot_id, 1,
    );
    const s2 = await mkSession(
      vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id,
      'MON', '11:00:00', '12:00:00', F.slot3.slot_id, 1,
    );

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.NON_CONSECUTIVE_LAB);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');
    expect(issue!.details.offering_id).toBe(F.offLab.offering_id);

    await cleanVersion(vId);
  });

  it('does NOT flag when two sessions are on adjacent slots', async () => {
    // slot1 (no=1) → slot2 (no=2) are adjacent
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(
      vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id,
      'MON', '09:00:00', '10:00:00', F.slot1.slot_id, 1,
    );
    const s2 = await mkSession(
      vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id,
      'MON', '10:00:00', '11:00:00', F.slot2.slot_id, 1,
    );

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.NON_CONSECUTIVE_LAB)).toHaveLength(0);

    await cleanVersion(vId);
  });

  it('skips consecutive check when start_slot_id is NULL', async () => {
    // No slot metadata → validator cannot check; must not crash or false-flag
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const s1 = await mkSession(vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id, 'TUE', '09:00:00', '10:00:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id, F.roomLab.room_id, 'TUE', '11:00:00', '12:00:00');

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.NON_CONSECUTIVE_LAB)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// CHECK H: Saturday closing time
// ===========================================================================
describe('SATURDAY_CLOSING', () => {
  it('flags a session on SAT that ends after the configured closing time', async () => {
    // F.satDay closing_time = 12:00; SATURDAY_LATEST_END = 12:30 → limit is 12:00
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(
      vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id,
      'SAT', '11:30:00', '12:30:00', // ends at 12:30 > 12:00
    );
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.SATURDAY_CLOSING);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('ERROR');
    expect(issue!.details.cutoff).toBe('12:00:00');

    await cleanVersion(vId);
  });

  it('flags a session on SAT that ends after SATURDAY_LATEST_END (12:30) even if no closing_time', async () => {
    // Add a SAT teaching day without explicit closing_time to another term
    const yr2 = await mkVia(admin, `${MD}/academic-years`, { year_label: `TT2${RUN}` });
    const term2 = await mkVia(admin, `${MD}/terms`, { year_id: yr2.year_id, term_name: `Odd2${RUN}`, parity: 'ODD', start_date: '2030-01-01', end_date: '2030-06-30' });
    // SAT with closing_time exactly at SATURDAY_LATEST_END
    await mkVia(admin, `${MD}/teaching-days`, {
      term_id: term2.term_id, day_name: 'SAT', is_teaching_day: true, closing_time: '12:30',
    });
    // Create an offering that belongs to term2 (composite FK requires matching term_id)
    const off2 = await mkVia(admin, `${MD}/offerings`, {
      component_id: F.compTheory.component_id, term_id: term2.term_id, data_status: 'SYNTHETIC',
    });

    const vId = await mkVersion(term2.term_id, F.adminUserId);
    const sId = await mkSession(
      vId, term2.term_id, off2.offering_id, F.roomA.room_id,
      'SAT', '13:00:00', '14:00:00', // ends at 14:00 > 12:30
    );

    const result = await computeValidation(vId);
    const issue = result.issues.find(i => i.rule_code === RULE.SATURDAY_CLOSING);
    expect(issue).toBeDefined();

    await cleanVersion(vId);
    await pool.query('DELETE FROM course_offerings WHERE offering_id = ?', [off2.offering_id]);
    await pool.query('DELETE FROM term_teaching_days WHERE term_id = ?', [term2.term_id]);
    await pool.query('DELETE FROM terms WHERE term_id = ?', [term2.term_id]);
    await pool.query('DELETE FROM academic_years WHERE year_id = ?', [yr2.year_id]);
  });

  it('does NOT flag a SAT session that ends before the cutoff', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    const sId = await mkSession(
      vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id,
      'SAT', '09:00:00', '10:00:00',
    );
    await mkSessionAudience(sId, vId, F.sec1.section_id);

    const result = await computeValidation(vId);
    expect(result.issues.filter(i => i.rule_code === RULE.SATURDAY_CLOSING)).toHaveLength(0);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// API: GET /api/timetable/validate/:id
// ===========================================================================
describe('GET /api/timetable/validate/:id', () => {
  it('returns the run and its issues after a persisted validation', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    // Two overlapping sessions in same room → one ROOM_DOUBLE_BOOKING issue
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'FRI', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomA.room_id, 'FRI', '10:00:00', '11:00:00');

    const postR = await admin.post(`${TT}/validate`, { version_id: vId });
    expect(postR.status).toBe(201);
    const runId: number = postR.body.data.validation_id;

    const getR = await admin.get(`${TT}/validate/${runId}`);
    expect(getR.status).toBe(200);
    expect(getR.body.data.run.validation_id).toBe(runId);
    expect(getR.body.data.issues.length).toBeGreaterThanOrEqual(1);
    expect(getR.body.data.issues[0].rule_code).toBe(RULE.ROOM_DOUBLE_BOOKING);
    expect(getR.body.data.summary.error_count).toBeGreaterThanOrEqual(1);

    await cleanVersion(vId);
  });

  it('returns 404 for unknown validation run', async () => {
    expect((await admin.get(`${TT}/validate/99999999`)).status).toBe(404);
  });
});

// ===========================================================================
// API: GET /api/timetable/versions/:id
// ===========================================================================
describe('GET /api/timetable/versions/:id', () => {
  it('returns the version with sections and latest validation', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);

    // Add a version section
    await pool.query(
      'INSERT INTO timetable_version_sections (version_id, term_id, section_id) VALUES (?, ?, ?)',
      [vId, F.term.term_id, F.sec1.section_id],
    );

    // Run a validation so latest_validation is populated
    await admin.post(`${TT}/validate`, { version_id: vId });

    const r = await admin.get(`${TT}/versions/${vId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.version.version_id).toBe(vId);
    expect(r.body.data.sections).toHaveLength(1);
    expect(r.body.data.latest_validation).not.toBeNull();

    await cleanVersion(vId);
  });

  it('returns 404 for unknown version', async () => {
    expect((await admin.get(`${TT}/versions/99999999`)).status).toBe(404);
  });
});

// ===========================================================================
// Multiple issues in one version
// ===========================================================================
describe('multiple issues in one version', () => {
  it('reports faculty overlap AND room double-booking simultaneously', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);
    // Same room, overlapping time → ROOM_DOUBLE_BOOKING
    // Same faculty, same time → FACULTY_OVERLAP
    const s1 = await mkSession(vId, F.term.term_id, F.offTheory.offering_id, F.roomA.room_id, 'MON', '09:00:00', '10:30:00');
    const s2 = await mkSession(vId, F.term.term_id, F.offLab.offering_id,    F.roomA.room_id, 'MON', '10:00:00', '11:00:00');
    await mkSessionFaculty(s1, vId, F.fac1.faculty_id);
    await mkSessionFaculty(s2, vId, F.fac1.faculty_id);

    const result = await computeValidation(vId);
    const codes = result.issues.map(i => i.rule_code);
    expect(codes).toContain(RULE.FACULTY_OVERLAP);
    expect(codes).toContain(RULE.ROOM_DOUBLE_BOOKING);
    expect(result.passed).toBe(false);

    await cleanVersion(vId);
  });
});

// ===========================================================================
// Edge: empty version (no sessions)
// ===========================================================================
describe('edge cases', () => {
  it('empty version (zero sessions) passes with no issues', async () => {
    const vId = await mkVersion(F.term.term_id, F.adminUserId);

    const result = await computeValidation(vId);
    expect(result.passed).toBe(true);
    expect(result.session_count).toBe(0);
    expect(result.issue_count).toBe(0);

    await cleanVersion(vId);
  });

  it('non-existent version returns VERSION_NOT_FOUND error issue', async () => {
    const result = await computeValidation(99999999);
    expect(result.passed).toBe(false);
    expect(result.issues[0].rule_code).toBe('VERSION_NOT_FOUND');
  });
});
