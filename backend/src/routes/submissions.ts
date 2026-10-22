import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import { semestersForParity } from '../services/academicTermRules';
import { draftSchema, facultyIdForUser, loadDetail, requireTermProgramMappings, review, reviewSchema, saveDraft, submit, validateCurriculumSelection } from '../services/submissionService';
import { HttpError } from '../utils/errors';
import { missingRef, one, Row, rule } from '../utils/crud';
import { availabilityType, dataStatus, dayName, fk, paramId, timeStr } from '../utils/zodHelpers';

// ============ Faculty submissions (preferences + availability) ============
export const submissionsRouter = Router();
submissionsRouter.use(authenticate);
const own = requirePermission('faculty_submission:own');
const reviewer = requirePermission('faculty_submission:review');
const termQuery = z.object({ term_id: paramId }).strict();
const curriculumQuery = z.object({ term_id: paramId, program_id: paramId, semester_id: paramId }).strict();

// --- faculty: own submission only (identity comes from the session, never from the request) ---

submissionsRouter.get('/mine/profile', own, async (req, res, next) => {
  try {
    const [rows]: any = await pool.query(
      'SELECT * FROM faculty_profiles WHERE user_id = ? AND is_active = 1',
      [req.user!.userId]
    );
    res.json(ok(rows[0] ?? null));
  } catch (e) { next(e); }
});

submissionsRouter.get('/mine/term-program-semesters', own, async (req, res, next) => {
  try {
    const { term_id } = termQuery.parse(req.query);
    await requireTermProgramMappings(pool);
    const [[term]]: any = await pool.query(
      `SELECT t.term_id, t.status, t.parity, y.is_active AS year_active
       FROM terms t JOIN academic_years y ON y.year_id = t.year_id
       WHERE t.term_id = ?`,
      [term_id],
    );
    if (!term) throw missingRef('term');
    if (term.status !== 'ACTIVE' || !term.year_active) {
      throw rule('TERM_NOT_ACTIVE', 'Choose an active academic term');
    }
    const [rows]: any = await pool.query(
      `SELECT p.program_id, p.program_code, p.program_name, cs.scheme_id,
              s.semester_id, s.semester_no, s.name AS semester_name
       FROM term_program_semesters tps
       JOIN curriculum_schemes cs ON cs.scheme_id = tps.scheme_id AND cs.is_active = 1
       JOIN programs p ON p.program_id = cs.program_id AND p.is_active = 1
       JOIN departments d ON d.dept_id = p.dept_id AND d.is_active = 1
       JOIN semesters s ON s.semester_id = tps.semester_id AND s.scheme_id = tps.scheme_id AND s.is_active = 1
       WHERE tps.term_id = ? AND tps.is_active = 1 AND s.semester_no IN (?)
       ORDER BY p.program_name, s.semester_no`,
      [term_id, semestersForParity(term.parity)],
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * GET /api/faculty-submissions/mine/available-courses?term_id=X
 * Returns offered curriculum courses for one active term/program/semester, enriched with:
 *   - course details (code, name, credits, category, department)
 *   - all offered components (theory/lab/tutorial) with weekly_hours
 *   - only active term-program-semester mappings
 *   - offering count (how many sections/audiences this component serves)
 * Draft offerings and unmapped courses are excluded from faculty preferences.
 */
submissionsRouter.get('/mine/available-courses', own, async (req, res, next) => {
  try {
    const { term_id, program_id, semester_id } = curriculumQuery.parse(req.query);
    await validateCurriculumSelection(pool, term_id, program_id, semester_id);
    const [rows]: any = await pool.query(
      `SELECT DISTINCT
         c.course_id, c.course_name, c.course_code, c.credits, c.category,
         c.dept_id, d.dept_name,
         cc.component_id, cc.component_type, cc.weekly_hours, cc.periods_per_session,
         cc.is_consecutive, cc.required_room_type_id, rt.type_name AS required_room_type,
         p.program_id, p.program_name, p.program_code, sem.semester_no, sem.name AS semester_name,
         co.offering_id, co.status AS offering_status,
         (SELECT COUNT(*) FROM offering_audiences oa2 WHERE oa2.offering_id = co.offering_id) AS audience_count
       FROM course_offerings co
       JOIN course_components cc ON cc.component_id = co.component_id
       JOIN courses c ON c.course_id = cc.course_id
       JOIN curriculum_courses curriculum ON curriculum.course_id = c.course_id AND curriculum.semester_id = ?
       JOIN semesters sem ON sem.semester_id = curriculum.semester_id AND sem.is_active = 1
       JOIN curriculum_schemes sch ON sch.scheme_id = sem.scheme_id AND sch.program_id = ? AND sch.is_active = 1
       JOIN programs p ON p.program_id = sch.program_id AND p.is_active = 1
       JOIN term_program_semesters tps ON tps.term_id = co.term_id AND tps.scheme_id = sch.scheme_id
         AND tps.semester_id = sem.semester_id AND tps.is_active = 1
       LEFT JOIN departments d ON d.dept_id = c.dept_id
       LEFT JOIN room_types rt ON rt.room_type_id = cc.required_room_type_id
       WHERE co.term_id = ? AND co.status = 'OFFERED' AND c.is_active = 1
       ORDER BY c.course_name, cc.component_type`,
      [semester_id, program_id, term_id]
    );

    // Group components under each course
    const courseMap = new Map<number, any>();
    for (const row of rows) {
      if (!courseMap.has(row.course_id)) {
        courseMap.set(row.course_id, {
          course_id: row.course_id,
          course_name: row.course_name,
          course_code: row.course_code,
          credits: row.credits,
          category: row.category,
          dept_id: row.dept_id,
          dept_name: row.dept_name,
          programs: [{
            program_id: row.program_id,
            program_name: row.program_name,
            program_code: row.program_code,
            semester_no: row.semester_no,
            semester_name: row.semester_name,
          }],
          components: [],
        });
      }
      if (row.component_id) {
        const existing = courseMap.get(row.course_id)!;
        if (!existing.components.some((c: any) => c.component_id === row.component_id)) {
          existing.components.push({
            component_id: row.component_id,
            component_type: row.component_type,
            weekly_hours: row.weekly_hours,
            periods_per_session: row.periods_per_session,
            is_consecutive: row.is_consecutive,
            required_room_type: row.required_room_type,
            audience_count: row.audience_count,
          });
        }
      }
    }
    res.json(ok([...courseMap.values()]));
  } catch (e) { next(e); }
});

submissionsRouter.get('/mine/source-subjects', reviewer, async (_req, res, next) => {
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT wir.workload_import_row_id, wir.source_row_number, wir.source_page, wir.subjects
       FROM workload_import_rows wir
       JOIN workload_import_batches wib ON wib.batch_id = wir.batch_id
       WHERE wir.resolution_status <> 'SKIPPED'
       ORDER BY wir.source_row_number, wir.workload_import_row_id`,
    );
    const subjects = new Map<string, {
      source_row_id: number;
      source_row_number: number;
      source_page: number;
      source_column: string;
      source_label: string;
      weekly_hours: number | null;
      occurrences: number;
      verification_status: 'PENDING_ADMIN_VERIFICATION';
    }>();
    for (const row of rows) {
      const sourceSubjects = typeof row.subjects === 'string' ? JSON.parse(row.subjects) : row.subjects;
      for (const subject of sourceSubjects as Array<{ column: string; rawLabel: string | null; weeklyHours: number | null }>) {
        if (!subject.rawLabel?.trim()) continue;
        const key = subject.rawLabel.trim().toLowerCase();
        const existing = subjects.get(key);
        if (existing) {
          existing.occurrences += 1;
          continue;
        }
        subjects.set(key, {
          source_row_id: Number(row.workload_import_row_id),
          source_row_number: Number(row.source_row_number),
          source_page: Number(row.source_page),
          source_column: subject.column,
          source_label: subject.rawLabel,
          weekly_hours: subject.weeklyHours == null ? null : Number(subject.weeklyHours),
          occurrences: 1,
          verification_status: 'PENDING_ADMIN_VERIFICATION',
        });
      }
    }
    res.json(ok([...subjects.values()].sort((a, b) => a.source_label.localeCompare(b.source_label))));
  } catch (error) { next(error); }
});

/**
 * GET /api/faculty-submissions/mine/track?term_id=X
 * Returns the complete workflow status for the authenticated faculty member:
 *   - Submission details + preferences + availability
 *   - Approved assignments for this term
 *   - Workload summary
 *   - Audit trail (timeline of meaningful events from audit_logs)
 * Faculty only sees their own data (identity from session).
 */
submissionsRouter.get('/mine/track', own, async (req, res, next) => {
  try {
    const { term_id } = termQuery.parse(req.query);
    const facultyId = await facultyIdForUser(pool, req.user!.userId);

    // Submission detail (preferences + availability)
    const [[subRow]]: any = await pool.query(
      'SELECT submission_id FROM faculty_submissions WHERE faculty_id = ? AND term_id = ?',
      [facultyId, term_id]
    );
    const submissionDetail = subRow ? await loadDetail(subRow.submission_id) : null;

    // Approved assignments for this term
    const [assignments]: any = await pool.query(
      `SELECT
         fa.assignment_id, fa.role, fa.is_approved, fa.approved_by, fa.approved_at, fa.created_at,
         fa.source_preference_id,
         c.course_name, c.course_code,
         cc.component_type, cc.weekly_hours,
         s.section_name,
         b.batch_name,
         u.name AS approved_by_name
       FROM faculty_assignments fa
       JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
       JOIN course_offerings co ON co.offering_id = oa.offering_id
       JOIN course_components cc ON cc.component_id = co.component_id
       JOIN courses c ON c.course_id = cc.course_id
       JOIN sections s ON s.section_id = oa.section_id
       LEFT JOIN batches b ON b.batch_id = oa.batch_id
       LEFT JOIN users u ON u.user_id = fa.approved_by
       WHERE fa.faculty_id = ? AND co.term_id = ?
       ORDER BY fa.is_approved DESC, fa.created_at DESC`,
      [facultyId, term_id]
    );

    // Audit trail — events related to this faculty's submission and assignments
    // Combines faculty_submissions audit rows with faculty_assignments audit rows
    let auditTrail: any[] = [];
    if (subRow) {
      const [subAudit]: any = await pool.query(
        `SELECT al.action, al.details, al.created_at, u.name AS actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.user_id = al.actor_user_id
         WHERE al.table_name = 'faculty_submissions' AND al.record_id = ?
         ORDER BY al.created_at ASC`,
        [subRow.submission_id]
      );
      auditTrail = [...subAudit];
    }
    // Add assignment audit events for this faculty
    if (assignments.length > 0) {
      const assignmentIds = assignments.map((a: any) => a.assignment_id);
      const [assignAudit]: any = await pool.query(
        `SELECT al.action, al.details, al.created_at, u.name AS actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.user_id = al.actor_user_id
         WHERE al.table_name = 'faculty_assignments' AND al.record_id IN (?)
         ORDER BY al.created_at ASC`,
        [assignmentIds]
      );
      auditTrail = [...auditTrail, ...assignAudit];
      // Sort by time ascending
      auditTrail.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    res.json(ok({
      term_id,
      faculty_id: facultyId,
      submission: submissionDetail,
      assignments,
      audit_trail: auditTrail,
    }));
  } catch (e) { next(e); }
});

submissionsRouter.get('/mine', own, async (req, res, next) => {
  try {
    const { term_id } = termQuery.parse(req.query);
    const facultyId = await facultyIdForUser(pool, req.user!.userId);
    const [[row]]: any = await pool.query('SELECT submission_id FROM faculty_submissions WHERE faculty_id = ? AND term_id = ?', [facultyId, term_id]);
    res.json(ok(row ? await loadDetail(row.submission_id) : { submission: null, preferences: [], availability: [], unrecordedAvailability: 'UNKNOWN' }));
  } catch (e) { next(e); }
});

submissionsRouter.put('/mine', own, async (req, res, next) => {
  try {
    const input = draftSchema.parse(req.body);
    const id = await withTransaction(async (conn) => saveDraft(conn, req.user!.userId, await facultyIdForUser(conn, req.user!.userId), input));
    res.json(ok(await loadDetail(id)));
  } catch (e) { next(e); }
});

submissionsRouter.post('/mine/submit', own, async (req, res, next) => {
  try {
    const { term_id } = z.object({ term_id: fk }).strict().parse(req.body);
    const id = await withTransaction(async (conn) => submit(conn, req.user!.userId, await facultyIdForUser(conn, req.user!.userId), term_id));
    res.json(ok(await loadDetail(id)));
  } catch (e) { next(e); }
});

// --- department/admin review ---
const listQuery = z.object({
  term_id: paramId.optional(), faculty_id: paramId.optional(),
  submission_status: z.enum(['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'RETURNED']).optional(),
  review_status: z.enum(['PENDING', 'IN_REVIEW', 'ACCEPTED', 'CHANGES_REQUESTED']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
}).strict();

submissionsRouter.get('/', reviewer, async (req, res, next) => {
  try {
    const q: Row = listQuery.parse(req.query);
    const cols = ['term_id', 'faculty_id', 'submission_status', 'review_status'].filter((k) => q[k] !== undefined);
    const where = cols.length ? `WHERE ${cols.map(() => 's.?? = ?').join(' AND ')}` : '';
    const wp = cols.flatMap((k) => [k, q[k]]);
    const [rows]: any = await pool.query(
      `SELECT s.*, f.name AS faculty_name FROM faculty_submissions s JOIN faculty_profiles f ON f.faculty_id = s.faculty_id ${where} ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`,
      [...wp, q.limit, q.offset]);
    const [[c]]: any = await pool.query(`SELECT COUNT(*) AS total FROM faculty_submissions s ${where}`, wp);
    res.json({ ...ok(rows), meta: { total: c.total, limit: q.limit, offset: q.offset } });
  } catch (e) { next(e); }
});

submissionsRouter.get('/:id', reviewer, async (req, res, next) => {
  try {
    const d = await loadDetail(paramId.parse(req.params.id));
    if (!d) throw new HttpError(404, 'Submission not found', 'NOT_FOUND');
    res.json(ok(d));
  } catch (e) { next(e); }
});

submissionsRouter.post('/:id/review', reviewer, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const b = reviewSchema.parse(req.body);
    await withTransaction((conn) => review(conn, req.user!.userId, id, b.action, b.comment));
    res.json(ok(await loadDetail(id)));
  } catch (e) { next(e); }
});

// ============ Admin-entered faculty availability (explicit AVAILABLE / UNAVAILABLE / UNKNOWN) ============
export const facultyAvailabilityRouter = Router();
facultyAvailabilityRouter.use(authenticate, requirePermission('faculty_submission:review'));

const availCreate = z.object({
  faculty_id: fk, term_id: fk, day: dayName, start_time: timeStr, end_time: timeStr,
  availability_type: availabilityType, // explicit: no default, so nothing is silently AVAILABLE
  data_status: dataStatus.optional(),
}).strict();
const availUpdate = availCreate.omit({ faculty_id: true, term_id: true }).partial().strict();

async function assertNoOverlap(conn: any, m: Row, ignoreId: number) {
  if (m.end_time <= m.start_time) throw rule('TIME_ORDER', 'end_time must be after start_time');
  const [clash]: any = await conn.query(
    `SELECT faculty_availability_id FROM faculty_availability WHERE faculty_id = ? AND term_id = ? AND \`day\` = ?
     AND faculty_availability_id <> ? AND start_time < ? AND end_time > ? LIMIT 1`,
    [m.faculty_id, m.term_id, m.day, ignoreId, m.end_time, m.start_time]);
  if (clash.length) throw rule('AVAILABILITY_OVERLAP', 'Overlaps another availability window for this faculty member and day');
}

facultyAvailabilityRouter.get('/', async (req, res, next) => {
  try {
    const q = z.object({ faculty_id: paramId.optional(), term_id: paramId.optional(), availability_type: availabilityType.optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).default(0) }).strict().parse(req.query) as Row;
    const cols = ['faculty_id', 'term_id', 'availability_type'].filter((k) => q[k] !== undefined);
    const where = cols.length ? `WHERE ${cols.map(() => '?? = ?').join(' AND ')}` : '';
    const [rows]: any = await pool.query(`SELECT * FROM faculty_availability ${where} ORDER BY faculty_id, \`day\`, start_time LIMIT ? OFFSET ?`,
      [...cols.flatMap((k) => [k, q[k]]), q.limit, q.offset]);
    res.json(ok(rows));
  } catch (e) { next(e); }
});

facultyAvailabilityRouter.post('/', async (req, res, next) => {
  try {
    const b = availCreate.parse(req.body);
    const row = await withTransaction(async (conn) => {
      if (!(await one(conn, 'faculty_profiles', 'faculty_id', b.faculty_id))) throw missingRef('faculty member');
      const term = await one(conn, 'terms', 'term_id', b.term_id);
      if (!term) throw missingRef('term');
      if (term.status === 'CLOSED') throw rule('TERM_CLOSED', 'This term is closed');
      await assertNoOverlap(conn, b, 0);
      const [r]: any = await conn.query("INSERT INTO faculty_availability SET ?, source = 'ADMIN_ENTRY'", [b]);
      await audit(conn, req.user!.userId, 'FACULTY_AVAILABILITY_ENTERED', 'faculty_availability', r.insertId, { faculty_id: b.faculty_id, type: b.availability_type });
      return one(conn, 'faculty_availability', 'faculty_availability_id', r.insertId);
    });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

async function adminEntryOnly(conn: any, id: number): Promise<Row> {
  const [rows]: any = await conn.query('SELECT * FROM faculty_availability WHERE faculty_availability_id = ? FOR UPDATE', [id]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
  if (row.source !== 'ADMIN_ENTRY') throw new HttpError(409, 'Faculty-submitted availability can only change through the submission (return it for correction)', 'NOT_ADMIN_ENTRY');
  return row;
}

facultyAvailabilityRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const b = availUpdate.parse(req.body);
    if (Object.keys(b).length === 0) throw new HttpError(400, 'No updatable fields supplied', 'EMPTY_UPDATE');
    const row = await withTransaction(async (conn) => {
      const existing = await adminEntryOnly(conn, id);
      await assertNoOverlap(conn, { ...existing, ...b }, id);
      await conn.query('UPDATE faculty_availability SET ? WHERE faculty_availability_id = ?', [b, id]);
      await audit(conn, req.user!.userId, 'FACULTY_AVAILABILITY_CHANGED', 'faculty_availability', id, b);
      return one(conn, 'faculty_availability', 'faculty_availability_id', id);
    });
    res.json(ok(row));
  } catch (e) { next(e); }
});

facultyAvailabilityRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    await withTransaction(async (conn) => {
      await adminEntryOnly(conn, id);
      await conn.query('DELETE FROM faculty_availability WHERE faculty_availability_id = ?', [id]);
      await audit(conn, req.user!.userId, 'FACULTY_AVAILABILITY_DELETED', 'faculty_availability', id);
    });
    res.json(ok({ deleted: id }));
  } catch (e) { next(e); }
});
