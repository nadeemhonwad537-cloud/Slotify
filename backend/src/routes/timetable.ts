/**
 * Timetable API — Milestone 4 (Validation endpoints).
 *
 * Routes:
 *   POST  /api/timetable/validate          — run validation on a version, persist results
 *   GET   /api/timetable/validate/:id      — fetch a previous validation run + issues
 *   GET   /api/timetable/versions/:id      — fetch a timetable version summary
 *
 * Permissions:
 *   timetable:generate  — ADMIN; required for POST (triggering a validation run)
 *   masterdata:read     — ADMIN + FACULTY; sufficient for GET
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import { computeValidation, runValidationAndPersist } from '../services/validationService';
import { getSchedulingConfiguration } from '../services/schedulingConfigurationService';
import {
  createTimetableSession,
  deleteTimetableSession,
  getTimetableSessionOptions,
  listTimetableSessions,
  updateTimetableSession,
} from '../services/timetableSessionService';
import { timetableSessionInput } from '../services/timetableSessionRules';
import { listFacultyTimetableContexts, listPublishedFacultySessions } from '../services/facultyTimetableService';
import { approveTimetable, publishTimetable, requestTimetableChanges, submitTimetableForReview } from '../services/timetableLifecycleService';
import { HttpError } from '../utils/errors';
import { fk, paramId } from '../utils/zodHelpers';

export const timetableRouter = Router();
timetableRouter.use(authenticate);

const canGenerate = requirePermission('timetable:generate');
const canRead     = requirePermission('timetable:generate', 'masterdata:read');
const canConfigure = requirePermission('masterdata:read');

const facultyTimetableFilter = z.object({
  year_id: paramId,
  term_id: paramId,
  semester_id: paramId,
}).strict();

// Faculty reads are scoped to the authenticated profile and published versions only.
timetableRouter.get('/faculty/contexts', requirePermission('faculty_submission:own'), async (req, res, next) => {
  try {
    res.json(ok(await listFacultyTimetableContexts(req.user!.userId)));
  } catch (error) { next(error); }
});

timetableRouter.get('/faculty/sessions', requirePermission('faculty_submission:own'), async (req, res, next) => {
  try {
    const filter = facultyTimetableFilter.parse(req.query);
    res.json(ok(await listPublishedFacultySessions(req.user!.userId, filter)));
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------
// GET /api/timetable/configuration/:termId
// Read-only readiness check. No schedule or database records are modified.
// ---------------------------------------------------------------------------
timetableRouter.get('/configuration/:termId', canConfigure, async (req, res, next) => {
  try {
    const termId = paramId.parse(req.params.termId);
    const result = await getSchedulingConfiguration(termId);
    if (!result) throw new HttpError(404, 'Academic term not found', 'NOT_FOUND');
    res.json(ok(result));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/timetable/validate
// Triggers a validation run and persists results.
// Body: { version_id: number, dry_run?: boolean }
//   dry_run=true returns results without persisting — useful for preview.
// ---------------------------------------------------------------------------
timetableRouter.post('/validate', canGenerate, async (req, res, next) => {
  try {
    const body = z.object({
      version_id: fk,
      dry_run: z.boolean().optional().default(false),
    }).strict().parse(req.body);

    // Confirm version exists before running
    const [rows]: any = await pool.query(
      'SELECT version_id, term_id, status FROM timetable_versions WHERE version_id = ?',
      [body.version_id],
    );
    if (!rows[0]) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');

    if (body.dry_run) {
      // Pure read — no DB writes
      const result = await computeValidation(body.version_id);
      return res.json(ok({ dry_run: true, ...result }));
    }

    const run = await runValidationAndPersist(body.version_id, req.user!.userId);
    return res.status(201).json(ok(run));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/timetable/validate/:id
// Returns a validation run record and all its issues.
// ---------------------------------------------------------------------------
timetableRouter.get('/validate/:id', canRead, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);

    const [runRows]: any = await pool.query(
      'SELECT * FROM validation_runs WHERE validation_id = ?',
      [id],
    );
    if (!runRows[0]) throw new HttpError(404, 'Validation run not found', 'NOT_FOUND');

    const [issueRows]: any = await pool.query(
      `SELECT issue_id, severity, rule_code, message, details_json, status
       FROM validation_issues WHERE validation_id = ? ORDER BY issue_id`,
      [id],
    );

    // Parse details_json back to objects for API consumers
    // mysql2 may return JSON columns already parsed as objects
    const issues = issueRows.map((row: any) => {
      let details: Record<string, unknown> = {};
      if (row.details_json != null) {
        details = typeof row.details_json === 'string'
          ? JSON.parse(row.details_json)
          : row.details_json;
      }
      return { ...row, details, details_json: undefined };
    });

    const summary = {
      issue_count:   issueRows.length,
      error_count:   issueRows.filter((i: any) => i.severity === 'ERROR').length,
      warning_count: issueRows.filter((i: any) => i.severity === 'WARNING').length,
    };

    res.json(ok({ run: runRows[0], issues, summary }));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/timetable/versions
// Lists versions (newest first) with term, creator, section/session counts and latest validation summary.
// Query: term_id?, status?, limit?, offset?
// ---------------------------------------------------------------------------
const VERSION_STATUSES = ['DRAFT', 'VALIDATED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'] as const;
timetableRouter.get('/versions', canRead, async (req, res, next) => {
  try {
    const q = z.object({
      term_id: paramId.optional(),
      status: z.enum(VERSION_STATUSES).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).strict().parse(req.query);
    const where: string[] = []; const params: unknown[] = [];
    if (q.term_id) { where.push('v.term_id = ?'); params.push(q.term_id); }
    if (q.status) { where.push('v.status = ?'); params.push(q.status); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows]: any = await pool.query(
      `SELECT v.version_id, v.term_id, t.term_name, y.year_label, v.version_no, v.parent_version_id, v.status,
              v.availability_unknown_status, v.created_by, u.name AS created_by_name, v.created_at, v.published_at,
              (SELECT COUNT(*) FROM timetable_version_sections s WHERE s.version_id = v.version_id) AS section_count,
              (SELECT COUNT(*) FROM scheduled_sessions ss WHERE ss.version_id = v.version_id) AS session_count,
              vr.validation_id AS last_validation_id, vr.status AS last_validation_status, vr.started_at AS last_validated_at,
              (SELECT COUNT(*) FROM validation_issues i WHERE i.validation_id = vr.validation_id AND i.severity = 'ERROR') AS last_error_count,
              (SELECT COUNT(*) FROM validation_issues i WHERE i.validation_id = vr.validation_id AND i.severity = 'WARNING') AS last_warning_count
       FROM timetable_versions v
       JOIN terms t ON t.term_id = v.term_id
       JOIN academic_years y ON y.year_id = t.year_id
       JOIN users u ON u.user_id = v.created_by
       LEFT JOIN validation_runs vr ON vr.validation_id = (SELECT MAX(x.validation_id) FROM validation_runs x WHERE x.version_id = v.version_id)
       ${w} ORDER BY v.term_id DESC, v.version_no DESC LIMIT ? OFFSET ?`, [...params, q.limit, q.offset]);
    const [[c]]: any = await pool.query(`SELECT COUNT(*) AS total FROM timetable_versions v ${w}`, params);
    res.json({ ...ok(rows), meta: { total: c.total, limit: q.limit, offset: q.offset } });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// POST /api/timetable/versions
// Creates an EMPTY draft version (no sessions are generated here; the generator is a separate milestone).
// Body: { term_id, parent_version_id?, section_ids? }. version_no is allocated per term inside a transaction.
// ---------------------------------------------------------------------------
timetableRouter.post('/versions', requirePermission('timetable:edit'), async (req, res, next) => {
  try {
    const b = z.object({
      term_id: fk, parent_version_id: fk.optional(), section_ids: z.array(fk).max(500).optional(),
    }).strict().parse(req.body);
    const created = await withTransaction(async (conn) => {
      const [[term]]: any = await conn.query('SELECT term_id, status FROM terms WHERE term_id = ? FOR UPDATE', [b.term_id]);
      if (!term) throw new HttpError(422, 'Referenced term does not exist', 'BAD_REFERENCE');
      if (term.status === 'CLOSED') throw new HttpError(422, 'Cannot create a version in a closed term', 'TERM_CLOSED');
      if (b.parent_version_id) {
        const [[p]]: any = await conn.query('SELECT term_id FROM timetable_versions WHERE version_id = ?', [b.parent_version_id]);
        if (!p) throw new HttpError(422, 'Parent version does not exist', 'BAD_REFERENCE');
        if (p.term_id !== b.term_id) throw new HttpError(422, 'Parent version belongs to a different term', 'PARENT_TERM_MISMATCH');
      }
      const sectionIds = b.section_ids ?? [];
      if (new Set(sectionIds).size !== sectionIds.length) {
        throw new HttpError(422, 'A section may only be selected once for a timetable version', 'DUPLICATE_SECTION');
      }
      if (sectionIds.length) {
        const [validSections]: any = await conn.query(
          'SELECT section_id FROM sections WHERE term_id = ? AND is_active = 1 AND section_id IN (?)',
          [b.term_id, sectionIds],
        );
        if (validSections.length !== sectionIds.length) {
          throw new HttpError(422, 'Every selected section must be active and belong to this term', 'SECTION_TERM_MISMATCH');
        }
      }
      const [[mx]]: any = await conn.query('SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM timetable_versions WHERE term_id = ?', [b.term_id]);
      const [ins]: any = await conn.query(
        'INSERT INTO timetable_versions (term_id, version_no, parent_version_id, created_by) VALUES (?, ?, ?, ?)',
        [b.term_id, mx.next_no, b.parent_version_id ?? null, req.user!.userId]);
      for (const sid of sectionIds) {
        await conn.query('INSERT INTO timetable_version_sections (version_id, term_id, section_id) VALUES (?, ?, ?)', [ins.insertId, b.term_id, sid]);
      }
      await audit(conn, req.user!.userId, 'TIMETABLE_VERSION_CREATED', 'timetable_versions', ins.insertId,
        { term_id: b.term_id, version_no: mx.next_no, parent_version_id: b.parent_version_id ?? null, sections: sectionIds.length });
      const [[row]]: any = await conn.query('SELECT * FROM timetable_versions WHERE version_id = ?', [ins.insertId]);
      return row;
    });
    res.status(201).json(ok(created));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// GET /api/timetable/versions/:id
// Returns a timetable version with its sections and latest validation run.
// ---------------------------------------------------------------------------
timetableRouter.get('/versions/:id', canRead, async (req, res, next) => {
  try {
    const id = paramId.parse(req.params.id);

    const [vRows]: any = await pool.query(
      `SELECT v.*, t.term_name, y.year_label
       FROM timetable_versions v
       JOIN terms t ON t.term_id = v.term_id
       JOIN academic_years y ON y.year_id = t.year_id
       WHERE v.version_id = ?`,
      [id],
    );
    if (!vRows[0]) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');

    const [sections]: any = await pool.query(
      `SELECT tvs.section_id, s.section_name, sem.semester_no
       FROM timetable_version_sections tvs
       JOIN sections  s   ON s.section_id   = tvs.section_id
       JOIN semesters sem ON sem.semester_id = s.semester_id
       WHERE tvs.version_id = ?`,
      [id],
    );

    const [latestRun]: any = await pool.query(
      `SELECT * FROM validation_runs
       WHERE version_id = ? ORDER BY started_at DESC LIMIT 1`,
      [id],
    );
    const [approvalActions]: any = await pool.query(
      `SELECT aa.approval_id, aa.action_type, aa.actor_role, aa.action_at, aa.comment, u.name AS actor_name
       FROM approval_actions aa
       JOIN users u ON u.user_id = aa.actor_id
       WHERE aa.version_id = ? ORDER BY aa.action_at DESC, aa.approval_id DESC`,
      [id],
    );

    res.json(ok({ version: vRows[0], sections, latest_validation: latestRun[0] ?? null, approval_actions: approvalActions }));
  } catch (e) {
    next(e);
  }
});

timetableRouter.post('/versions/:id/submit-review', requirePermission('timetable:review'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const result = await submitTimetableForReview(versionId, req.user!.userId, req.user!.roles);
    if (result.status !== 'IN_REVIEW') {
      throw new HttpError(422, 'Timetable review is blocked by validation errors or missing scheduled sessions.', 'TIMETABLE_REVIEW_BLOCKED', {
        validation: result.validation,
      });
    }
    res.json(ok(result));
  } catch (error) {
    next(error);
  }
});

timetableRouter.post('/versions/:id/request-changes', requirePermission('timetable:review'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const body = z.object({ comment: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    res.json(ok(await requestTimetableChanges(versionId, req.user!.userId, req.user!.roles, body.comment)));
  } catch (error) {
    next(error);
  }
});

timetableRouter.post('/versions/:id/approve', requirePermission('timetable:approve', 'timetable:publish'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const result = await approveTimetable(versionId, req.user!.userId, req.user!.roles);
    if (result.status !== 'APPROVED') {
      throw new HttpError(422, 'Timetable approval is blocked by validation errors or missing scheduled sessions.', 'TIMETABLE_APPROVAL_BLOCKED', {
        validation: result.validation,
      });
    }
    res.json(ok(result));
  } catch (error) {
    next(error);
  }
});

timetableRouter.post('/versions/:id/publish', requirePermission('timetable:publish'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const result = await publishTimetable(versionId, req.user!.userId, req.user!.roles);
    if (result.status !== 'PUBLISHED') {
      throw new HttpError(422, 'Timetable publication is blocked by validation errors or missing scheduled sessions.', 'TIMETABLE_PUBLICATION_BLOCKED', {
        validation: result.validation,
      });
    }
    res.json(ok(result));
  } catch (error) {
    next(error);
  }
});

// Draft-session management. Session details are always scoped through version_id.
timetableRouter.get('/versions/:id/session-options', canRead, async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    res.json(ok(await getTimetableSessionOptions(versionId)));
  } catch (e) {
    next(e);
  }
});

timetableRouter.get('/versions/:id/sessions', canRead, async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    res.json(ok(await listTimetableSessions(versionId)));
  } catch (e) {
    next(e);
  }
});

timetableRouter.get('/versions/:id/sessions/:sessionId', canRead, async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const sessionId = paramId.parse(req.params.sessionId);
    const [session] = await listTimetableSessions(versionId, sessionId);
    res.json(ok(session));
  } catch (e) {
    next(e);
  }
});

timetableRouter.post('/versions/:id/sessions', requirePermission('timetable:edit'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const input = timetableSessionInput.parse(req.body);
    const sessionId = await createTimetableSession(versionId, input, req.user!.userId);
    const [session] = await listTimetableSessions(versionId, sessionId);
    res.status(201).json(ok(session));
  } catch (e) {
    next(e);
  }
});

timetableRouter.put('/versions/:id/sessions/:sessionId', requirePermission('timetable:edit'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const sessionId = paramId.parse(req.params.sessionId);
    const input = timetableSessionInput.parse(req.body);
    await updateTimetableSession(versionId, sessionId, input, req.user!.userId);
    const [session] = await listTimetableSessions(versionId, sessionId);
    res.json(ok(session));
  } catch (e) {
    next(e);
  }
});

timetableRouter.delete('/versions/:id/sessions/:sessionId', requirePermission('timetable:edit'), async (req, res, next) => {
  try {
    const versionId = paramId.parse(req.params.id);
    const sessionId = paramId.parse(req.params.sessionId);
    await deleteTimetableSession(versionId, sessionId, req.user!.userId);
    res.json(ok({ session_id: sessionId, deleted: true }));
  } catch (e) {
    next(e);
  }
});
