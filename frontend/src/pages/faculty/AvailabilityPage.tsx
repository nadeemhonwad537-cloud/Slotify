import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { facultySubmissionEditorState } from '@/lib/facultySubmissionEditor';
import { FacultyTermContextSelector } from '@/components/faculty/FacultyTermContextSelector';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import { PlusIcon, TrashIcon, SaveIcon } from 'lucide-react';
import type { AcademicYear, SubmissionDetail, Term, AvailabilityType } from '@/types';
import { activeFacultyTerms, activeFacultyYears, filterFacultyTerms, initialFacultyTerm } from '@/lib/facultyAcademicContext';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const AV_TYPES: AvailabilityType[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];
const avColor: Record<AvailabilityType, 'green' | 'red' | 'yellow'> = {
  AVAILABLE: 'green', UNAVAILABLE: 'red', UNKNOWN: 'yellow',
};

interface AvWindow { day: string; start_time: string; end_time: string; availability_type: AvailabilityType; }
interface CurriculumChoice {
  program_id: number;
  program_code: string;
  program_name: string;
  semester_id: number;
  semester_no: number;
  semester_name: string | null;
}

export function AvailabilityPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  const {
    data: activeTerms = [],
    isPending: termsLoading,
    error: termsError,
  } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=500'),
    select: r => r.data,
  });
  const {
    data: academicYears = [],
    isPending: academicYearsLoading,
    error: academicYearsError,
  } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => listRequest<AcademicYear>('/masterdata/academic-years?limit=500'),
    select: r => r.data,
  });
  const selectableTerms = activeFacultyTerms(academicYears, activeTerms);
  const availableAcademicYears = activeFacultyYears(academicYears);
  const termStorageKey = `slotify:faculty-term:${user?.userId ?? 'unknown'}`;
  const [termId, setTermId] = useState('');
  const [yearId, setYearId] = useState<number | null>(null);
  const [parity, setParity] = useState<Term['parity']>('ODD');
  useEffect(() => {
    if (termsLoading || academicYearsLoading) return;
    if (availableAcademicYears.some(year => year.year_id === yearId)) return;
    const nextTerm = initialFacultyTerm(selectableTerms, sessionStorage.getItem(termStorageKey));
    if (nextTerm) {
      setYearId(nextTerm.year_id);
      setParity(nextTerm.parity);
      setTermId(String(nextTerm.term_id));
    } else if (academicYears.length) {
      setYearId(availableAcademicYears[0]?.year_id ?? null);
      setTermId('');
    } else {
      setYearId(null);
      setTermId('');
    }
  }, [academicYears.length, academicYearsLoading, availableAcademicYears, selectableTerms, termStorageKey, termsLoading, yearId]);
  const termsForSelection = filterFacultyTerms(selectableTerms, yearId, parity);
  useEffect(() => {
    if (termId && !termsForSelection.some(term => String(term.term_id) === termId)) setTermId('');
  }, [termId, termsForSelection]);
  useEffect(() => {
    if (termsForSelection.some(term => String(term.term_id) === termId)) sessionStorage.setItem(termStorageKey, termId);
  }, [termId, termStorageKey, termsForSelection]);

  const { data: curriculumChoices = [], error: curriculumError } = useQuery<CurriculumChoice[]>({
    queryKey: ['faculty-term-curricula', termId],
    queryFn: () => api.get<CurriculumChoice[]>(`/faculty-submissions/mine/term-program-semesters?term_id=${termId}`),
    enabled: !!termId && !!profile,
  });
  const {
    data: detail,
    isFetching: detailFetching,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<SubmissionDetail>({
    queryKey: ['my-submission', termId],
    queryFn: () => api.get<SubmissionDetail>(`/faculty-submissions/mine?term_id=${termId}`),
    enabled: !!termId && !!profile,
  });
  const detailEditorState = facultySubmissionEditorState({
    enabled: !!termId && !!profile,
    isFetching: detailFetching,
    hasError: !!detailError,
    hasData: !!detail,
  });
  const [programId, setProgramId] = useState<number>();
  const [semesterId, setSemesterId] = useState<number>();
  useEffect(() => {
    if (!curriculumChoices.length) {
      setProgramId(undefined);
      setSemesterId(undefined);
      return;
    }
    const savedSemesterId = detail?.preferences.find(preference => preference.semester_id != null)?.semester_id;
    const savedChoice = curriculumChoices.find(choice => choice.semester_id === savedSemesterId);
    const selectedChoice = curriculumChoices.find(choice => choice.program_id === programId && choice.semester_id === semesterId);
    const nextChoice = savedChoice ?? selectedChoice ?? curriculumChoices[0];
    if (programId !== nextChoice.program_id || semesterId !== nextChoice.semester_id) {
      setProgramId(nextChoice.program_id);
      setSemesterId(nextChoice.semester_id);
    }
  }, [curriculumChoices, detail, programId, semesterId]);

  const curriculum = curriculumChoices.find(choice => choice.program_id === programId && choice.semester_id === semesterId);
  const hasUnsupportedPreferences = detail?.preferences.some(preference =>
    preference.preference_kind === 'SOURCE' || preference.course_id == null,
  ) ?? false;

  const [windows, setWindows] = useState<AvWindow[]>([]);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  useEffect(() => {
    if (detail?.availability) {
      setWindows(detail.availability.filter(a => a.source === 'FACULTY_SUBMISSION').map(a => ({
        day: a.day, start_time: a.start_time, end_time: a.end_time, availability_type: a.availability_type,
      })));
    }
  }, [detail]);

  const isLocked = detail?.submission?.submission_status === 'SUBMITTED';
  const saveMutation = useMutation({
    mutationFn: () => api.put('/faculty-submissions/mine', {
      term_id: parseInt(termId),
      program_id: curriculum!.program_id,
      semester_id: curriculum!.semester_id,
      preferences: detail?.preferences?.map(p => ({ course_id: p.course_id, component_id: p.component_id ?? undefined, note: p.note ?? undefined })) ?? [],
      availability: windows,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-submission'] }); setSaveSuccess('Availability saved.'); setSaveError(''); setTimeout(() => setSaveSuccess(''), 3000); },
    onError: (e: any) => { setSaveError(e?.error?.message ?? 'Save failed'); setSaveSuccess(''); },
  });

  function addWindow() { setWindows(w => [...w, { day: 'MON', start_time: '09:00', end_time: '10:00', availability_type: 'AVAILABLE' }]); }
  function removeWindow(i: number) { setWindows(w => w.filter((_, idx) => idx !== i)); }
  function updateWindow(i: number, field: keyof AvWindow, val: string) {
    setWindows(w => w.map((win, idx) => idx === i ? { ...win, [field]: val } : win));
  }

  if (profileQuery.isPending || profileQuery.isError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }
  if (termsError || academicYearsError) {
    return <ErrorMessage error={termsError ?? academicYearsError} title="Unable to load your academic context" />;
  }
  if (termsLoading || academicYearsLoading) {
    return <Card padding><p className="text-sm text-gray-500">Loading your academic context…</p></Card>;
  }

  return (
    <div>
      <PageHeader title="My Availability" subtitle="Mark your available and unavailable time windows. Unrecorded time is treated as UNKNOWN — never assumed available." />

      <div className="mb-5 grid gap-4">
        <FacultyTermContextSelector
          academicYears={availableAcademicYears}
          terms={selectableTerms}
          yearId={yearId}
          parity={parity}
          termId={termId}
          onYearChange={nextYearId => {
            setYearId(nextYearId);
            setTermId(String(filterFacultyTerms(selectableTerms, nextYearId, parity)[0]?.term_id ?? ''));
          }}
          onParityChange={nextParity => {
            setParity(nextParity);
            setTermId(String(filterFacultyTerms(selectableTerms, yearId, nextParity)[0]?.term_id ?? ''));
          }}
          onTermChange={setTermId}
        />
        <select
          className="input min-w-64"
          value={curriculum ? `${curriculum.program_id}:${curriculum.semester_id}` : ''}
          onChange={event => {
            const [nextProgramId, nextSemesterId] = event.target.value.split(':').map(Number);
            setProgramId(nextProgramId);
            setSemesterId(nextSemesterId);
          }}
          disabled={!curriculumChoices.length || !!detail?.preferences.some(preference => preference.semester_id != null)}
        >
          {curriculumChoices.length === 0
            ? <option value="">No applicable program semesters</option>
            : curriculumChoices.map(choice => (
              <option key={`${choice.program_id}:${choice.semester_id}`} value={`${choice.program_id}:${choice.semester_id}`}>
                {choice.program_code} — Semester {choice.semester_no}{choice.semester_name ? ` (${choice.semester_name})` : ''}
              </option>
            ))}
        </select>
      </div>
      {!termsForSelection.length && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No active term is configured for this academic year and parity. Choose another context before saving availability.
        </p>
      )}
      {curriculumError && <FormError message={(curriculumError as Error).message} />}
      {!curriculumError && !curriculumChoices.length && termId && (
        <p className="text-sm text-amber-700 mb-4">No active program-semester mapping is configured for this term. Availability cannot be saved without a valid academic context.</p>
      )}
      {detailEditorState === 'loading' && (
        <p className="mb-4 text-sm text-gray-600" role="status">Loading availability for the selected term…</p>
      )}
      {detailEditorState === 'error' && (
        <div className="mb-4 space-y-2">
          <ErrorMessage error={detailError} title="Unable to load availability for the selected term" />
          <button type="button" className="btn-secondary btn-sm" onClick={() => void refetchDetail()}>
            Retry loading availability
          </button>
          <p className="text-xs text-amber-800">Editing and saving are disabled until the selected term's current submission loads successfully.</p>
        </div>
      )}
      {hasUnsupportedPreferences && (
        <p className="text-sm text-amber-700 mb-4">This submission contains an unverified subject preference that cannot be safely preserved by this form. Contact the administrator before saving availability.</p>
      )}

      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800 mb-5">
        <strong>Important:</strong> Time windows you do not record will be treated as UNKNOWN by the timetable system — not AVAILABLE. If you are available at a time, mark it explicitly.
      </div>

      <Card padding className="max-w-2xl">
        <div className="space-y-3 mb-4">
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <select className="input w-24" value={w.day} onChange={e => updateWindow(i, 'day', e.target.value)} disabled={isLocked || detailEditorState !== 'ready'}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="time" className="input w-32" value={w.start_time.slice(0, 5)} onChange={e => updateWindow(i, 'start_time', e.target.value + ':00')} disabled={isLocked || detailEditorState !== 'ready'} />
              <span className="text-gray-400 text-sm">to</span>
              <input type="time" className="input w-32" value={w.end_time.slice(0, 5)} onChange={e => updateWindow(i, 'end_time', e.target.value + ':00')} disabled={isLocked || detailEditorState !== 'ready'} />
              <select className="input w-36" value={w.availability_type} onChange={e => updateWindow(i, 'availability_type', e.target.value)} disabled={isLocked || detailEditorState !== 'ready'}>
                {AV_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {!isLocked && (
                <button className="btn-ghost btn-sm text-red-500 p-1.5" onClick={() => removeWindow(i)} disabled={detailEditorState !== 'ready'}>
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {windows.length === 0 && <p className="text-sm text-gray-400">No availability windows recorded.</p>}
        </div>

        {!isLocked && (
          <button className="btn-secondary btn-sm" onClick={addWindow} disabled={detailEditorState !== 'ready'}>
            <PlusIcon className="w-4 h-4" /> Add Window
          </button>
        )}

        {saveError && <FormError message={saveError} />}
        {saveSuccess && <p className="text-xs text-green-700 mt-2">{saveSuccess}</p>}

        {!isLocked && (
          <div className="mt-5 pt-4 border-t">
            <button className="btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || detailEditorState !== 'ready' || !detail || !curriculum || hasUnsupportedPreferences}>
              <SaveIcon className="w-4 h-4" /> {saveMutation.isPending ? 'Saving…' : 'Save Availability'}
            </button>
          </div>
        )}
        {isLocked && <p className="mt-4 text-sm text-gray-500">Availability is locked after submission.</p>}
      </Card>

      {/* Admin-entered windows */}
      {detail?.availability?.filter(a => a.source !== 'FACULTY_SUBMISSION').length ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Department-entered availability</h3>
          <div className="space-y-2">
            {detail.availability.filter(a => a.source !== 'FACULTY_SUBMISSION').map(a => (
              <div key={a.faculty_availability_id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm">
                <span className="font-medium text-gray-700">{a.day}</span>
                <span className="text-gray-500">{a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}</span>
                <Badge variant={avColor[a.availability_type]}>{a.availability_type}</Badge>
                <span className="text-xs text-gray-400">(entered by department)</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
