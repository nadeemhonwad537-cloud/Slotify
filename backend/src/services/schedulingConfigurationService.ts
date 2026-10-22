import { Pool, PoolConnection } from 'mysql2/promise';
import { pool as defaultPool } from '../db/pool';
import { SCHEDULING_POLICY } from '../rules/scheduleRules';
import {
  ConfiguredDivision,
  ConfiguredDay,
  ConfiguredRoom,
  SchedulingConfiguration,
  expectedSemesters,
  validateSchedulingConfiguration,
} from './schedulingConfiguration';

type DB = Pool | PoolConnection;

export async function getSchedulingConfiguration(termId: number, db: DB = defaultPool) {
  const [termRows]: any = await db.query(
    'SELECT term_id, term_name, parity, status FROM terms WHERE term_id = ?',
    [termId],
  );
  const term = termRows[0];
  if (!term) return null;

  const [mappingRows]: any = await db.query(
    `SELECT DISTINCT sem.semester_no
     FROM term_program_semesters tps
     JOIN semesters sem ON sem.semester_id = tps.semester_id
     JOIN curriculum_schemes cs ON cs.scheme_id = tps.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
     JOIN departments d ON d.dept_id = p.dept_id
     WHERE tps.term_id = ? AND tps.is_active = 1 AND sem.is_active = 1
       AND cs.is_active = 1 AND p.is_active = 1 AND d.is_active = 1`,
    [termId],
  );
  const [divisionRows]: any = await db.query(
    `SELECT sec.section_id, sec.section_name, sec.data_status, sem.semester_no, p.program_code
     FROM sections sec
     JOIN semesters sem ON sem.semester_id = sec.semester_id
     JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
    JOIN departments d ON d.dept_id = p.dept_id
    WHERE sec.term_id = ? AND sec.is_active = 1 AND sem.is_active = 1
      AND cs.is_active = 1 AND p.is_active = 1 AND d.is_active = 1
     ORDER BY sem.semester_no, p.program_code, sec.section_name`,
    [termId],
  );
  const activeDivisions: ConfiguredDivision[] = divisionRows.map((row: any) => ({
    section_id: Number(row.section_id),
    section_name: row.section_name,
    semester_no: Number(row.semester_no),
    program_code: row.program_code,
    data_status: row.data_status,
  }));
  const activeDivisionCounts: Record<number, number> = Object.fromEntries(
    [...new Set(activeDivisions.map(row => row.semester_no))].map(semester =>
      [semester, activeDivisions.filter(row => row.semester_no === semester).length]),
  );

  const [practicalColumnRows]: any = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'practical_approved'`,
  );
  const practicalApprovalSupported = practicalColumnRows.length > 0;
  const roomQuery = practicalApprovalSupported
    ? `SELECT r.room_id, r.room_code, rt.type_code, r.capacity, r.equipment, r.data_status, r.practical_approved
       FROM rooms r JOIN room_types rt ON rt.room_type_id = r.room_type_id
       WHERE r.is_active = 1 AND rt.is_active = 1 ORDER BY r.room_id`
    : `SELECT r.room_id, r.room_code, rt.type_code, r.capacity, r.equipment, r.data_status, 0 AS practical_approved
       FROM rooms r JOIN room_types rt ON rt.room_type_id = r.room_type_id
       WHERE r.is_active = 1 AND rt.is_active = 1 ORDER BY r.room_id`;
  const [roomRows]: any = await db.query(roomQuery);
  const [roomAvailabilityRows]: any = await db.query(
    `SELECT room_id, \`day\`, start_time, end_time, availability_type
     FROM room_availability WHERE term_id = ?`,
    [termId],
  );
  const rooms: ConfiguredRoom[] = roomRows.map((room: any) => ({
    room_id: Number(room.room_id),
    room_code: room.room_code,
    type_code: room.type_code,
    capacity: room.capacity == null ? null : Number(room.capacity),
    equipment: room.equipment,
    data_status: room.data_status,
    practical_approved: Boolean(room.practical_approved),
    availability: roomAvailabilityRows
      .filter((window: any) => Number(window.room_id) === Number(room.room_id))
      .map((window: any) => ({
        day_name: window.day,
        start_time: window.start_time,
        end_time: window.end_time,
        availability_type: window.availability_type,
      })),
  }));

  const [gridRows]: any = await db.query(
    `SELECT td.day_name, td.is_teaching_day, td.closing_time,
            s.slot_id, s.slot_no, s.start_time, s.end_time, s.slot_type, s.data_status
     FROM term_teaching_days td
     LEFT JOIN term_day_slots tds ON tds.term_day_id = td.term_day_id AND tds.is_active = 1
     LEFT JOIN time_slots s ON s.slot_id = tds.slot_id
     WHERE td.term_id = ?
     ORDER BY td.day_name, s.start_time`,
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

  const [[workloadCounts]]: any = await db.query(
    `SELECT COUNT(*) AS active_count,
            SUM(data_status IN ('VERIFIED','RESOLVED')) AS verified_count
     FROM faculty_workload_rules WHERE is_active = 1`,
  );

  const config: SchedulingConfiguration = {
    term_id: Number(term.term_id),
    parity: term.parity,
    mapped_semester_numbers: mappingRows.map((row: any) => Number(row.semester_no)),
    active_division_counts: activeDivisionCounts,
    active_divisions: activeDivisions,
    rooms,
    days: [...dayMap.values()],
    practical_approval_supported: practicalApprovalSupported,
    calendar_supported: false,
    workload_rule_count: Number(workloadCounts.active_count),
    verified_workload_rule_count: Number(workloadCounts.verified_count ?? 0),
  };
  const issues = validateSchedulingConfiguration(config);
  if (term.status !== 'ACTIVE') {
    issues.push({
      severity: 'ERROR',
      rule_code: 'TERM_NOT_ACTIVE',
      message: `Term "${term.term_name}" is ${term.status}; only an ACTIVE term can be scheduled.`,
      details: { status: term.status },
    });
  }

  return {
    term: { term_id: Number(term.term_id), term_name: term.term_name, parity: term.parity, status: term.status },
    expected_semesters: expectedSemesters(term.parity),
    expected_divisions: SCHEDULING_POLICY.divisionsPerSemester * 3,
    actual_divisions: Object.values(activeDivisionCounts).reduce((sum, count) => sum + count, 0),
    active_semesters: Object.keys(activeDivisionCounts).map(Number).sort((a, b) => a - b),
    active_divisions: activeDivisions,
    rooms,
    days: [...dayMap.values()],
    calendar_supported: config.calendar_supported,
    practical_approval_supported: practicalApprovalSupported,
    workload_rules: {
      active: config.workload_rule_count,
      verified: config.verified_workload_rule_count,
    },
    ready: !issues.some(issue => issue.severity === 'ERROR'),
    issues,
  };
}
