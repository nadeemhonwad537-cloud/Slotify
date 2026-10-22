export type TimetableLifecycleStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PUBLISHED'
  | 'ARCHIVED';

const ROLE_PRIORITY = ['ADMIN', 'COORDINATOR', 'FACULTY', 'STUDENT'];

export function authorizedTimetableActorRole(userRoles: string[], permissionRoles: string[]): string | null {
  const grantedRoles = new Set(permissionRoles);
  return ROLE_PRIORITY.find(role => userRoles.includes(role) && grantedRoles.has(role)) ?? null;
}

export function canSubmitTimetableForReview(input: {
  status: string;
  validationStatus: string;
  errorCount: number;
  sessionCount: number;
  availabilityUnknownStatus: string;
}): boolean {
  return input.status === 'VALIDATED'
    && input.validationStatus === 'PASSED'
    && input.errorCount === 0
    && input.sessionCount > 0
    && input.availabilityUnknownStatus !== 'OPEN';
}

export function canPublishTimetable(input: {
  status: string;
  validationStatus: string | null;
  errorCount: number;
  sessionCount: number;
  availabilityUnknownStatus: string;
}): boolean {
  return input.status === 'APPROVED'
    && input.validationStatus === 'PASSED'
    && input.errorCount === 0
    && input.sessionCount > 0
    && input.availabilityUnknownStatus !== 'OPEN';
}

export function canApproveTimetable(input: {
  status: string;
  validationStatus: string;
  errorCount: number;
  sessionCount: number;
  availabilityUnknownStatus: string;
}): boolean {
  return input.status === 'IN_REVIEW'
    && input.validationStatus === 'PASSED'
    && input.errorCount === 0
    && input.sessionCount > 0
    && input.availabilityUnknownStatus !== 'OPEN';
}

export function isSessionAcademicContextConsistent(input: {
  sessionTermId: number;
  versionTermId: number;
  offeringTermId: number | null;
  audienceMatchesOffering: boolean;
  sectionTermId: number | null;
  sectionInVersion: boolean;
  activeCurriculumMapping: boolean;
  courseInCurriculum: boolean;
}): boolean {
  return input.sessionTermId === input.versionTermId
    && input.offeringTermId === input.versionTermId
    && input.audienceMatchesOffering
    && input.sectionTermId === input.versionTermId
    && input.sectionInVersion
    && input.activeCurriculumMapping
    && input.courseInCurriculum;
}
