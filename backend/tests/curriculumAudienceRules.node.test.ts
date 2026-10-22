import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurriculumAudienceSections, CurriculumAudienceSection } from '../src/services/curriculumAudienceRules';

const context = { year_id: 1, term_id: 2, program_id: 3, scheme_id: 4, semester_id: 5 };
const sections: CurriculumAudienceSection[] = [
  { section_id: 10, ...context, is_active: 1 },
  { section_id: 11, ...context, is_active: 0 },
  { section_id: 12, ...context, term_id: 20, is_active: 1 },
  { section_id: 13, ...context, program_id: 30, is_active: 1 },
];

test('accepts only active divisions from the complete selected academic context', () => {
  assert.deepEqual(assertCurriculumAudienceSections([10], sections, context, true), [10]);
});

test('publishing requires at least one explicitly selected division', () => {
  assert.throws(() => assertCurriculumAudienceSections([], sections, context, true), /Select at least one active division/);
  assert.deepEqual(assertCurriculumAudienceSections([], sections, context), []);
});

test('rejects inactive or cross-context division IDs', () => {
  for (const id of [11, 12, 13, 999]) {
    assert.throws(() => assertCurriculumAudienceSections([id], sections, context), /belong to the selected year/);
  }
});

test('rejects duplicate division selections', () => {
  assert.throws(() => assertCurriculumAudienceSections([10, 10], sections, context), /duplicate IDs/);
});
