import assert from 'node:assert/strict';
import test from 'node:test';
import { mappedSemestersForContext, schemesForProgram } from '../../frontend/src/lib/curriculumSelection';

const schemes = [
  { scheme_id: 1, program_id: 10, is_active: 1 },
  { scheme_id: 2, program_id: 10, is_active: 0 },
  { scheme_id: 3, program_id: 20, is_active: 1 },
];

const semesters = [
  { semester_id: 31, scheme_id: 1, semester_no: 3, is_active: 1 },
  { semester_id: 35, scheme_id: 1, semester_no: 5, is_active: 1 },
  { semester_id: 37, scheme_id: 1, semester_no: 7, is_active: 0 },
  { semester_id: 34, scheme_id: 1, semester_no: 4, is_active: 1 },
  { semester_id: 53, scheme_id: 3, semester_no: 3, is_active: 1 },
];

const mappings = [
  { scheme_id: 1, semester_id: 31, is_active: 1 },
  { scheme_id: 1, semester_id: 35, is_active: 0 },
  { scheme_id: 1, semester_id: 37, is_active: 1 },
  { scheme_id: 1, semester_id: 34, is_active: 1 },
  { scheme_id: 3, semester_id: 53, is_active: 1 },
];

test('scheme choices stay visible for the selected program even before semester mapping', () => {
  assert.deepEqual(schemesForProgram(schemes, 10).map(scheme => scheme.scheme_id), [1]);
  assert.deepEqual(schemesForProgram(schemes, 20).map(scheme => scheme.scheme_id), [3]);
  assert.deepEqual(schemesForProgram(schemes, undefined), []);
});

test('semester options require an active exact mapping and matching parity', () => {
  assert.deepEqual(
    mappedSemestersForContext(semesters, mappings, 1, 'ODD', true).map(semester => semester.semester_no),
    [3],
  );
  assert.deepEqual(
    mappedSemestersForContext(semesters, mappings, 1, 'EVEN', true).map(semester => semester.semester_no),
    [4],
  );
});

test('semester options do not appear when mapping data is unavailable', () => {
  assert.deepEqual(mappedSemestersForContext(semesters, mappings, 1, 'ODD', false), []);
});
