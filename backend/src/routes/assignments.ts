/**
 * Assignments API — Milestone 3.
 *
 * Manages faculty_assignments and context-scoped allocation planning/finalization.
 * Workload is revalidated on every write (create / change role / approve).
 *
 * Permissions:
 *   assignments:manage  — ADMIN (seed); create, change, approve, delete.
 *   masterdata:read     — list and get (ADMIN + FACULTY in seed).
 *   faculty_submission:own — faculty view of their own approved assignments.
 *
 * Routes:
 *   GET    /api/assignments                    list (assignments:manage or own via ?faculty_id)
 *   GET    /api/assignments/:id                get one
 *   POST   /api/assignments                    create
 *   PATCH  /api/assignments/:id                change role / source_preference_id
 *   POST   /api/assignments/:id/approve        approve (sets is_approved=1)
 *   DELETE /api/assignments/:id                delete (only unapproved)
 *   GET    /api/assignments/workload           workload summary for a faculty+term
 *   GET    /api/assignments/allocation/contexts configured allocation contexts
 *   GET    /api/assignments/allocation/plan    curriculum requirements and workload for a section
 *   POST   /api/assignments/allocation/validate validate allocation coverage
 *   POST   /api/assignments/allocation/finalize validate and approve section draft assignments
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import {
  AllocationRequirementInput,
  validateAllocationRequirements,
  validateWorkloadReadiness,
} from '../services/allocationRules';
import { assertWorkloadOk, computeWorkload } from '../services/workloadService';
import { missingRef, one, Row, rule } from '../utils/crud';
import { HttpError } from '../utils/errors';
import { dataStatus, fk, paramId } from '../utils/zodHelpers';

export const assignmentsRouter = Router();
assignmentsRouter.use(authenticate);

const canManage = requirePermission('assignments:manage');
const canRead = requirePermission('assignments:manage', 'masterdata:read', 'faculty_submission:own');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const ROLES = ['UNSPECIFIED', 'LECTURER', 'LAB_LEAD', 'LAB_ASSISTANT', 'TUTOR'] as const;

const createSchema = z
  .object({
    audience_id: fk,
    faculty_id: fk,
    role: z.enum(ROLES).optional(),
    role_status: dataStatus.optional(),
    source_preference_id: fk.nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    audience_id: fk.optional(),
    faculty_id: fk.optional(),
    role: z.enum(ROLES).optional(),
    role_status: dataStatus.optional(),
    source_preference_id: fk.nullable().optional(),
  })
  .partial()
  .strict();

const listQuery = z
  .object({
    faculty_id: paramId.optional(),
    audience_id: paramId.optional(),
    term_id: paramId.optional(),
    is_approved: z
      .enum(['0', '1'])
      .transform((v) => Number(v))
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const workloadQuery = z
  .object({
    faculty_id: paramId,
    term_id: paramId,
  })
  .strict();

const allocationContextSchema = z.object({
  term_id: paramId,
  program_id: paramId,
  scheme_id: paramId,
  semester_id: paramId,
  section_id: paramId,
}).strict();

type AllocationContext = z.infer<typeof allocationContextSchema>;

async function requireAllocationSchema(db: any) {
  const [rows]: any = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'term_program_semesters') AS has_term_mapping,
       EXISTS (SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faculty_subject_preferences'
           AND COLUMN_NAME = 'semester_id') AS has_preference_semester`,
  );
  if (Number(rows[0]?.has_term_mapping) !== 1 || Number(rows[0]?.has_preference_semester) !== 1) {
    throw new HttpError(503, 'Faculty allocation requires database migrations 005 (term-program-semester mapping) and 007 (preference semester context). Apply the missing migration before allocating.', 'ALLOCATION_SCHEMA_REQUIRED');
  }
}

async function validateAllocationContext(db: any, context: AllocationContext): Promise<Row> {
  await requireAllocationSchema(db);
  const [rows]: any = await db.query(
    `SELECT t.term_id, t.term_name, t.status AS term_status, y.year_label,
            p.program_id, p.program_name, p.program_code,
            cs.scheme_id, cs.scheme_code, s.semester_id, s.semester_no, s.name AS semester_name,
            sec.section_id, sec.section_name, sec.strength, sec.data_status AS section_data_status
     FROM sections sec
     JOIN terms t ON t.term_id = sec.term_id
     JOIN academic_years y ON y.year_id = t.year_id
     JOIN term_program_semesters tps
       ON tps.term_id = t.term_id AND tps.scheme_id = sec.scheme_id AND tps.semester_id = sec.semester_id
     JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
     JOIN semesters s ON s.semester_id = sec.semester_id AND s.scheme_id = sec.scheme_id
     WHERE sec.term_id = ? AND p.program_id = ? AND cs.scheme_id = ?
       AND s.semester_id = ? AND sec.section_id = ?
       AND y.is_active = 1 AND p.is_active = 1 AND cs.is_active = 1
       AND s.is_active = 1 AND tps.is_active = 1 AND sec.is_active = 1
     LIMIT 1`,
    [context.term_id, context.program_id, context.scheme_id, context.semester_id, context.section_id],
  );
  if (!rows[0]) {
    throw new HttpError(422, 'Select an active term, mapped program semester, and section from the configured academic structure.', 'INVALID_ALLOCATION_CONTEXT');
  }
  if (rows[0].term_status === 'CLOSED') {
    throw new HttpError(422, 'Allocations cannot be changed for a closed academic term.', 'TERM_CLOSED');
  }
  return rows[0];
}

async function loadAllocationPlan(db: any, context: AllocationContext) {
  const academicContext = await validateAllocationContext(db, context);
  const [requirementRows]: any = await db.query(
    `SELECT c.course_id, c.course_name, c.course_code, c.data_status AS course_data_status, cur.is_elective,
            cc.component_id, cc.component_type, cc.weekly_hours, cc.periods_per_session,
            cc.is_consecutive, cc.data_status AS component_data_status,
            rt.type_name AS required_room_type,
            co.offering_id, co.status AS offering_status, co.data_status AS offering_data_status,
            oa.audience_id, oa.section_id, oa.batch_id, oa.strength,
            oa.data_status AS audience_data_status, b.batch_name, b.is_active AS batch_is_active,
            (
              SELECT COUNT(*) FROM faculty_submissions fs
              WHERE fs.term_id = ? AND fs.submission_status = 'SUBMITTED'
                AND fs.review_status = 'ACCEPTED'
                AND EXISTS (
                  SELECT 1 FROM faculty_subject_preferences pref
                  WHERE pref.submission_id = fs.submission_id
                    AND pref.course_id = c.course_id AND pref.semester_id = ?
                )
            ) AS accepted_preference_count
     FROM curriculum_courses cur
     JOIN courses c ON c.course_id = cur.course_id
     LEFT JOIN course_components cc ON cc.course_id = c.course_id
     LEFT JOIN room_types rt ON rt.room_type_id = cc.required_room_type_id
     LEFT JOIN course_offerings co
       ON co.component_id = cc.component_id AND co.term_id = ? AND co.status <> 'CANCELLED'
     LEFT JOIN offering_audiences oa
       ON oa.offering_id = co.offering_id AND oa.term_id = co.term_id AND oa.section_id = ?
     LEFT JOIN batches b ON b.batch_id = oa.batch_id AND b.section_id = oa.section_id
     WHERE cur.scheme_id = ? AND cur.semester_id = ?
       AND (cur.is_elective = 0 OR co.offering_id IS NOT NULL)
     ORDER BY c.course_name, cc.component_type, co.offering_id, oa.batch_id`,
    [context.term_id, context.semester_id, context.term_id, context.section_id, context.scheme_id, context.semester_id],
  );
  const [invalidAudienceRows]: any = await db.query(
    `SELECT oa.audience_id, c.course_name, cc.component_type
     FROM offering_audiences oa
     JOIN course_offerings co ON co.offering_id = oa.offering_id AND co.term_id = oa.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN courses c ON c.course_id = cc.course_id
     JOIN sections sec ON sec.section_id = oa.section_id
     WHERE oa.term_id = ? AND oa.section_id = ? AND co.status <> 'CANCELLED'
       AND NOT EXISTS (
         SELECT 1 FROM curriculum_courses cur
         WHERE cur.course_id = c.course_id AND cur.scheme_id = sec.scheme_id AND cur.semester_id = sec.semester_id
       )`,
    [context.term_id, context.section_id],
  );

  const audienceIds = requirementRows
    .map((row: Row) => row.audience_id)
    .filter((id: number | null) => id != null);
  const assignmentsByAudience = new Map<number, Row[]>();
  if (audienceIds.length) {
    const [assignmentRows]: any = await db.query(
      `SELECT fa.assignment_id, fa.audience_id, fa.faculty_id, fa.role, fa.role_status, fa.created_at,
              fa.source_preference_id, fa.is_approved, fa.role_status,
              fp.name AS faculty_name, fp.data_status AS faculty_data_status,
              fp.staff_code, fp.is_active, d.designation_name,
              EXISTS (
                SELECT 1 FROM faculty_availability fav
                WHERE fav.faculty_id = fp.faculty_id AND fav.term_id = ?
                  AND fav.availability_type = 'AVAILABLE'
                  AND fav.data_status IN ('VERIFIED','RESOLVED')
              ) AS availability_confirmed,
              EXISTS (
                SELECT 1 FROM faculty_submissions fs
                WHERE fs.faculty_id = fp.faculty_id AND fs.term_id = ?
                  AND fs.submission_status = 'SUBMITTED' AND fs.review_status = 'ACCEPTED'
              ) AS accepted_preferences_exist
       FROM faculty_assignments fa
       JOIN faculty_profiles fp ON fp.faculty_id = fa.faculty_id
       LEFT JOIN designations d ON d.designation_id = fp.designation_id
       WHERE fa.audience_id IN (?)`,
       [context.term_id, context.term_id, audienceIds],
    );
    for (const row of assignmentRows) {
      const group = assignmentsByAudience.get(row.audience_id) ?? [];
      group.push(row);
      assignmentsByAudience.set(row.audience_id, group);
    }
  }

  const [preferenceRows]: any = await db.query(
    `SELECT fs.faculty_id, pref.preference_id, pref.course_id, pref.component_id, pref.preference_order
     FROM faculty_subject_preferences pref
     JOIN faculty_submissions fs ON fs.submission_id = pref.submission_id
     WHERE fs.term_id = ? AND fs.submission_status = 'SUBMITTED'
       AND fs.review_status = 'ACCEPTED' AND pref.semester_id = ?
     ORDER BY fs.faculty_id, pref.course_id, (pref.component_id IS NOT NULL) DESC, pref.preference_order`,
    [context.term_id, context.semester_id],
  );
  const preferenceByFacultyCourseComponent = new Map<string, number>();
  for (const pref of preferenceRows) {
    const key = `${pref.faculty_id}:${pref.course_id}:${pref.component_id ?? 0}`;
    if (!preferenceByFacultyCourseComponent.has(key)) {
      preferenceByFacultyCourseComponent.set(key, pref.preference_order);
    }
  }
  const requirementEntries = requirementRows.map((row: Row) => {
    const assignments = row.audience_id == null ? [] : (assignmentsByAudience.get(row.audience_id) ?? []);
    const matchingPreferences = preferenceRows.filter((pref: Row) =>
      pref.course_id === row.course_id &&
      (pref.component_id === row.component_id || pref.component_id == null));
    const preferredFaculty = new Map<number, { preference_rank: number; preference_id: number }>();
    for (const pref of matchingPreferences) {
      if (!preferredFaculty.has(pref.faculty_id)) {
        preferredFaculty.set(pref.faculty_id, {
          preference_rank: pref.preference_order,
          preference_id: pref.preference_id,
        });
      }
    }
    const invalidStatuses = [
      academicContext.section_data_status,
      row.course_data_status,
      row.component_data_status,
      row.offering_data_status,
      row.audience_data_status,
    ]
      .filter((status: string | null) => status && status !== 'VERIFIED' && status !== 'RESOLVED');
    return {
      ...row,
      component_type: row.component_type ?? 'COMPONENT NOT CONFIGURED',
      weekly_hours: row.weekly_hours == null ? null : Number(row.weekly_hours),
      data_status: invalidStatuses.join(' / ') || 'VERIFIED',
      accepted_preference_count: Number(row.accepted_preference_count ?? 0),
      preferred_faculty: [...preferredFaculty.entries()]
        .map(([faculty_id, preference]) => ({ faculty_id, ...preference }))
        .sort((a, b) => a.preference_rank - b.preference_rank),
      assignments: assignments.map((assignment: Row) => ({
        ...assignment,
        preference_rank:
          preferenceByFacultyCourseComponent.get(`${assignment.faculty_id}:${row.course_id}:${row.component_id}`)
          ?? preferenceByFacultyCourseComponent.get(`${assignment.faculty_id}:${row.course_id}:0`)
          ?? null,
      })),
    };
  });

  const [activeFaculty]: any = await db.query(
    `SELECT fp.faculty_id, fp.name AS faculty_name, fp.staff_code, fp.is_active,
            fp.data_status AS faculty_data_status,
            d.designation_name,
            EXISTS (SELECT 1 FROM faculty_availability fav
              WHERE fav.faculty_id = fp.faculty_id AND fav.term_id = ?
                AND fav.availability_type = 'AVAILABLE'
                AND fav.data_status IN ('VERIFIED','RESOLVED')) AS availability_confirmed,
            EXISTS (SELECT 1 FROM faculty_submissions fs WHERE fs.faculty_id = fp.faculty_id AND fs.term_id = ?
              AND fs.submission_status = 'SUBMITTED' AND fs.review_status = 'ACCEPTED') AS accepted_preferences_exist
     FROM faculty_profiles fp
     LEFT JOIN designations d ON d.designation_id = fp.designation_id
     WHERE fp.is_active = 1 ORDER BY fp.name`,
    [context.term_id, context.term_id],
  );

  const faculty = await Promise.all(activeFaculty.map(async (person: Row) => {
    const confirmed = await computeWorkload(person.faculty_id, context.term_id, db);
    const all = await computeWorkload(person.faculty_id, context.term_id, db, true);
    const assignedHours = Number(all.confirmed_hours);
    const confirmedHours = Number(confirmed.confirmed_hours);
    const maxHours = all.max_hours;
    return {
      ...person,
      availability_confirmed: Boolean(person.availability_confirmed),
      accepted_preferences_exist: Boolean(person.accepted_preferences_exist),
      confirmed_hours: confirmedHours,
      draft_hours: Math.max(0, assignedHours - confirmedHours),
      assigned_hours: assignedHours,
      unconfirmed_hours: Number(all.unconfirmed_hours),
      remaining_hours: maxHours == null ? null : Math.max(0, maxHours - assignedHours),
      overload_hours: maxHours == null ? null : Math.max(0, assignedHours - maxHours),
      limit_status: all.limit_status,
      max_hours: maxHours ?? null,
      enforcement_mode: all.enforcement_mode ?? null,
      workload_warning: all.warning_message ?? null,
    };
  }));

  const validationInput: AllocationRequirementInput[] = requirementEntries.map((entry: Row) => ({
    course_name: entry.course_name,
    component_id: entry.component_id,
    component_type: entry.component_type ?? 'COMPONENT',
    weekly_hours: entry.weekly_hours,
    offering_id: entry.offering_id,
    offering_status: entry.offering_status,
    audience_id: entry.audience_id,
    batch_id: entry.batch_id,
    batch_is_active: entry.batch_is_active,
    section_is_active: academicContext.section_is_active,
    data_status: entry.data_status,
    assignments: entry.assignments.map((assignment: Row) => ({
      faculty_name: assignment.faculty_name,
      role: assignment.role,
      role_status: assignment.role_status,
      faculty_data_status: assignment.faculty_data_status,
      is_active: assignment.is_active,
      availability_confirmed: assignment.availability_confirmed,
      preference_rank: assignment.preference_rank,
      accepted_preferences_exist: assignment.accepted_preferences_exist,
    })),
  }));
  const issues = validateAllocationRequirements(validationInput);
  for (const invalid of invalidAudienceRows) {
    issues.push({
      severity: 'ERROR',
      code: 'INVALID_COURSE_SECTION',
      message: `${invalid.course_name} (${invalid.component_type}) is offered to the selected section but does not belong to its curriculum scheme and semester.`,
      audience_id: invalid.audience_id,
    });
  }
  if (requirementEntries.length === 0) {
    issues.push({
      severity: 'ERROR',
      code: 'NO_CURRICULUM_REQUIREMENTS',
      message: 'No curriculum courses or offered elective requirements are configured for this semester.',
      audience_id: null,
    });
  }
  const assignedFacultyIds = new Set<number>(
    requirementEntries.flatMap((entry: Row) => entry.assignments.map((assignment: Row) => assignment.faculty_id)),
  );
  for (const person of faculty) {
    if (!assignedFacultyIds.has(person.faculty_id)) continue;
    issues.push(...validateWorkloadReadiness({
      faculty_name: person.faculty_name,
      limit_status: person.limit_status,
      max_hours: person.max_hours ?? null,
      assigned_hours: person.assigned_hours,
      warning_message: person.workload_warning,
    }));
  }

  return {
    context: academicContext,
    requirements: requirementEntries,
    faculty,
    issues,
    can_finalize: !issues.some(issue => issue.severity === 'ERROR'),
    required_hours: requirementEntries.reduce((sum: number, entry: Row) => sum + Number(entry.weekly_hours ?? 0), 0),
    allocated_hours: requirementEntries.reduce((sum: number, entry: Row) =>
      sum + (entry.assignments.length ? Number(entry.weekly_hours ?? 0) : 0), 0),
    unallocated_hours: requirementEntries.reduce((sum: number, entry: Row) =>
      sum + (entry.assignments.length ? 0 : Number(entry.weekly_hours ?? 0)), 0),
  };
}

async function validateSingleAssignmentForApproval(db: any, assignmentId: number) {
  const [rows]: any = await db.query(
    `SELECT c.course_name, cc.component_id, cc.component_type, cc.weekly_hours,
            co.offering_id, co.term_id, co.status AS offering_status, oa.audience_id, oa.batch_id,
            b.is_active AS batch_is_active, sec.is_active AS section_is_active,
            sec.data_status AS section_data_status, t.status AS term_status,
            c.data_status AS course_data_status, cc.data_status AS component_data_status,
            co.data_status AS offering_data_status, oa.data_status AS audience_data_status,
            fa.role, fa.role_status, fp.name AS faculty_name, fp.is_active AS faculty_is_active,
            fp.data_status AS faculty_data_status,
            EXISTS (
              SELECT 1 FROM faculty_availability fav
              WHERE fav.faculty_id = fp.faculty_id AND fav.term_id = co.term_id
                AND fav.availability_type = 'AVAILABLE'
                AND fav.data_status IN ('VERIFIED','RESOLVED')
            ) AS availability_confirmed,
            EXISTS (
              SELECT 1 FROM faculty_submissions fs
              WHERE fs.faculty_id = fp.faculty_id AND fs.term_id = co.term_id
                AND fs.submission_status = 'SUBMITTED' AND fs.review_status = 'ACCEPTED'
            ) AS accepted_preferences_exist
     FROM faculty_assignments fa
     JOIN faculty_profiles fp ON fp.faculty_id = fa.faculty_id
     JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
     JOIN course_offerings co ON co.offering_id = oa.offering_id
     JOIN sections sec ON sec.section_id = oa.section_id AND sec.term_id = co.term_id
     JOIN terms t ON t.term_id = co.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN courses c ON c.course_id = cc.course_id
     LEFT JOIN batches b ON b.batch_id = oa.batch_id AND b.section_id = oa.section_id
     WHERE fa.assignment_id = ?`,
    [assignmentId],
  );
  const row: Row | undefined = rows[0];
  if (!row) throw new HttpError(404, 'Assignment references could not be loaded', 'NOT_FOUND');
  if (row.term_status === 'CLOSED') {
    throw new HttpError(422, 'Assignments cannot be approved for a closed academic term.', 'TERM_CLOSED');
  }

  const sourceStatuses = [
    row.section_data_status,
    row.course_data_status,
    row.component_data_status,
    row.offering_data_status,
    row.audience_data_status,
  ];
  const dataStatus = sourceStatuses.every(status => status === 'VERIFIED' || status === 'RESOLVED')
    ? 'VERIFIED'
    : String(sourceStatuses.find(status => status !== 'VERIFIED' && status !== 'RESOLVED') ?? 'VERIFY');
  const issues = validateAllocationRequirements([{
    course_name: row.course_name,
    component_id: row.component_id == null ? null : Number(row.component_id),
    component_type: row.component_type,
    weekly_hours: row.weekly_hours == null ? null : Number(row.weekly_hours),
    offering_id: row.offering_id == null ? null : Number(row.offering_id),
    offering_status: row.offering_status,
    audience_id: row.audience_id == null ? null : Number(row.audience_id),
    batch_id: row.batch_id == null ? null : Number(row.batch_id),
    batch_is_active: row.batch_id == null ? null : row.batch_is_active,
    section_is_active: row.section_is_active,
    data_status: dataStatus,
    assignments: [{
      faculty_name: row.faculty_name,
      role: row.role,
      role_status: row.role_status,
      faculty_data_status: row.faculty_data_status,
      is_active: row.faculty_is_active,
      availability_confirmed: row.availability_confirmed,
      preference_rank: null,
      accepted_preferences_exist: row.accepted_preferences_exist,
    }],
  }]);
  const blockingIssues = issues.filter(issue => issue.severity === 'ERROR');
  if (blockingIssues.length) {
    throw new HttpError(
      422,
      'Assignment cannot be approved until its curriculum, faculty, role, and availability data are verified.',
      'ASSIGNMENT_VALIDATION_FAILED',
      { issues: blockingIssues },
    );
  }
  return row;
}

assignmentsRouter.get('/allocation/contexts', canManage, async (req, res, next) => {
  try {
    const query = z.object({ term_id: paramId.optional() }).strict().parse(req.query);
    const where = query.term_id ? 'AND t.term_id = ?' : '';
    const params = query.term_id ? [query.term_id] : [];
    const [rows]: any = await pool.query(
      `SELECT t.term_id, t.term_name, t.status AS term_status, t.parity, y.year_label,
              p.program_id, p.program_name, p.program_code,
              cs.scheme_id, cs.scheme_code, s.semester_id, s.semester_no, s.name AS semester_name,
              sec.section_id, sec.section_name, sec.strength
       FROM term_program_semesters tps
       JOIN terms t ON t.term_id = tps.term_id
       JOIN academic_years y ON y.year_id = t.year_id
       JOIN curriculum_schemes cs ON cs.scheme_id = tps.scheme_id
       JOIN programs p ON p.program_id = cs.program_id
       JOIN semesters s ON s.semester_id = tps.semester_id AND s.scheme_id = tps.scheme_id
       JOIN sections sec ON sec.term_id = tps.term_id AND sec.scheme_id = tps.scheme_id
         AND sec.semester_id = tps.semester_id
       WHERE tps.is_active = 1 AND sec.is_active = 1 AND t.status <> 'CLOSED'
         AND y.is_active = 1 AND p.is_active = 1 AND cs.is_active = 1 AND s.is_active = 1
         ${where}
       ORDER BY t.term_id DESC, p.program_name, s.semester_no, sec.section_name`,
      params,
    );
    res.json({ ...ok(rows), meta: { total: rows.length, limit: rows.length, offset: 0 } });
  } catch (e) { next(e); }
});

assignmentsRouter.get('/allocation/plan', canManage, async (req, res, next) => {
  try {
    const context = allocationContextSchema.parse(req.query);
    res.json(ok(await loadAllocationPlan(pool, context)));
  } catch (e) { next(e); }
});

assignmentsRouter.post('/allocation/validate', canManage, async (req, res, next) => {
  try {
    const context = allocationContextSchema.parse(req.body);
    const plan = await loadAllocationPlan(pool, context);
    res.json(ok({
      issues: plan.issues,
      can_finalize: plan.can_finalize,
      required_hours: plan.required_hours,
      allocated_hours: plan.allocated_hours,
      unallocated_hours: plan.unallocated_hours,
    }));
  } catch (e) { next(e); }
});

assignmentsRouter.post('/allocation/finalize', canManage, async (req, res, next) => {
  try {
    const context = allocationContextSchema.parse(req.body);
    const finalized = await withTransaction(async (conn) => {
      const plan = await loadAllocationPlan(conn, context);
      if (!plan.can_finalize) {
        throw new HttpError(422, 'Allocation cannot be finalized until all required teaching components and hard constraints are resolved.', 'ALLOCATION_VALIDATION_FAILED', {
          issues: plan.issues,
        });
      }

      const [drafts]: any = await conn.query(
        `SELECT fa.assignment_id, fa.faculty_id
         FROM faculty_assignments fa
         JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
         WHERE oa.audience_id IN (?) AND fa.is_approved = 0
         FOR UPDATE`,
        [plan.requirements.map((row: Row) => row.audience_id).filter((id: number | null) => id != null)],
      );
      const facultyIds: number[] = [...new Set<number>((drafts as Row[]).map(row => Number(row.faculty_id)))];
      for (const facultyId of facultyIds) {
        await assertWorkloadOk(conn, facultyId, context.term_id);
      }
      for (const draft of drafts) {
        await conn.query(
          `UPDATE faculty_assignments
           SET is_approved = 1, approved_by = ?, approved_at = UTC_TIMESTAMP()
           WHERE assignment_id = ? AND is_approved = 0`,
          [req.user!.userId, draft.assignment_id],
        );
        await audit(conn, req.user!.userId, 'ASSIGNMENT_APPROVED', 'faculty_assignments', draft.assignment_id, {
          faculty_id: draft.faculty_id,
          allocation_context: context,
          finalized: true,
        });
      }
      return { finalized_count: drafts.length, context: plan.context, issues: plan.issues };
    });
    res.json(ok(finalized));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Loads an assignment with enriched data for responses. */
async function loadAssignment(id: number): Promise<Row | null> {
  const [rows]: any = await pool.query(
    `SELECT
       fa.assignment_id,
       fa.audience_id,
       fa.faculty_id,
       fa.role,
       fa.role_status,
       fa.source_preference_id,
       fa.is_approved,
       fa.approved_by,
       fa.approved_at,
       fa.created_at,
       fp.name           AS faculty_name,
       fp.designation_id,
       d.designation_name,
       oa.offering_id,
       oa.section_id,
       oa.batch_id,
       co.term_id,
       co.component_id,
       cc.component_type,
       c.course_id,
       c.course_name,
       c.course_code
     FROM faculty_assignments fa
     JOIN faculty_profiles   fp ON fp.faculty_id  = fa.faculty_id
     LEFT JOIN designations  d  ON d.designation_id = fp.designation_id
     JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
     JOIN course_offerings   co ON co.offering_id = oa.offering_id
     JOIN course_components  cc ON cc.component_id = co.component_id
     JOIN courses            c  ON c.course_id    = cc.course_id
     WHERE fa.assignment_id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Shared pre-write validation used by create and update.
 * Throws on bad references or constraint violations; returns the resolved term_id.
 */
async function validateRefs(
  conn: any,
  audienceId: number,
  facultyId: number,
  sourcePreferenceId: number | null | undefined,
): Promise<number> {
  await requireAllocationSchema(conn);
  const audience = await one(conn, 'offering_audiences', 'audience_id', audienceId);
  if (!audience) throw missingRef('offering audience');

  const offering = await one(conn, 'course_offerings', 'offering_id', audience.offering_id);
  if (!offering) throw missingRef('course offering');
  if (offering.status === 'CANCELLED') throw rule('OFFERING_CANCELLED', 'Cannot assign faculty to a cancelled offering');
  if (offering.status !== 'OFFERED') throw rule('OFFERING_NOT_OFFERED', 'Faculty can only be assigned to a course offering that is marked OFFERED');

  const [contextRows]: any = await conn.query(
    `    SELECT sec.section_id, sec.term_id, sec.semester_id, cc.course_id, co.component_id
     FROM offering_audiences oa
     JOIN sections sec ON sec.section_id = oa.section_id AND sec.term_id = oa.term_id
     JOIN course_offerings co ON co.offering_id = oa.offering_id AND co.term_id = oa.term_id
     JOIN course_components cc ON cc.component_id = co.component_id
     JOIN terms t ON t.term_id = sec.term_id
     JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
     JOIN curriculum_courses cur
       ON cur.course_id = cc.course_id AND cur.scheme_id = sec.scheme_id AND cur.semester_id = sec.semester_id
     JOIN term_program_semesters tps
       ON tps.term_id = sec.term_id AND tps.scheme_id = sec.scheme_id AND tps.semester_id = sec.semester_id
     WHERE oa.audience_id = ? AND tps.is_active = 1 AND sec.is_active = 1
       AND t.status <> 'CLOSED' AND cs.is_active = 1 AND p.is_active = 1
     LIMIT 1`,
    [audienceId],
  );
  if (!contextRows.length) {
    throw rule('INVALID_OFFERING_AUDIENCE', 'The offering is not part of the selected section curriculum and active term mapping');
  }
  if (audience.batch_id != null) {
    const batch = await one(conn, 'batches', 'batch_id', audience.batch_id);
    if (!batch || !batch.is_active || batch.section_id !== audience.section_id) {
      throw rule('INVALID_BATCH', 'The audience batch is inactive or does not belong to its section');
    }
  }

  const faculty = await one(conn, 'faculty_profiles', 'faculty_id', facultyId);
  if (!faculty) throw missingRef('faculty member');
  if (!faculty.is_active) throw rule('FACULTY_INACTIVE', 'Faculty member is not active');

  if (sourcePreferenceId != null) {
    // faculty_subject_preferences has no faculty_id column — join via faculty_submissions.
    const [subRows]: any = await conn.query(
      `SELECT fs.faculty_id, fs.term_id, p.course_id, p.component_id, p.semester_id
       FROM faculty_subject_preferences p
       JOIN faculty_submissions fs ON fs.submission_id = p.submission_id
       WHERE p.preference_id = ?`,
      [sourcePreferenceId],
    );
    if (!subRows[0]) throw missingRef('faculty subject preference');
    if (subRows[0].faculty_id !== facultyId) {
      throw rule('PREFERENCE_FACULTY_MISMATCH', 'The source preference does not belong to the assigned faculty member');
    }
    if (subRows[0].term_id !== offering.term_id
      || subRows[0].semester_id !== contextRows[0].semester_id
      || subRows[0].course_id !== contextRows[0].course_id
      || (subRows[0].component_id != null && subRows[0].component_id !== contextRows[0].component_id)) {
      throw rule('PREFERENCE_TARGET_MISMATCH', 'The source preference does not match the offered course component and academic context');
    }
  }

  return offering.term_id as number;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/assignments/audiences
 * Returns offering_audiences for a term, enriched with course name, component type and section name.
 * Used by the admin assignment creation wizard.
 * Query: term_id (required)
 */
assignmentsRouter.get('/audiences', canManage, async (req, res, next) => {
  try {
    const { term_id } = z.object({ term_id: paramId }).strict().parse(req.query);
    const [rows]: any = await pool.query(
      `SELECT
         oa.audience_id, oa.offering_id, oa.section_id, oa.batch_id, oa.term_id, oa.strength,
         c.course_name, c.course_code,
         cc.component_type,
         s.section_name,
         b.batch_name
       FROM offering_audiences oa
       JOIN course_offerings   co ON co.offering_id  = oa.offering_id
       JOIN course_components  cc ON cc.component_id = co.component_id
       JOIN courses            c  ON c.course_id     = cc.course_id
       JOIN sections           s  ON s.section_id    = oa.section_id
       LEFT JOIN batches        b  ON b.batch_id      = oa.batch_id
       WHERE oa.term_id = ? AND co.status <> 'CANCELLED'
       ORDER BY c.course_name, cc.component_type, s.section_name`,
      [term_id]
    );
    res.json({ ...ok(rows), meta: { total: rows.length, limit: rows.length, offset: 0 } });
  } catch (e) { next(e); }
});

/**
 * GET /api/assignments/workload
 * Returns the workload summary for a given faculty + term.
 * Must be registered before /:id to avoid "workload" being parsed as an id.
 */
assignmentsRouter.get('/workload', canRead, async (req, res, next) => {
  try {
    const { faculty_id, term_id } = workloadQuery.parse(req.query);

    // Faculty can only view their own workload
    if (req.user!.roles.includes('FACULTY') && !req.user!.roles.includes('ADMIN')) {
      const [rows]: any = await pool.query(
        'SELECT faculty_id FROM faculty_profiles WHERE user_id = ? AND is_active = 1',
        [req.user!.userId],
      );
      if (!rows[0] || rows[0].faculty_id !== faculty_id) {
        throw new HttpError(403, 'You can only view your own workload', 'FORBIDDEN');
      }
    }

    const result = await computeWorkload(faculty_id, term_id);
    res.json(ok(result));
  } catch (e) {
    next(e);
  }
});

/** GET /api/assignments */
assignmentsRouter.get('/', canRead, async (req, res, next) => {
  try {
    const q: Row = listQuery.parse(req.query);

    // Faculty can only list their own assignments
    if (req.user!.roles.includes('FACULTY') && !req.user!.roles.includes('ADMIN')) {
      const [rows]: any = await pool.query(
        'SELECT faculty_id FROM faculty_profiles WHERE user_id = ? AND is_active = 1',
        [req.user!.userId],
      );
      if (!rows[0]) throw new HttpError(403, 'No faculty profile linked to your account', 'NO_FACULTY_PROFILE');
      // Silently scope to own faculty_id
      q.faculty_id = rows[0].faculty_id;
      // Faculty may only see approved assignments
      q.is_approved = 1;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.faculty_id !== undefined) { conditions.push('fa.faculty_id = ?'); params.push(q.faculty_id); }
    if (q.audience_id !== undefined) { conditions.push('fa.audience_id = ?'); params.push(q.audience_id); }
    if (q.is_approved !== undefined) { conditions.push('fa.is_approved = ?'); params.push(q.is_approved); }
    if (q.term_id !== undefined) { conditions.push('co.term_id = ?'); params.push(q.term_id); }
    if (req.user!.roles.includes('FACULTY') && !req.user!.roles.includes('ADMIN')) {
      conditions.push("fa.role_status IN ('VERIFIED', 'RESOLVED')");
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.query(
      `SELECT
         fa.assignment_id, fa.audience_id, fa.faculty_id, fa.role, fa.role_status,
         fa.source_preference_id, fa.is_approved, fa.approved_by, fa.approved_at, fa.created_at,
         fp.name AS faculty_name,
         co.term_id,
         t.year_id, y.year_label, t.term_name, t.parity,
         sec.section_id, sec.section_name, b.batch_id, b.batch_name,
         sem.semester_id, sem.semester_no, sem.name AS semester_name,
         p.program_code, p.program_name,
         cc.component_type,
         c.course_name, c.course_code
       FROM faculty_assignments fa
       JOIN faculty_profiles   fp ON fp.faculty_id  = fa.faculty_id
       JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
       JOIN course_offerings   co ON co.offering_id = oa.offering_id
       JOIN terms t ON t.term_id = co.term_id
       JOIN academic_years y ON y.year_id = t.year_id
       JOIN sections sec ON sec.section_id = oa.section_id AND sec.term_id = oa.term_id
       JOIN semesters sem ON sem.semester_id = sec.semester_id AND sem.scheme_id = sec.scheme_id
       JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
       JOIN programs p ON p.program_id = cs.program_id
       LEFT JOIN batches b ON b.batch_id = oa.batch_id AND b.section_id = oa.section_id
       JOIN course_components  cc ON cc.component_id = co.component_id
       JOIN courses            c  ON c.course_id    = cc.course_id
       ${where}
       ORDER BY fa.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, q.limit, q.offset],
    );

    const [[countRow]]: any = await pool.query(
      `SELECT COUNT(*) AS total
       FROM faculty_assignments fa
       JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
       JOIN course_offerings   co ON co.offering_id = oa.offering_id
       ${where}`,
      params,
    );

    res.json({ ...ok(rows), meta: { total: countRow.total, limit: q.limit, offset: q.offset } });
  } catch (e) {
    next(e);
  }
});

/** GET /api/assignments/:id */
assignmentsRouter.get('/:id', canRead, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const row = await loadAssignment(id);
    if (!row) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');

    // Faculty can only view their own approved assignments
    if (req.user!.roles.includes('FACULTY') && !req.user!.roles.includes('ADMIN')) {
      const [facRows]: any = await pool.query(
        'SELECT faculty_id FROM faculty_profiles WHERE user_id = ? AND is_active = 1',
        [req.user!.userId],
      );
      if (!facRows[0] || facRows[0].faculty_id !== row.faculty_id || !row.is_approved) {
        throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
      }
    }

    res.json(ok(row));
  } catch (e) {
    next(e);
  }
});

/** POST /api/assignments */
assignmentsRouter.post('/', canManage, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    const assignment = await withTransaction(async (conn) => {
      const termId = await validateRefs(conn, body.audience_id, body.faculty_id, body.source_preference_id);

      // Check for duplicate (same audience + faculty + role)
      const [dup]: any = await conn.query(
        'SELECT assignment_id FROM faculty_assignments WHERE audience_id = ? AND faculty_id = ? AND role = ? FOR UPDATE',
        [body.audience_id, body.faculty_id, body.role ?? 'UNSPECIFIED'],
      );
      if (dup.length) throw new HttpError(409, 'This faculty member already has an assignment with this role for this audience', 'DUPLICATE');

      const [ins]: any = await conn.query('INSERT INTO faculty_assignments SET ?', [
        {
          audience_id: body.audience_id,
          faculty_id: body.faculty_id,
          role: body.role ?? 'UNSPECIFIED',
          role_status: body.role_status ?? 'VERIFY',
          source_preference_id: body.source_preference_id ?? null,
        },
      ]);
      const newId: number = ins.insertId;

      // Revalidate workload after inserting (so the new row is included)
      const workload = await assertWorkloadOk(conn, body.faculty_id, termId);

      await audit(conn, req.user!.userId, 'ASSIGNMENT_CREATED', 'faculty_assignments', newId, {
        audience_id: body.audience_id,
        faculty_id: body.faculty_id,
        role: body.role ?? 'UNSPECIFIED',
        workload_status: workload.limit_status,
      });

      return one(conn, 'faculty_assignments', 'assignment_id', newId);
    });

    res.status(201).json(ok(assignment));
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/assignments/:id — change role or source_preference_id only */
assignmentsRouter.patch('/:id', canManage, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const body = updateSchema.parse(req.body);
    if (Object.keys(body).length === 0) throw new HttpError(400, 'No updatable fields supplied', 'EMPTY_UPDATE');

    const assignment = await withTransaction(async (conn) => {
      const [locked]: any = await conn.query(
        'SELECT * FROM faculty_assignments WHERE assignment_id = ? FOR UPDATE',
        [id],
      );
      const existing: Row | undefined = locked[0];
      if (!existing) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
      if (existing.is_approved) {
        throw new HttpError(409, 'Approved assignments cannot be changed. Create a new draft through the allocation workflow.', 'ASSIGNMENT_APPROVED');
      }

      const newAudienceId = body.audience_id ?? existing.audience_id;
      const newFacultyId = body.faculty_id ?? existing.faculty_id;
      const newPreferenceId = body.source_preference_id !== undefined
        ? body.source_preference_id
        : newFacultyId !== existing.faculty_id ? null : existing.source_preference_id;
      const termId = await validateRefs(
        conn,
        newAudienceId,
        newFacultyId,
        newPreferenceId,
      );

      // Check for duplicate if role changes
      const newRole = body.role ?? existing.role;
      if (body.role || body.faculty_id || body.audience_id) {
        const [dup]: any = await conn.query(
          'SELECT assignment_id FROM faculty_assignments WHERE audience_id = ? AND faculty_id = ? AND role = ? AND assignment_id <> ?',
          [newAudienceId, newFacultyId, newRole, id],
        );
        if (dup.length) throw new HttpError(409, 'A duplicate assignment would result from this role change', 'DUPLICATE');
      }

      await conn.query('UPDATE faculty_assignments SET ? WHERE assignment_id = ?', [
        { ...body, source_preference_id: newPreferenceId },
        id,
      ]);

      // Revalidate workload after change
      const workload = await assertWorkloadOk(conn, newFacultyId, termId);

      await audit(conn, req.user!.userId, 'ASSIGNMENT_CHANGED', 'faculty_assignments', id, {
        changes: body,
        workload_status: workload.limit_status,
      });

      return one(conn, 'faculty_assignments', 'assignment_id', id);
    });

    res.json(ok(assignment));
  } catch (e) {
    next(e);
  }
});

/** POST /api/assignments/:id/approve */
assignmentsRouter.post('/:id/approve', canManage, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const comment = z.object({ comment: z.string().trim().max(500).optional() }).strict().parse(req.body).comment;

    const assignment = await withTransaction(async (conn) => {
      const [locked]: any = await conn.query(
        'SELECT * FROM faculty_assignments WHERE assignment_id = ? FOR UPDATE',
        [id],
      );
      const existing: Row | undefined = locked[0];
      if (!existing) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
      if (existing.is_approved) throw new HttpError(409, 'Assignment is already approved', 'ALREADY_APPROVED');

      const approvalReadiness = await validateSingleAssignmentForApproval(conn, id);

      await conn.query(
        'UPDATE faculty_assignments SET is_approved = 1, approved_by = ?, approved_at = UTC_TIMESTAMP() WHERE assignment_id = ?',
        [req.user!.userId, id],
      );

      // Revalidate workload after marking approved
      const workload = await assertWorkloadOk(conn, existing.faculty_id, approvalReadiness.term_id);
      const workloadIssues = validateWorkloadReadiness({
        faculty_name: approvalReadiness.faculty_name,
        limit_status: workload.limit_status,
        max_hours: workload.max_hours ?? null,
        assigned_hours: workload.confirmed_hours,
        warning_message: workload.warning_message,
      });
      const workloadErrors = workloadIssues.filter(issue => issue.severity === 'ERROR');
      if (workloadErrors.length) {
        throw new HttpError(
          422,
          'Assignment cannot be approved until the faculty workload can be verified.',
          workloadErrors[0].code,
          { issues: workloadErrors },
        );
      }

      await audit(conn, req.user!.userId, 'ASSIGNMENT_APPROVED', 'faculty_assignments', id, {
        faculty_id: existing.faculty_id,
        comment: comment ?? null,
        workload_status: workload.limit_status,
      });

      return one(conn, 'faculty_assignments', 'assignment_id', id);
    });

    res.json(ok(assignment));
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/assignments/:id — only unapproved assignments can be deleted */
assignmentsRouter.delete('/:id', canManage, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);

    await withTransaction(async (conn) => {
      const [locked]: any = await conn.query(
        'SELECT * FROM faculty_assignments WHERE assignment_id = ? FOR UPDATE',
        [id],
      );
      const existing: Row | undefined = locked[0];
      if (!existing) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
      if (existing.is_approved) {
        throw new HttpError(
          409,
          'Approved assignments cannot be deleted. Revoke approval first or contact an administrator.',
          'ASSIGNMENT_APPROVED',
        );
      }

      await conn.query('DELETE FROM faculty_assignments WHERE assignment_id = ?', [id]);
      await audit(conn, req.user!.userId, 'ASSIGNMENT_DELETED', 'faculty_assignments', id, {
        faculty_id: existing.faculty_id,
        audience_id: existing.audience_id,
      });
    });

    res.json(ok({ deleted: id }));
  } catch (e) {
    next(e);
  }
});
