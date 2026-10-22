

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, RefreshCwIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { Modal } from '@/components/ui/Modal';
import type { TimetableVersion, ValidationRun, ValidationIssue, Term, Section, Semester } from '@/types';

interface VersionListRow {
  version_id: number;
  term_id: number;
  term_name: string;
  year_label: string;
  version_no: number;
  parent_version_id: number | null;
  status: string;
  availability_unknown_status: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  published_at: string | null;
  section_count: number;
  session_count: number;
  last_validation_id: number | null;
  last_validation_status: string | null;
  last_validated_at: string | null;
  last_error_count: number;
  last_warning_count: number;
}

interface VersionDetail {
  version: TimetableVersion & { term_name: string; year_label: string };
  sections: { section_id: number; section_name: string; semester_no: number }[];
  latest_validation: ValidationRun | null;
  approval_actions: {
    approval_id: number;
    action_type: string;
    actor_role: string;
    action_at: string;
    comment: string | null;
    actor_name: string;
  }[];
}

interface ValidationDetail {
  run: ValidationRun;
  issues: ValidationIssue[];
  summary: { issue_count: number; error_count: number; warning_count: number };
}

interface SessionFaculty {
  faculty_id: number;
  faculty_name: string;
  staff_code: string | null;
  role: string;
}

interface TimetableSessionRow {
  session_id: number;
  version_id: number;
  offering_id: number;
  room_id: number;
  day: string;
  start_time: string;
  end_time: string;
  start_slot_id: number | null;
  start_slot_no: number | null;
  slot_count: number | null;
  course_name: string;
  course_code: string | null;
  component_type: string;
  room_code: string;
  room_name: string | null;
  audiences: {
    audience_id: number;
    section_id: number;
    section_name: string;
    batch_id: number | null;
    batch_name: string | null;
  }[];
  faculty: SessionFaculty[];
}

interface SessionSlotOption {
  day: string;
  start_slot_id: number;
  slot_count: number;
  start_time: string;
  end_time: string;
}

interface SessionFacultyOption {
  assignment_id: number;
  faculty_id: number;
  faculty_name: string;
  staff_code: string | null;
  role: string;
}

interface SessionAudienceOption {
  audience_id: number;
  section_id: number;
  section_name: string;
  batch_id: number | null;
  batch_name: string | null;
  faculty: SessionFacultyOption[];
}

interface SessionOfferingOption {
  offering_id: number;
  course_name: string;
  course_code: string | null;
  component_type: string;
  duration_is_configured: boolean;
  audiences: SessionAudienceOption[];
  slot_options: SessionSlotOption[];
}

interface SessionOptions {
  offerings: SessionOfferingOption[];
  rooms: {
    room_id: number;
    room_code: string;
    room_name: string | null;
    capacity: number | null;
    room_type_name: string;
    practical_approved: number;
  }[];
  practical_approval_supported: boolean;
}

function CreateVersionModal({ open, onClose, terms, sections, semesterMap }: {
  open: boolean; onClose: () => void; terms: Term[]; sections: Section[]; semesterMap: Record<number, number>;
}) {
  const qc = useQueryClient();
  const [termId, setTermId] = useState('');
  const [selectedSections, setSelectedSections] = useState<number[]>([]);
  const [err, setErr] = useState('');

  const termSections = sections.filter(s => termId && String(s.term_id) === termId);

  function toggleSection(id: number) {
    setSelectedSections(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const mut = useMutation({
    mutationFn: (b: any) => api.post('/timetable/versions', b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timetable-versions-list'] });
      onClose();
      setTermId(''); setSelectedSections([]); setErr('');
    },
    onError: (e: any) => setErr(e?.error?.message ?? 'Failed to create version'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!termId) { setErr('Select a term'); return; }
    mut.mutate({ term_id: +termId, section_ids: selectedSections });
  }

  return (
    <Modal open={open} onClose={onClose} title="Create New Timetable Version" size="md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Term</label>
          <select className="input" value={termId} onChange={e => { setTermId(e.target.value); setSelectedSections([]); }} required>
            <option value="">— Choose term —</option>
            {terms.filter(t => t.status !== 'CLOSED').map(t => <option key={t.term_id} value={t.term_id}>{t.term_name} ({t.status})</option>)}
          </select>
        </div>
        {termId && (
          <div>
            <label className="label">Sections to include (optional)</label>
            {termSections.length === 0
              ? <p className="text-sm text-gray-400">No sections found for this term.</p>
              : <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {termSections.map(s => (
                    <label key={s.section_id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selectedSections.includes(s.section_id)} onChange={() => toggleSection(s.section_id)} />
                      <span className="text-sm text-gray-700">{s.section_name} (Sem {semesterMap[s.semester_id] ?? s.semester_id})</span>
                    </label>
                  ))}                </div>
            }
            <p className="text-xs text-gray-400 mt-1">Leave all unchecked to create a version with no sections yet.</p>
          </div>
        )}
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || !termId}>{mut.isPending ? 'Creating…' : 'Create Version'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SessionModal({ open, onClose, onSaved, versionId, options, session }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  versionId: number;
  options: SessionOptions | undefined;
  session: TimetableSessionRow | null;
}) {
  const qc = useQueryClient();
  const [offeringId, setOfferingId] = useState('');
  const [audienceId, setAudienceId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [startSlotId, setStartSlotId] = useState('');
  const [assignmentIds, setAssignmentIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const offering = options?.offerings.find(item => String(item.offering_id) === offeringId);
  const audience = offering?.audiences.find(item => String(item.audience_id) === audienceId);
  const slots = offering?.slot_options ?? [];

  useEffect(() => {
    if (!open) return;
    setOfferingId(session ? String(session.offering_id) : '');
    setAudienceId(session?.audiences[0] ? String(session.audiences[0].audience_id) : '');
    setRoomId(session ? String(session.room_id) : '');
    setStartSlotId(session?.start_slot_id ? String(session.start_slot_id) : '');
    setAssignmentIds([]);
    setError('');
    setValidationMessages([]);
  }, [open, session]);

  useEffect(() => {
    if (!session || !audience) return;
    const selectedFacultyIds = new Set(session.faculty.map(member => member.faculty_id));
    setAssignmentIds(audience.faculty
      .filter(member => selectedFacultyIds.has(member.faculty_id))
      .map(member => member.assignment_id));
  }, [audience, session]);

  const mutation = useMutation({
    mutationFn: (body: {
      offering_id: number;
      audience_id: number;
      room_id: number;
      start_slot_id: number;
      assignment_ids: number[];
    }) => session
      ? api.put(`/timetable/versions/${versionId}/sessions/${session.session_id}`, body)
      : api.post(`/timetable/versions/${versionId}/sessions`, body),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['timetable-version-sessions', versionId] }),
        qc.invalidateQueries({ queryKey: ['timetable-version', versionId] }),
        qc.invalidateQueries({ queryKey: ['timetable-versions-list'] }),
      ]);
      onSaved();
      onClose();
    },
    onError: (e: any) => {
      setError(e?.error?.message ?? 'Could not save the session.');
      const issues = e?.error?.details?.issues;
      setValidationMessages(Array.isArray(issues) ? issues.map((issue: any) => issue.message).filter(Boolean) : []);
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setValidationMessages([]);
    if (!offering || !audience || !roomId || !startSlotId || assignmentIds.length === 0) {
      setError('Select a course offering, division or batch, room, teaching time, and at least one assigned faculty member.');
      return;
    }
    mutation.mutate({
      offering_id: offering.offering_id,
      audience_id: audience.audience_id,
      room_id: Number(roomId),
      start_slot_id: Number(startSlotId),
      assignment_ids: assignmentIds,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={session ? 'Edit Draft Session' : 'Add Draft Session'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="session-offering">Course offering</label>
          <select id="session-offering" className="input" value={offeringId} onChange={event => {
            setOfferingId(event.target.value); setAudienceId(''); setAssignmentIds([]); setStartSlotId('');
          }}>
            <option value="">— Choose a verified offering —</option>
            {(options?.offerings ?? []).map(item => (
              <option key={item.offering_id} value={item.offering_id}>
                {item.course_code ? `${item.course_code} · ` : ''}{item.course_name} ({item.component_type})
              </option>
            ))}
          </select>
        </div>
        {offering && (
          <div>
            <label className="label" htmlFor="session-audience">Division / batch</label>
            <select id="session-audience" className="input" value={audienceId} onChange={event => {
              setAudienceId(event.target.value); setAssignmentIds([]);
            }}>
              <option value="">— Choose audience —</option>
              {offering.audiences.map(item => (
                <option key={item.audience_id} value={item.audience_id}>
                  {item.section_name}{item.batch_name ? ` · ${item.batch_name}` : ' · Full division'}
                </option>
              ))}
            </select>
          </div>
        )}
        {audience && (
          <div>
            <label className="label" htmlFor="session-faculty">Assigned faculty</label>
            <select
              id="session-faculty"
              multiple
              className="input min-h-28"
              value={assignmentIds.map(String)}
              onChange={event => setAssignmentIds(Array.from(event.currentTarget.selectedOptions, option => Number(option.value)))}
            >
              {audience.faculty.map(member => (
                <option key={member.assignment_id} value={member.assignment_id}>
                  {member.faculty_name}{member.staff_code ? ` (${member.staff_code})` : ''} · {member.role}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Only approved and verified assignments for this audience are selectable.</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="session-room">Room</label>
          <select id="session-room" className="input" value={roomId} onChange={event => setRoomId(event.target.value)}>
            <option value="">— Choose a verified room —</option>
            {(options?.rooms ?? []).map(room => (
              <option key={room.room_id} value={room.room_id}>
                {room.room_code}{room.room_name ? ` · ${room.room_name}` : ''} · {room.room_type_name}
                {room.capacity != null ? ` · capacity ${room.capacity}` : ''}
              </option>
            ))}
          </select>
          {offering?.component_type !== 'THEORY' && options && !options.practical_approval_supported && (
            <p className="text-xs text-amber-700 mt-1">Room practical approval is not configured in this database schema; validation will block practical sessions.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="session-time">Configured teaching time</label>
          <select id="session-time" className="input" value={startSlotId} onChange={event => setStartSlotId(event.target.value)}>
            <option value="">— Choose a configured slot —</option>
            {slots.map(slot => (
              <option key={`${slot.day}-${slot.start_slot_id}`} value={slot.start_slot_id}>
                {slot.day} · {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                {slot.slot_count > 1 ? ` (${slot.slot_count} consecutive periods)` : ''}
              </option>
            ))}
          </select>
          {offering && !offering.duration_is_configured && (
            <p className="text-xs text-red-700 mt-1">Lab duration is not configured. Verify periods per session before scheduling.</p>
          )}
          {offering && offering.duration_is_configured && slots.length === 0 && (
            <p className="text-xs text-amber-700 mt-1">No configured consecutive teaching slots are available for this session duration.</p>
          )}
        </div>
        {error && <FormError message={error} />}
        {validationMessages.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-700 space-y-1">
            {validationMessages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : session ? 'Save Changes' : 'Add Session'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TimetableVersionsPage() {
  const qc = useQueryClient();
  const [filterTermId, setFilterTermId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editingSession, setEditingSession] = useState<TimetableSessionRow | null>(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const [sessionActionError, setSessionActionError] = useState('');
  const [workflowNotice, setWorkflowNotice] = useState('');
  const [workflowError, setWorkflowError] = useState('');

  const { data: terms = [] } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: r => r.data });
  const { data: sections = [] } = useQuery({ queryKey: ['sections'], queryFn: () => listRequest<Section>('/masterdata/sections?limit=500'), select: r => r.data });
  const { data: semesters = [] } = useQuery({ queryKey: ['semesters'], queryFn: () => listRequest<Semester>('/masterdata/semesters?limit=500'), select: r => r.data });

  // Map semester_id → semester_no for display
  const semesterMap = Object.fromEntries(semesters.map(s => [s.semester_id, s.semester_no]));

  const queryParams = new URLSearchParams();
  if (filterTermId) queryParams.set('term_id', filterTermId);
  if (filterStatus) queryParams.set('status', filterStatus);
  queryParams.set('limit', '200');

  const { data: listResult, isLoading: listLoading, error: listError, refetch } = useQuery({
    queryKey: ['timetable-versions-list', filterTermId, filterStatus],
    queryFn: () => listRequest<VersionListRow>(`/timetable/versions?${queryParams}`),
  });
  const versions = listResult?.data ?? [];

  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery<VersionDetail>({
    queryKey: ['timetable-version', selectedId],
    queryFn: () => api.get<VersionDetail>(`/timetable/versions/${selectedId}`),
    enabled: !!selectedId,
  });
  const { data: validationDetail, isLoading: validationDetailLoading, error: validationDetailError } = useQuery<ValidationDetail>({
    queryKey: ['timetable-validation-detail', detail?.latest_validation?.validation_id],
    queryFn: () => api.get<ValidationDetail>(`/timetable/validate/${detail!.latest_validation!.validation_id}`),
    enabled: !!detail?.latest_validation?.validation_id,
  });

  const { data: sessions = [], isLoading: sessionsLoading, error: sessionsError } = useQuery<TimetableSessionRow[]>({
    queryKey: ['timetable-version-sessions', selectedId],
    queryFn: () => api.get<TimetableSessionRow[]>(`/timetable/versions/${selectedId}/sessions`),
    enabled: !!selectedId,
  });
  const validationPassed = validationDetail?.run.status === 'PASSED'
    && validationDetail.summary.error_count === 0
    && sessions.length > 0;
  const { data: sessionOptions, isLoading: sessionOptionsLoading, error: sessionOptionsError } = useQuery<SessionOptions>({
    queryKey: ['timetable-version-session-options', selectedId],
    queryFn: () => api.get<SessionOptions>(`/timetable/versions/${selectedId}/session-options`),
    enabled: !!selectedId && detail?.version.status === 'DRAFT',
  });
  const deleteSession = useMutation({
    mutationFn: (sessionId: number) => api.delete(`/timetable/versions/${selectedId}/sessions/${sessionId}`),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['timetable-version-sessions', selectedId] }),
        qc.invalidateQueries({ queryKey: ['timetable-versions-list'] }),
      ]);
      setSessionNotice('Session deleted.');
      setSessionActionError('');
    },
    onError: (e: any) => setSessionActionError(e?.error?.message ?? 'Could not delete the session.'),
  });
  const lifecycleQueryKeys = [
    ['timetable-version', selectedId],
    ['timetable-versions-list'],
  ] as const;
  const validateVersion = useMutation({
    mutationFn: () => api.post('/timetable/validate', { version_id: selectedId, dry_run: false }),
    onSuccess: async () => {
      setWorkflowNotice('Validation completed. Review the results before submitting for review.');
      setWorkflowError('');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
    onError: (error: any) => setWorkflowError(error?.error?.message ?? 'Timetable validation failed.'),
  });
  const submitForReview = useMutation({
    mutationFn: () => api.post(`/timetable/versions/${selectedId}/submit-review`),
    onSuccess: async () => {
      setWorkflowNotice('The timetable passed validation and was submitted for review.');
      setWorkflowError('');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
    onError: async (error: any) => {
      setWorkflowError(error?.error?.message ?? 'Could not submit the timetable for review.');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
  });
  const requestChanges = useMutation({
    mutationFn: (comment: string) => api.post(`/timetable/versions/${selectedId}/request-changes`, { comment }),
    onSuccess: async () => {
      setWorkflowNotice('The timetable was returned to DRAFT and the review comment was recorded.');
      setWorkflowError('');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
    onError: (error: any) => setWorkflowError(error?.error?.message ?? 'Could not return the timetable for changes.'),
  });
  const approveVersion = useMutation({
    mutationFn: () => api.post(`/timetable/versions/${selectedId}/approve`),
    onSuccess: async () => {
      setWorkflowNotice('The timetable passed revalidation and was approved for publication.');
      setWorkflowError('');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
    onError: async (error: any) => {
      setWorkflowError(error?.error?.message ?? 'Could not approve the timetable.');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
  });
  const publishVersion = useMutation({
    mutationFn: () => api.post(`/timetable/versions/${selectedId}/publish`),
    onSuccess: async () => {
      setWorkflowNotice('The timetable was published. The prior published version, if any, is archived.');
      setWorkflowError('');
      await Promise.all([
        ...lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })),
        qc.invalidateQueries({ queryKey: ['my-faculty-timetable-contexts'] }),
        qc.invalidateQueries({ queryKey: ['my-faculty-timetable-sessions'] }),
      ]);
    },
    onError: async (error: any) => {
      setWorkflowError(error?.error?.message ?? 'Could not publish the timetable.');
      await Promise.all(lifecycleQueryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
  });

  const VERSION_STATUSES = ['DRAFT', 'VALIDATED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'];

  return (
    <div>
      <PageHeader title="Timetable Versions"
        subtitle="View, create and manage timetable versions."
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => refetch()} title="Refresh"><RefreshCwIcon className="w-4 h-4" /></button>
            <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}><PlusIcon className="w-4 h-4" /> New Version</button>
          </div>
        } />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <select className="input w-48" value={filterTermId} onChange={e => setFilterTermId(e.target.value)}>
          <option value="">All terms</option>
          {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
        <select className="input w-40" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {VERSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {listError && <ErrorMessage error={listError} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Version list */}
        <div className="lg:col-span-2 space-y-2">
          {listLoading && (
            <div className="card p-8 text-center">
              <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}
          {!listLoading && versions.length === 0 && (
            <Card>
              <EmptyState title="No timetable versions" description="Create a draft to add and validate sessions. Automatic timetable generation is not implemented." />
            </Card>
          )}
          {versions.map(v => (
            <div
              key={v.version_id}
              onClick={() => {
                setSelectedId(v.version_id);
                setSessionNotice('');
                setSessionActionError('');
                setWorkflowNotice('');
                setWorkflowError('');
              }}
              className={`card p-4 cursor-pointer transition-colors ${selectedId === v.version_id ? 'border-brand-400 bg-brand-50' : 'hover:bg-gray-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">v{v.version_no}</span>
                    <StatusBadge status={v.status} />
                    {v.availability_unknown_status !== 'NONE' && (
                      <Badge variant="yellow">Unknown Avail: {v.availability_unknown_status}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{v.year_label} · {v.term_name}</p>
                  {v.status === 'PUBLISHED' && v.published_at && (
                    <p className="mt-1 text-xs font-medium text-green-700">Current published version · {new Date(v.published_at).toLocaleString()}</p>
                  )}
                  {v.status === 'ARCHIVED' && v.published_at && (
                    <p className="mt-1 text-xs text-gray-500">Archived publication · {new Date(v.published_at).toLocaleString()}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{new Date(v.created_at).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-400">by {v.created_by_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span>{v.section_count} sections</span>
                <span>{v.session_count} sessions</span>
                {v.last_validation_status && (
                  <span className="flex items-center gap-1">
                    Validation: <StatusBadge status={v.last_validation_status} />
                    {v.last_error_count > 0 && <span className="text-red-600">{v.last_error_count} errors</span>}
                    {v.last_warning_count > 0 && <span className="text-yellow-600">{v.last_warning_count} warnings</span>}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div>
          {!selectedId ? (
            <Card>
              <EmptyState title="Select a version" description="Click any version to see its details." />
            </Card>
          ) : detailLoading ? (
            <Card><div className="py-8 text-center"><div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" /></div></Card>
          ) : detailError ? (
            <ErrorMessage error={detailError} />
          ) : detail ? (
            <div className="space-y-3">
              <Card>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Version</p><p className="font-semibold text-gray-900">v{detail.version.version_no}</p></div>
                  <div><p className="text-xs text-gray-400">Status</p><StatusBadge status={detail.version.status} /></div>
                  <div><p className="text-xs text-gray-400">Academic context</p><p className="text-gray-900">{detail.version.year_label} · {detail.version.term_name}</p></div>
                  <div><p className="text-xs text-gray-400">Created</p><p className="text-gray-900">{new Date(detail.version.created_at).toLocaleDateString()}</p></div>
                  {detail.version.published_at && <div className="col-span-2"><p className="text-xs text-gray-400">Published at</p><p className="text-gray-900">{new Date(detail.version.published_at).toLocaleString()}</p></div>}
                </div>
                {detail.version.availability_unknown_status !== 'NONE' && (
                  <div className="mt-3 rounded bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                    Unknown availability: <strong>{detail.version.availability_unknown_status}</strong>. Cannot approve or publish until resolved.
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Sections ({detail.sections.length})</h3>
                {detail.sections.length === 0
                  ? <p className="text-xs text-gray-400">No sections linked.</p>
                  : <div className="flex flex-wrap gap-1.5">
                      {detail.sections.map(s => (
                        <span key={s.section_id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium">
                          {s.section_name} · Sem {s.semester_no}
                        </span>
                      ))}
                    </div>
                }
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Latest Validation</h3>
                {!detail.latest_validation
                  ? <p className="text-xs text-gray-400">No validation run yet. Validate this version before submitting it for review.</p>
                  : <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-900">Run #{detail.latest_validation.validation_id}</p>
                        <p className="text-xs text-gray-400">{new Date(detail.latest_validation.started_at).toLocaleString()}</p>
                      </div>
                      <StatusBadge status={detail.latest_validation.status} />
                    </div>
                }
                {validationDetailLoading && <p className="mt-2 text-xs text-gray-500">Loading validation findings…</p>}
                {validationDetailError && <div className="mt-2"><ErrorMessage error={validationDetailError} title="Could not load validation findings" /></div>}
                {validationDetail && (
                  <>
                    <p className={`mt-2 text-xs ${validationDetail.summary.error_count ? 'text-red-700' : 'text-green-700'}`}>
                      {validationDetail.summary.error_count} blocking errors · {validationDetail.summary.warning_count} warnings
                    </p>
                    {validationDetail.issues.length > 0 && (
                      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                        {validationDetail.issues.map(issue => (
                          <div key={issue.issue_id} className={`rounded border px-2 py-2 text-xs ${issue.severity === 'ERROR' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
                            <div className="flex items-center gap-2">
                              <Badge variant={issue.severity === 'ERROR' ? 'red' : issue.severity === 'WARNING' ? 'yellow' : 'blue'}>{issue.severity}</Badge>
                              <code className="text-gray-600">{issue.rule_code}</code>
                            </div>
                            <p className="mt-1 text-gray-800">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-gray-700">Review & publication</h3>
                <p className="mt-1 text-xs text-gray-600">
                  Drafts are private. Submission, approval, and publication each rerun validation; publication archives the current version for this term.
                </p>
                {workflowNotice && <p role="status" className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{workflowNotice}</p>}
                {workflowError && <div className="mt-3"><FormError message={workflowError} /></div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(detail.version.status === 'DRAFT' || detail.version.status === 'VALIDATED') && (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={validateVersion.isPending}
                      onClick={() => { setWorkflowError(''); setWorkflowNotice(''); validateVersion.mutate(); }}
                    >
                      {validateVersion.isPending ? 'Validating…' : 'Run validation'}
                    </button>
                  )}
                  {detail.version.status === 'VALIDATED' && (
                    <button
                      className="btn-primary btn-sm"
                      disabled={!validationPassed || submitForReview.isPending}
                      onClick={() => { setWorkflowError(''); setWorkflowNotice(''); submitForReview.mutate(); }}
                    >
                      {submitForReview.isPending ? 'Submitting…' : 'Submit for review'}
                    </button>
                  )}
                  {detail.version.status === 'IN_REVIEW' && (
                    <>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={requestChanges.isPending}
                        onClick={() => {
                          const comment = window.prompt('Explain the changes required before this timetable can be reviewed again.');
                          if (comment?.trim()) {
                            setWorkflowError('');
                            setWorkflowNotice('');
                            requestChanges.mutate(comment.trim());
                          }
                        }}
                      >
                        Return for changes
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={!validationPassed || approveVersion.isPending}
                        onClick={() => { setWorkflowError(''); setWorkflowNotice(''); approveVersion.mutate(); }}
                      >
                        {approveVersion.isPending ? 'Approving…' : 'Approve for publication'}
                      </button>
                    </>
                  )}
                  {detail.version.status === 'APPROVED' && (
                    <>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={requestChanges.isPending}
                        onClick={() => {
                          const comment = window.prompt('Explain the changes required before this timetable can be approved again.');
                          if (comment?.trim()) {
                            setWorkflowError('');
                            setWorkflowNotice('');
                            requestChanges.mutate(comment.trim());
                          }
                        }}
                      >
                        Return for changes
                      </button>
                      <button
                        className="btn-primary btn-sm"
                        disabled={!validationPassed || publishVersion.isPending}
                        onClick={() => {
                          if (window.confirm('Publish this approved timetable? The current published version for this term will be archived.')) {
                            setWorkflowError('');
                            setWorkflowNotice('');
                            publishVersion.mutate();
                          }
                        }}
                      >
                        {publishVersion.isPending ? 'Publishing…' : 'Publish timetable'}
                      </button>
                    </>
                  )}
                </div>
                {(detail.version.status === 'DRAFT' || detail.version.status === 'VALIDATED') && (
                  <p className="mt-2 text-xs text-gray-500">Only versions with no blocking validation errors can enter review.</p>
                )}
                {detail.version.status === 'IN_REVIEW' && (
                <p className="mt-2 text-xs text-gray-500">Approval requires a fresh passing validation and the configured timetable approval permission.</p>
                )}
                {detail.version.status === 'APPROVED' && (
                <p className="mt-2 text-xs text-gray-500">This version is approved but remains private until an authorized publisher publishes it.</p>
                )}
                {detail.version.status === 'PUBLISHED' && (
                  <p className="mt-2 text-xs text-green-700">This is the current published version for this term and is read-only.</p>
                )}
                {detail.version.status === 'ARCHIVED' && (
                  <p className="mt-2 text-xs text-gray-500">This prior published version is archived and retained for history.</p>
                )}
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Version history</h3>
                {detail.approval_actions.length === 0
                  ? <p className="text-xs text-gray-400">No review or publication actions recorded.</p>
                  : <div className="space-y-3">
                      {detail.approval_actions.map(action => (
                        <div key={action.approval_id} className="border-l-2 border-gray-200 pl-3">
                          <p className="text-xs font-medium text-gray-800">{action.action_type.replace(/_/g, ' ')} · {action.actor_name} ({action.actor_role})</p>
                          <p className="text-xs text-gray-500">{new Date(action.action_at).toLocaleString()}</p>
                          {action.comment && <p className="mt-1 text-xs text-gray-700">{action.comment}</p>}
                        </div>
                      ))}
                    </div>
                }
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      {selectedId && detail && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Scheduled sessions</h2>
              <p className="text-sm text-gray-500">Version v{detail.version.version_no} · {sessions.length} session{sessions.length === 1 ? '' : 's'}</p>
            </div>
            {detail.version.status === 'DRAFT' && (
              <button
                className="btn-primary btn-sm"
                disabled={sessionOptionsLoading || !!sessionOptionsError}
                onClick={() => { setEditingSession(null); setShowSessionForm(true); setSessionActionError(''); }}
              >
                <PlusIcon className="w-4 h-4" /> Add Session
              </button>
            )}
          </div>

          {sessionNotice && <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{sessionNotice}</p>}
          {sessionActionError && <FormError message={sessionActionError} />}
          {sessionOptionsError && detail.version.status === 'DRAFT' && <ErrorMessage error={sessionOptionsError} />}
          {sessionsError && <ErrorMessage error={sessionsError} />}
          {sessionsLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <EmptyState
              title="No sessions in this version"
              description={detail.version.status === 'DRAFT'
                ? 'Add a session using verified course, audience, faculty, room, and teaching-slot records.'
                : 'This non-draft version has no scheduled sessions.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Day / time</th>
                    <th className="px-3 py-2">Course</th>
                    <th className="px-3 py-2">Division</th>
                    <th className="px-3 py-2">Room</th>
                    <th className="px-3 py-2">Faculty</th>
                    {detail.version.status === 'DRAFT' && <th className="px-3 py-2">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map(session => (
                    <tr key={session.session_id}>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{session.day}</div>
                        <div className="text-gray-500">{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</div>
                        {session.start_slot_no != null && <div className="text-xs text-gray-400">Period {session.start_slot_no}{session.slot_count && session.slot_count > 1 ? `–${session.start_slot_no + session.slot_count - 1}` : ''}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-900">{session.course_name}</div>
                        <div className="text-gray-500">{session.course_code ?? 'No course code'} · {session.component_type}</div>
                      </td>
                      <td className="px-3 py-3">
                        {session.audiences.map(item => (
                          <div key={`${item.section_id}-${item.batch_id ?? 'all'}`}>
                            {item.section_name}{item.batch_name ? ` · ${item.batch_name}` : ''}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3">{session.room_code}{session.room_name ? ` · ${session.room_name}` : ''}</td>
                      <td className="px-3 py-3">
                        {session.faculty.length
                          ? session.faculty.map(member => <div key={member.faculty_id}>{member.faculty_name} · {member.role}</div>)
                          : <span className="text-red-600">No faculty</span>}
                      </td>
                      {detail.version.status === 'DRAFT' && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          <button className="btn-secondary btn-sm mr-2" onClick={() => {
                            setEditingSession(session);
                            setShowSessionForm(true);
                            setSessionActionError('');
                          }}>Edit</button>
                          <button className="btn-danger btn-sm" disabled={deleteSession.isPending} onClick={() => {
                            if (window.confirm(`Delete the ${session.course_name} session on ${session.day} at ${session.start_time.slice(0, 5)}?`)) {
                              setSessionNotice('');
                              setSessionActionError('');
                              deleteSession.mutate(session.session_id);
                            }
                          }}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.version.status !== 'DRAFT' && (
            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              This version is read-only because its status is {detail.version.status}. Only DRAFT versions can be edited.
            </p>
          )}
        </Card>
      )}

      <CreateVersionModal open={showCreate} onClose={() => setShowCreate(false)} terms={terms} sections={sections} semesterMap={semesterMap} />
      {selectedId && (
        <SessionModal
          open={showSessionForm}
          onClose={() => setShowSessionForm(false)}
          onSaved={() => setSessionNotice(editingSession ? 'Session updated.' : 'Session added.')}
          versionId={selectedId}
          options={sessionOptions}
          session={editingSession}
        />
      )}
    </div>
  );
}
