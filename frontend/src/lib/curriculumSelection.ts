import { semestersForParity, TermParity } from './academicTermRules';

export interface CurriculumSchemeOption {
  scheme_id: number;
  program_id: number;
  is_active: number;
}

export interface CurriculumSemesterOption {
  semester_id: number;
  scheme_id: number;
  semester_no: number;
  is_active: number;
}

export interface CurriculumSemesterMapping {
  scheme_id: number;
  semester_id: number;
  is_active: number;
}

export function schemesForProgram<T extends CurriculumSchemeOption>(schemes: T[], programId: number | undefined): T[] {
  return schemes.filter(scheme => scheme.program_id === programId && Boolean(scheme.is_active));
}

export function mappedSemestersForContext<T extends CurriculumSemesterOption>(
  semesters: T[],
  mappings: CurriculumSemesterMapping[],
  schemeId: number | undefined,
  parity: TermParity | undefined,
  mappingAvailable: boolean,
): T[] {
  if (!schemeId || !parity || !mappingAvailable) return [];
  const mappedSemesterIds = new Set(mappings
    .filter(mapping => mapping.scheme_id === schemeId && Boolean(mapping.is_active))
    .map(mapping => mapping.semester_id));
  const allowedSemesterNumbers = semestersForParity(parity);
  return semesters.filter(semester => semester.scheme_id === schemeId
    && Boolean(semester.is_active)
    && allowedSemesterNumbers.includes(semester.semester_no)
    && mappedSemesterIds.has(semester.semester_id));
}
