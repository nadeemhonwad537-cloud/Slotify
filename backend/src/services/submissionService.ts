import { PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db/pool';
import { HttpError } from '../utils/errors';
import { missingRef, one, Row, rule } from '../utils/crud';
import { availabilityType, dayName, fk, timeStr } from '../utils/zodHelpers';
import { audit } from './audit';
import { MAX_PREFERENCES, validatePreferenceRequests } from './preferenceValidation';
import { assertRequiredPreferenceCount, assertReviewActionAllowed, validateAvailabilityWindows } from './submissionRules';

/** Business limit from the requirements. It is also enforced structurally in MySQL (CHECK 1..3 + unique order). */
export { MAX_PREFERENCES } from './preferenceValidation';

export const draftSchema = z.object({
  term_id: fk,
  program_id: fk,
  semester_id: fk,
  preferences: z.array(z.union([
    z.object({
      course_id: fk, component_id: fk.nullable().optional(), note: z.string().trim().min(1).max(255).nullable().optional(),
    }).strict(),
    z.object({
      source_row_id: fk,
      subject_column: z.enum(['Subject-I', 'Subject-II', 'Subject-III']),
      note: z.string().trim().min(1).max(255).nullable().optional(),
    }).strict(),
  ])).max(MAX_PREFERENCES, `At most ${MAX_PREFERENCES} preferences are allowed`),
  availability: z.array(z.object({ day: dayName, start_time: timeStr, end_time: timeStr, availability_type: availabilityType }).strict()).max(200),
}).strict();
export type DraftInput = z.infer<typeof draftSchema>;

export const reviewSchema = z.object({
  action: z.enum(['START_REVIEW', 'ACCEPT', 'RETURN']),
  comment: z.string().trim().min(1).max(2000).optional(),
}).strict();

/** Resolves the logged-in user to their faculty profile. Faculty only ever act on their own submission. */
export async function facultyIdForUser(conn: PoolConnection | typeof pool, userId: number): Promise<number> {
  const [rows]: any = await conn.query('SELECT faculty_id FROM faculty_profiles WHERE user_id = ? AND is_active = 1', [userId]);
  if (!rows[0]) throw new HttpError(403, 'Your account is not linked to an active faculty profile', 'NO_FACULTY_PROFILE');
  return rows[0].faculty_id;
}

async function openTerm(conn: PoolConnection, termId: number): Promise<Row> {
  const term = await one(conn, 'terms', 'term_id', termId);
  if (!term) throw missingRef('term');
  if (term.status === 'CLOSED') throw rule('TERM_CLOSED', 'This term is closed; submissions can no longer change');
  return term;
}

export async function requireTermProgramMappings(conn: PoolConnection | typeof pool) {
  const [tables]: any = await conn.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'term_program_semesters'`,
  );
  if (!tables.length) {
    throw new HttpError(503, 'Faculty preferences require migration 005 and an active term-program-semester configuration. Ask an administrator to complete academic setup.', 'TERM_SEMESTER_MAPPING_REQUIRED');
  }
  const [columns]: any = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'faculty_subject_preferences' AND column_name = 'semester_id'`,
  );
  if (!columns.length) {
    throw new HttpError(503, 'Faculty preference curriculum context requires migration 007. Ask an administrator to apply pending migrations before saving or reviewing preferences.', 'PREFERENCE_CONTEXT_MIGRATION_REQUIRED');
  }
}

export async function validateCurriculumSelection(
  conn: PoolConnection | typeof pool,
  termId: number,
  programId: number,
  semesterId: number,
) {
  await requireTermProgramMappings(conn);
  const [rows]: any = await conn.query(
    `SELECT t.term_id
     FROM terms t
     JOIN academic_years y ON y.year_id = t.year_id
     JOIN term_program_semesters tps ON tps.term_id = t.term_id AND tps.is_active = 1
     JOIN semesters s ON s.semester_id = tps.semester_id AND s.is_active = 1
     JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id AND cs.scheme_id = tps.scheme_id AND cs.is_active = 1
     JOIN programs p ON p.program_id = cs.program_id AND p.is_active = 1
     JOIN departments d ON d.dept_id = p.dept_id AND d.is_active = 1
     WHERE t.term_id = ? AND t.status = 'ACTIVE' AND y.is_active = 1
       AND p.program_id = ? AND s.semester_id = ?
     LIMIT 1`,
    [termId, programId, semesterId],
  );
  if (!rows.length) {
    throw rule('TERM_CURRICULUM_NOT_APPLICABLE', 'Select an active program and semester configured for the selected academic term');
  }
}

async function lockSubmission(conn: PoolConnection, facultyId: number, termId: number, create: boolean): Promise<Row | null> {
  if (create) await conn.query('INSERT IGNORE INTO faculty_submissions (faculty_id, term_id) VALUES (?, ?)', [facultyId, termId]);
  const [rows]: any = await conn.query('SELECT * FROM faculty_submissions WHERE faculty_id = ? AND term_id = ? FOR UPDATE', [facultyId, termId]);
  return rows[0] ?? null;
}

async function validatePublishedCoursePreference(
  conn: PoolConnection,
  termId: number,
  programId: number,
  semesterId: number,
  courseId: number,
  componentId: number | null,
) {
  const [eligible]: any = await conn.query(
    `SELECT c.course_id
     FROM courses c
     JOIN curriculum_courses cc ON cc.course_id = c.course_id AND cc.semester_id = ?
     JOIN semesters s ON s.semester_id = cc.semester_id
     JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id AND cs.program_id = ?
     JOIN course_components component ON component.course_id = c.course_id
       AND (? IS NULL OR component.component_id = ?)
     JOIN course_offerings co ON co.component_id = component.component_id AND co.term_id = ? AND co.status = 'OFFERED'
     JOIN term_program_semesters tps ON tps.term_id = co.term_id AND tps.scheme_id = cs.scheme_id
       AND tps.semester_id = s.semester_id AND tps.is_active = 1
     WHERE c.course_id = ? AND c.is_active = 1
       AND s.is_active = 1 AND cs.is_active = 1 AND cs.program_id = ?
     LIMIT 1 FOR UPDATE`,
    [semesterId, programId, componentId, componentId, termId, courseId, programId],
  );
  if (eligible.length) return;

  const course = await one(conn, 'courses', 'course_id', courseId);
  if (!course) throw missingRef('course');
  const component = componentId == null
    ? null
    : await one(conn, 'course_components', 'component_id', componentId);
  if (componentId != null && (!component || component.course_id !== courseId)) {
    throw rule('COMPONENT_COURSE_MISMATCH', 'The selected component does not belong to this course');
  }
  if (!course.is_active) throw rule('COURSE_INACTIVE', `Course "${course.course_name}" is not active`);
  throw rule('SUBJECT_NOT_PUBLISHED_FOR_TERM', 'Each preference must be an offered component in the selected program, semester and term');
}

/** Replaces the faculty member's draft (preferences + availability) atomically. */
export async function saveDraft(conn: PoolConnection, userId: number, facultyId: number, input: DraftInput) {
  await openTerm(conn, input.term_id);
  await validateCurriculumSelection(conn, input.term_id, input.program_id, input.semester_id);
  const sub = (await lockSubmission(conn, facultyId, input.term_id, true))!;
  if (sub.submission_status === 'SUBMITTED') throw new HttpError(409, 'A submitted form is locked until the department returns it', 'SUBMISSION_LOCKED');

  // --- preferences (backend limit, in addition to the database CHECK) ---
  if (input.preferences.length > MAX_PREFERENCES) throw new HttpError(400, `At most ${MAX_PREFERENCES} preferences are allowed`, 'TOO_MANY_PREFERENCES');
  const rankedPreferences = validatePreferenceRequests(input.preferences);
  for (const p of input.preferences) {
    if ('course_id' in p) {
      await validatePublishedCoursePreference(
        conn, input.term_id, input.program_id, input.semester_id, p.course_id, p.component_id ?? null,
      );
    } else {
      throw rule('SUBJECT_NOT_PUBLISHED_FOR_TERM', 'Only published curriculum subjects can be requested. Unverified workload labels are not eligible.');
    }
  }

  // --- availability: explicit states only; unrecorded time stays UNKNOWN ---
  const rows = [...input.availability];
  validateAvailabilityWindows(rows);
  const [others]: any = await conn.query(
    `SELECT \`day\`, start_time, end_time FROM faculty_availability
     WHERE faculty_id = ? AND term_id = ? AND NOT (source = 'FACULTY_SUBMISSION' AND submission_id = ?)`,
    [facultyId, input.term_id, sub.submission_id]);
  for (const a of rows) if (others.some((o: any) => o.day === a.day && a.start_time < o.end_time && o.start_time < a.end_time)) {
    throw rule('AVAILABILITY_OVERLAP', 'A window overlaps availability the department already entered for you');
  }

  await conn.query('DELETE FROM faculty_subject_preferences WHERE submission_id = ?', [sub.submission_id]);
  await conn.query('DELETE FROM faculty_source_subject_preferences WHERE submission_id = ?', [sub.submission_id]);
  for (const { preference: p, preference_order } of rankedPreferences) {
    if ('course_id' in p) {
      await conn.query('INSERT INTO faculty_subject_preferences (submission_id, preference_order, course_id, semester_id, component_id, note) VALUES (?, ?, ?, ?, ?, ?)',
        [sub.submission_id, preference_order, p.course_id, input.semester_id, p.component_id ?? null, p.note ?? null]);
    } else {
      throw rule('SUBJECT_NOT_PUBLISHED_FOR_TERM', 'Only published curriculum subjects can be requested. Unverified workload labels are not eligible.');
    }
  }
  await conn.query("DELETE FROM faculty_availability WHERE submission_id = ? AND source = 'FACULTY_SUBMISSION'", [sub.submission_id]);
  for (const a of rows) {
    await conn.query(
      "INSERT INTO faculty_availability (faculty_id, term_id, submission_id, source, `day`, start_time, end_time, availability_type, data_status) VALUES (?, ?, ?, 'FACULTY_SUBMISSION', ?, ?, ?, ?, 'VERIFY')",
      [facultyId, input.term_id, sub.submission_id, a.day, a.start_time, a.end_time, a.availability_type]);
  }
  if (sub.submission_status === 'NOT_STARTED') await conn.query("UPDATE faculty_submissions SET submission_status = 'DRAFT' WHERE submission_id = ?", [sub.submission_id]);
  await audit(conn, userId, 'SUBMISSION_DRAFT_SAVED', 'faculty_submissions', sub.submission_id,
    {
      preferences: input.preferences.filter(preference => 'course_id' in preference).length,
      pendingSourcePreferences: 0,
      availabilityWindows: rows.length,
    });
  return sub.submission_id as number;
}

export async function submit(conn: PoolConnection, userId: number, facultyId: number, termId: number) {
  await openTerm(conn, termId);
  const sub = await lockSubmission(conn, facultyId, termId, false);
  if (!sub || sub.submission_status === 'NOT_STARTED') throw new HttpError(409, 'Save your preferences and availability before submitting', 'NOTHING_TO_SUBMIT');
  if (sub.submission_status === 'SUBMITTED') throw new HttpError(409, 'This form has already been submitted', 'INVALID_STATE');

  // Exactly 3 preferences are required at submission time (drafts may have fewer)
  const [prefRows]: any = await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM faculty_subject_preferences WHERE submission_id = ?) +
       (SELECT COUNT(*) FROM faculty_source_subject_preferences WHERE submission_id = ?) AS n`,
    [sub.submission_id, sub.submission_id]);
  const prefCount = Number(prefRows[0]?.n ?? 0);
  assertRequiredPreferenceCount(prefCount);
  await requireTermProgramMappings(conn);
  const [sourcePreferences]: any = await conn.query(
    'SELECT source_preference_id FROM faculty_source_subject_preferences WHERE submission_id = ? LIMIT 1',
    [sub.submission_id],
  );
  if (sourcePreferences.length) {
    throw rule('SUBJECT_NOT_PUBLISHED_FOR_TERM', 'Only published curriculum subjects can be submitted as preferences');
  }
  const [preferences]: any = await conn.query(
    'SELECT course_id, component_id, semester_id FROM faculty_subject_preferences WHERE submission_id = ? ORDER BY preference_order FOR UPDATE',
    [sub.submission_id],
  );
  const semesterIds = [...new Set(preferences.map((preference: Row) => preference.semester_id).filter((id: number | null) => id != null))];
  if (preferences.some((preference: Row) => preference.semester_id == null) || semesterIds.length !== 1) {
    throw rule('PREFERENCE_CONTEXT_REQUIRED', 'Save all preferences again under one active program and semester before submitting');
  }
  const semesterId = Number(semesterIds[0]);
  const [[context]]: any = await conn.query(
    `SELECT cs.program_id
     FROM semesters s JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id
     WHERE s.semester_id = ?`,
    [semesterId],
  );
  if (!context) throw missingRef('preference semester');
  await validateCurriculumSelection(conn, termId, context.program_id, semesterId);
  for (const preference of preferences) {
    await validatePublishedCoursePreference(
      conn, termId, context.program_id, semesterId, preference.course_id, preference.component_id,
    );
  }

  await conn.query(
    `UPDATE faculty_submissions SET submission_status = 'SUBMITTED', submitted_at = UTC_TIMESTAMP(), review_status = 'PENDING',
     reviewed_by = NULL, reviewed_at = NULL, review_comment = NULL WHERE submission_id = ?`, [sub.submission_id]);
  await audit(conn, userId, 'SUBMISSION_SUBMITTED', 'faculty_submissions', sub.submission_id,
    { resubmission: sub.submission_status === 'RETURNED', previousReviewComment: sub.review_comment ?? null });
  return sub.submission_id as number;
}

/** Department review: START_REVIEW, ACCEPT or RETURN (return-for-correction). Preferences stay requests; nothing is assigned here. */
export async function review(conn: PoolConnection, reviewerUserId: number, submissionId: number, action: 'START_REVIEW' | 'ACCEPT' | 'RETURN', comment?: string) {
  const [rows]: any = await conn.query('SELECT * FROM faculty_submissions WHERE submission_id = ? FOR UPDATE', [submissionId]);
  const sub: Row | undefined = rows[0];
  if (!sub) throw new HttpError(404, 'Submission not found', 'NOT_FOUND');
  const [own]: any = await conn.query('SELECT 1 FROM faculty_profiles WHERE faculty_id = ? AND user_id = ?', [sub.faculty_id, reviewerUserId]);
  if (own.length) throw new HttpError(403, 'You cannot review your own submission', 'SELF_REVIEW');
  assertReviewActionAllowed(sub.submission_status, sub.review_status, action);

  if (action === 'START_REVIEW') {
    await conn.query("UPDATE faculty_submissions SET review_status = 'IN_REVIEW', reviewed_by = ? WHERE submission_id = ?", [reviewerUserId, submissionId]);
  } else if (action === 'ACCEPT') {
    await conn.query("UPDATE faculty_submissions SET review_status = 'ACCEPTED', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_comment = ? WHERE submission_id = ?",
      [reviewerUserId, comment ?? null, submissionId]);
  } else {
    if (!comment) throw new HttpError(400, 'A comment explaining what to correct is required when returning a form', 'COMMENT_REQUIRED');
    await conn.query(
      "UPDATE faculty_submissions SET submission_status = 'RETURNED', review_status = 'CHANGES_REQUESTED', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_comment = ? WHERE submission_id = ?",
      [reviewerUserId, comment, submissionId]);
  }
  await audit(conn, reviewerUserId, `SUBMISSION_${action}`, 'faculty_submissions', submissionId, { comment: comment ?? null });
  return submissionId;
}

/** Submission with its preferences and availability. Unrecorded time is reported as UNKNOWN, never AVAILABLE. */
export async function loadDetail(submissionId: number) {
  await requireTermProgramMappings(pool);
  const [[submission]]: any = await pool.query(
    `SELECT fs.*, reviewer.name AS reviewer_name
     FROM faculty_submissions fs LEFT JOIN users reviewer ON reviewer.user_id = fs.reviewed_by
     WHERE fs.submission_id = ?`,
    [submissionId],
  );
  if (!submission) return null;
  const [coursePreferences]: any = await pool.query(
    `SELECT 'COURSE' AS preference_kind, p.preference_id, p.preference_order, p.course_id, p.semester_id, c.course_name, c.course_code,
            p.component_id, cc.component_type, cc.weekly_hours, p.note, pr.program_id, pr.program_code, pr.program_name,
            sem.semester_no, sem.name AS semester_name, NULL AS source_row_id, NULL AS source_subject_column,
            NULL AS source_page, NULL AS source_row_number, NULL AS source_label, NULL AS source_hours
     FROM faculty_subject_preferences p JOIN courses c ON c.course_id = p.course_id
     LEFT JOIN course_components cc ON cc.component_id = p.component_id
     LEFT JOIN semesters sem ON sem.semester_id = p.semester_id
     LEFT JOIN curriculum_schemes sch ON sch.scheme_id = sem.scheme_id
     LEFT JOIN programs pr ON pr.program_id = sch.program_id
     WHERE p.submission_id = ? ORDER BY p.preference_order`, [submissionId]);
  const [sourcePreferences]: any = await pool.query(
    `SELECT 'SOURCE' AS preference_kind, p.source_preference_id AS preference_id, p.preference_order,
            NULL AS course_id, NULL AS semester_id, NULL AS course_name, NULL AS course_code, NULL AS component_id, NULL AS component_type, NULL AS weekly_hours,
            p.note, NULL AS program_id, NULL AS program_code, NULL AS program_name, NULL AS semester_no, NULL AS semester_name,
            p.workload_import_row_id AS source_row_id, p.subject_column AS source_subject_column,
            wir.source_page, wir.source_row_number, source_subject.label AS source_label,
            source_subject.hours AS source_hours
     FROM faculty_source_subject_preferences p
     JOIN workload_import_rows wir ON wir.workload_import_row_id = p.workload_import_row_id
     JOIN JSON_TABLE(wir.subjects, '$[*]' COLUMNS (
       subject_column VARCHAR(32) PATH '$.column',
       label VARCHAR(255) PATH '$.rawLabel',
       hours DECIMAL(5,2) PATH '$.weeklyHours' NULL ON EMPTY
     )) AS source_subject ON source_subject.subject_column COLLATE utf8mb4_unicode_ci
       = p.subject_column COLLATE utf8mb4_unicode_ci
     WHERE p.submission_id = ?`,
     [submissionId]);
  const preferences = [...coursePreferences, ...sourcePreferences]
    .sort((a: any, b: any) => a.preference_order - b.preference_order);
  const [availability]: any = await pool.query(
    'SELECT faculty_availability_id, `day`, start_time, end_time, availability_type, source, data_status FROM faculty_availability WHERE submission_id = ? ORDER BY FIELD(`day`,\'MON\',\'TUE\',\'WED\',\'THU\',\'FRI\',\'SAT\',\'SUN\'), start_time',
    [submissionId]);
  return { submission, preferences, availability, unrecordedAvailability: 'UNKNOWN' as const };
}
