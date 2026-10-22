export interface WorkloadAssignmentInput {
  role: string;
  component_type: string;
  weekly_hours: number | string | null;
  is_approved: number | boolean;
}

export interface WorkloadHours {
  confirmed_hours: number;
  unconfirmed_hours: number;
  approved_hours: number;
  draft_hours: number;
}

const CONFIRMED_ROLES = new Set(['LECTURER', 'LAB_LEAD', 'TUTOR']);

function activityTypeFor(role: string, componentType: string): string | null {
  if (role === 'LAB_ASSISTANT') return 'LAB_ASSISTANT';
  if (componentType === 'PROJECT') return 'PROJECT_SUPERVISION';
  return null;
}

export function calculateWorkloadHours(
  assignments: WorkloadAssignmentInput[],
  policyMap: ReadonlyMap<string, string>,
  includeDraftAssignments: boolean,
): WorkloadHours {
  let confirmedHours = 0;
  let unconfirmedHours = 0;
  let approvedHours = 0;
  let draftHours = 0;

  for (const assignment of assignments) {
    const hours = Number(assignment.weekly_hours ?? 0);
    const approved = Boolean(assignment.is_approved);
    const countsConfirmed = CONFIRMED_ROLES.has(assignment.role)
      || policyMap.get(activityTypeFor(assignment.role, assignment.component_type) ?? '') === 'YES';

    if (countsConfirmed) {
      if (approved) approvedHours += hours;
      else draftHours += hours;
      if (approved || includeDraftAssignments) confirmedHours += hours;
      continue;
    }

    const activityType = activityTypeFor(assignment.role, assignment.component_type);
    const policy = activityType ? policyMap.get(activityType) ?? 'UNCONFIRMED' : 'UNCONFIRMED';
    if (policy === 'UNCONFIRMED' && (approved || includeDraftAssignments)) {
      unconfirmedHours += hours;
    }
  }

  return {
    confirmed_hours: confirmedHours,
    unconfirmed_hours: unconfirmedHours,
    approved_hours: approvedHours,
    draft_hours: draftHours,
  };
}

export interface AllocationRequirementInput {
  course_name: string;
  component_id: number | null;
  component_type: string;
  weekly_hours: number | string | null;
  offering_id: number | null;
  offering_status: string | null;
  audience_id: number | null;
  batch_id: number | null;
  batch_is_active: number | boolean | null;
  section_is_active: number | boolean;
  data_status: string;
  assignments: Array<{
    faculty_name: string;
    role: string;
    role_status: string;
    faculty_data_status: string;
    is_active: number | boolean;
    availability_confirmed: number | boolean;
    preference_rank: number | null;
    accepted_preferences_exist: number | boolean;
  }>;
}

export interface AllocationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  audience_id: number | null;
}

export function validateAllocationRequirements(
  requirements: AllocationRequirementInput[],
): AllocationIssue[] {
  const isVerified = (status: string) => status === 'VERIFIED' || status === 'RESOLVED';
  const issues: AllocationIssue[] = [];
  for (const requirement of requirements) {
    const scope = `${requirement.course_name} (${requirement.component_type})`;
    const add = (severity: AllocationIssue['severity'], code: string, message: string) => {
      issues.push({ severity, code, message, audience_id: requirement.audience_id });
    };

    if (requirement.component_id == null) {
      add('ERROR', 'MISSING_COMPONENT', `${requirement.course_name} has no configured teaching component.`);
    }
    if (requirement.weekly_hours == null || Number(requirement.weekly_hours) <= 0) {
      add('ERROR', 'MISSING_WEEKLY_HOURS', `${scope} has no configured weekly teaching hours.`);
    }
    if (requirement.offering_id == null || requirement.offering_status !== 'OFFERED') {
      add('ERROR', 'MISSING_OFFERING', `${scope} has no offered course instance for the selected term.`);
    }
    if (requirement.offering_id != null && requirement.audience_id == null) {
      add('ERROR', 'MISSING_AUDIENCE', `${scope} has no offering audience for the selected section or batch.`);
    }
    if (requirement.batch_id != null && !requirement.batch_is_active) {
      add('ERROR', 'INVALID_BATCH', `${scope} references an inactive batch or a batch that does not belong to the selected section.`);
    }
    if (!requirement.section_is_active) {
      add('ERROR', 'INACTIVE_SECTION', `${scope} belongs to an inactive division.`);
    }
    if (requirement.audience_id != null && requirement.assignments.length === 0) {
      add('ERROR', 'MISSING_FACULTY', `${scope} has no faculty assignment for this section or batch.`);
    }
    if (requirement.data_status !== 'VERIFIED' && requirement.data_status !== 'RESOLVED') {
      add('ERROR', 'UNVERIFIED_REQUIREMENT', `${scope} has data status ${requirement.data_status}; resolve and verify the teaching requirement before finalizing.`);
    }

    for (const assignment of requirement.assignments) {
      if (!assignment.is_active) {
        add('ERROR', 'INACTIVE_FACULTY', `${assignment.faculty_name} is inactive but assigned to ${scope}.`);
      }
      if (!isVerified(assignment.faculty_data_status)) {
        add('ERROR', 'UNVERIFIED_FACULTY', `${assignment.faculty_name} has data status ${assignment.faculty_data_status}; verify the faculty record before finalizing.`);
      }
      if (!isVerified(assignment.role_status)) {
        add('ERROR', 'UNVERIFIED_ASSIGNMENT_ROLE', `${assignment.faculty_name}'s assignment role is ${assignment.role_status}; verify it before finalizing.`);
      }
      if (assignment.role === 'UNSPECIFIED') {
        add('ERROR', 'UNSPECIFIED_ROLE', `${assignment.faculty_name} has no teaching role specified for ${scope}.`);
      }
      if (!assignment.availability_confirmed) {
        add('ERROR', 'AVAILABILITY_UNKNOWN', `${assignment.faculty_name} has no verified AVAILABLE time for this term; availability remains UNKNOWN.`);
      } else {
        add('WARNING', 'SCHEDULE_AVAILABILITY_CHECK_REQUIRED', `${assignment.faculty_name}'s submitted availability must be checked against scheduled day/time before timetable finalization.`);
      }
      if (assignment.accepted_preferences_exist && assignment.preference_rank == null) {
        add('WARNING', 'PREFERENCE_MISMATCH', `${assignment.faculty_name} did not rank ${scope} in an accepted preference submission.`);
      }
    }
  }
  return issues;
}

export function validateWorkloadReadiness(input: {
  faculty_name: string;
  limit_status: string;
  max_hours: number | null;
  assigned_hours?: number;
  warning_message?: string | null;
}): AllocationIssue[] {
  if (input.limit_status === 'OVER_LIMIT') {
    return [{
      severity: 'ERROR',
      code: 'WORKLOAD_LIMIT_EXCEEDED',
      message: input.warning_message ??
        `${input.faculty_name} is assigned ${input.assigned_hours ?? 'more than'} hours/week, over the verified hard limit of ${input.max_hours}.`,
      audience_id: null,
    }];
  }
  if (input.limit_status === 'NO_RULE' || input.max_hours == null) {
    return [{
      severity: 'ERROR',
      code: 'WORKLOAD_RULE_MISSING',
      message: input.warning_message ?? `${input.faculty_name}'s workload limit cannot be verified from configured data.`,
      audience_id: null,
    }];
  }
  if (input.limit_status === 'WARNING') {
    return [{
      severity: 'WARNING',
      code: 'WORKLOAD_WARNING',
      message: input.warning_message ?? `${input.faculty_name}'s workload is within a warning-only policy.`,
      audience_id: null,
    }];
  }
  return [];
}
