import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api } from '@/lib/api';
import { facultyTimetableSessionsQueryKey } from '@/lib/facultyTimetableQuery';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ErrorMessage } from '@/components/ui/ErrorMessage';

interface TimetableContext {
  year_id: number;
  year_label: string;
  term_id: number;
  term_name: string;
  parity: 'ODD' | 'EVEN';
  program_id: number;
  program_code: string;
  program_name: string;
  scheme_id: number;
  scheme_code: string;
  scheme_version: string;
  semester_id: number;
  semester_no: number;
  semester_name: string | null;
}

interface TimetableSession {
  session_id: number;
  day: string;
  session_date: string | null;
  start_time: string;
  end_time: string;
  course_code: string | null;
  course_name: string;
  component_type: string;
  room_code: string;
  room_name: string | null;
  divisions: string;
  faculty_names: string;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function displayTime(time: string) {
  return time.slice(0, 5);
}

export function FacultyTimetablePage() {
  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;
  const contextsQuery = useQuery({
    queryKey: ['my-faculty-timetable-contexts', profile?.faculty_id],
    queryFn: () => api.get<TimetableContext[]>('/timetable/faculty/contexts'),
    enabled: !!profile,
    staleTime: 30_000,
  });
  const contexts = contextsQuery.data ?? [];

  const [yearId, setYearId] = useState(0);
  const [parity, setParity] = useState<'ODD' | 'EVEN'>('ODD');
  const [termId, setTermId] = useState(0);
  const [semesterId, setSemesterId] = useState(0);

  const years = Array.from(
    new Map(contexts.map(context => [context.year_id, {
      year_id: context.year_id,
      year_label: context.year_label,
    }])).values(),
  );
  const selectedYear = years.find(year => year.year_id === yearId);
  const parityOptions = Array.from(new Set(
    contexts.filter(context => context.year_id === selectedYear?.year_id).map(context => context.parity),
  ));
  const terms = contexts
    .filter(context => context.year_id === selectedYear?.year_id && context.parity === parity)
    .filter((context, index, rows) => rows.findIndex(row => row.term_id === context.term_id) === index);
  const selectedTerm = terms.find(term => term.term_id === termId);
  const semesters = contexts.filter(context => context.term_id === selectedTerm?.term_id);
  const selectedSemester = semesters.find(semester => semester.semester_id === semesterId);

  useEffect(() => {
    if (!years.some(year => year.year_id === yearId)) setYearId(years[0]?.year_id ?? 0);
  }, [years, yearId]);
  useEffect(() => {
    if (!parityOptions.includes(parity)) setParity(parityOptions[0] ?? 'ODD');
  }, [parityOptions, parity]);
  useEffect(() => {
    if (!terms.some(term => term.term_id === termId)) setTermId(terms[0]?.term_id ?? 0);
  }, [terms, termId]);
  useEffect(() => {
    if (!semesters.some(semester => semester.semester_id === semesterId)) {
      setSemesterId(semesters[0]?.semester_id ?? 0);
    }
  }, [semesters, semesterId]);

  const sessionsQuery = useQuery({
    queryKey: facultyTimetableSessionsQueryKey(profile?.faculty_id, yearId, termId, semesterId),
    queryFn: () => api.get<TimetableSession[]>(
      `/timetable/faculty/sessions?year_id=${yearId}&term_id=${termId}&semester_id=${semesterId}`,
    ),
    enabled: !!profile && !!yearId && !!termId && !!semesterId,
  });
  const sessions = sessionsQuery.data ?? [];

  if (profileQuery.isPending || profileQuery.isError || !profile) {
    return <FacultyProfileStatus query={profileQuery} />;
  }
  if (contextsQuery.error) return <ErrorMessage error={contextsQuery.error} title="Unable to load your teaching contexts" />;
  if (sessionsQuery.error) return <ErrorMessage error={sessionsQuery.error} title="Unable to load your timetable" />;

  return (
    <div>
      <PageHeader
        title="My Timetable"
        subtitle="Published sessions for your approved teaching assignments. Draft schedules are not shown."
      />

      {contextsQuery.isLoading ? (
        <Card padding><p className="text-sm text-gray-500">Loading your approved teaching contexts…</p></Card>
      ) : contexts.length === 0 ? (
        <Card padding>
          <p className="text-sm font-medium text-gray-800">No approved teaching context is available</p>
          <p className="mt-1 text-sm text-gray-600">Ask the administrator to verify your faculty profile and approved subject assignments. No timetable sessions are created by this page.</p>
        </Card>
      ) : (
        <>
          <Card padding className="mb-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm text-gray-600">
                Academic year
                <select className="input mt-1" value={yearId} onChange={event => {
                  setYearId(Number(event.target.value));
                  setTermId(0);
                  setSemesterId(0);
                }}>
                  {years.map(year => <option key={year.year_id} value={year.year_id}>{year.year_label}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Term parity
                <select className="input mt-1" value={parity} onChange={event => {
                  setParity(event.target.value as 'ODD' | 'EVEN');
                  setTermId(0);
                  setSemesterId(0);
                }}>
                  {parityOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Term
                <select className="input mt-1" value={termId} onChange={event => {
                  setTermId(Number(event.target.value));
                  setSemesterId(0);
                }}>
                  {terms.map(term => <option key={term.term_id} value={term.term_id}>{term.term_name}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Semester
                <select className="input mt-1" value={semesterId} onChange={event => setSemesterId(Number(event.target.value))}>
                  {semesters.map(semester => (
                    <option key={semester.semester_id} value={semester.semester_id}>
                      {semester.program_code} · Semester {semester.semester_no} · {semester.scheme_code} v{semester.scheme_version}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          {sessionsQuery.isLoading ? (
            <Card padding><p className="text-sm text-gray-500">Loading published timetable sessions…</p></Card>
          ) : sessions.length === 0 ? (
            <Card padding>
              <p className="text-sm font-medium text-gray-800">No published timetable for this selection</p>
              <p className="mt-1 text-sm text-gray-600">A draft timetable is not visible here. Ask the administrator whether a timetable has been formally published for this term and semester.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {DAYS.map(day => {
                const daySessions = sessions.filter(session => session.day === day);
                return (
                  <Card key={day} padding>
                    <h2 className="mb-3 border-b border-gray-100 pb-2 text-sm font-semibold text-gray-800">{day}</h2>
                    {daySessions.length === 0 ? (
                      <p className="text-xs text-gray-400">No sessions</p>
                    ) : (
                      <div className="space-y-2">
                        {daySessions.map(session => (
                          <article key={session.session_id} className="rounded-md border border-brand-100 bg-brand-50 p-3">
                            <p className="text-xs font-semibold text-brand-800">
                              {displayTime(session.start_time)}–{displayTime(session.end_time)}
                            </p>
                            <p className="mt-1 text-sm font-medium text-gray-900">{session.course_name}</p>
                            <p className="text-xs text-gray-600">
                              {session.course_code ? `${session.course_code} · ` : ''}{session.component_type}
                            </p>
                            <dl className="mt-2 space-y-1 text-xs text-gray-600">
                              <div><dt className="inline font-medium">Division: </dt><dd className="inline">{session.divisions}</dd></div>
                              <div><dt className="inline font-medium">Room: </dt><dd className="inline">{session.room_name || session.room_code}</dd></div>
                              {session.session_date && <div><dt className="inline font-medium">Date: </dt><dd className="inline">{session.session_date}</dd></div>}
                              <div><dt className="inline font-medium">Faculty: </dt><dd className="inline">{session.faculty_names}</dd></div>
                            </dl>
                          </article>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
