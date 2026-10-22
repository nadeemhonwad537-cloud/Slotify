import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCurriculumBuilderPayload } from '../src/services/curriculumBuilder';

const base = {
  year_id: 1,
  term_id: 2,
  program_id: 3,
  scheme_id: 4,
  semester_id: 5,
  subjects: [{
    course_code: 'CS-101',
    course_name: 'Example subject',
    required_weekly_hours: 4,
    audience_section_ids: [11],
    components: [
      { component_type: 'THEORY', weekly_hours: 3 },
      { component_type: 'LAB', weekly_hours: 1, is_consecutive: true, periods_per_session: 2 },
    ],
  }],
};

test('accepts a curriculum whose component hours match its subject total', () => {
  const parsed = validateCurriculumBuilderPayload(base);
  assert.equal(parsed.subjects[0].components.length, 2);
  assert.equal(parsed.subjects[0].is_elective, false);
});

test('rejects duplicate subject codes without regard to case', () => {
  const input = structuredClone(base);
  input.subjects.push({ ...input.subjects[0], course_code: 'cs-101' });
  assert.throws(() => validateCurriculumBuilderPayload(input), /unique within this curriculum/);
});

test('rejects inconsistent component hours', () => {
  const input = structuredClone(base);
  input.subjects[0].required_weekly_hours = 5;
  assert.throws(() => validateCurriculumBuilderPayload(input), /sum of component hours/);
});

test('rejects repeated component types', () => {
  const input = structuredClone(base);
  input.subjects[0].components.push({ component_type: 'LAB', weekly_hours: 1 });
  assert.throws(() => validateCurriculumBuilderPayload(input), /only one component of each type/);
});

test('rejects consecutive components without multiple periods per session', () => {
  const input = structuredClone(base);
  input.subjects[0].components[1].periods_per_session = 1;
  assert.throws(() => validateCurriculumBuilderPayload(input), /at least two periods per session/);
});

test('requires at least one explicit division audience per subject offering', () => {
  const input = structuredClone(base);
  input.subjects[0].audience_section_ids = [];
  assert.throws(() => validateCurriculumBuilderPayload(input), /Array must contain at least 1 element/);
});

test('rejects duplicate division audience IDs', () => {
  const input = structuredClone(base);
  input.subjects[0].audience_section_ids = [11, 11];
  assert.throws(() => validateCurriculumBuilderPayload(input), /duplicate IDs/);
});
