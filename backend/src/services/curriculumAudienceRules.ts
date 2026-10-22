import { HttpError } from '../utils/errors';
import type { CurriculumDraftContext } from './curriculumDraftRules';

export interface CurriculumAudienceSection extends CurriculumDraftContext {
  section_id: number;
  is_active: number | boolean;
}

export function assertCurriculumAudienceSections(
  requestedIds: number[],
  sections: CurriculumAudienceSection[],
  context: CurriculumDraftContext,
  required = false,
): number[] {
  if (required && requestedIds.length === 0) {
    throw new HttpError(422, 'Select at least one active division for every subject offering', 'OFFERING_AUDIENCE_REQUIRED');
  }

  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new HttpError(400, 'Division selections must not contain duplicate IDs', 'DUPLICATE_OFFERING_AUDIENCE');
  }

  const validIds = new Set(sections
    .filter(section => Boolean(section.is_active)
      && section.year_id === context.year_id
      && section.term_id === context.term_id
      && section.program_id === context.program_id
      && section.scheme_id === context.scheme_id
      && section.semester_id === context.semester_id)
    .map(section => section.section_id));
  const invalidIds = requestedIds.filter(id => !validIds.has(id));
  if (invalidIds.length) {
    throw new HttpError(
      422,
      'Every selected division must be active and belong to the selected year, term, program, scheme, and semester',
      'OFFERING_AUDIENCE_CONTEXT_MISMATCH',
      { section_ids: invalidIds },
    );
  }

  return requestedIds;
}
