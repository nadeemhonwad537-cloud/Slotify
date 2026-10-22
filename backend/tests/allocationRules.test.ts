import { describe, expect, it } from 'vitest';
import { calculateWorkloadHours, validateAllocationRequirements } from '../src/services/allocationRules';

describe('allocation workload rules', () => {
  it('separates approved, draft, and explicitly unconfirmed weekly hours', () => {
    const result = calculateWorkloadHours([
      { role: 'LECTURER', component_type: 'THEORY', weekly_hours: 3, is_approved: 1 },
      { role: 'LAB_LEAD', component_type: 'LAB', weekly_hours: '2.00', is_approved: 0 },
      { role: 'LAB_ASSISTANT', component_type: 'LAB', weekly_hours: 2, is_approved: 1 },
    ], new Map([['LAB_ASSISTANT', 'UNCONFIRMED']]), true);

    expect(result).toEqual({
      confirmed_hours: 5,
      unconfirmed_hours: 2,
      approved_hours: 3,
      draft_hours: 2,
    });
  });

  it('does not include draft assignments in confirmed workload reads', () => {
    const result = calculateWorkloadHours([
      { role: 'LECTURER', component_type: 'THEORY', weekly_hours: 3, is_approved: 1 },
      { role: 'LECTURER', component_type: 'THEORY', weekly_hours: 2, is_approved: 0 },
    ], new Map(), false);

    expect(result.confirmed_hours).toBe(3);
    expect(result.draft_hours).toBe(2);
  });

  it('counts special roles only when the stored policy explicitly says yes', () => {
    const result = calculateWorkloadHours([
      { role: 'LAB_ASSISTANT', component_type: 'LAB', weekly_hours: 2, is_approved: 1 },
      { role: 'LAB_ASSISTANT', component_type: 'LAB', weekly_hours: 1, is_approved: 0 },
      { role: 'TUTOR', component_type: 'TUTORIAL', weekly_hours: 1, is_approved: 1 },
    ], new Map([['LAB_ASSISTANT', 'YES']]), true);

    expect(result).toEqual({
      confirmed_hours: 4,
      unconfirmed_hours: 0,
      approved_hours: 3,
      draft_hours: 1,
    });
  });
});

describe('allocation coverage validation', () => {
  it('blocks missing offerings, audience, weekly hours, faculty, and unspecified roles', () => {
    const issues = validateAllocationRequirements([
      {
        course_name: 'Algorithms',
        component_id: null,
        component_type: 'LAB',
        weekly_hours: null,
        offering_id: null,
        offering_status: null,
        audience_id: null,
        batch_id: null,
        batch_is_active: null,
        section_is_active: 1,
        data_status: 'VERIFY',
        assignments: [],
      },
      {
        course_name: 'Databases',
        component_id: 11,
        component_type: 'THEORY',
        weekly_hours: 3,
        offering_id: 5,
        offering_status: 'OFFERED',
        audience_id: 9,
        batch_id: null,
        batch_is_active: null,
        section_is_active: 1,
        data_status: 'VERIFIED',
        assignments: [{
          faculty_name: 'Sample Faculty',
          role: 'UNSPECIFIED',
          role_status: 'VERIFY',
          faculty_data_status: 'VERIFY',
          is_active: 1,
          availability_confirmed: 0,
          preference_rank: null,
          accepted_preferences_exist: 0,
        }],
      },
    ]);

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'MISSING_COMPONENT',
      'MISSING_WEEKLY_HOURS',
      'MISSING_OFFERING',
      'UNVERIFIED_REQUIREMENT',
      'UNSPECIFIED_ROLE',
      'UNVERIFIED_ASSIGNMENT_ROLE',
      'UNVERIFIED_FACULTY',
      'AVAILABILITY_UNKNOWN',
    ]));
    expect(issues.filter(issue => [
      'UNVERIFIED_REQUIREMENT',
      'UNVERIFIED_ASSIGNMENT_ROLE',
      'UNVERIFIED_FACULTY',
      'AVAILABILITY_UNKNOWN',
    ].includes(issue.code)).every(issue => issue.severity === 'ERROR')).toBe(true);
  });

  it('reports a faculty inactivity and preference mismatch', () => {
    const issues = validateAllocationRequirements([{
      course_name: 'Databases',
      component_id: 11,
      component_type: 'THEORY',
      weekly_hours: 3,
      offering_id: 5,
      offering_status: 'OFFERED',
      audience_id: 9,
      batch_id: null,
      batch_is_active: null,
      data_status: 'VERIFIED',
      assignments: [{
        faculty_name: 'Inactive Faculty',
        role: 'LECTURER',
        role_status: 'VERIFIED',
        faculty_data_status: 'VERIFIED',
        is_active: 0,
        availability_confirmed: 1,
        preference_rank: null,
        accepted_preferences_exist: 1,
      }],
    }]);

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'INACTIVE_FACULTY',
      'PREFERENCE_MISMATCH',
      'SCHEDULE_AVAILABILITY_CHECK_REQUIRED',
    ]));
    expect(issues.some(issue => issue.severity === 'ERROR')).toBe(true);
  });
});
