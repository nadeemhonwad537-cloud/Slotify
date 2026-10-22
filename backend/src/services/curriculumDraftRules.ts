import { z } from 'zod';
import { HttpError } from '../utils/errors';

const numberText = (max: number, decimals: number, minimum: number) => z.string().max(12).refine(value => {
  if (value === '') return true;
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  const number = Number(value);
  return pattern.test(value) && Number.isFinite(number) && number >= minimum && number <= max;
}, `Enter a number from ${minimum} to ${max} with at most ${decimals} decimal place(s), or leave it blank`);

const draftComponentSchema = z.object({
  component_type: z.enum(['', 'THEORY', 'TUTORIAL', 'LAB', 'PROJECT']),
  weekly_hours: numberText(99.99, 2, 0.01),
  periods_per_session: z.string().max(2).refine(value =>
    value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 12),
  'Periods per session must be from 1 to 12'),
  is_consecutive: z.boolean(),
  required_room_type_id: z.string().max(10).refine(value =>
    value === '' || (/^\d+$/.test(value) && Number(value) > 0),
  'Required room type must be a positive ID'),
}).strict().superRefine((component, ctx) => {
  if (component.is_consecutive && component.periods_per_session !== '' && Number(component.periods_per_session) < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periods_per_session'],
      message: 'A consecutive component needs at least two periods per session',
    });
  }
});

const draftSubjectSchema = z.object({
  course_code: z.string().max(30),
  course_name: z.string().max(200),
  category: z.string().max(20),
  credits: numberText(99.9, 1, 0),
  required_weekly_hours: numberText(99.99, 2, 0.01),
  is_elective: z.boolean(),
  audience_section_ids: z.array(z.number().int().positive()).default([]).superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Division selections must not contain duplicate IDs',
      });
    }
  }),
  components: z.array(draftComponentSchema).max(4),
}).strict();

export const curriculumDraftSubjectsSchema = z.array(draftSubjectSchema).min(1).max(100).superRefine((subjects, ctx) => {
  const codes = new Set<string>();
  subjects.forEach((subject, subjectIndex) => {
    const code = subject.course_code.trim().toLowerCase();
    if (code && codes.has(code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [subjectIndex, 'course_code'],
        message: 'Subject codes must be unique within this draft',
      });
    }
    if (code) codes.add(code);

    const componentTypes = new Set<string>();
    subject.components.forEach((component, componentIndex) => {
      if (component.component_type && componentTypes.has(component.component_type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [subjectIndex, 'components', componentIndex, 'component_type'],
          message: 'A subject can have only one component of each type',
        });
      }
      if (component.component_type) componentTypes.add(component.component_type);
    });
  });
});

export type CurriculumDraftSubject = z.infer<typeof draftSubjectSchema>;

export interface CurriculumDraftContext {
  year_id: number;
  term_id: number;
  program_id: number;
  scheme_id: number;
  semester_id: number;
}

export function validateCurriculumDraftSubjects(input: unknown): CurriculumDraftSubject[] {
  return curriculumDraftSubjectsSchema.parse(input);
}

export function serializeCurriculumDraftSubjects(subjects: unknown): string {
  return JSON.stringify(validateCurriculumDraftSubjects(subjects));
}

export function deserializeCurriculumDraftSubjects(value: unknown): CurriculumDraftSubject[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HttpError(500, 'Stored curriculum draft is not valid JSON', 'CURRICULUM_DRAFT_CORRUPT');
      }
      throw error;
    }
  }
  try {
    return validateCurriculumDraftSubjects(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(500, 'Stored curriculum draft has an invalid subject structure', 'CURRICULUM_DRAFT_CORRUPT');
    }
    throw error;
  }
}

export function curriculumDraftContextMatches(
  stored: Record<string, unknown>,
  requested: CurriculumDraftContext,
): boolean {
  return stored.year_id != null && Number(stored.year_id) === requested.year_id
    && stored.term_id != null && Number(stored.term_id) === requested.term_id
    && stored.program_id != null && Number(stored.program_id) === requested.program_id
    && stored.scheme_id != null && Number(stored.scheme_id) === requested.scheme_id
    && stored.semester_id != null && Number(stored.semester_id) === requested.semester_id;
}

export function assertCurriculumDraftContextMatches(
  stored: Record<string, unknown>,
  requested: CurriculumDraftContext,
): void {
  if (!curriculumDraftContextMatches(stored, requested)) {
    throw new HttpError(409, 'This curriculum draft belongs to a different academic context', 'CURRICULUM_DRAFT_CONTEXT_MISMATCH');
  }
}

export function assertCurriculumDraftVersion(expectedVersion: number, actualVersion: number): void {
  if (expectedVersion !== actualVersion) {
    throw new HttpError(409, 'This curriculum draft was updated in another session. Reload or restore the latest draft before saving.', 'CURRICULUM_DRAFT_VERSION_CONFLICT');
  }
}
