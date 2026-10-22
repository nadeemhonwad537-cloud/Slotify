import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePreferenceRequests } from '../src/services/preferenceValidation';

test('assigns ordered unique ranks to up to three course preferences', () => {
  const ranked = validatePreferenceRequests([
    { course_id: 11, component_id: 21 },
    { course_id: 12, component_id: 22 },
    { course_id: 13, component_id: 23 },
  ]);

  assert.deepEqual(ranked.map(item => item.preference_order), [1, 2, 3]);
});

test('rejects a duplicate subject even when a different component is selected', () => {
  assert.throws(
    () => validatePreferenceRequests([
      { course_id: 11, component_id: 21 },
      { course_id: 11, component_id: 22 },
    ]),
    { code: 'DUPLICATE_PREFERENCE' },
  );
});

test('rejects more than three preferences', () => {
  assert.throws(
    () => validatePreferenceRequests([{ course_id: 1 }, { course_id: 2 }, { course_id: 3 }, { course_id: 4 }]),
    { code: 'TOO_MANY_PREFERENCES' },
  );
});

test('rejects unverified workload labels as preference targets', () => {
  assert.throws(
    () => validatePreferenceRequests([{ source_row_id: 1, subject_column: 'Subject-I' }]),
    { code: 'SUBJECT_NOT_PUBLISHED_FOR_TERM' },
  );
});
