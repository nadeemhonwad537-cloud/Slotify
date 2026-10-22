import assert from 'node:assert/strict';
import test from 'node:test';
import { semesterMatchesParity, semestersForParity } from '../src/services/academicTermRules';

test('odd terms allow only semesters 3, 5 and 7', () => {
  assert.deepEqual(semestersForParity('ODD'), [3, 5, 7]);
  for (const semester of [3, 5, 7]) assert.equal(semesterMatchesParity(semester, 'ODD'), true);
  for (const semester of [2, 4, 6, 8]) assert.equal(semesterMatchesParity(semester, 'ODD'), false);
});

test('even terms allow only semesters 4, 6 and 8', () => {
  assert.deepEqual(semestersForParity('EVEN'), [4, 6, 8]);
  for (const semester of [4, 6, 8]) assert.equal(semesterMatchesParity(semester, 'EVEN'), true);
  for (const semester of [2, 3, 5, 7]) assert.equal(semesterMatchesParity(semester, 'EVEN'), false);
});
