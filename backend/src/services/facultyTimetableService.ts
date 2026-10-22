import { pool } from '../db/pool';
import { semestersForParity, semesterMatchesParity, TermParity } from './academicTermRules';

export interface FacultyTimetableContext {
  year_id: number;
  year_label: string;
  term_id: number;
  term_name: string;
  parity: TermParity;
  program_id: number;
  program_code: string;
  program_name: string;
  scheme_id: number;
  scheme_code: string;
  scheme_version: string;
  semester_id: number;
  semester_no: number;
  semester_name: string | null;
}

export interface FacultyTimetableFilter {
  year_id: number;
  term_id: number;
  semester_id: number;
}

export async function listFacultyTimetableContexts(userId: number): Promise<FacultyTimetableContext[]> {
  const [rows]: any = await pool.query(
    `SELECT DISTINCT y.year_id, y.year_label, t.term_id, t.term_name, t.parity,
            p.program_id, p.program_code, p.program_name, cs.scheme_id, cs.scheme_code,
            cs.version AS scheme_version, s.semester_id, s.semester_no, s.name AS semester_name
     FROM faculty_profiles fp
     JOIN faculty_assignments fa ON fa.faculty_id = fp.faculty_id
       AND fa.is_approved = 1 AND fa.role_status IN ('VERIFIED', 'RESOLVED')
     JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
     JOIN sections sec ON sec.section_id = oa.section_id AND sec.term_id = oa.term_id
     JOIN terms t ON t.term_id = sec.term_id
     JOIN academic_years y ON y.year_id = t.year_id
     JOIN semesters s ON s.semester_id = sec.semester_id AND s.scheme_id = sec.scheme_id
     JOIN term_program_semesters tps ON tps.term_id = sec.term_id
       AND tps.scheme_id = sec.scheme_id AND tps.semester_id = sec.semester_id AND tps.is_active = 1
     JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
     WHERE fp.user_id = ? AND fp.is_active = 1
       AND s.is_active = 1 AND sec.is_active = 1
     ORDER BY y.year_label DESC, t.term_id DESC, p.program_name, s.semester_no`,
    [userId],
  );

  return rows
    .filter((row: any) => semesterMatchesParity(Number(row.semester_no), row.parity))
    .map((row: any) => ({
      ...row,
      year_id: Number(row.year_id),
      term_id: Number(row.term_id),
      program_id: Number(row.program_id),
      scheme_id: Number(row.scheme_id),
      semester_id: Number(row.semester_id),
      semester_no: Number(row.semester_no),
    }));
}

export async function listPublishedFacultySessions(userId: number, filter: FacultyTimetableFilter) {
  const [[term]]: any = await pool.query(
    'SELECT parity FROM terms WHERE term_id = ? AND year_id = ?',
    [filter.term_id, filter.year_id],
  );
  if (!term) return [];

  const [rows]: any = await pool.query(
    `SELECT DISTINCT ss.session_id, ss.\`day\`, ss.session_date, ss.start_time, ss.end_time,
            c.course_code, c.course_name, cc.component_type,
            r.room_code, r.room_name,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(sec2.section_name,
              IF(b2.batch_name IS NULL, '', CONCAT(' / ', b2.batch_name)))
              ORDER BY sec2.section_name SEPARATOR ', ')
             FROM session_audiences sa2
             JOIN faculty_assignments fa2 ON fa2.faculty_id = own.faculty_id
               AND fa2.is_approved = 1 AND fa2.role_status IN ('VERIFIED', 'RESOLVED')
             JOIN offering_audiences oa2 ON oa2.audience_id = fa2.audience_id
               AND oa2.offering_id = ss.offering_id
               AND oa2.section_id = sa2.section_id AND oa2.batch_id <=> sa2.batch_id
             JOIN sections sec2 ON sec2.section_id = sa2.section_id AND sec2.term_id = ss.term_id
             JOIN semesters sem2 ON sem2.semester_id = sec2.semester_id AND sem2.scheme_id = sec2.scheme_id
             LEFT JOIN batches b2 ON b2.batch_id = sa2.batch_id AND b2.section_id = sa2.section_id
             WHERE sa2.session_id = ss.session_id AND sa2.version_id = ss.version_id
               AND sem2.semester_id = ?) AS divisions,
            (SELECT GROUP_CONCAT(DISTINCT assigned.name ORDER BY assigned.name SEPARATOR ', ')
             FROM session_faculty sf2
             JOIN faculty_profiles assigned ON assigned.faculty_id = sf2.faculty_id
             WHERE sf2.session_id = ss.session_id AND sf2.version_id = ss.version_id) AS faculty_names
     FROM faculty_profiles own
     JOIN session_faculty sf ON sf.faculty_id = own.faculty_id
     JOIN scheduled_sessions ss ON ss.session_id = sf.session_id AND ss.version_id = sf.version_id
     JOIN timetable_versions tv ON tv.version_id = ss.version_id AND tv.status = 'PUBLISHED'
     JOIN terms t ON t.term_id = ss.term_id AND t.year_id = ?
     JOIN course_offerings co ON co.offering_id = ss.offering_id AND co.term_id = ss.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN courses c ON c.course_id = cc.course_id
     JOIN rooms r ON r.room_id = ss.room_id
     JOIN session_audiences sa ON sa.session_id = ss.session_id AND sa.version_id = ss.version_id
     JOIN sections sec ON sec.section_id = sa.section_id AND sec.term_id = ss.term_id
     JOIN semesters sem ON sem.semester_id = sec.semester_id AND sem.scheme_id = sec.scheme_id
     JOIN faculty_assignments fa ON fa.faculty_id = own.faculty_id
       AND fa.is_approved = 1 AND fa.role_status IN ('VERIFIED', 'RESOLVED')
     JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
       AND oa.offering_id = ss.offering_id
       AND oa.section_id = sa.section_id AND oa.batch_id <=> sa.batch_id
     WHERE own.user_id = ? AND own.is_active = 1
       AND t.term_id = ? AND t.parity = ?
       AND sem.semester_id = ? AND sem.semester_no IN (?)
     ORDER BY FIELD(ss.\`day\`, 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'), ss.start_time, ss.session_id`,
    [
      filter.semester_id,
      filter.year_id,
      userId,
      filter.term_id,
      term.parity,
      filter.semester_id,
      semestersForParity(term.parity),
    ],
  );
  return rows;
}
