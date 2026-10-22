import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNewValidationErrors,
  findSessionValidationErrors,
  getContiguousSlotOptions,
  timetableSessionInput,
  TeachingSlot,
} from '../src/services/timetableSessionRules';
import type { ValidationIssue } from '../src/services/validationService';

const slots: TeachingSlot[] = [
  { day: 'MON', slot_id: 1, slot_no: 1, start_time: '08:00:00', end_time: '09:00:00' },
  { day: 'MON', slot_id: 2, slot_no: 2, start_time: '09:00:00', end_time: '10:00:00' },
  { day: 'MON', slot_id: 3, slot_no: 3, start_time: '10:15:00', end_time: '11:15:00' },
  { day: 'TUE', slot_id: 4, slot_no: 4, start_time: '08:00:00', end_time: '09:00:00' },
];

test('slot options only include adjacent periods without a time gap', () => {
  assert.deepEqual(getContiguousSlotOptions(slots, 2), [{
    day: 'MON',
    start_slot_id: 1,
    slot_count: 2,
    start_time: '08:00:00',
    end_time: '10:00:00',
  }]);
});

test('slot options reject an unknown or non-positive duration', () => {
  assert.deepEqual(getContiguousSlotOptions(slots, 0), []);
  assert.deepEqual(getContiguousSlotOptions(slots, 4), []);
});

test('session request requires unique approved assignment references and rejects extra fields', () => {
  const request = {
    offering_id: 12,
    audience_id: 8,
    room_id: 4,
    start_slot_id: 1,
    assignment_ids: [31],
  };
  assert.equal(timetableSessionInput.safeParse(request).success, true);
  assert.equal(timetableSessionInput.safeParse({ ...request, assignment_ids: [31, 31] }).success, false);
  assert.equal(timetableSessionInput.safeParse({ ...request, day: 'MON' }).success, false);
});

test('validation comparison detects newly introduced errors but permits unchanged existing errors', () => {
  const existing: ValidationIssue = {
    severity: 'ERROR',
    rule_code: 'FACULTY_OVERLAP',
    message: 'An existing conflict.',
    details: { faculty_id: 4, session_ids: [2, 3] },
  };
  const added: ValidationIssue = {
    severity: 'ERROR',
    rule_code: 'ROOM_CAPACITY',
    message: 'Capacity exceeded.',
    details: { session_id: 9, room_id: 4 },
  };
  assert.deepEqual(findNewValidationErrors([existing], [existing]), []);
  assert.deepEqual(findNewValidationErrors([existing], [existing, added]), [added]);
  assert.deepEqual(findSessionValidationErrors([existing, added], 9), [added]);
});
