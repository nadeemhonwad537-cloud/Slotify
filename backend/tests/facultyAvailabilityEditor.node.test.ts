import assert from 'node:assert/strict';
import test from 'node:test';
import { facultySubmissionEditorState } from '../../frontend/src/lib/facultySubmissionEditor';

test('availability editor waits for selected-term submission before allowing edits', () => {
  assert.equal(facultySubmissionEditorState({
    enabled: true,
    isFetching: true,
    hasError: false,
    hasData: false,
  }), 'loading');
});

test('availability editor becomes ready only after selected-term data finishes loading', () => {
  assert.equal(facultySubmissionEditorState({
    enabled: true,
    isFetching: false,
    hasError: false,
    hasData: true,
  }), 'ready');
});

test('availability refetch errors block editing even when cached submission data exists', () => {
  assert.equal(facultySubmissionEditorState({
    enabled: true,
    isFetching: false,
    hasError: true,
    hasData: true,
  }), 'error');
});

test('availability editor stays idle without an active profile and term context', () => {
  assert.equal(facultySubmissionEditorState({
    enabled: false,
    isFetching: false,
    hasError: false,
    hasData: false,
  }), 'idle');
});
