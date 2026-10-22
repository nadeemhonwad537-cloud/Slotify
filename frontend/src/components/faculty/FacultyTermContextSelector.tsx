import type { AcademicYear, Term } from '@/types';
import { filterFacultyTerms } from '@/lib/facultyAcademicContext';

interface FacultyTermContextSelectorProps {
  academicYears: AcademicYear[];
  terms: Term[];
  yearId: number | null;
  parity: Term['parity'];
  termId: string;
  onYearChange: (yearId: number | null) => void;
  onParityChange: (parity: Term['parity']) => void;
  onTermChange: (termId: string) => void;
  disabled?: boolean;
}

export function FacultyTermContextSelector({
  academicYears,
  terms,
  yearId,
  parity,
  termId,
  onYearChange,
  onParityChange,
  onTermChange,
  disabled = false,
}: FacultyTermContextSelectorProps) {
  const applicableTerms = filterFacultyTerms(terms, yearId, parity);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm text-gray-600">
        Academic year
        <select
          className="input mt-1"
          value={yearId ?? ''}
          onChange={event => onYearChange(event.target.value ? Number(event.target.value) : null)}
          disabled={disabled || academicYears.length === 0}
        >
          <option value="">No academic years available</option>
          {academicYears.map(year => (
            <option key={year.year_id} value={year.year_id}>{year.year_label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm text-gray-600">
        Term parity
        <select
          className="input mt-1"
          value={parity}
          onChange={event => onParityChange(event.target.value as Term['parity'])}
          disabled={disabled || yearId === null}
        >
          <option value="ODD">Odd</option>
          <option value="EVEN">Even</option>
        </select>
      </label>
      <label className="text-sm text-gray-600">
        Academic term
        <select
          className="input mt-1"
          value={termId}
          onChange={event => onTermChange(event.target.value)}
          disabled={disabled || applicableTerms.length === 0}
        >
          {applicableTerms.length === 0
            ? <option value="">No active term for this year and parity</option>
            : applicableTerms.map(term => (
              <option key={term.term_id} value={term.term_id}>{term.term_name}</option>
            ))}
        </select>
      </label>
    </div>
  );
}
