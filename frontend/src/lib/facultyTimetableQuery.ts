export function facultyTimetableSessionsQueryKey(
  facultyId: number | undefined,
  yearId: number,
  termId: number,
  semesterId: number,
) {
  return ['my-faculty-timetable-sessions', facultyId, yearId, termId, semesterId] as const;
}
