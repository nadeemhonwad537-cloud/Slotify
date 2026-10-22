import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCurriculumDraftEditorContent } from '../../frontend/src/lib/curriculumDraftEditor';

const blankSubject = {
  course_code: '',
  course_name: '',
  category: '',
  credits: '',
  required_weekly_hours: '',
  is_elective: false,
  audience_section_ids: [] as number[],
  components: [] as unknown[],
};

test('curriculum context switching treats division audience selections as unsaved editor content', () => {
  assert.equal(hasCurriculumDraftEditorContent([{
    ...blankSubject,
    audience_section_ids: [23],
  }]), true);
});

test('curriculum context switching allows an untouched blank editor to switch without a discard prompt', () => {
  assert.equal(hasCurriculumDraftEditorContent([blankSubject]), false);
});
