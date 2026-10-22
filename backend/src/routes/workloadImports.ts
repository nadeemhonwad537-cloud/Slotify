import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import { HttpError } from '../utils/errors';
import { fk, paramId } from '../utils/zodHelpers';

export const workloadImportsRouter = Router();
workloadImportsRouter.use(authenticate);

const admin = requirePermission('masterdata:write');
const own = requirePermission('faculty_submission:own');

const reviewSchema = z.object({
  resolution_status: z.enum(['REVIEWED', 'SKIPPED']),
  faculty_id: fk.nullable().optional(),
  department_id: fk.nullable().optional(),
  term_id: fk.nullable().optional(),
  subject_mappings: z.record(z.object({
    course_id: fk,
    component_id: fk.nullable().optional(),
    semester_id: fk.nullable().optional(),
    section_id: fk.nullable().optional(),
    batch_id: fk.nullable().optional(),
  }).strict()).optional(),
  review_notes: z.string().trim().min(1).max(2000),
}).strict();

workloadImportsRouter.get('/mine', own, async (req, res, next) => {
  try {
    const [profiles] = await pool.query<RowDataPacket[]>(
      'SELECT faculty_id FROM faculty_profiles WHERE user_id = ? AND is_active = 1',
      [req.user!.userId],
    );
    if (!profiles[0]) throw new HttpError(403, 'No faculty profile linked to your account', 'NO_FACULTY_PROFILE');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT workload_import_row_id, source_row_number, source_page, source_name, group_label,
              faculty_category, subjects, lab_duty, sdp_hours, minor_project_hours,
              printed_theory_hours, printed_lab_hours, printed_total_hours,
              printed_load_source_text, unresolved_fields, issues, resolution_status, review_notes
       FROM workload_import_rows
       WHERE faculty_id = ? AND resolution_status IN ('UNRESOLVED','REVIEWED')
       ORDER BY batch_id, source_row_number`,
      [profiles[0].faculty_id],
    );
    res.json(ok(rows));
  } catch (error) {
    next(error);
  }
});

workloadImportsRouter.get('/', admin, async (_req, res, next) => {
  try {
    const [batches] = await pool.query<RowDataPacket[]>(
      `SELECT b.batch_id, b.source_key, b.status, b.imported_at, b.content_sha256, b.import_summary,
              d.document_id, d.file_name, d.source_type, d.term_id, d.remarks
       FROM workload_import_batches b
       JOIN source_documents d ON d.document_id = b.source_document_id
       ORDER BY b.batch_id DESC`,
    );
    if (!batches.length) {
      res.json(ok({ batch: null, summary: { total: 0, unresolved: 0, reviewed: 0, skipped: 0, blockers: 0 }, rows: [] }));
      return;
    }
    const batch = batches[0];
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT workload_import_row_id, source_row_number, source_page, raw_source_line, source_name,
              group_label, faculty_category, subjects, lab_duty, sdp_hours, minor_project_hours,
              printed_theory_hours, printed_lab_hours, printed_total_hours, printed_load_source_text,
              source_snapshot, unresolved_fields, issues, resolution_status, faculty_id, department_id,
              term_id, resolution_json, review_notes, reviewed_by, reviewed_at
       FROM workload_import_rows
       WHERE batch_id = ?
       ORDER BY source_row_number`,
      [batch.batch_id],
    );
    const summary = {
      total: rows.length,
      unresolved: rows.filter(row => row.resolution_status === 'UNRESOLVED').length,
      reviewed: rows.filter(row => row.resolution_status === 'REVIEWED' || row.resolution_status === 'RESOLVED').length,
      skipped: rows.filter(row => row.resolution_status === 'SKIPPED').length,
      blockers: rows.reduce((count, row) => count + (row.issues as Array<{ severity: string }>).filter(issue => issue.severity === 'BLOCKER').length, 0),
    };
    res.json(ok({ batch, summary, rows }));
  } catch (error) {
    next(error);
  }
});

workloadImportsRouter.patch('/:id/review', admin, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);
    const body = reviewSchema.parse(req.body);
    const result = await withTransaction(async conn => {
      const [records] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM workload_import_rows WHERE workload_import_row_id = ? FOR UPDATE',
        [id],
      );
      const row = records[0];
      if (!row) throw new HttpError(404, 'Workload source row not found', 'NOT_FOUND');

      if (body.faculty_id != null) {
        const [faculty] = await conn.query<RowDataPacket[]>(
          'SELECT faculty_id, is_active FROM faculty_profiles WHERE faculty_id = ?',
          [body.faculty_id],
        );
        if (!faculty[0] || !faculty[0].is_active) throw new HttpError(422, 'Selected faculty profile does not exist or is inactive', 'INVALID_FACULTY_MAPPING');
      }
      if (body.department_id != null) {
        const [departments] = await conn.query<RowDataPacket[]>(
          'SELECT dept_id, is_active FROM departments WHERE dept_id = ?',
          [body.department_id],
        );
        if (!departments[0] || !departments[0].is_active) throw new HttpError(422, 'Selected department does not exist or is inactive', 'INVALID_DEPARTMENT_MAPPING');
      }
      if (body.term_id != null) {
        const [terms] = await conn.query<RowDataPacket[]>(
          'SELECT term_id FROM terms WHERE term_id = ? AND status <> \'CLOSED\'',
          [body.term_id],
        );
        if (!terms[0]) throw new HttpError(422, 'Selected term does not exist or is closed', 'INVALID_TERM_MAPPING');
      }
      if (body.subject_mappings) {
        const sourceSubjects = row.subjects as Array<{ rawLabel: string | null }>;
        const sourceLabels = new Set(sourceSubjects.map(subject => subject.rawLabel).filter((label): label is string => !!label));
        for (const [label, mapping] of Object.entries(body.subject_mappings)) {
          if (!sourceLabels.has(label)) throw new HttpError(422, `Subject label "${label}" is not present in this source row`, 'INVALID_SOURCE_LABEL');
          const [courses] = await conn.query<RowDataPacket[]>(
            'SELECT course_id FROM courses WHERE course_id = ? AND is_active = 1',
            [mapping.course_id],
          );
          if (!courses[0]) throw new HttpError(422, `Course mapping for "${label}" is missing or inactive`, 'INVALID_COURSE_MAPPING');
          if (mapping.component_id != null) {
            const [components] = await conn.query<RowDataPacket[]>(
              'SELECT component_id FROM course_components WHERE component_id = ? AND course_id = ?',
              [mapping.component_id, mapping.course_id],
            );
            if (!components[0]) throw new HttpError(422, `Component mapping for "${label}" does not belong to its course`, 'INVALID_COMPONENT_MAPPING');
          }
          if (mapping.semester_id != null) {
            const [semesters] = await conn.query<RowDataPacket[]>(
              `SELECT semester_id, scheme_id FROM semesters WHERE semester_id = ?`,
              [mapping.semester_id],
            );
            if (!semesters[0]) throw new HttpError(422, `Semester mapping for "${label}" does not exist`, 'INVALID_SEMESTER_MAPPING');
            const [curriculum] = await conn.query<RowDataPacket[]>(
              'SELECT 1 FROM curriculum_courses WHERE course_id = ? AND semester_id = ? AND scheme_id = ?',
              [mapping.course_id, mapping.semester_id, semesters[0].scheme_id],
            );
            if (!curriculum[0]) throw new HttpError(422, `Course is not in the selected curriculum semester for "${label}"`, 'INVALID_CURRICULUM_MAPPING');
          }
          if (mapping.section_id != null) {
            const [sections] = await conn.query<RowDataPacket[]>(
              'SELECT section_id, term_id, semester_id, scheme_id FROM sections WHERE section_id = ?',
              [mapping.section_id],
            );
            if (!sections[0] ||
                (body.term_id != null && sections[0].term_id !== body.term_id) ||
                (mapping.semester_id != null && sections[0].semester_id !== mapping.semester_id)) {
              throw new HttpError(422, `Section mapping for "${label}" conflicts with the selected term or semester`, 'INVALID_SECTION_MAPPING');
            }
            if (mapping.batch_id != null) {
              const [batches] = await conn.query<RowDataPacket[]>(
                'SELECT batch_id FROM batches WHERE batch_id = ? AND section_id = ?',
                [mapping.batch_id, mapping.section_id],
              );
              if (!batches[0]) throw new HttpError(422, `Batch mapping for "${label}" does not belong to its section`, 'INVALID_BATCH_MAPPING');
            }
          } else if (mapping.batch_id != null) {
            throw new HttpError(422, `A section is required before mapping a batch for "${label}"`, 'INVALID_BATCH_MAPPING');
          }
        }
      }

      const facultyId = body.faculty_id === undefined ? row.faculty_id : body.faculty_id;
      const departmentId = body.department_id === undefined ? row.department_id : body.department_id;
      const termId = body.term_id === undefined ? row.term_id : body.term_id;
      const currentMappings = (row.resolution_json ?? {}) as Record<string, unknown>;
      const mappings = body.subject_mappings ?? currentMappings;
      if (body.resolution_status === 'REVIEWED' && facultyId != null && departmentId != null) {
        const [facultyRows] = await conn.query<RowDataPacket[]>(
          'SELECT dept_id FROM faculty_profiles WHERE faculty_id = ?',
          [facultyId],
        );
        if (facultyRows[0]?.dept_id != null && facultyRows[0].dept_id !== departmentId) {
          throw new HttpError(422, 'Faculty and selected department do not match', 'FACULTY_DEPARTMENT_MISMATCH');
        }
      }
      await conn.query(
        `UPDATE workload_import_rows
         SET resolution_status = ?, faculty_id = ?, department_id = ?, term_id = ?,
             resolution_json = ?, review_notes = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP()
         WHERE workload_import_row_id = ?`,
        [
          body.resolution_status,
          facultyId,
          departmentId,
          termId,
          JSON.stringify(mappings),
          body.review_notes,
          req.user!.userId,
          id,
        ],
      );
      await conn.query(
        `UPDATE workload_import_batches
         SET status = IF(EXISTS (
           SELECT 1 FROM workload_import_rows
           WHERE batch_id = ? AND resolution_status IN ('REVIEWED','RESOLVED','SKIPPED')
         ), 'PARTIALLY_RESOLVED', 'REVIEW_REQUIRED')
         WHERE batch_id = ?`,
        [row.batch_id, row.batch_id],
      );
      await audit(conn, req.user!.userId, 'WORKLOAD_IMPORT_ROW_REVIEWED', 'workload_import_rows', id, {
        source_row_number: row.source_row_number,
        resolution_status: body.resolution_status,
        faculty_id: facultyId,
        department_id: departmentId,
        term_id: termId,
        review_notes: body.review_notes,
      });
      const [updated] = await conn.query<RowDataPacket[]>(
        `SELECT workload_import_row_id, source_row_number, source_page, source_name, group_label,
                faculty_category, subjects, lab_duty, sdp_hours, minor_project_hours,
                printed_theory_hours, printed_lab_hours, printed_total_hours,
                printed_load_source_text, unresolved_fields, issues, resolution_status,
                faculty_id, department_id, term_id, resolution_json, review_notes, reviewed_at
         FROM workload_import_rows WHERE workload_import_row_id = ?`,
        [id],
      );
      return updated[0];
    });
    res.json(ok(result));
  } catch (error) {
    next(error);
  }
});
