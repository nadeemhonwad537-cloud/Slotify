import { HttpError } from '../utils/errors';

export const MAX_PREFERENCES = 3;

export type PreferenceRequest =
  | { course_id: number; component_id?: number | null; note?: string | null }
  | { source_row_id: number; subject_column: string; note?: string | null };

export function validatePreferenceRequests(preferences: readonly PreferenceRequest[]) {
  if (preferences.length > MAX_PREFERENCES) {
    throw new HttpError(400, `At most ${MAX_PREFERENCES} preferences are allowed`, 'TOO_MANY_PREFERENCES');
  }

  const seenCourses = new Set<number>();
  return preferences.map((preference, index) => {
    if (!('course_id' in preference)) {
      throw new HttpError(422, 'Only published curriculum subjects can be requested. Unverified workload labels are not eligible.', 'SUBJECT_NOT_PUBLISHED_FOR_TERM');
    }
    if (seenCourses.has(preference.course_id)) {
      throw new HttpError(400, 'A subject can only be selected once, even when it has multiple components', 'DUPLICATE_PREFERENCE');
    }
    seenCourses.add(preference.course_id);
    return { preference, preference_order: index + 1 };
  });
}
