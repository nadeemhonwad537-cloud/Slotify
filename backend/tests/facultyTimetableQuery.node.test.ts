import assert from 'node:assert/strict';
import test from 'node:test';
import { facultyTimetableSessionsQueryKey } from '../../frontend/src/lib/facultyTimetableQuery';

test('faculty timetable cache keys are isolated by faculty profile', () => {
  const facultyAKey = facultyTimetableSessionsQueryKey(41, 2026, 12, 3);
  const facultyBKey = facultyTimetableSessionsQueryKey(42, 2026, 12, 3);

  assert.notDeepEqual(facultyAKey, facultyBKey);
  assert.deepEqual(facultyAKey, ['my-faculty-timetable-sessions', 41, 2026, 12, 3]);
});
