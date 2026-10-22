/**
 * Admin dashboard statistics. Every number comes from the database; nothing is hardcoded.
 * GET /api/admin/dashboard   (permission: masterdata:write, i.e. ADMIN)
 */
import { Router } from 'express';
import { pool } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';

export const adminRouter = Router();
adminRouter.use(authenticate);

async function n(sql: string, params: unknown[] = []): Promise<number> {
  const [rows]: any = await pool.query(sql, params);
  return Number(rows[0]?.n ?? 0);
}
async function grouped(sql: string): Promise<Record<string, number>> {
  const [rows]: any = await pool.query(sql);
  return Object.fromEntries(rows.map((r: any) => [r.k, Number(r.n)]));
}

adminRouter.get('/dashboard', requirePermission('masterdata:write'), async (_req, res, next) => {
  try {
    const [departments, faculty, rooms, courses, sections, offerings, users] = await Promise.all([
      n('SELECT COUNT(*) n FROM departments WHERE is_active = 1'),
      n('SELECT COUNT(*) n FROM faculty_profiles WHERE is_active = 1'),
      n('SELECT COUNT(*) n FROM rooms WHERE is_active = 1'),
      n('SELECT COUNT(*) n FROM courses WHERE is_active = 1'),
      n('SELECT COUNT(*) n FROM sections'),
      n("SELECT COUNT(*) n FROM course_offerings WHERE status <> 'CANCELLED'"),
      n("SELECT COUNT(*) n FROM users WHERE status = 'ACTIVE'"),
    ]);
    const [terms, assignments, submissionStatus, reviewStatus, versions] = await Promise.all([
      grouped('SELECT status k, COUNT(*) n FROM terms GROUP BY status'),
      grouped("SELECT IF(is_approved = 1, 'APPROVED', 'PENDING') k, COUNT(*) n FROM faculty_assignments GROUP BY k"),
      grouped('SELECT submission_status k, COUNT(*) n FROM faculty_submissions GROUP BY submission_status'),
      grouped('SELECT review_status k, COUNT(*) n FROM faculty_submissions GROUP BY review_status'),
      grouped('SELECT status k, COUNT(*) n FROM timetable_versions GROUP BY status'),
    ]);
    const [latestRows]: any = await pool.query(
      `SELECT v.version_id, v.version_no, v.status, t.term_name, vr.status AS validation_status, vr.started_at AS validated_at,
              (SELECT COUNT(*) FROM validation_issues i WHERE i.validation_id = vr.validation_id AND i.severity = 'ERROR') AS errors,
              (SELECT COUNT(*) FROM validation_issues i WHERE i.validation_id = vr.validation_id AND i.severity = 'WARNING') AS warnings
       FROM timetable_versions v JOIN terms t ON t.term_id = v.term_id
       LEFT JOIN validation_runs vr ON vr.validation_id = (SELECT MAX(x.validation_id) FROM validation_runs x WHERE x.version_id = v.version_id)
       ORDER BY v.created_at DESC, v.version_id DESC LIMIT 1`);

    // Configuration warnings: each is computed from live data.
    const checks: Array<[string, 'WARNING' | 'INFO', string, Promise<number>]> = [
      ['NO_DEPARTMENTS', 'WARNING', 'No departments have been created', Promise.resolve(departments === 0 ? 1 : 0)],
      ['NO_TERMS', 'WARNING', 'No academic terms have been configured', Promise.resolve(Object.values(terms).reduce((a, b) => a + b, 0) === 0 ? 1 : 0)],
      ['TERM_NO_TEACHING_DAYS', 'WARNING', 'term(s) have no teaching days configured',
        n('SELECT COUNT(*) n FROM terms t WHERE t.status <> \'CLOSED\' AND NOT EXISTS (SELECT 1 FROM term_teaching_days d WHERE d.term_id = t.term_id)')],
      ['TERM_NO_TIME_SLOTS', 'WARNING', 'term(s) have no time slots configured',
        n('SELECT COUNT(*) n FROM terms t WHERE t.status <> \'CLOSED\' AND NOT EXISTS (SELECT 1 FROM time_slots s WHERE s.term_id = t.term_id)')],
      ['FACULTY_NO_DESIGNATION', 'WARNING', 'active faculty have no designation (workload limits cannot apply; never inferred from names)',
        n('SELECT COUNT(*) n FROM faculty_profiles WHERE is_active = 1 AND designation_id IS NULL')],
      ['FACULTY_NO_DEPARTMENT', 'INFO', 'active faculty have no department', n('SELECT COUNT(*) n FROM faculty_profiles WHERE is_active = 1 AND dept_id IS NULL')],
      ['NO_VERIFIED_WORKLOAD_RULE', 'WARNING', 'designation(s) have no VERIFIED workload rule (no limit is enforced until verified)',
        n(`SELECT COUNT(*) n FROM designations d WHERE d.is_active = 1 AND NOT EXISTS
           (SELECT 1 FROM faculty_workload_rules r WHERE r.designation_id = d.designation_id AND r.is_active = 1 AND r.data_status = 'VERIFIED')`)],
      ['ROOM_NO_CAPACITY', 'WARNING', 'active room(s) have no capacity set', n('SELECT COUNT(*) n FROM rooms WHERE is_active = 1 AND capacity IS NULL')],
      ['COMPONENT_NO_HOURS', 'WARNING', 'course component(s) have no weekly hours', n('SELECT COUNT(*) n FROM course_components WHERE weekly_hours IS NULL')],
      ['OFFERING_NO_AUDIENCE', 'WARNING', 'offering(s) have no audience (section/batch)',
        n("SELECT COUNT(*) n FROM course_offerings o WHERE o.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM offering_audiences a WHERE a.offering_id = o.offering_id)")],
      ['AUDIENCE_NO_APPROVED_FACULTY', 'INFO', 'audience(s) have no approved faculty assignment',
        n('SELECT COUNT(*) n FROM offering_audiences a WHERE NOT EXISTS (SELECT 1 FROM faculty_assignments f WHERE f.audience_id = a.audience_id AND f.is_approved = 1)')],
      ['UNCONFIRMED_COUNTING_RULES', 'INFO', 'workload counting rule(s) remain UNCONFIRMED (lab assistant / project / SDP / minor project)',
        n("SELECT COUNT(*) n FROM workload_counting_policy WHERE counts_toward_limit = 'UNCONFIRMED'")],
    ];
    const counts = await Promise.all(checks.map((c) => c[3]));
    const warnings = checks
      .map((c, i) => ({ code: c[0], severity: c[1], count: counts[i], message: `${counts[i]} ${c[2]}`.replace(/^1 (\w+)\(s\)/, '1 $1') }))
      .filter((w) => w.count > 0)
      .map((w) => (w.code === 'NO_DEPARTMENTS' || w.code === 'NO_TERMS' ? { ...w, message: checks.find((c) => c[0] === w.code)![2] } : w));

    res.json(ok({
      totals: { departments, faculty, rooms, courses, sections, offerings, activeUsers: users },
      terms, assignments, submissions: { submission_status: submissionStatus, review_status: reviewStatus },
      versions, latestVersion: latestRows[0] ?? null, warnings,
      generator: { implemented: false, note: 'Automatic timetable generation is a separate pending milestone.' },
    }));
  } catch (e) { next(e); }
});
