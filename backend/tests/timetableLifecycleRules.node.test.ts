import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizedTimetableActorRole,
  canApproveTimetable,
  canPublishTimetable,
  canSubmitTimetableForReview,
  isSessionAcademicContextConsistent,
} from '../src/services/timetableLifecycleRules';

test('timetable actions require a matching configured role permission', () => {
  assert.equal(authorizedTimetableActorRole(['FACULTY', 'ADMIN'], ['ADMIN']), 'ADMIN');
  assert.equal(authorizedTimetableActorRole(['COORDINATOR'], ['ADMIN', 'COORDINATOR']), 'COORDINATOR');
  assert.equal(authorizedTimetableActorRole(['FACULTY'], ['ADMIN']), null);
});

test('only a validated draft can be submitted for review', () => {
  const ready = {
    status: 'VALIDATED',
    validationStatus: 'PASSED',
    errorCount: 0,
    sessionCount: 1,
    availabilityUnknownStatus: 'RESOLVED',
  };
  assert.equal(canSubmitTimetableForReview(ready), true);
  assert.equal(canSubmitTimetableForReview({ ...ready, status: 'DRAFT' }), false);
  assert.equal(canSubmitTimetableForReview({ ...ready, validationStatus: 'FAILED' }), false);
  assert.equal(canSubmitTimetableForReview({ ...ready, errorCount: 1 }), false);
  assert.equal(canSubmitTimetableForReview({ ...ready, sessionCount: 0 }), false);
  assert.equal(canSubmitTimetableForReview({ ...ready, availabilityUnknownStatus: 'OPEN' }), false);
});

test('publishing requires an approved version, a clean validation, sessions, and resolved availability', () => {
  const ready = {
    status: 'APPROVED',
    validationStatus: 'PASSED',
    errorCount: 0,
    sessionCount: 1,
    availabilityUnknownStatus: 'RESOLVED',
  };
  assert.equal(canPublishTimetable(ready), true);
  assert.equal(canPublishTimetable({ ...ready, status: 'IN_REVIEW' }), false);
  assert.equal(canPublishTimetable({ ...ready, validationStatus: 'FAILED' }), false);
  assert.equal(canPublishTimetable({ ...ready, errorCount: 1 }), false);
  assert.equal(canPublishTimetable({ ...ready, sessionCount: 0 }), false);
  assert.equal(canPublishTimetable({ ...ready, availabilityUnknownStatus: 'OPEN' }), false);
});

test('approval requires a review-pending version and a fresh passing validation', () => {
  const ready = {
    status: 'IN_REVIEW',
    validationStatus: 'PASSED',
    errorCount: 0,
    sessionCount: 1,
    availabilityUnknownStatus: 'RESOLVED',
  };
  assert.equal(canApproveTimetable(ready), true);
  assert.equal(canApproveTimetable({ ...ready, status: 'APPROVED' }), false);
  assert.equal(canApproveTimetable({ ...ready, validationStatus: 'FAILED' }), false);
});

test('academic context requires matching version, term, offering, division, and mapped curriculum', () => {
  const consistent = {
    sessionTermId: 4,
    versionTermId: 4,
    offeringTermId: 4,
    audienceMatchesOffering: true,
    sectionTermId: 4,
    sectionInVersion: true,
    activeCurriculumMapping: true,
    courseInCurriculum: true,
  };
  assert.equal(isSessionAcademicContextConsistent(consistent), true);
  assert.equal(isSessionAcademicContextConsistent({ ...consistent, sectionTermId: 5 }), false);
  assert.equal(isSessionAcademicContextConsistent({ ...consistent, sectionInVersion: false }), false);
  assert.equal(isSessionAcademicContextConsistent({ ...consistent, audienceMatchesOffering: false }), false);
  assert.equal(isSessionAcademicContextConsistent({ ...consistent, activeCurriculumMapping: false }), false);
  assert.equal(isSessionAcademicContextConsistent({ ...consistent, courseInCurriculum: false }), false);
});
