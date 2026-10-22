import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRequiredPreferenceCount, assertReviewActionAllowed, validateAvailabilityWindows } from '../src/services/submissionRules';

test('submission requires exactly three preferences while drafts may be shorter', () => {
  assert.doesNotThrow(() => assertRequiredPreferenceCount(3));
  assert.throws(() => assertRequiredPreferenceCount(2), { code: 'WRONG_PREFERENCE_COUNT' });
  assert.throws(() => assertRequiredPreferenceCount(0), { code: 'WRONG_PREFERENCE_COUNT' });
});

test('availability windows reject invalid time ranges and overlaps', () => {
  assert.throws(
    () => validateAvailabilityWindows([
      { day: 'MON', start_time: '09:00:00', end_time: '11:00:00', availability_type: 'AVAILABLE' },
      { day: 'MON', start_time: '10:00:00', end_time: '12:00:00', availability_type: 'UNAVAILABLE' },
    ]),
    { code: 'AVAILABILITY_OVERLAP' },
  );
  assert.throws(
    () => validateAvailabilityWindows([
      { day: 'TUE', start_time: '12:00:00', end_time: '12:00:00', availability_type: 'UNKNOWN' },
    ]),
    { code: 'TIME_ORDER' },
  );
});

test('availability windows allow distinct adjacent ranges and preserve UNKNOWN explicitly', () => {
  assert.doesNotThrow(() => validateAvailabilityWindows([
    { day: 'MON', start_time: '09:00:00', end_time: '10:00:00', availability_type: 'AVAILABLE' },
    { day: 'MON', start_time: '10:00:00', end_time: '11:00:00', availability_type: 'UNKNOWN' },
    { day: 'TUE', start_time: '09:00:00', end_time: '11:00:00', availability_type: 'UNAVAILABLE' },
  ]));
});

test('accepted reviews are final while existing pending accept behavior remains supported', () => {
  assert.doesNotThrow(() => assertReviewActionAllowed('SUBMITTED', 'PENDING', 'ACCEPT'));
  assert.throws(
    () => assertReviewActionAllowed('SUBMITTED', 'ACCEPTED', 'RETURN'),
    { code: 'INVALID_STATE' },
  );
  assert.throws(
    () => assertReviewActionAllowed('SUBMITTED', 'ACCEPTED', 'START_REVIEW'),
    { code: 'INVALID_STATE' },
  );
});
