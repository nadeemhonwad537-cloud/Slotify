import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearchIcon, PencilIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { Modal } from '@/components/ui/Modal';
import { Link } from 'react-router-dom';
import type {
  Batch, Course, CourseComponent, Department, FacultyProfile, Section, Semester, Term,
} from '@/types';

interface ImportSubject {
  column: string;
  rawLabel: string | null;
  weeklyHours: number | null;
}

interface ImportIssue {
  code: string;
  field: string;
  severity: 'REVIEW' | 'BLOCKER';
  message: string;
}

interface SubjectMapping {
  course_id: number;
  component_id?: number | null;
  semester_id?: number | null;
  section_id?: number | null;
  batch_id?: number | null;
}

interface ImportRow {
  workload_import_row_id: number;
  source_row_number: number;
  source_page: number;
  raw_source_line: string;
  source_name: string | null;
  group_label: string;
  faculty_category: string;
  subjects: ImportSubject[];
  lab_duty: { rawLabel: string | null; weeklyHours: number | null };
  sdp_hours: number | null;
  minor_project_hours: number | null;
  printed_theory_hours: number | null;
  printed_lab_hours: number | null;
  printed_total_hours: number | null;
  printed_load_source_text: string;
  source_snapshot: {
    possibleFacultyMatches?: FacultyProfile[];
    subjectMatches?: Array<{
      rawLabel: string;
      candidates: Array<{ course_code: string | null; course_name: string; match: string }>;
    }>;
  };
  unresolved_fields: string[];
  issues: ImportIssue[];
  resolution_status: 'UNRESOLVED' | 'REVIEWED' | 'RESOLVED' | 'SKIPPED';
  faculty_id: number | null;
  department_id: number | null;
  term_id: number | null;
  resolution_json: Record<string, SubjectMapping> | null;
  review_notes: string | null;
  reviewed_at: string | null;
}

interface ImportResponse {
  batch: {
    batch_id: number;
    source_key: string;
    status: string;
    imported_at: string;
    file_name: string;
    term_id: number | null;
    remarks: string;
    import_summary: {
      inserted: { sourceDocuments: number; batches: number; sourceRows: number; provenance: number; discrepancies: number };
      updated: number;
      skipped: number;
      masterDataChanged: Record<string, number>;
    } | null;
  } | null;
  summary: { total: number; unresolved: number; reviewed: number; skipped: number; blockers: number };
  rows: ImportRow[];
}

function ReviewRowModal({
  row, onClose, faculty, departments, terms, courses, components, semesters, sections, batches,
}: {
  row: ImportRow | null;
  onClose: () => void;
  faculty: FacultyProfile[];
  departments: Department[];
  terms: Term[];
  courses: Course[];
  components: CourseComponent[];
  semesters: Semester[];
  sections: Section[];
  batches: Batch[];
}) {
  const qc = useQueryClient();
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [termId, setTermId] = useState('');
  const [status, setStatus] = useState<'REVIEWED' | 'SKIPPED'>('REVIEWED');
  const [notes, setNotes] = useState('');
  const [mappings, setMappings] = useState<Record<string, SubjectMapping>>({});
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    setFacultyId(row?.faculty_id == null ? '' : String(row.faculty_id));
    setDepartmentId(row?.department_id == null ? '' : String(row.department_id));
    setTermId(row?.term_id == null ? '' : String(row.term_id));
    setStatus(row?.resolution_status === 'SKIPPED' ? 'SKIPPED' : 'REVIEWED');
    setNotes(row?.review_notes ?? '');
    setMappings(row?.resolution_json ?? {});
    setErrorText('');
  }, [row]);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/workload-imports/${row!.workload_import_row_id}/review`, {
      resolution_status: status,
      faculty_id: facultyId ? Number(facultyId) : null,
      department_id: departmentId ? Number(departmentId) : null,
      term_id: termId ? Number(termId) : null,
      subject_mappings: mappings,
      review_notes: notes,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workload-import-review'] });
      await qc.invalidateQueries({ queryKey: ['my-import-workload'] });
      onClose();
    },
    onError: (error: Error) => setErrorText(error.message || 'Could not save review'),
  });

  function updateMapping(label: string, field: keyof SubjectMapping, value: string) {
    setMappings(current => {
      const next = { ...current };
      if (!value && field === 'course_id') {
        delete next[label];
        return next;
      }
      const currentMapping = next[label] ?? { course_id: 0 };
      const parsed = value ? Number(value) : null;
      next[label] = {
        ...currentMapping,
        [field]: field === 'course_id' ? (parsed ?? 0) : parsed,
      };
      if (field === 'course_id') {
        next[label].component_id = null;
        next[label].semester_id = null;
        next[label].section_id = null;
        next[label].batch_id = null;
      }
      if (field === 'semester_id') {
        next[label].section_id = null;
        next[label].batch_id = null;
      }
      if (field === 'section_id') next[label].batch_id = null;
      return next;
    });
  }

  if (!row) return null;
  const uniqueLabels = [...new Set(row.subjects.map(subject => subject.rawLabel).filter((label): label is string => !!label))];

  return (
    <Modal open={!!row} onClose={onClose} title={`Review source row ${row.source_row_number}`} size="xl">
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Source cells below are read-only. Saving a review records separate mapping decisions and notes; it does not create faculty, courses, or assignments.
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Original transcription · page {row.source_page}</p>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{row.raw_source_line}</p>
        </div>
        {row.issues.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Unresolved validation issues</h3>
            <ul className="space-y-1 text-xs text-gray-600">
              {row.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}><Badge variant={issue.severity === 'BLOCKER' ? 'red' : 'yellow'}>{issue.severity}</Badge> {issue.code}: {issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label">Existing faculty profile (optional)
            <select className="input mt-1" value={facultyId} onChange={event => setFacultyId(event.target.value)}>
              <option value="">No identity mapping</option>
              {faculty.filter(item => item.is_active).map(item => (
                <option key={item.faculty_id} value={item.faculty_id}>{item.name}{item.staff_code ? ` (${item.staff_code})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="label">Department candidate (optional)
            <select className="input mt-1" value={departmentId} onChange={event => setDepartmentId(event.target.value)}>
              <option value="">Not confirmed</option>
              {departments.filter(item => item.is_active).map(item => <option key={item.dept_id} value={item.dept_id}>{item.dept_code} — {item.dept_name}</option>)}
            </select>
          </label>
          <label className="label">Academic term (optional)
            <select className="input mt-1" value={termId} onChange={event => setTermId(event.target.value)}>
              <option value="">Not confirmed</option>
              {terms.filter(item => item.status !== 'CLOSED').map(item => <option key={item.term_id} value={item.term_id}>{item.term_name}</option>)}
            </select>
          </label>
          <label className="label">Review outcome
            <select className="input mt-1" value={status} onChange={event => setStatus(event.target.value as 'REVIEWED' | 'SKIPPED')}>
              <option value="REVIEWED">Reviewed — not an assignment</option>
              <option value="SKIPPED">Skip this source row</option>
            </select>
          </label>
        </div>
        {uniqueLabels.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Optional subject mapping suggestions</h3>
            {uniqueLabels.map(label => {
              const mapping = mappings[label];
              const selectedCourseId = mapping?.course_id || '';
              const selectedSemesterId = mapping?.semester_id ?? '';
              const selectedSectionId = mapping?.section_id ?? '';
              const suggestions = row.source_snapshot.subjectMatches?.find(match => match.rawLabel === label)?.candidates ?? [];
              return (
                <div key={label} className="rounded-lg border border-gray-200 p-3">
                  <p className="mb-2 text-sm font-medium">{label}</p>
                  {suggestions.length > 0 && <p className="mb-2 text-xs text-amber-700">Possible catalogue matches only: {suggestions.map(item => `${item.course_code ?? '(no code)'} ${item.course_name} (${item.match})`).join('; ')}</p>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select className="input" aria-label={`${label} course mapping`} value={selectedCourseId} onChange={event => updateMapping(label, 'course_id', event.target.value)}>
                      <option value="">No confirmed course mapping</option>
                      {courses.filter(item => item.is_active).map(item => <option key={item.course_id} value={item.course_id}>{item.course_code ?? '(no code)'} — {item.course_name}</option>)}
                    </select>
                    <select className="input" aria-label={`${label} component mapping`} value={mapping?.component_id ?? ''} disabled={!selectedCourseId} onChange={event => updateMapping(label, 'component_id', event.target.value)}>
                      <option value="">Component unconfirmed</option>
                      {components.filter(item => item.course_id === Number(selectedCourseId)).map(item => <option key={item.component_id} value={item.component_id}>{item.component_type} · {item.weekly_hours ?? '?'}h/wk</option>)}
                    </select>
                    <select className="input" aria-label={`${label} semester mapping`} value={selectedSemesterId} onChange={event => updateMapping(label, 'semester_id', event.target.value)}>
                      <option value="">Semester unconfirmed</option>
                      {semesters.filter(item => item.is_active).map(item => <option key={item.semester_id} value={item.semester_id}>Semester {item.semester_no}</option>)}
                    </select>
                    <select className="input" aria-label={`${label} section mapping`} value={selectedSectionId} onChange={event => updateMapping(label, 'section_id', event.target.value)}>
                      <option value="">Section unconfirmed</option>
                      {sections.filter(item => (!termId || item.term_id === Number(termId)) && (!selectedSemesterId || item.semester_id === Number(selectedSemesterId))).map(item => <option key={item.section_id} value={item.section_id}>{item.section_name} (section {item.section_id})</option>)}
                    </select>
                    <select className="input sm:col-span-2" aria-label={`${label} batch mapping`} value={mapping?.batch_id ?? ''} onChange={event => updateMapping(label, 'batch_id', event.target.value)}>
                      <option value="">Section-wide / batch not confirmed</option>
                      {batches.filter(item => !selectedSectionId || item.section_id === Number(selectedSectionId)).map(item => <option key={item.batch_id} value={item.batch_id}>{item.batch_name} ({item.batch_type})</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        <label className="label">Review notes (required)
          <textarea className="input mt-1 min-h-20" value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} required placeholder="Record the authority or evidence supporting any decision. Unresolved issues remain visible." />
        </label>
        {errorText && <FormError message={errorText} />}
        <div className="flex justify-end gap-3 border-t pt-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={mutation.isPending || notes.trim().length === 0} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save review decisions'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function WorkloadImportPage() {
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['workload-import-review'],
    queryFn: () => api.get<ImportResponse>('/workload-imports'),
  });
  const { data: faculty = [] } = useQuery({ queryKey: ['faculty'], queryFn: () => listRequest<FacultyProfile>('/masterdata/faculty?limit=500'), select: response => response.data });
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => listRequest<Department>('/masterdata/departments?limit=500'), select: response => response.data });
  const { data: terms = [] } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: response => response.data });
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: () => listRequest<Course>('/masterdata/courses?limit=500'), select: response => response.data });
  const { data: components = [] } = useQuery({ queryKey: ['components'], queryFn: () => listRequest<CourseComponent>('/masterdata/components?limit=500'), select: response => response.data });
  const { data: semesters = [] } = useQuery({ queryKey: ['semesters'], queryFn: () => listRequest<Semester>('/masterdata/semesters?limit=500'), select: response => response.data });
  const { data: sections = [] } = useQuery({ queryKey: ['sections'], queryFn: () => listRequest<Section>('/masterdata/sections?limit=500'), select: response => response.data });
  const { data: batches = [] } = useQuery({ queryKey: ['batches'], queryFn: () => listRequest<Batch>('/masterdata/batches?limit=500'), select: response => response.data });

  if (error) return <ErrorMessage error={error} />;
  const result = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="CSE Workload Import Review"
        subtitle="Source-reported faculty workloads are kept separate from master data and approved assignments."
      />
      <Card padding>
        <h2 className="font-semibold text-gray-900">Admin controls for faculty preference subjects</h2>
        <p className="mt-1 max-w-4xl text-sm text-gray-600">
          Add or correct canonical courses and components in the catalogue, then configure a term offering. Only confirmed OFFERED components for a term appear in faculty preferences. Keep unclear workbook abbreviations in review until their official course identity and hours are confirmed.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn-secondary btn-sm" to="/admin/courses">Manage course catalogue</Link>
          <Link className="btn-primary btn-sm" to="/admin/courses?tab=offerings">Manage term offerings</Link>
          <Link className="btn-secondary btn-sm" to="/admin/workload-imports">Review source mappings</Link>
        </div>
      </Card>
      {!result?.batch ? (
        <Card padding><p className="text-sm text-gray-600">No workload source has been imported.</p></Card>
      ) : (
        <>
          <Card padding>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2"><FileSearchIcon className="h-5 w-5 text-brand-600" /><h2 className="font-semibold text-gray-900">{result.batch.file_name}</h2></div>
                <p className="text-xs text-gray-500">Imported {new Date(result.batch.imported_at).toLocaleString()} · Source term FK: {result.batch.term_id ?? 'not linked'}</p>
                <p className="mt-2 max-w-3xl text-xs text-gray-600">{result.batch.remarks}</p>
              </div>
              <StatusBadge status={result.batch.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
              <Summary label="Source rows" value={result.summary.total} />
              <Summary label="Awaiting review" value={result.summary.unresolved} />
              <Summary label="Reviewed" value={result.summary.reviewed} />
              <Summary label="Skipped" value={result.summary.skipped} />
              <Summary label="Open blocker flags" value={result.summary.blockers} />
            </div>
            {result.batch.import_summary && (
              <p className="mt-3 rounded-lg bg-green-50 p-3 text-xs text-green-900">
                Committed source import: {result.batch.import_summary.inserted.sourceRows} review rows, {result.batch.import_summary.inserted.provenance} provenance rows, {result.batch.import_summary.inserted.discrepancies} blocking discrepancies; {result.batch.import_summary.updated} source/master-data updates; {result.batch.import_summary.skipped} skips. No faculty, course, component, curriculum, offering, audience, assignment, or preference records were changed.
              </p>
            )}
            <p className="mt-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
              Printed theory/lab/total values below are quoted from the source. Subject-hour sums are not represented as calculated workload and are never added to printed totals. Only approved records in Assignments count as teaching assignments.
            </p>
          </Card>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>{['Row / source', 'Category / review', 'Subject labels and hours', 'Lab duty', 'Other categories', 'Printed source totals', 'Unresolved issues', 'Possible matches', 'Review'].map(title => <th key={title} className="px-3 py-3 font-medium">{title}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(result.rows ?? []).map(row => {
                  const subjectLabels = row.subjects.filter(subject => subject.rawLabel || subject.weeklyHours !== null);
                  const possibleMatches = row.source_snapshot.subjectMatches?.flatMap(subject => subject.candidates.map(candidate => `${subject.rawLabel} → ${candidate.course_code ?? '(no code)'} ${candidate.course_name}`)) ?? [];
                  return (
                    <tr key={row.workload_import_row_id} className="align-top">
                      <td className="max-w-52 px-3 py-3">
                        <p className="font-semibold text-gray-800">Row {row.source_row_number} · page {row.source_page}</p>
                        <p className="mt-1 text-gray-700">{row.source_name ?? 'Missing source row'}</p>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-400">{row.raw_source_line}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p>{row.faculty_category}</p>
                        <div className="mt-1"><StatusBadge status={row.resolution_status} /></div>
                        {row.faculty_id != null && <p className="mt-1 text-gray-500">Profile #{row.faculty_id}</p>}
                      </td>
                      <td className="px-3 py-3">{subjectLabels.map((subject, index) => <p key={`${subject.column}-${index}`}>{subject.rawLabel ?? 'Unlabeled'} · {subject.weeklyHours ?? 'unreadable'}h</p>)}</td>
                      <td className="px-3 py-3">{row.lab_duty.rawLabel ?? '—'}{row.lab_duty.rawLabel && ` · ${row.lab_duty.weeklyHours ?? 'unreadable'}h`}</td>
                      <td className="px-3 py-3">SDP: {row.sdp_hours ?? '—'}<br />Minor project: {row.minor_project_hours ?? '—'}</td>
                      <td className="px-3 py-3">
                        <p>{row.printed_theory_hours ?? 'unreadable'} / {row.printed_lab_hours ?? 'unreadable'} / {row.printed_total_hours ?? 'unreadable'}h</p>
                        <p className="mt-1 max-w-48 text-gray-400">{row.printed_load_source_text}</p>
                      </td>
                      <td className="max-w-72 px-3 py-3">
                        {row.issues.length === 0 ? '—' : row.issues.map((issue, index) => (
                          <p key={`${issue.code}-${index}`} className="mb-1"><Badge variant={issue.severity === 'BLOCKER' ? 'red' : 'yellow'}>{issue.code}</Badge> {issue.message}</p>
                        ))}
                      </td>
                      <td className="max-w-64 px-3 py-3">{possibleMatches.length ? possibleMatches.map((match, index) => <p key={`${match}-${index}`} className="mb-1">{match} <span className="text-amber-600">(suggestion only)</span></p>) : 'None confirmed'}</td>
                      <td className="px-3 py-3">
                        <button className="btn-secondary btn-sm" onClick={() => setEditing(row)}><PencilIcon className="h-3.5 w-3.5" /> Review</button>
                        {row.review_notes && <p className="mt-2 max-w-48 text-gray-500">{row.review_notes}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {isLoading && <p className="p-4 text-sm text-gray-500">Loading workload source…</p>}
          </div>
        </>
      )}
      <ReviewRowModal
        row={editing}
        onClose={() => setEditing(null)}
        faculty={faculty}
        departments={departments}
        terms={terms}
        courses={courses}
        components={components}
        semesters={semesters}
        sections={sections}
        batches={batches}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold text-gray-900">{value}</p></div>;
}
