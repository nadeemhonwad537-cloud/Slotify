export interface CurriculumDraftEditorSubject {
  course_code: string;
  course_name: string;
  category: string;
  credits: string;
  required_weekly_hours: string;
  is_elective: boolean;
  audience_section_ids: number[];
  components: unknown[];
}

export function hasCurriculumDraftEditorContent(subjects: CurriculumDraftEditorSubject[]): boolean {
  return subjects.some(subject =>
    subject.course_code.trim()
    || subject.course_name.trim()
    || subject.category.trim()
    || subject.credits.trim()
    || subject.required_weekly_hours.trim()
    || subject.is_elective
    || subject.audience_section_ids.length > 0
    || subject.components.length > 0,
  );
}
