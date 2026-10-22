import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AllocationRequirementInput,
  validateAllocationRequirements,
  validateWorkloadReadiness,
} from '../src/services/allocationRules';

const validRequirement = (): AllocationRequirementInput => ({
  course_name: 'Algorithms',
  component_id: 1,
  component_type: 'THEORY',
  weekly_hours: 3,
  offering_id: 1,
  offering_status: 'OFFERED',
  audience_id: 1,
  batch_id: null,
  batch_is_active: null,
  section_is_active: 1,
  data_status: 'VERIFIED',
  assignments: [{
    faculty_name: 'Verified Faculty',
    role: 'LECTURER',
    role_status: 'VERIFIED',
    faculty_data_status: 'VERIFIED',
    is_active: 1,
    availability_confirmed: 1,
    preference_rank: 1,
    accepted_preferences_exist: 1,
  }],
});

test('allocation finalization blocks missing or unverified available faculty windows', () => {
  const requirement = validRequirement();
  requirement.assignments[0].availability_confirmed = 0;

  const issues = validateAllocationRequirements([requirement]);
  const availabilityIssue = issues.find(issue => issue.code === 'AVAILABILITY_UNKNOWN');

  assert.equal(availabilityIssue?.severity, 'ERROR');
});

test('allocation finalization blocks unverified curriculum, faculty, and assignment role data', () => {
  const requirement = validRequirement();
  requirement.data_status = 'SYNTHETIC';
  requirement.assignments[0].faculty_data_status = 'VERIFY';
  requirement.assignments[0].role_status = 'DISCREPANCY';

  const issues = validateAllocationRequirements([requirement]);
  const blockingCodes = new Set(issues.filter(issue => issue.severity === 'ERROR').map(issue => issue.code));

  assert.ok(blockingCodes.has('UNVERIFIED_REQUIREMENT'));
  assert.ok(blockingCodes.has('UNVERIFIED_FACULTY'));
  assert.ok(blockingCodes.has('UNVERIFIED_ASSIGNMENT_ROLE'));
});

test('allocation finalization blocks assignments attached to inactive divisions', () => {
  const requirement = validRequirement();
  requirement.section_is_active = 0;

  const issues = validateAllocationRequirements([requirement]);

  assert.ok(issues.some(issue => issue.code === 'INACTIVE_SECTION' && issue.severity === 'ERROR'));
});

test('verified requirements and assignment data with confirmed availability remain finalizable', () => {
  const issues = validateAllocationRequirements([validRequirement()]);

  assert.ok(issues.every(issue => issue.severity !== 'ERROR'));
  assert.ok(issues.some(issue => issue.code === 'SCHEDULE_AVAILABILITY_CHECK_REQUIRED'));
});

test('missing workload rules block while an explicit warning-mode policy stays visible as a warning', () => {
  const missingRule = validateWorkloadReadiness({
    faculty_name: 'Faculty',
    limit_status: 'NO_RULE',
    max_hours: null,
  });
  const warningMode = validateWorkloadReadiness({
    faculty_name: 'Faculty',
    limit_status: 'WARNING',
    max_hours: 18,
    warning_message: 'Verified warning-only workload policy exceeded.',
  });

  assert.equal(missingRule[0]?.severity, 'ERROR');
  assert.equal(missingRule[0]?.code, 'WORKLOAD_RULE_MISSING');
  assert.equal(warningMode[0]?.severity, 'WARNING');
  assert.equal(warningMode[0]?.code, 'WORKLOAD_WARNING');
});
