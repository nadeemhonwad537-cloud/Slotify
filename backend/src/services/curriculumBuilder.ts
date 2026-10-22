import { z } from 'zod';

const componentSchema = z.object({
  component_type: z.enum(['THEORY', 'TUTORIAL', 'LAB', 'PROJECT']),
  weekly_hours: z.number().min(0.01).max(99.99),
  periods_per_session: z.number().int().min(1).max(12).nullable().optional(),
  is_consecutive: z.boolean().default(false),
  required_room_type_id: z.number().int().positive().nullable().optional(),
}).strict().superRefine((component, ctx) => {
  if (component.is_consecutive && (component.periods_per_session ?? 0) < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periods_per_session'],
      message: 'A consecutive component needs at least two periods per session',
    });
  }
});

const subjectSchema = z.object({
  course_code: z.string().trim().min(1).max(30),
  course_name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(20).optional(),
  credits: z.number().min(0).max(99.9).optional(),
  required_weekly_hours: z.number().min(0.01).max(99.99),
  is_elective: z.boolean().default(false),
  audience_section_ids: z.array(z.number().int().positive()).min(1).superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Division selections must not contain duplicate IDs',
      });
    }
  }),
  components: z.array(componentSchema).min(1).max(4),
}).strict().superRefine((subject, ctx) => {
  const types = new Set<string>();
  subject.components.forEach((component, index) => {
    if (types.has(component.component_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['components', index, 'component_type'],
        message: 'A subject can have only one component of each type',
      });
    }
    types.add(component.component_type);
  });

  const componentHours = subject.components.reduce((total, component) => total + component.weekly_hours, 0);
  if (Math.abs(componentHours - subject.required_weekly_hours) > 0.001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['required_weekly_hours'],
      message: 'Required weekly hours must equal the sum of component hours',
    });
  }
});

export const curriculumBuilderSchema = z.object({
  year_id: z.number().int().positive(),
  term_id: z.number().int().positive(),
  program_id: z.number().int().positive(),
  scheme_id: z.number().int().positive(),
  semester_id: z.number().int().positive(),
  subjects: z.array(subjectSchema).min(1).max(100),
}).strict().superRefine((payload, ctx) => {
  const codes = new Set<string>();
  payload.subjects.forEach((subject, index) => {
    const normalized = subject.course_code.toLocaleLowerCase();
    if (codes.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjects', index, 'course_code'],
        message: 'Subject codes must be unique within this curriculum',
      });
    }
    codes.add(normalized);
  });
});

export type CurriculumBuilderPayload = z.infer<typeof curriculumBuilderSchema>;

export function validateCurriculumBuilderPayload(input: unknown): CurriculumBuilderPayload {
  return curriculumBuilderSchema.parse(input);
}
