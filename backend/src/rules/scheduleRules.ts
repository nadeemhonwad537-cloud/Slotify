/**
 * Rules fixed by the project requirements (NOT university master data).
 * Anything university-specific (periods, breaks, rooms, hours) lives in the database.
 */

/** Owner-confirmed Saturday half-day cutoff. Exact Saturday periods remain configurable. */
export const SATURDAY_LATEST_END = '12:30:00';

export const SCHEDULING_POLICY = {
  dayStart: '08:00:00',
  weekdayLatestEnd: '17:30:00',
  saturdayLatestEnd: SATURDAY_LATEST_END,
  periodMinutes: 60,
  lunchStart: '12:30:00',
  lunchEnd: '13:30:00',
  divisionsPerSemester: 4,
  classroomCount: 8,
  labCount: 4,
  missingAvailability: 'BLOCK',
  unknownAvailability: 'BLOCK',
} as const;

/** Semester parity rule: odd-numbered semesters run in ODD terms, even-numbered in EVEN terms. */
export const semesterParity = (semesterNo: number): 'ODD' | 'EVEN' => (semesterNo % 2 === 1 ? 'ODD' : 'EVEN');

/** Latest permitted end time for teaching on a day (HH:MM:SS), or null when the day has no configured limit. */
export function dayLatestEnd(dayName: string, closingTime: string | null): string | null {
  if (dayName !== 'SAT') return closingTime;
  return closingTime && closingTime < SATURDAY_LATEST_END ? closingTime : SATURDAY_LATEST_END;
}
