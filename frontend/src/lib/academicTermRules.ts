export type TermParity = 'ODD' | 'EVEN';

const PARITY_SEMESTERS: Record<TermParity, readonly number[]> = {
  ODD: [3, 5, 7],
  EVEN: [4, 6, 8],
};

export function semestersForParity(parity: TermParity | undefined): readonly number[] {
  return parity ? PARITY_SEMESTERS[parity] : [];
}
