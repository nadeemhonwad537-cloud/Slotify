export type FacultySubmissionEditorState = 'idle' | 'loading' | 'error' | 'ready';

export function facultySubmissionEditorState(input: {
  enabled: boolean;
  isFetching: boolean;
  hasError: boolean;
  hasData: boolean;
}): FacultySubmissionEditorState {
  if (!input.enabled) return 'idle';
  if (input.hasError) return 'error';
  if (!input.hasData) return 'loading';
  if (input.isFetching) return 'loading';
  return 'ready';
}
