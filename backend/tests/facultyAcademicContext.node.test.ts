import assert from 'node:assert/strict';
import test from 'node:test';
import { activeFacultyTerms, activeFacultyYears, filterFacultyTerms, initialFacultyTerm } from '../../frontend/src/lib/facultyAcademicContext';
import type { AcademicYear, Term } from '../../frontend/src/types';

const years: AcademicYear[] = [
  { year_id: 1, year_label: 'Year A', start_date: null, end_date: null, is_active: 1 },
  { year_id: 2, year_label: 'Year B', start_date: null, end_date: null, is_active: 1 },
  { year_id: 3, year_label: 'Year C', start_date: null, end_date: null, is_active: 1 },
];
const terms: Term[] = [
  { term_id: 11, year_id: 1, term_name: 'Odd A', parity: 'ODD', start_date: null, end_date: null, status: 'ACTIVE' },
  { term_id: 12, year_id: 1, term_name: 'Even A', parity: 'EVEN', start_date: null, end_date: null, status: 'ACTIVE' },
  { term_id: 21, year_id: 2, term_name: 'Odd B', parity: 'ODD', start_date: null, end_date: null, status: 'ACTIVE' },
];

test('faculty terms are filtered by both year and parity', () => {
  assert.deepEqual(filterFacultyTerms(terms, 1, 'EVEN').map(term => term.term_id), [12]);
  assert.deepEqual(filterFacultyTerms(terms, 2, 'EVEN'), []);
  assert.deepEqual(filterFacultyTerms(terms, null, 'ODD'), []);
});

test('initial term restores a valid remembered term or falls back to an available term', () => {
  assert.equal(initialFacultyTerm(terms, '12')?.term_id, 12);
  assert.equal(initialFacultyTerm(terms, 'missing')?.term_id, 11);
  assert.equal(initialFacultyTerm([], null), null);
});

test('active academic years are available even when they have no active terms', () => {
  assert.deepEqual(activeFacultyYears(years).map(year => year.year_id), [1, 2, 3]);
});

test('terms from inactive academic years are not selectable', () => {
  const inactiveYears = years.map(year => year.year_id === 2 ? { ...year, is_active: 0 } : year);
  assert.deepEqual(activeFacultyTerms(inactiveYears, terms).map(term => term.term_id), [11, 12]);
});
