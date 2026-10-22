/**
 * Validation Service — Milestone 4.
 *
 * Validates a timetable_versions draft against all scheduling constraints and
 * persists results to validation_runs + validation_issues.
 *
 * Design rules:
 *  - computeValidation() is a pure read function: no DB writes, safe to call
 *    repeatedly (after manual edits, before approval, inside generation).
 *  - runValidationAndPersist() wraps it: creates a validation_run row, inserts
 *    issues, and updates version.status to VALIDATED (PASSED) or leaves DRAFT
 *    (FAILED). Never modifies scheduled_sessions or timetable content.
 *  - Missing or UNKNOWN faculty/room availability is an ERROR. Decision H
 *    defaults unknown availability to blocked.
 *  - Rules that depend on unconfirmed university policy (consecutive lab gap
 *    across breaks) are not enforced — only confirmed rules are coded.
 *  - No university-specific data is hardcoded; everything comes from the DB.
 */

import { Pool, PoolConnection } from 'mysql2/promise';
import { pool as defaultPool } from '../db/pool';
import {
  ConfiguredDay,
  resolveAudienceStrength,
  resolveTotalAudienceStrength,
  validateAvailability,
  validateConsecutivePeriods,
  validateRoomCapacity,
  validateRoomSuitability,
  validateSessionAudienceScope,
  validateSessionGrid,
} from './schedulingConfiguration';
import { isSessionAcademicContextConsistent } from './timetableLifecycleRules';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  severity: IssueSeverity;
  rule_code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface ValidationResult {
  version_id: number;
  session_count: number;
  issue_count: number;
  error_count: number;
  warning_count: number;
  passed: boolean; // true when error_count === 0
  issues: ValidationIssue[];
}

export interface PersistedValidationRun {
  validation_id: number;
  version_id: number;
  status: 'PASSED' | 'FAILED';
  session_count: number;
  issue_count: number;
  error_count: number;
  warning_count: number;
}

// ---------------------------------------------------------------------------
// Rule codes — used in validation_issues.rule_code (VARCHAR 60)
// ---------------------------------------------------------------------------
export const RULE = {
  FACULTY_OVERLAP:      'FACULTY_OVERLAP',
  ROOM_DOUBLE_BOOKING:  'ROOM_DOUBLE_BOOKING',
  AUDIENCE_OVERLAP:     'AUDIENCE_OVERLAP',
  ROOM_CAPACITY:        'ROOM_CAPACITY',
  ROOM_TYPE_MISMATCH:   'ROOM_TYPE_MISMATCH',
  FACULTY_UNAVAILABLE:  'FACULTY_UNAVAILABLE',
  FACULTY_UNKNOWN_AVAIL:'FACULTY_UNKNOWN_AVAIL',
  NON_CONSECUTIVE_LAB:  'NON_CONSECUTIVE_LAB',
  SATURDAY_CLOSING:     'SATURDAY_CLOSING',
  INVALID_TEACHING_SLOT:'INVALID_TEACHING_SLOT',
  SESSION_BREAK_CONFLICT:'SESSION_BREAK_CONFLICT',
  OPERATING_HOURS:      'OPERATING_HOURS',
  NOT_A_TEACHING_DAY:   'NOT_A_TEACHING_DAY',
  ROOM_UNKNOWN_AVAILABILITY:'ROOM_UNKNOWN_AVAILABILITY',
  ROOM_UNAVAILABLE:     'ROOM_UNAVAILABLE',
  ROOM_CAPACITY_MISSING:'ROOM_CAPACITY_MISSING',
  AUDIENCE_STRENGTH_MISSING:'AUDIENCE_STRENGTH_MISSING',
  PRACTICAL_ROOM_NOT_APPROVED:'PRACTICAL_ROOM_NOT_APPROVED',
  ROOM_PRACTICAL_CONFIGURATION_UNAVAILABLE:'ROOM_PRACTICAL_CONFIGURATION_UNAVAILABLE',
  SHARED_DIVISION_SESSION:'SHARED_DIVISION_SESSION',
  AUDIENCE_SCOPE_CONFLICT:'AUDIENCE_SCOPE_CONFLICT',
  ROOM_NOT_VERIFIED:    'ROOM_NOT_VERIFIED',
  LAB_PERIODS_MISSING:  'LAB_PERIODS_MISSING',
  LAB_PERIOD_COUNT_MISMATCH:'LAB_PERIOD_COUNT_MISMATCH',
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Time-interval overlap: returns true when [s1,e1) and [s2,e2) share any time. */
function overlaps(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 < e2 && s2 < e1;
}

type DB = Pool | PoolConnection;

// ---------------------------------------------------------------------------
// computeValidation — pure read, no DB writes
// ---------------------------------------------------------------------------

/**
 * Runs all constraint checks against a timetable version and returns structured
 * issues. Does NOT write anything to the database.
 *
 * @param versionId   The timetable_versions.version_id to validate.
 * @param db          Optional connection (for use inside a transaction) or pool.
 */
export async function computeValidation(
  versionId: number,
  db: DB = defaultPool,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);

  // ------------------------------------------------------------------
  // 0. Confirm version exists and load its term_id
  // ------------------------------------------------------------------
  const [versionRows]: any = await db.query(
    'SELECT version_id, term_id, status FROM timetable_versions WHERE version_id = ?',
    [versionId],
  );
  if (!versionRows[0]) {
    // Return a single issue rather than throwing — keeps return type consistent
    return {
      version_id: versionId,
      session_count: 0,
      issue_count: 1,
      error_count: 1,
      warning_count: 0,
      passed: false,
      issues: [{
        severity: 'ERROR',
        rule_code: 'VERSION_NOT_FOUND',
        message: `Timetable version ${versionId} does not exist.`,
        details: { version_id: versionId },
      }],
    };
  }
  const termId: number = versionRows[0].term_id;

  const [practicalApprovalColumns]: any = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'practical_approved'`,
  );
  const practicalApprovalSupported = practicalApprovalColumns.length > 0;
  if (!practicalApprovalSupported) {
    add({
      severity: 'ERROR',
      rule_code: RULE.ROOM_PRACTICAL_CONFIGURATION_UNAVAILABLE,
      message: 'Room practical approval is unavailable until the room suitability migration is applied.',
      details: { migration: '008_room_practical_approval.sql' },
    });
  }

  // ------------------------------------------------------------------
  // 1. Load all sessions for this version
  // ------------------------------------------------------------------
  const [sessions]: any = await db.query(
    `SELECT
       ss.session_id,
       ss.offering_id,
       ss.room_id,
       ss.day,
       ss.start_time,
       ss.end_time,
       ss.start_slot_id,
       ss.slot_count,
       co.component_id,
       cc.component_type,
       cc.weekly_hours,
       cc.is_consecutive,
       cc.required_room_type_id,
       cc.periods_per_session,
       reqrt.type_code    AS required_room_type_code,
       r.capacity         AS room_capacity,
       r.room_type_id     AS room_type_id,
       rt.type_code       AS room_type_code,
       ${practicalApprovalSupported ? 'r.practical_approved' : '0'} AS practical_approved,
       r.data_status      AS room_data_status
     FROM scheduled_sessions ss
     JOIN course_offerings   co ON co.offering_id  = ss.offering_id
     JOIN course_components  cc ON cc.component_id = co.component_id
     JOIN rooms               r ON r.room_id       = ss.room_id
     JOIN room_types          rt ON rt.room_type_id = r.room_type_id
     LEFT JOIN room_types  reqrt ON reqrt.room_type_id = cc.required_room_type_id
     WHERE ss.version_id = ?`,
    [versionId],
  );
  const sessionCount: number = sessions.length;
  if (sessionCount === 0) {
    add({
      severity: 'ERROR',
      rule_code: 'NO_SCHEDULED_SESSIONS',
      message: 'A timetable version must contain at least one scheduled session before it can be reviewed or published.',
      details: { version_id: versionId },
    });
  }

  // ------------------------------------------------------------------
  // 2. Load session_audiences per session
  // ------------------------------------------------------------------
  const [allAudiences]: any = await db.query(
    `SELECT sa.session_id, sa.section_id, sa.batch_id,
            sec.strength AS section_strength, b.strength AS batch_strength
     FROM session_audiences sa
     JOIN sections sec ON sec.section_id = sa.section_id
     LEFT JOIN batches b ON b.batch_id = sa.batch_id AND b.section_id = sa.section_id
     WHERE sa.version_id = ?`,
    [versionId],
  );
  // Map session_id → audience rows
  const audienceMap = new Map<number, {
    section_id: number;
    batch_id: number | null;
    section_strength: number | null;
    batch_strength: number | null;
  }[]>();
  for (const a of allAudiences) {
    if (!audienceMap.has(a.session_id)) audienceMap.set(a.session_id, []);
    audienceMap.get(a.session_id)!.push(a);
  }

  const [contextRows]: any = await db.query(
    `SELECT ss.session_id, ss.term_id AS session_term_id, tv.term_id AS version_term_id,
            co.term_id AS offering_term_id, co.status AS offering_status, co.data_status AS offering_data_status,
            cc.component_id, cc.data_status AS component_data_status,
            c.course_id, c.is_active AS course_is_active, c.data_status AS course_data_status,
            r.room_id, r.is_active AS room_is_active, r.data_status AS room_data_status,
            rt.room_type_id, rt.is_active AS room_type_is_active,
            sa.section_id, sec.term_id AS section_term_id, sec.is_active AS section_is_active,
            sec.data_status AS section_data_status, sem.semester_id, sem.is_active AS semester_is_active,
            cs.scheme_id, cs.is_active AS scheme_is_active, p.program_id, p.is_active AS program_is_active,
            tps.term_program_semester_id, tps.is_active AS mapping_is_active,
            oa.audience_id, oa.data_status AS audience_data_status,
            b.batch_id, b.is_active AS batch_is_active,
            tvs.version_section_id, curriculum.course_id AS curriculum_course_id
     FROM scheduled_sessions ss
     JOIN timetable_versions tv ON tv.version_id = ss.version_id
     LEFT JOIN course_offerings co ON co.offering_id = ss.offering_id
     LEFT JOIN course_components cc ON cc.component_id = co.component_id
     LEFT JOIN courses c ON c.course_id = cc.course_id
     LEFT JOIN rooms r ON r.room_id = ss.room_id
     LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
     LEFT JOIN session_audiences sa ON sa.session_id = ss.session_id AND sa.version_id = ss.version_id
     LEFT JOIN sections sec ON sec.section_id = sa.section_id
     LEFT JOIN semesters sem ON sem.semester_id = sec.semester_id AND sem.scheme_id = sec.scheme_id
     LEFT JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
     LEFT JOIN programs p ON p.program_id = cs.program_id
     LEFT JOIN term_program_semesters tps ON tps.term_id = ss.term_id
       AND tps.scheme_id = sec.scheme_id AND tps.semester_id = sec.semester_id
     LEFT JOIN curriculum_courses curriculum ON curriculum.scheme_id = sec.scheme_id
       AND curriculum.semester_id = sec.semester_id AND curriculum.course_id = c.course_id
     LEFT JOIN offering_audiences oa ON oa.offering_id = ss.offering_id AND oa.term_id = ss.term_id
       AND oa.section_id = sa.section_id AND oa.batch_id <=> sa.batch_id
     LEFT JOIN batches b ON b.batch_id = sa.batch_id AND b.section_id = sa.section_id
     LEFT JOIN timetable_version_sections tvs ON tvs.version_id = ss.version_id
       AND tvs.term_id = ss.term_id AND tvs.section_id = sa.section_id
     WHERE ss.version_id = ?`,
    [versionId],
  );
  for (const row of contextRows) {
    const contextConsistent = row.section_id != null && isSessionAcademicContextConsistent({
      sessionTermId: Number(row.session_term_id),
      versionTermId: Number(row.version_term_id),
      offeringTermId: row.offering_term_id == null ? null : Number(row.offering_term_id),
      audienceMatchesOffering: row.audience_id != null,
      sectionTermId: row.section_term_id == null ? null : Number(row.section_term_id),
      sectionInVersion: row.version_section_id != null,
      activeCurriculumMapping: Number(row.mapping_is_active) === 1,
      courseInCurriculum: row.curriculum_course_id != null,
    });
    if (!contextConsistent) {
      add({
        severity: 'ERROR',
        rule_code: 'SESSION_ACADEMIC_CONTEXT_INVALID',
        message: `Session ${row.session_id} does not match the timetable version's term, mapped division, and curriculum context.`,
        details: { session_id: row.session_id, section_id: row.section_id ?? null },
      });
    }

    const referencesVerified = row.offering_status === 'OFFERED'
      && ['VERIFIED', 'RESOLVED'].includes(row.offering_data_status)
      && row.component_id != null
      && ['VERIFIED', 'RESOLVED'].includes(row.component_data_status)
      && row.course_id != null
      && Number(row.course_is_active) === 1
      && ['VERIFIED', 'RESOLVED'].includes(row.course_data_status)
      && row.room_id != null
      && Number(row.room_is_active) === 1
      && ['VERIFIED', 'RESOLVED'].includes(row.room_data_status)
      && row.room_type_id != null
      && Number(row.room_type_is_active) === 1
      && row.section_id != null
      && Number(row.section_is_active) === 1
      && ['VERIFIED', 'RESOLVED'].includes(row.section_data_status)
      && row.semester_id != null
      && Number(row.semester_is_active) === 1
      && row.scheme_id != null
      && Number(row.scheme_is_active) === 1
      && row.program_id != null
      && Number(row.program_is_active) === 1
      && ['VERIFIED', 'RESOLVED'].includes(row.audience_data_status)
      && (row.batch_id == null || Number(row.batch_is_active) === 1);
    if (!referencesVerified) {
      add({
        severity: 'ERROR',
        rule_code: 'SESSION_REFERENCE_INACTIVE_OR_UNVERIFIED',
        message: `Session ${row.session_id} uses a missing, inactive, or unverified course, division, audience, room, or program reference.`,
        details: { session_id: row.session_id },
      });
    }
  }

  // ------------------------------------------------------------------
  // 3. Load session_faculty per session
  // ------------------------------------------------------------------
  const [allFaculty]: any = await db.query(
    'SELECT sf.session_id, sf.faculty_id, sf.role FROM session_faculty sf WHERE sf.version_id = ?',
    [versionId],
  );
  const facultyMap = new Map<number, { faculty_id: number; role: string }[]>();
  for (const f of allFaculty) {
    if (!facultyMap.has(f.session_id)) facultyMap.set(f.session_id, []);
    facultyMap.get(f.session_id)!.push(f);
  }

  const [invalidFacultyRows]: any = await db.query(
    `SELECT sf.session_id, sf.faculty_id
     FROM session_faculty sf
     JOIN scheduled_sessions ss ON ss.session_id = sf.session_id AND ss.version_id = sf.version_id
     LEFT JOIN faculty_profiles fp ON fp.faculty_id = sf.faculty_id
     WHERE sf.version_id = ?
       AND (
         fp.faculty_id IS NULL OR fp.is_active <> 1 OR fp.data_status NOT IN ('VERIFIED', 'RESOLVED')
         OR NOT EXISTS (
           SELECT 1
           FROM faculty_assignments fa
           JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
             AND oa.offering_id = ss.offering_id AND oa.term_id = ss.term_id
           JOIN session_audiences sa ON sa.session_id = ss.session_id AND sa.version_id = ss.version_id
             AND sa.section_id = oa.section_id AND sa.batch_id <=> oa.batch_id
           WHERE fa.faculty_id = sf.faculty_id AND fa.is_approved = 1
             AND fa.role_status IN ('VERIFIED', 'RESOLVED')
         )
       )`,
    [versionId],
  );
  for (const row of invalidFacultyRows) {
    add({
      severity: 'ERROR',
      rule_code: 'SESSION_FACULTY_ASSIGNMENT_INVALID',
      message: `Faculty ${row.faculty_id} on session ${row.session_id} lacks an active, verified profile and approved assignment for its audience.`,
      details: { session_id: row.session_id, faculty_id: row.faculty_id },
    });
  }

  // ------------------------------------------------------------------
  // 4. Load active day grids for operating-hours, break, and slot checks.
  // ------------------------------------------------------------------
  const [gridRows]: any = await db.query(
    `SELECT td.day_name, td.is_teaching_day, td.closing_time,
            s.slot_id, s.slot_no, s.start_time, s.end_time, s.slot_type, s.data_status
     FROM term_teaching_days td
     LEFT JOIN term_day_slots tds ON tds.term_day_id = td.term_day_id AND tds.is_active = 1
     LEFT JOIN time_slots s ON s.slot_id = tds.slot_id
     WHERE td.term_id = ? ORDER BY td.day_name, s.start_time`,
    [termId],
  );
  const dayMap = new Map<string, ConfiguredDay>();
  for (const row of gridRows) {
    if (!dayMap.has(row.day_name)) {
      dayMap.set(row.day_name, {
        day_name: row.day_name,
        is_teaching_day: Boolean(row.is_teaching_day),
        closing_time: row.closing_time,
        slots: [],
      });
    }
    if (row.slot_id != null) {
      dayMap.get(row.day_name)!.slots.push({
        slot_id: Number(row.slot_id),
        slot_no: Number(row.slot_no),
        start_time: row.start_time,
        end_time: row.end_time,
        slot_type: row.slot_type,
        data_status: row.data_status,
      });
    }
  }

  // ------------------------------------------------------------------
  // 5. Load offering audience sizes for the exact scheduled sections/batches.
  // ------------------------------------------------------------------
  const [offeringAudiences]: any = await db.query(
    `SELECT oa.offering_id, oa.section_id, oa.batch_id, oa.strength AS audience_strength
     FROM offering_audiences oa
     WHERE oa.term_id = ?`,
    [termId],
  );
  const offeringAudienceStrength = new Map<string, number>();
  for (const oa of offeringAudiences) {
    if (oa.audience_strength != null) {
      offeringAudienceStrength.set(
        `${oa.offering_id}:${oa.section_id}:${oa.batch_id ?? 0}`,
        Number(oa.audience_strength),
      );
    }
  }

  // ------------------------------------------------------------------
  // 6. Build lookup indexes for fast overlap detection
  // ------------------------------------------------------------------
  // Group sessions by day for pairwise checks
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(s);
  }

  // ------------------------------------------------------------------
  // CHECK A: Faculty overlap
  // ------------------------------------------------------------------
  for (const [day, daySessions] of byDay) {
    // Collect all (faculty_id, session) pairs for this day
    const facultySlots: { faculty_id: number; session: any }[] = [];
    for (const sess of daySessions) {
      for (const f of (facultyMap.get(sess.session_id) ?? [])) {
        facultySlots.push({ faculty_id: f.faculty_id, session: sess });
      }
    }
    // Pairwise check within same faculty
    for (let i = 0; i < facultySlots.length; i++) {
      for (let j = i + 1; j < facultySlots.length; j++) {
        const a = facultySlots[i];
        const b = facultySlots[j];
        if (a.faculty_id !== b.faculty_id) continue;
        if (!overlaps(a.session.start_time, a.session.end_time, b.session.start_time, b.session.end_time)) continue;
        add({
          severity: 'ERROR',
          rule_code: RULE.FACULTY_OVERLAP,
          message: `Faculty ${a.faculty_id} is scheduled in two overlapping sessions on ${day}.`,
          details: {
            faculty_id: a.faculty_id,
            day,
            session_a: { session_id: a.session.session_id, start: a.session.start_time, end: a.session.end_time },
            session_b: { session_id: b.session.session_id, start: b.session.start_time, end: b.session.end_time },
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // CHECK B: Room double-booking
  // ------------------------------------------------------------------
  for (const [day, daySessions] of byDay) {
    for (let i = 0; i < daySessions.length; i++) {
      for (let j = i + 1; j < daySessions.length; j++) {
        const a = daySessions[i];
        const b = daySessions[j];
        if (a.room_id !== b.room_id) continue;
        if (!overlaps(a.start_time, a.end_time, b.start_time, b.end_time)) continue;
        add({
          severity: 'ERROR',
          rule_code: RULE.ROOM_DOUBLE_BOOKING,
          message: `Room ${a.room_id} is double-booked on ${day} between ${a.start_time}–${a.end_time} and ${b.start_time}–${b.end_time}.`,
          details: {
            room_id: a.room_id,
            day,
            session_a: { session_id: a.session_id, start: a.start_time, end: a.end_time },
            session_b: { session_id: b.session_id, start: b.start_time, end: b.end_time },
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // CHECK C: Audience (student) overlap
  // ------------------------------------------------------------------
  for (const [day, daySessions] of byDay) {
    for (let i = 0; i < daySessions.length; i++) {
      for (let j = i + 1; j < daySessions.length; j++) {
        const sa = daySessions[i];
        const sb = daySessions[j];
        if (!overlaps(sa.start_time, sa.end_time, sb.start_time, sb.end_time)) continue;

        const audA = audienceMap.get(sa.session_id) ?? [];
        const audB = audienceMap.get(sb.session_id) ?? [];

        for (const a of audA) {
          for (const b of audB) {
            if (a.section_id !== b.section_id) continue;
            // Audience overlap when:
            //   both have same batch → direct conflict
            //   one (or both) has no batch → whole-section conflict
            const sameBatch = a.batch_id != null && b.batch_id != null && a.batch_id === b.batch_id;
            const wholeSection = a.batch_id == null || b.batch_id == null;
            if (!sameBatch && !wholeSection) continue;
            add({
              severity: 'ERROR',
              rule_code: RULE.AUDIENCE_OVERLAP,
              message: `Section ${a.section_id}${a.batch_id != null ? ` batch ${a.batch_id}` : ''} has two overlapping sessions on ${day}.`,
              details: {
                section_id: a.section_id,
                batch_id_a: a.batch_id,
                batch_id_b: b.batch_id,
                day,
                session_a: { session_id: sa.session_id, start: sa.start_time, end: sa.end_time },
                session_b: { session_id: sb.session_id, start: sb.start_time, end: sb.end_time },
              },
            });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // CHECK D: Capacity is a hard constraint. Missing room capacity or audience
  // strength also blocks because the fit cannot be established.
  // ------------------------------------------------------------------
  for (const sess of sessions) {
    const audienceRows = audienceMap.get(sess.session_id) ?? [];
    const audienceScopeIssues = validateSessionAudienceScope(audienceRows);
    for (const audienceIssue of audienceScopeIssues) {
      add({
        ...audienceIssue,
        details: { ...audienceIssue.details, session_id: sess.session_id },
      });
    }
    const strengths = audienceRows.map(audience => {
      const exactAudienceStrength = offeringAudienceStrength.get(
        `${sess.offering_id}:${audience.section_id}:${audience.batch_id ?? 0}`,
      );
      return resolveAudienceStrength({
        offering_audience_strength: exactAudienceStrength ?? null,
        section_strength: audience.section_strength == null ? null : Number(audience.section_strength),
        batch_strength: audience.batch_strength == null ? null : Number(audience.batch_strength),
        batch_id: audience.batch_id == null ? null : Number(audience.batch_id),
      });
    });
    const strength = resolveTotalAudienceStrength(strengths);
    for (const capacityIssue of validateRoomCapacity(
      sess.room_capacity == null ? null : Number(sess.room_capacity),
      strength ?? null,
    )) {
      add({
        ...capacityIssue,
        details: {
          ...capacityIssue.details,
          session_id: sess.session_id,
          room_id: sess.room_id,
          offering_id: sess.offering_id,
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // CHECK E: Room type mismatch
  // ------------------------------------------------------------------
  for (const sess of sessions) {
    for (const suitabilityIssue of validateRoomSuitability({
      component_type: sess.component_type,
      room_type_code: sess.room_type_code,
      required_room_type_code: sess.required_room_type_code,
      practical_approved: Boolean(sess.practical_approved),
      room_status: sess.room_data_status,
    })) {
      add({
        ...suitabilityIssue,
        details: {
          ...suitabilityIssue.details,
          session_id: sess.session_id,
          room_id: sess.room_id,
          required_room_type_id: sess.required_room_type_id,
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // CHECK F: Missing/UNKNOWN availability is blocking; explicit AVAILABLE
  // coverage must span the entire scheduled session.
  // ------------------------------------------------------------------
  // Collect unique faculty ids in this version
  const allFacultyIds = new Set<number>();
  for (const fList of facultyMap.values()) for (const f of fList) allFacultyIds.add(f.faculty_id);

  if (allFacultyIds.size > 0) {
    const [availRows]: any = await db.query(
      `SELECT faculty_id, \`day\`, start_time, end_time, availability_type
       FROM faculty_availability
       WHERE faculty_id IN (?) AND term_id = ?`,
      [[...allFacultyIds], termId],
    );
    // Map faculty_id+day → all explicit availability windows
    type AvailWindow = {
      start_time: string;
      end_time: string;
      availability_type: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
    };
    const availabilityMap = new Map<string, AvailWindow[]>();
    for (const av of availRows) {
      const key = `${av.faculty_id}:${av.day}`;
      if (!availabilityMap.has(key)) availabilityMap.set(key, []);
      availabilityMap.get(key)!.push(av);
    }

    for (const sess of sessions) {
      const fList = facultyMap.get(sess.session_id) ?? [];
      for (const f of fList) {
        const windows = availabilityMap.get(`${f.faculty_id}:${sess.day}`) ?? [];
        for (const availabilityIssue of validateAvailability(
          sess.start_time,
          sess.end_time,
          windows,
          `Faculty ${f.faculty_id}`,
        )) {
          add({
            ...availabilityIssue,
            rule_code: availabilityIssue.rule_code === 'UNKNOWN_AVAILABILITY'
              ? RULE.FACULTY_UNKNOWN_AVAIL
              : RULE.FACULTY_UNAVAILABLE,
            details: {
              ...availabilityIssue.details,
              session_id: sess.session_id, faculty_id: f.faculty_id, day: sess.day,
            },
          });
        }
      }
    }
  }

  // Validate day grids, exact teaching-slot membership, room availability, and
  // per-session consecutive period requirements.
  const roomIds = [...new Set<number>(sessions.map((session: any) => Number(session.room_id)))];
  const [roomAvailabilityRows]: any = roomIds.length
    ? await db.query(
      `SELECT room_id, \`day\`, start_time, end_time, availability_type
       FROM room_availability WHERE room_id IN (?) AND term_id = ?`,
      [roomIds, termId],
    )
    : [[]];
  for (const sess of sessions) {
    const gridIssues = validateSessionGrid({
      day_name: sess.day,
      start_time: sess.start_time,
      end_time: sess.end_time,
      start_slot_id: sess.start_slot_id == null ? null : Number(sess.start_slot_id),
      slot_count: sess.slot_count == null ? null : Number(sess.slot_count),
    }, dayMap.get(sess.day));
    for (const gridIssue of gridIssues) {
      const ruleCode = gridIssue.rule_code === 'SATURDAY_CUTOFF'
        ? RULE.SATURDAY_CLOSING
        : gridIssue.rule_code;
      add({
        ...gridIssue,
        rule_code: ruleCode,
        details: { ...gridIssue.details, session_id: sess.session_id },
      });
    }

    const roomWindows = roomAvailabilityRows
      .filter((window: any) => Number(window.room_id) === Number(sess.room_id) && window.day === sess.day)
      .map((window: any) => ({
        start_time: window.start_time,
        end_time: window.end_time,
        availability_type: window.availability_type,
      }));
    for (const roomIssue of validateAvailability(sess.start_time, sess.end_time, roomWindows, `Room ${sess.room_id}`)) {
      add({
        ...roomIssue,
        rule_code: roomIssue.rule_code === 'UNKNOWN_AVAILABILITY'
          ? RULE.ROOM_UNKNOWN_AVAILABILITY
          : RULE.ROOM_UNAVAILABLE,
        details: { ...roomIssue.details, session_id: sess.session_id, room_id: sess.room_id, day: sess.day },
      });
    }

    if (!(facultyMap.get(sess.session_id) ?? []).length) {
      add({
        severity: 'ERROR',
        rule_code: 'SESSION_FACULTY_MISSING',
        message: `Session ${sess.session_id} has no assigned faculty member.`,
        details: { session_id: sess.session_id },
      });
    }
    for (const consecutiveIssue of validateConsecutivePeriods({
      is_consecutive: Boolean(sess.is_consecutive),
      periods_per_session: sess.periods_per_session == null ? null : Number(sess.periods_per_session),
      slot_count: sess.slot_count == null ? null : Number(sess.slot_count),
    })) {
      add({ ...consecutiveIssue, details: { ...consecutiveIssue.details, session_id: sess.session_id } });
    }
  }

  // ------------------------------------------------------------------
  // CHECK G: Consecutive lab periods
  // Sessions for the same offering on the same day must use adjacent
  // time slots with no gap (slot_no consecutive, no BREAK in between).
  // Only fires when is_consecutive = 1 AND start_slot_id is populated.
  // ------------------------------------------------------------------
  // Group sessions by offering + day
  const byOfferingDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!s.is_consecutive) continue;
    const key = `${s.offering_id}:${s.day}`;
    if (!byOfferingDay.has(key)) byOfferingDay.set(key, []);
    byOfferingDay.get(key)!.push(s);
  }

  for (const [key, group] of byOfferingDay) {
    if (group.length < 2) continue; // single session can't violate consecutiveness
    if (group.some((s: any) => s.start_slot_id == null)) continue; // no slot data — skip

    // Load the slot_no values for these slots
    const slotIds = group.map((s: any) => s.start_slot_id);
    const [slotRows]: any = await db.query(
      'SELECT slot_id, slot_no FROM time_slots WHERE slot_id IN (?)',
      [slotIds],
    );
    const slotNoMap = new Map<number, number>(slotRows.map((r: any) => [r.slot_id, r.slot_no]));

    const sorted = [...group].sort((a: any, b: any) =>
      (slotNoMap.get(a.start_slot_id) ?? 0) - (slotNoMap.get(b.start_slot_id) ?? 0),
    );

    let consecutive = true;
    for (let i = 1; i < sorted.length; i++) {
      const prevNo = slotNoMap.get(sorted[i - 1].start_slot_id) ?? 0;
      const prevCount = sorted[i - 1].slot_count ?? 1;
      const currNo = slotNoMap.get(sorted[i].start_slot_id) ?? 0;
      if (currNo !== prevNo + prevCount) {
        consecutive = false;
        break;
      }
    }

    if (!consecutive) {
      const [offeringId, day] = key.split(':');
      add({
        severity: 'ERROR',
        rule_code: RULE.NON_CONSECUTIVE_LAB,
        message: `Offering ${offeringId} requires consecutive periods on ${day} but sessions are not adjacent.`,
        details: {
          offering_id: Number(offeringId),
          day,
          session_ids: group.map((s: any) => s.session_id),
          slot_nos: group.map((s: any) => slotNoMap.get(s.start_slot_id)),
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // Summarise
  // ------------------------------------------------------------------
  const errorCount = issues.filter(i => i.severity === 'ERROR').length;
  const warningCount = issues.filter(i => i.severity === 'WARNING').length;

  return {
    version_id: versionId,
    session_count: sessionCount,
    issue_count: issues.length,
    error_count: errorCount,
    warning_count: warningCount,
    passed: errorCount === 0,
    issues,
  };
}

// ---------------------------------------------------------------------------
// runValidationAndPersist — writes validation_runs + validation_issues
// ---------------------------------------------------------------------------

/**
 * Runs computeValidation, persists results to validation_runs and
 * validation_issues, and updates timetable_versions.status to VALIDATED
 * when there are no ERRORs.
 *
 * Returns the persisted run record.
 */
export async function runValidationAndPersist(
  versionId: number,
  actorUserId: number,
  db: DB = defaultPool,
): Promise<PersistedValidationRun> {
  void actorUserId;
  // Create the validation_run record (status=RUNNING)
  const [runIns]: any = await db.query(
    `INSERT INTO validation_runs (version_id, validation_type, status, started_at)
     VALUES (?, 'TIMETABLE_VERSION', 'RUNNING', UTC_TIMESTAMP())`,
    [versionId],
  );
  const validationId: number = runIns.insertId;

  let result: ValidationResult;
  try {
    result = await computeValidation(versionId, db);
  } catch (err) {
    // Mark the run as FAILED if the computation itself crashes
    await db.query(
      "UPDATE validation_runs SET status = 'FAILED', ended_at = UTC_TIMESTAMP() WHERE validation_id = ?",
      [validationId],
    );
    throw err;
  }

  // Persist issues
  for (const issue of result.issues) {
    await db.query(
      `INSERT INTO validation_issues (validation_id, severity, rule_code, message, details_json)
       VALUES (?, ?, ?, ?, ?)`,
      [validationId, issue.severity, issue.rule_code, issue.message,
        Object.keys(issue.details).length ? JSON.stringify(issue.details) : null],
    );
  }

  const finalStatus = result.passed ? 'PASSED' : 'FAILED';

  // Update the validation_run
  await db.query(
    'UPDATE validation_runs SET status = ?, ended_at = UTC_TIMESTAMP() WHERE validation_id = ?',
    [finalStatus, validationId],
  );

  // Keep the version status aligned with its latest persisted validation.
  if (result.passed) {
    await db.query(
      "UPDATE timetable_versions SET status = 'VALIDATED' WHERE version_id = ? AND status = 'DRAFT'",
      [versionId],
    );
  } else {
    await db.query(
      "UPDATE timetable_versions SET status = 'DRAFT' WHERE version_id = ? AND status = 'VALIDATED'",
      [versionId],
    );
  }

  return {
    validation_id: validationId,
    version_id: versionId,
    status: finalStatus,
    session_count: result.session_count,
    issue_count: result.issue_count,
    error_count: result.error_count,
    warning_count: result.warning_count,
  };
}
