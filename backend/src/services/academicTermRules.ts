export type TermParity = 'ODD' | 'EVEN';

const PARITY_SEMESTERS: Record<TermParity, readonly number[]> = {
  ODD: [3, 5, 7],
  EVEN: [4, 6, 8],
};

export function semestersForParity(parity: TermParity): readonly number[] {
  return PARITY_SEMESTERS[parity];
}

export function semesterMatchesParity(semesterNo: number, parity: TermParity): boolean {
  return semestersForParity(parity).includes(semesterNo);
}
