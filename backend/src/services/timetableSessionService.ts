import { PoolConnection } from 'mysql2/promise';
import { pool, withTransaction } from '../db/pool';
import { audit } from './audit';
import { computeValidation } from './validationService';
import {
  findNewValidationErrors,
  findSessionValidationErrors,
  getContiguousSlotOptions,
  SessionSlotOption,
  TeachingSlot,
} from './timetableSessionRules';
import { HttpError } from '../utils/errors';
import { z } from 'zod';
import { timetableSessionInput } from './timetableSessionRules';

type SessionInput = z.infer<typeof timetableSessionInput>;
type DB = PoolConnection | typeof pool;

function mapSessionRows(
  sessions: any[],
  audiences: any[],
  faculty: any[],
) {
  const audienceMap = new Map<number, any[]>();
  for (const audience of audiences) {
    const items = audienceMap.get(Number(audience.session_id)) ?? [];
    items.push(audience);
    audienceMap.set(Number(audience.session_id), items);
  }
  const facultyMap = new Map<number, any[]>();
  for (const member of faculty) {
    const items = facultyMap.get(Number(member.session_id)) ?? [];
    items.push(member);
    facultyMap.set(Number(member.session_id), items);
  }
  return sessions.map(session => ({
    ...session,
    audiences: audienceMap.get(Number(session.session_id)) ?? [],
    faculty: facultyMap.get(Number(session.session_id)) ?? [],
  }));
}

export async function listTimetableSessions(versionId: number, sessionId?: number, db: DB = pool) {
  const [[version]]: any = await db.query(
    'SELECT version_id FROM timetable_versions WHERE version_id = ?',
    [versionId],
  );
  if (!version) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');

  const sessionFilter = sessionId == null ? '' : ' AND ss.session_id = ?';
  const params = sessionId == null ? [versionId] : [versionId, sessionId];
  const [sessions]: any = await db.query(
    `SELECT ss.session_id, ss.version_id, ss.offering_id, ss.room_id, ss.\`day\`, ss.session_date,
            ss.start_time, ss.end_time, ss.start_slot_id, ss.slot_count, ts.slot_no AS start_slot_no,
            c.course_id, c.course_code, c.course_name, cc.component_type,
            co.offering_code, r.room_code, r.room_name, rt.type_name AS room_type_name
     FROM scheduled_sessions ss
     JOIN course_offerings co ON co.offering_id = ss.offering_id AND co.term_id = ss.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN courses c ON c.course_id = cc.course_id
     JOIN rooms r ON r.room_id = ss.room_id
     JOIN room_types rt ON rt.room_type_id = r.room_type_id
     LEFT JOIN time_slots ts ON ts.slot_id = ss.start_slot_id AND ts.term_id = ss.term_id
     WHERE ss.version_id = ?${sessionFilter}
     ORDER BY FIELD(ss.\`day\`, 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'), ss.start_time, ss.session_id`,
    params,
  );
  if (sessionId != null && !sessions.length) {
    throw new HttpError(404, 'Session not found in this timetable version', 'NOT_FOUND');
  }
  if (!sessions.length) return [];

  const ids = sessions.map((session: any) => Number(session.session_id));
  const [audiences]: any = await db.query(
    `SELECT sa.session_id, oa.audience_id, sa.section_id, sa.batch_id, s.section_name, b.batch_name
     FROM session_audiences sa
     JOIN sections s ON s.section_id = sa.section_id
     JOIN scheduled_sessions ss ON ss.session_id = sa.session_id AND ss.version_id = sa.version_id
     JOIN offering_audiences oa ON oa.offering_id = ss.offering_id
       AND oa.section_id = sa.section_id AND oa.batch_id <=> sa.batch_id
     LEFT JOIN batches b ON b.batch_id = sa.batch_id AND b.section_id = sa.section_id
     WHERE sa.version_id = ? AND sa.session_id IN (?)`,
    [versionId, ids],
  );
  const [faculty]: any = await db.query(
    `SELECT sf.session_id, sf.faculty_id, sf.role, fp.name AS faculty_name, fp.staff_code
     FROM session_faculty sf
     JOIN faculty_profiles fp ON fp.faculty_id = sf.faculty_id
     WHERE sf.version_id = ? AND sf.session_id IN (?)`,
    [versionId, ids],
  );
  return mapSessionRows(sessions, audiences, faculty);
}

export async function getTimetableSessionOptions(versionId: number) {
  const [[version]]: any = await pool.query(
    'SELECT version_id, term_id FROM timetable_versions WHERE version_id = ?',
    [versionId],
  );
  if (!version) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');

  const [rows]: any = await pool.query(
    `SELECT co.offering_id, co.offering_code, co.data_status AS offering_status,
            cc.component_type, cc.periods_per_session, cc.is_consecutive, cc.data_status AS component_status,
            c.course_id, c.course_code, c.course_name, c.data_status AS course_status,
            oa.audience_id, oa.section_id, oa.batch_id, oa.strength AS audience_strength,
            oa.data_status AS audience_status, s.section_name, s.data_status AS section_status,
            b.batch_name, fa.assignment_id, fa.faculty_id, fa.role, fp.name AS faculty_name,
            fp.staff_code, fp.data_status AS faculty_status
     FROM timetable_version_sections tvs
     JOIN sections s ON s.section_id = tvs.section_id AND s.term_id = tvs.term_id AND s.is_active = 1
     JOIN offering_audiences oa ON oa.section_id = s.section_id AND oa.term_id = tvs.term_id
     JOIN course_offerings co ON co.offering_id = oa.offering_id AND co.term_id = oa.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN courses c ON c.course_id = cc.course_id AND c.is_active = 1
     LEFT JOIN batches b ON b.batch_id = oa.batch_id AND b.section_id = oa.section_id AND b.is_active = 1
     JOIN faculty_assignments fa ON fa.audience_id = oa.audience_id AND fa.is_approved = 1
       AND fa.role_status IN ('VERIFIED', 'RESOLVED')
     JOIN faculty_profiles fp ON fp.faculty_id = fa.faculty_id AND fp.is_active = 1
       AND fp.data_status IN ('VERIFIED', 'RESOLVED')
     WHERE tvs.version_id = ? AND co.status = 'OFFERED'
       AND co.data_status IN ('VERIFIED', 'RESOLVED')
       AND cc.data_status IN ('VERIFIED', 'RESOLVED')
       AND c.data_status IN ('VERIFIED', 'RESOLVED')
       AND oa.data_status IN ('VERIFIED', 'RESOLVED')
       AND s.data_status IN ('VERIFIED', 'RESOLVED')
       AND (oa.batch_id IS NULL OR b.batch_id IS NOT NULL)
     ORDER BY c.course_name, cc.component_type, s.section_name, b.batch_name, fp.name`,
    [versionId],
  );

  const offeringsById = new Map<number, any>();
  for (const row of rows) {
    const offeringId = Number(row.offering_id);
    let offering = offeringsById.get(offeringId);
    if (!offering) {
      offering = {
        offering_id: offeringId,
        offering_code: row.offering_code,
        course_id: Number(row.course_id),
        course_code: row.course_code,
        course_name: row.course_name,
        component_type: row.component_type,
        periods_per_session: row.periods_per_session == null ? null : Number(row.periods_per_session),
        is_consecutive: Boolean(row.is_consecutive),
        audiences: new Map<number, any>(),
      };
      offeringsById.set(offeringId, offering);
    }
    const audienceId = Number(row.audience_id);
    let audience = offering.audiences.get(audienceId);
    if (!audience) {
      audience = {
        audience_id: audienceId,
        section_id: Number(row.section_id),
        section_name: row.section_name,
        batch_id: row.batch_id == null ? null : Number(row.batch_id),
        batch_name: row.batch_name,
        strength: row.audience_strength == null ? null : Number(row.audience_strength),
        faculty: new Map<number, any>(),
      };
      offering.audiences.set(audienceId, audience);
    }
    audience.faculty.set(Number(row.assignment_id), {
      assignment_id: Number(row.assignment_id),
      faculty_id: Number(row.faculty_id),
      faculty_name: row.faculty_name,
      staff_code: row.staff_code,
      role: row.role,
    });
  }

  const [roomColumn]: any = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'practical_approved'`,
  );
  const practicalApprovalSupported = roomColumn.length > 0;
  const [rooms]: any = await pool.query(
    `SELECT r.room_id, r.room_code, r.room_name, r.capacity, r.equipment, r.data_status,
            rt.type_code AS room_type_code, rt.type_name AS room_type_name,
            ${practicalApprovalSupported ? 'r.practical_approved' : '0'} AS practical_approved
     FROM rooms r JOIN room_types rt ON rt.room_type_id = r.room_type_id
     WHERE r.is_active = 1 AND rt.is_active = 1 AND r.data_status IN ('VERIFIED', 'RESOLVED')
     ORDER BY r.room_code`,
  );

  const [slotRows]: any = await pool.query(
    `SELECT td.day_name AS day, td.is_teaching_day, s.slot_id, s.slot_no, s.start_time, s.end_time
     FROM term_teaching_days td
     JOIN term_day_slots tds ON tds.term_day_id = td.term_day_id AND tds.term_id = td.term_id AND tds.is_active = 1
     JOIN time_slots s ON s.slot_id = tds.slot_id AND s.term_id = td.term_id
     WHERE td.term_id = ? AND td.is_teaching_day = 1
       AND s.slot_type = 'TEACHING' AND s.data_status IN ('VERIFIED', 'RESOLVED')
     ORDER BY td.day_name, s.slot_no`,
    [version.term_id],
  );
  const slots: TeachingSlot[] = slotRows.map((row: any) => ({
    day: row.day,
    slot_id: Number(row.slot_id),
    slot_no: Number(row.slot_no),
    start_time: row.start_time,
    end_time: row.end_time,
  }));

  return {
    offerings: [...offeringsById.values()].map(offering => {
      const periodCount = offering.periods_per_session ?? 1;
      const durationIsConfigured = !(offering.component_type === 'LAB' && offering.periods_per_session == null);
      const slotOptions: SessionSlotOption[] = durationIsConfigured
        ? getContiguousSlotOptions(slots, periodCount)
        : [];
      return {
        ...offering,
        audiences: [...offering.audiences.values()].map((audience: any) => ({
          ...audience,
          faculty: [...audience.faculty.values()],
        })),
        duration_is_configured: durationIsConfigured,
        slot_options: slotOptions,
      };
    }),
    rooms,
    practical_approval_supported: practicalApprovalSupported,
  };
}

async function lockDraftVersion(conn: PoolConnection, versionId: number) {
  const [[version]]: any = await conn.query(
    'SELECT version_id, term_id, status FROM timetable_versions WHERE version_id = ? FOR UPDATE',
    [versionId],
  );
  if (!version) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');
  if (version.status !== 'DRAFT') {
    throw new HttpError(409, 'Sessions can only be changed while the timetable version is DRAFT', 'VERSION_NOT_DRAFT');
  }
  return version;
}

async function resolveSessionInput(
  conn: PoolConnection,
  versionId: number,
  termId: number,
  input: SessionInput,
) {
  const [[target]]: any = await conn.query(
    `SELECT co.offering_id, co.component_id, cc.component_type, cc.periods_per_session, cc.is_consecutive,
            oa.audience_id, oa.section_id, oa.batch_id, oa.strength,
            s.data_status AS section_status, oa.data_status AS audience_status
     FROM course_offerings co
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN offering_audiences oa ON oa.offering_id = co.offering_id AND oa.term_id = co.term_id
     JOIN sections s ON s.section_id = oa.section_id AND s.term_id = oa.term_id AND s.is_active = 1
     JOIN timetable_version_sections tvs ON tvs.section_id = s.section_id AND tvs.term_id = s.term_id
       AND tvs.version_id = ?
     LEFT JOIN batches b ON b.batch_id = oa.batch_id AND b.section_id = oa.section_id AND b.is_active = 1
     WHERE co.offering_id = ? AND co.term_id = ? AND oa.audience_id = ?
       AND co.status = 'OFFERED'
       AND co.data_status IN ('VERIFIED', 'RESOLVED')
       AND cc.data_status IN ('VERIFIED', 'RESOLVED')
       AND oa.data_status IN ('VERIFIED', 'RESOLVED')
       AND s.data_status IN ('VERIFIED', 'RESOLVED')
       AND (oa.batch_id IS NULL OR b.batch_id IS NOT NULL)`,
    [versionId, input.offering_id, termId, input.audience_id],
  );
  if (!target) {
    throw new HttpError(422, 'The course offering and audience must be verified and linked to a section in this timetable version', 'INVALID_OFFERING_AUDIENCE');
  }
  if (target.component_type === 'LAB' && target.periods_per_session == null) {
    throw new HttpError(422, 'The lab duration is not configured; verify periods per session before scheduling it', 'LAB_DURATION_UNKNOWN');
  }
  const slotCount = target.periods_per_session == null ? 1 : Number(target.periods_per_session);

  const [assignmentRows]: any = await conn.query(
    `SELECT fa.assignment_id, fa.faculty_id, fa.role
     FROM faculty_assignments fa
     JOIN faculty_profiles fp ON fp.faculty_id = fa.faculty_id
     WHERE fa.audience_id = ? AND fa.assignment_id IN (?)
       AND fa.is_approved = 1 AND fa.role_status IN ('VERIFIED', 'RESOLVED')
       AND fp.is_active = 1 AND fp.data_status IN ('VERIFIED', 'RESOLVED')`,
    [input.audience_id, input.assignment_ids],
  );
  if (assignmentRows.length !== input.assignment_ids.length) {
    throw new HttpError(422, 'Every selected faculty assignment must be approved, verified, active, and assigned to this audience', 'INVALID_FACULTY_ASSIGNMENT');
  }
  const facultyIds = assignmentRows.map((row: any) => Number(row.faculty_id));
  if (new Set(facultyIds).size !== facultyIds.length) {
    throw new HttpError(422, 'Select at most one assignment role for each faculty member', 'DUPLICATE_SESSION_FACULTY');
  }

  const [[room]]: any = await conn.query(
    `SELECT r.room_id FROM rooms r JOIN room_types rt ON rt.room_type_id = r.room_type_id
     WHERE r.room_id = ? AND r.is_active = 1 AND rt.is_active = 1
       AND r.data_status IN ('VERIFIED', 'RESOLVED')`,
    [input.room_id],
  );
  if (!room) throw new HttpError(422, 'The selected room must be active and verified', 'INVALID_ROOM');

  const [slotRows]: any = await conn.query(
    `SELECT td.day_name AS day, td.is_teaching_day, s.slot_id, s.slot_no, s.start_time, s.end_time
     FROM term_teaching_days td
     JOIN term_day_slots tds ON tds.term_day_id = td.term_day_id AND tds.term_id = td.term_id AND tds.is_active = 1
     JOIN time_slots s ON s.slot_id = tds.slot_id AND s.term_id = td.term_id
     WHERE td.term_id = ? AND td.is_teaching_day = 1
       AND s.slot_type = 'TEACHING' AND s.data_status IN ('VERIFIED', 'RESOLVED')
     ORDER BY td.day_name, s.slot_no`,
    [termId],
  );
  const slots: TeachingSlot[] = slotRows.map((row: any) => ({
    day: row.day,
    slot_id: Number(row.slot_id),
    slot_no: Number(row.slot_no),
    start_time: row.start_time,
    end_time: row.end_time,
  }));
  const slotOption = getContiguousSlotOptions(slots, slotCount)
    .find(option => option.start_slot_id === input.start_slot_id);
  if (!slotOption) {
    throw new HttpError(422, 'The selected start time does not fit the required consecutive teaching periods', 'INVALID_TEACHING_SLOT');
  }
  return { slotOption, assignmentRows, audience: target };
}

async function rejectNewValidationErrors(
  conn: PoolConnection,
  versionId: number,
  previousIssues: Awaited<ReturnType<typeof computeValidation>>['issues'],
  affectedSessionId: number,
) {
  const validation = await computeValidation(versionId, conn);
  const affectedErrors = findSessionValidationErrors(validation.issues, affectedSessionId);
  const newErrors = findNewValidationErrors(previousIssues, validation.issues);
  const allErrors = [...new Map([...affectedErrors, ...newErrors].map(issue => [
    `${issue.rule_code}:${JSON.stringify(issue.details)}`,
    issue,
  ])).values()];
  if (allErrors.length) {
    throw new HttpError(422, 'Session violates timetable constraints', 'SESSION_VALIDATION_FAILED', { issues: allErrors });
  }
}

export async function createTimetableSession(
  versionId: number,
  input: SessionInput,
  actorId: number,
) {
  return withTransaction(async conn => {
    const version = await lockDraftVersion(conn, versionId);
    const before = await computeValidation(versionId, conn);
    const { slotOption, assignmentRows, audience } = await resolveSessionInput(conn, versionId, Number(version.term_id), input);
    const [insert]: any = await conn.query(
      `INSERT INTO scheduled_sessions
         (version_id, term_id, offering_id, room_id, \`day\`, start_time, end_time, start_slot_id, slot_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [versionId, version.term_id, input.offering_id, input.room_id, slotOption.day,
        slotOption.start_time, slotOption.end_time, slotOption.start_slot_id, slotOption.slot_count],
    );
    const sessionId = Number(insert.insertId);
    await conn.query(
      'INSERT INTO session_audiences (session_id, version_id, section_id, batch_id) VALUES (?, ?, ?, ?)',
      [sessionId, versionId, audience.section_id, audience.batch_id],
    );
    for (const assignment of assignmentRows) {
      await conn.query(
        'INSERT INTO session_faculty (session_id, version_id, faculty_id, role) VALUES (?, ?, ?, ?)',
        [sessionId, versionId, assignment.faculty_id, assignment.role],
      );
    }
    await rejectNewValidationErrors(conn, versionId, before.issues, sessionId);
    await audit(conn, actorId, 'TIMETABLE_SESSION_CREATED', 'scheduled_sessions', sessionId, {
      version_id: versionId,
      offering_id: input.offering_id,
      audience_id: input.audience_id,
      room_id: input.room_id,
      assignment_ids: assignmentRows.map((row: any) => Number(row.assignment_id)),
      day: slotOption.day,
      start_time: slotOption.start_time,
      end_time: slotOption.end_time,
    });
    return sessionId;
  });
}

export async function updateTimetableSession(
  versionId: number,
  sessionId: number,
  input: SessionInput,
  actorId: number,
) {
  return withTransaction(async conn => {
    const version = await lockDraftVersion(conn, versionId);
    const [[existing]]: any = await conn.query(
      'SELECT session_id FROM scheduled_sessions WHERE session_id = ? AND version_id = ? FOR UPDATE',
      [sessionId, versionId],
    );
    if (!existing) throw new HttpError(404, 'Session not found in this timetable version', 'NOT_FOUND');
    const before = await computeValidation(versionId, conn);
    const { slotOption, assignmentRows, audience } = await resolveSessionInput(conn, versionId, Number(version.term_id), input);
    await conn.query(
      `UPDATE scheduled_sessions
       SET offering_id = ?, room_id = ?, \`day\` = ?, start_time = ?, end_time = ?, start_slot_id = ?, slot_count = ?
       WHERE session_id = ? AND version_id = ?`,
      [input.offering_id, input.room_id, slotOption.day, slotOption.start_time, slotOption.end_time,
        slotOption.start_slot_id, slotOption.slot_count, sessionId, versionId],
    );
    await conn.query('DELETE FROM session_audiences WHERE session_id = ? AND version_id = ?', [sessionId, versionId]);
    await conn.query(
      'INSERT INTO session_audiences (session_id, version_id, section_id, batch_id) VALUES (?, ?, ?, ?)',
      [sessionId, versionId, audience.section_id, audience.batch_id],
    );
    await conn.query('DELETE FROM session_faculty WHERE session_id = ? AND version_id = ?', [sessionId, versionId]);
    for (const assignment of assignmentRows) {
      await conn.query(
        'INSERT INTO session_faculty (session_id, version_id, faculty_id, role) VALUES (?, ?, ?, ?)',
        [sessionId, versionId, assignment.faculty_id, assignment.role],
      );
    }
    await rejectNewValidationErrors(conn, versionId, before.issues, sessionId);
    await audit(conn, actorId, 'TIMETABLE_SESSION_UPDATED', 'scheduled_sessions', sessionId, {
      version_id: versionId,
      offering_id: input.offering_id,
      audience_id: input.audience_id,
      room_id: input.room_id,
      assignment_ids: assignmentRows.map((row: any) => Number(row.assignment_id)),
      day: slotOption.day,
      start_time: slotOption.start_time,
      end_time: slotOption.end_time,
    });
  });
}

export async function deleteTimetableSession(versionId: number, sessionId: number, actorId: number) {
  return withTransaction(async conn => {
    await lockDraftVersion(conn, versionId);
    const [[existing]]: any = await conn.query(
      'SELECT session_id, offering_id FROM scheduled_sessions WHERE session_id = ? AND version_id = ? FOR UPDATE',
      [sessionId, versionId],
    );
    if (!existing) throw new HttpError(404, 'Session not found in this timetable version', 'NOT_FOUND');
    await conn.query(
      'DELETE FROM scheduled_sessions WHERE session_id = ? AND version_id = ?',
      [sessionId, versionId],
    );
    await audit(conn, actorId, 'TIMETABLE_SESSION_DELETED', 'scheduled_sessions', sessionId, {
      version_id: versionId,
      offering_id: Number(existing.offering_id),
    });
  });
}
