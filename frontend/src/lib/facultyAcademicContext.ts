import type { AcademicYear, Term } from '@/types';

export function filterFacultyTerms(
  terms: Term[],
  yearId: number | null,
  parity: Term['parity'],
): Term[] {
  if (yearId === null) return [];
  return terms.filter(term => term.year_id === yearId && term.parity === parity);
}

export function initialFacultyTerm(
  terms: Term[],
  rememberedTermId: string | null,
): Term | null {
  return terms.find(term => String(term.term_id) === rememberedTermId) ?? terms[0] ?? null;
}

export function activeFacultyYears(years: AcademicYear[]): AcademicYear[] {
  return years.filter(year => year.is_active === 1);
}

export function activeFacultyTerms(years: AcademicYear[], terms: Term[]): Term[] {
  const activeYearIds = new Set(years.filter(year => year.is_active === 1).map(year => year.year_id));
  return terms.filter(term => activeYearIds.has(term.year_id));
}
