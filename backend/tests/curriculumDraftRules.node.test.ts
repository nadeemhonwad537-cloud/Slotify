import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCurriculumDraftContextMatches,
  assertCurriculumDraftVersion,
  curriculumDraftContextMatches,
  deserializeCurriculumDraftSubjects,
  serializeCurriculumDraftSubjects,
  validateCurriculumDraftSubjects,
} from '../src/services/curriculumDraftRules';

const subjects = [{
  course_code: 'CS-101',
  course_name: 'Foundations',
  category: '',
  credits: '3',
  required_weekly_hours: '4',
  is_elective: false,
  audience_section_ids: [11],
  components: [{
    component_type: 'LAB',
    weekly_hours: '2',
    periods_per_session: '2',
    is_consecutive: true,
    required_room_type_id: '4',
  }],
}];

const context = { year_id: 1, term_id: 2, program_id: 3, scheme_id: 4, semester_id: 5 };

test('curriculum draft serialization round-trips subject and component fields without loss', () => {
  const stored = serializeCurriculumDraftSubjects(subjects);
  assert.deepEqual(deserializeCurriculumDraftSubjects(stored), subjects);
});

test('curriculum drafts preserve valid incomplete editor rows', () => {
  const parsed = validateCurriculumDraftSubjects([{
    course_code: '',
    course_name: '',
    category: '',
    credits: '',
    required_weekly_hours: '',
    is_elective: false,
    audience_section_ids: [],
    components: [{ component_type: '', weekly_hours: '', periods_per_session: '', is_consecutive: false, required_room_type_id: '' }],
  }]);
  assert.equal(parsed[0].course_code, '');
  assert.equal(parsed[0].components[0].component_type, '');
});

test('older saved draft rows restore with no division selections', () => {
  const legacySubject = { ...subjects[0] };
  delete (legacySubject as Partial<typeof legacySubject>).audience_section_ids;
  const restored = validateCurriculumDraftSubjects([legacySubject]);
  assert.deepEqual(restored[0].audience_section_ids, []);
});

test('curriculum draft validation rejects duplicate subject codes and invalid component settings', () => {
  assert.throws(() => validateCurriculumDraftSubjects([subjects[0], subjects[0]]), /unique within this draft/);
  assert.throws(() => validateCurriculumDraftSubjects([{
    ...subjects[0],
    components: [{ ...subjects[0].components[0], is_consecutive: true, periods_per_session: '1' }],
  }]), /at least two periods per session/);
  assert.throws(() => validateCurriculumDraftSubjects([{
    ...subjects[0],
    components: [{ ...subjects[0].components[0], required_room_type_id: 'not-an-id' }],
  }]), /positive ID/);
});

test('draft context matching covers every academic scope ID', () => {
  assert.equal(curriculumDraftContextMatches(context, context), true);
  for (const key of Object.keys(context) as Array<keyof typeof context>) {
    assert.equal(curriculumDraftContextMatches(context, { ...context, [key]: context[key] + 1 }), false);
  }
  assert.throws(() => assertCurriculumDraftContextMatches(context, { ...context, semester_id: 6 }), /different academic context/);
});

test('optimistic draft versions reject stale writes', () => {
  assert.doesNotThrow(() => assertCurriculumDraftVersion(3, 3));
  assert.throws(() => assertCurriculumDraftVersion(2, 3), /updated in another session/);
});
