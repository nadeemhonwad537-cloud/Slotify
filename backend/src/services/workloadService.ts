/**
 * Workload service — Milestone 3.
 *
 * Computes a faculty member's weekly teaching hours for a given term from
 * their approved assignments, then evaluates those hours against the
 * configured workload rules for their designation.
 *
 * Design rules (from HANDOVER.md and DECISIONS.md):
 *  - Only LECTURER, LAB_LEAD, and TUTOR roles count as confirmed load.
 *  - LAB_ASSISTANT, PROJECT_SUPERVISION, SDP, MINOR_PROJECT follow the
 *    workload_counting_policy table; UNCONFIRMED => reported separately,
 *    never silently counted.
 *  - A rule is applied ONLY when the faculty has a designation AND at least
 *    one active workload rule for that designation with data_status = VERIFIED.
 *    Anything else returns a WARNING, never silently unlimited.
 *  - Enforcement mode HARD => 422 on creation/change/approve when over the limit.
 *    WARNING mode => included in the result but the operation is not blocked.
 *  - Revalidation happens on every create, change, and approve action.
 */

import { PoolConnection } from 'mysql2/promise';
import { pool } from '../db/pool';
import { calculateWorkloadHours } from './allocationRules';
import { HttpError } from '../utils/errors';

export interface WorkloadResult {
  faculty_id: number;
  term_id: number;
  confirmed_hours: number;
  unconfirmed_hours: number;
  /** Roles with UNCONFIRMED counting policy that contributed to unconfirmed_hours. */
  unconfirmed_activities: UnconfirmedActivity[];
  limit_status: 'OK' | 'OVER_LIMIT' | 'WARNING' | 'NO_RULE';
  /** Present when a rule was found. */
  max_hours?: number;
  enforcement_mode?: 'HARD' | 'WARNING';
  /** Human-readable explanation for WARNING / NO_RULE cases. */
  warning_message?: string;
}

export interface UnconfirmedActivity {
  assignment_id: number;
  role: string;
  activity_type: string;
  weekly_hours: number | null;
  counts_toward_limit: string; // UNCONFIRMED in practice here
}

/**
 * Computes the workload for a faculty member in a term.
 * Uses a connection when called inside a transaction, otherwise uses the pool.
 *
 * @param includeUnapproved - when true, counts all assignments regardless of
 *   is_approved status. Used during write validation (create/patch/approve) so
 *   that a row being inserted or promoted is included in the limit check even
 *   before it reaches is_approved=1. The default (false) is used for the
 *   read-only /workload endpoint, which reports only confirmed committed load.
 */
export async function computeWorkload(
  facultyId: number,
  termId: number,
  conn?: PoolConnection,
  includeUnapproved = false,
): Promise<WorkloadResult> {
  const db: any = conn ?? pool;

  // --- 1. Pull assignments for this faculty in this term -----------------------
  const [assignments]: any = await db.query(
    `SELECT
       fa.assignment_id,
       fa.role,
       fa.is_approved,
       cc.weekly_hours,
       cc.component_type
     FROM faculty_assignments fa
     JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
     JOIN course_offerings co   ON co.offering_id  = oa.offering_id
     JOIN course_components cc  ON cc.component_id = co.component_id
     WHERE fa.faculty_id = ?
       AND co.term_id    = ?`,
    [facultyId, termId],
  );

  // --- 2. Pull the counting policy for special activities ----------------------
  const [policies]: any = await db.query(
    'SELECT activity_type, counts_toward_limit FROM workload_counting_policy',
  );
  const policyMap = new Map<string, string>(
    policies.map((p: any) => [p.activity_type, p.counts_toward_limit]),
  );

  // --- 3. Split into confirmed and unconfirmed ---------------------------------
  const hours = calculateWorkloadHours(assignments, policyMap, includeUnapproved);
  const confirmedHours = hours.confirmed_hours;
  const unconfirmedHours = hours.unconfirmed_hours;
  const unconfirmedActivities: UnconfirmedActivity[] = assignments.flatMap((a: any) => {
    if (!a.is_approved && !includeUnapproved) return [];
    const activityType = a.role === 'LAB_ASSISTANT'
      ? 'LAB_ASSISTANT'
      : a.component_type === 'PROJECT' ? 'PROJECT_SUPERVISION' : null;
    const policy = activityType ? (policyMap.get(activityType) ?? 'UNCONFIRMED') : 'UNCONFIRMED';
    return policy === 'UNCONFIRMED'
      ? [{
          assignment_id: a.assignment_id,
          role: a.role,
          activity_type: activityType ?? a.role,
          weekly_hours: a.weekly_hours,
          counts_toward_limit: policy,
        }]
      : [];
  });

  // --- 4. Find the designation and active VERIFIED workload rule ---------------
  const [facultyRows]: any = await db.query(
    'SELECT designation_id FROM faculty_profiles WHERE faculty_id = ?',
    [facultyId],
  );
  const designationId: number | null = facultyRows[0]?.designation_id ?? null;

  if (!designationId) {
    return {
      faculty_id: facultyId,
      term_id: termId,
      confirmed_hours: confirmedHours,
      unconfirmed_hours: unconfirmedHours,
      unconfirmed_activities: unconfirmedActivities,
      limit_status: 'WARNING',
      warning_message:
        'Faculty member has no designation set; workload limit cannot be verified.',
    };
  }

  const [rules]: any = await db.query(
    `SELECT workload_rule_id, max_hours, enforcement_mode, data_status
     FROM faculty_workload_rules
     WHERE designation_id = ?
       AND is_active = 1
       AND data_status = 'VERIFIED'
     ORDER BY workload_rule_id DESC
     LIMIT 1`,
    [designationId],
  );

  if (!rules[0]) {
    // Designation exists but no VERIFIED rule — always a WARNING, never unlimited
    return {
      faculty_id: facultyId,
      term_id: termId,
      confirmed_hours: confirmedHours,
      unconfirmed_hours: unconfirmedHours,
      unconfirmed_activities: unconfirmedActivities,
      limit_status: 'NO_RULE',
      warning_message:
        'No VERIFIED workload rule found for this faculty designation. Limit cannot be enforced.',
    };
  }

  const rule = rules[0];
  const maxHours: number = Number(rule.max_hours);
  const mode: 'HARD' | 'WARNING' = rule.enforcement_mode;

  const overLimit = confirmedHours > maxHours;
  const limitStatus = overLimit
    ? mode === 'HARD'
      ? 'OVER_LIMIT'
      : 'WARNING'
    : 'OK';

  return {
    faculty_id: facultyId,
    term_id: termId,
    confirmed_hours: confirmedHours,
    unconfirmed_hours: unconfirmedHours,
    unconfirmed_activities: unconfirmedActivities,
    limit_status: limitStatus,
    max_hours: maxHours,
    enforcement_mode: mode,
    ...(limitStatus === 'WARNING' && overLimit
      ? {
          warning_message: `Confirmed hours (${confirmedHours}) exceed the limit (${maxHours}) but enforcement is WARNING only.`,
        }
      : {}),
  };
}

/**
 * Validates workload and throws a 422 HttpError when enforcement_mode is HARD
 * and the faculty is over the limit. Call inside the assignment write transaction.
 */
export async function assertWorkloadOk(
  conn: PoolConnection,
  facultyId: number,
  termId: number,
): Promise<WorkloadResult> {
  // Always include unapproved rows when validating a write — the row being
  // created/changed/approved is unapproved at the moment of the check.
  const result = await computeWorkload(facultyId, termId, conn, true);
  if (result.limit_status === 'OVER_LIMIT') {
    throw new HttpError(
      422,
      `Assignment would exceed the faculty workload limit of ${result.max_hours} hours/week ` +
        `(current confirmed total: ${result.confirmed_hours} hours).`,
      'WORKLOAD_EXCEEDED',
      {
        confirmed_hours: result.confirmed_hours,
        max_hours: result.max_hours,
        enforcement_mode: result.enforcement_mode,
      },
    );
  }
  return result;
}

/** Maps an assignment role + component_type to a workload_counting_policy activity_type key. */
function roleToActivityType(role: string, componentType: string): string | null {
  if (role === 'LAB_ASSISTANT') return 'LAB_ASSISTANT';
  if (componentType === 'PROJECT') return 'PROJECT_SUPERVISION';
  // SDP and MINOR_PROJECT would need a dedicated role or component type not yet in the schema.
  // Do not invent mappings — return null so they land in UNCONFIRMED.
  return null;
}
