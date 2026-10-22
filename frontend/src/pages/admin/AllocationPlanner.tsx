import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, CheckCircle2Icon, SaveIcon, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { api, listRequest, ApiRequestError } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ConfirmModal } from '@/components/ui/Modal';
import type { AllocationContextOption, AllocationIssue, AllocationPlan, AllocationRequirement } from '@/types';

interface ValidationResponse {
  issues: AllocationIssue[];
  can_finalize: boolean;
  required_hours: number;
  allocated_hours: number;
  unallocated_hours: number;
}

const contextKey = (context: AllocationContextOption) => ({
  term_id: context.term_id,
  program_id: context.program_id,
  scheme_id: context.scheme_id,
  semester_id: context.semester_id,
  section_id: context.section_id,
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiRequestError ? error.error.message : fallback;
}

function roleFor(componentType: string) {
  if (componentType === 'LAB') return 'LAB_LEAD';
  if (componentType === 'TUTORIAL') return 'TUTOR';
  if (componentType === 'PROJECT') return 'UNSPECIFIED';
  return 'LECTURER';
}

function AllocationPlanner() {
  const queryClient = useQueryClient();
  const [termId, setTermId] = useState('');
  const [programId, setProgramId] = useState('');
  const [schemeId, setSchemeId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [facultySelections, setFacultySelections] = useState<Record<number, string>>({});
  const [roleSelections, setRoleSelections] = useState<Record<number, string>>({});
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const contextsQuery = useQuery({
    queryKey: ['allocation-contexts'],
    queryFn: () => listRequest<AllocationContextOption>('/assignments/allocation/contexts'),
    select: result => result.data,
  });
  const contexts = contextsQuery.data ?? [];
  const terms = useMemo(() => [...new Map(contexts.map(c => [c.term_id, c])).values()], [contexts]);
  const programs = contexts.filter(c => String(c.term_id) === termId)
    .filter((c, index, rows) => rows.findIndex(r => r.program_id === c.program_id) === index);
  const schemes = contexts.filter(c => String(c.term_id) === termId && String(c.program_id) === programId)
    .filter((c, index, rows) => rows.findIndex(r => r.scheme_id === c.scheme_id) === index);
  const semesters = contexts.filter(c => String(c.term_id) === termId && String(c.program_id) === programId && String(c.scheme_id) === schemeId)
    .filter((c, index, rows) => rows.findIndex(r => r.semester_id === c.semester_id) === index);
  const sections = contexts.filter(c => String(c.term_id) === termId && String(c.program_id) === programId
    && String(c.scheme_id) === schemeId && String(c.semester_id) === semesterId);
  const selectedContext = sections.find(c => String(c.section_id) === sectionId);

  const planQuery = useQuery({
    queryKey: ['allocation-plan', termId, programId, schemeId, semesterId, sectionId],
    queryFn: () => api.get<AllocationPlan>(`/assignments/allocation/plan?term_id=${termId}&program_id=${programId}&scheme_id=${schemeId}&semester_id=${semesterId}&section_id=${sectionId}`),
    enabled: !!selectedContext,
  });
  const plan = planQuery.data;

  function resetValidation() {
    setValidation(null);
    setActionError('');
    setConfirmFinalize(false);
  }

  const invalidatePlan = () => {
    resetValidation();
    queryClient.invalidateQueries({ queryKey: ['allocation-plan'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: { audience_id: number; faculty_id: number; role: string; source_preference_id: number | null }) => api.post('/assignments', body),
    onSuccess: invalidatePlan,
    onError: error => setActionError(getErrorMessage(error, 'Could not create the draft allocation.')),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { faculty_id: number; role: string } }) => api.patch(`/assignments/${id}`, body),
    onSuccess: invalidatePlan,
    onError: error => setActionError(getErrorMessage(error, 'Could not update the draft allocation.')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/assignments/${id}`),
    onSuccess: () => { setDeleteTarget(null); invalidatePlan(); },
    onError: error => setActionError(getErrorMessage(error, 'Could not remove the draft allocation.')),
  });
  const validateMutation = useMutation({
    mutationFn: () => api.post<ValidationResponse>('/assignments/allocation/validate', contextKey(selectedContext!)),
    onSuccess: result => { setValidation(result); setActionError(''); },
    onError: error => setActionError(getErrorMessage(error, 'Allocation validation failed.')),
  });
  const finalizeMutation = useMutation({
    mutationFn: () => api.post<{ finalized_count: number }>('/assignments/allocation/finalize', contextKey(selectedContext!)),
    onSuccess: result => {
      setConfirmFinalize(false);
      setValidation(null);
      queryClient.invalidateQueries({ queryKey: ['allocation-plan'] });
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
      setActionError(`Finalized ${result.finalized_count} draft allocation${result.finalized_count === 1 ? '' : 's'}.`);
    },
    onError: error => setActionError(getErrorMessage(error, 'Allocation could not be finalized.')),
  });

  function selectTerm(value: string) {
    setTermId(value);
    setProgramId('');
    setSchemeId('');
    setSemesterId('');
    setSectionId('');
    resetValidation();
  }

  const issues = validation?.issues ?? plan?.issues ?? [];
  const errors = issues.filter(issue => issue.severity === 'ERROR');
  const warnings = issues.filter(issue => issue.severity === 'WARNING');

  return (
    <section className="mb-8 space-y-4">
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Allocation planner</h2>
          <p className="text-sm text-gray-500">Choose a configured academic context to review all required teaching components and their faculty allocations.</p>
        </div>
        {contextsQuery.isLoading ? <p className="text-sm text-gray-500">Loading configured academic contexts…</p>
          : contextsQuery.error ? <ErrorMessage error={contextsQuery.error} title="Could not load academic contexts" />
            : contexts.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No active term-to-program-semester mappings with active sections were found. Configure the academic year, term mapping, and section before allocation.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="text-sm">
                  <span className="label">Academic term</span>
                  <select className="input" value={termId} onChange={e => selectTerm(e.target.value)}>
                    <option value="">Select term</option>
                    {terms.map(item => <option key={item.term_id} value={item.term_id}>{item.year_label} — {item.term_name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Program</span>
                  <select className="input" value={programId} disabled={!termId} onChange={e => { setProgramId(e.target.value); setSchemeId(''); setSemesterId(''); setSectionId(''); resetValidation(); }}>
                    <option value="">Select program</option>
                    {programs.map(item => <option key={item.program_id} value={item.program_id}>{item.program_name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Curriculum scheme</span>
                  <select className="input" value={schemeId} disabled={!programId} onChange={e => { setSchemeId(e.target.value); setSemesterId(''); setSectionId(''); resetValidation(); }}>
                    <option value="">Select scheme</option>
                    {schemes.map(item => <option key={item.scheme_id} value={item.scheme_id}>{item.scheme_code}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Semester</span>
                  <select className="input" value={semesterId} disabled={!schemeId} onChange={e => { setSemesterId(e.target.value); setSectionId(''); resetValidation(); }}>
                    <option value="">Select semester</option>
                    {semesters.map(item => <option key={item.semester_id} value={item.semester_id}>{item.semester_name || `Semester ${item.semester_no}`}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Section</span>
                  <select className="input" value={sectionId} disabled={!semesterId} onChange={e => { setSectionId(e.target.value); resetValidation(); }}>
                    <option value="">Select section</option>
                    {sections.map(item => <option key={item.section_id} value={item.section_id}>{item.section_name}</option>)}
                  </select>
                </label>
              </div>
            )}
      </Card>

      {selectedContext && (
        <>
          {planQuery.isLoading && <Card><p className="text-sm text-gray-500">Loading curriculum requirements and faculty workload…</p></Card>}
          {planQuery.error && <ErrorMessage error={planQuery.error} title="Could not load allocation plan" />}
          {plan && (
            <>
              <Card padding={false}>
                <div className="border-b border-gray-100 px-5 py-4">
                  <h3 className="font-semibold text-gray-900">
                    {plan.context.program_name} · {plan.context.semester_name || `Semester ${plan.context.semester_no}`} · Section {plan.context.section_name}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">{plan.context.year_label} · {plan.context.term_name} · {plan.required_hours.toFixed(2)} weekly teaching hours in this section</p>
                </div>
                <div className="grid gap-3 border-b border-gray-100 p-4 sm:grid-cols-3">
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">Required teaching</p><p className="font-semibold">{plan.required_hours.toFixed(2)} h/week</p></div>
                  <div className="rounded-lg bg-green-50 p-3"><p className="text-xs text-green-700">Requirements with faculty</p><p className="font-semibold text-green-800">{plan.allocated_hours.toFixed(2)} h/week</p></div>
                  <div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-amber-700">Remaining unallocated</p><p className="font-semibold text-amber-800">{plan.unallocated_hours.toFixed(2)} h/week</p></div>
                </div>
                {actionError && <div className="px-5 pt-4"><div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div></div>}
                {plan.requirements.length === 0 ? (
                  <p className="p-5 text-sm text-amber-700">No curriculum components are configured for this program, scheme, and semester. Add curriculum subjects before allocating faculty.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Subject / component</th>
                          <th className="px-4 py-3">Teaching requirement</th>
                          <th className="px-4 py-3">Data status</th>
                          <th className="px-4 py-3">Faculty allocations</th>
                          <th className="px-4 py-3">Add faculty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {plan.requirements.map((requirement, index) => (
                          <RequirementRow
                            key={`${requirement.component_id}-${requirement.audience_id ?? `missing-${index}`}`}
                            requirement={requirement}
                            plan={plan}
                            selectedFaculty={facultySelections[requirement.audience_id ?? -1] ?? ''}
                            selectedRole={roleSelections[requirement.audience_id ?? -1] ?? roleFor(requirement.component_type)}
                            onFacultyChange={value => setFacultySelections(current => ({ ...current, [requirement.audience_id ?? -1]: value }))}
                            onRoleChange={value => setRoleSelections(current => ({ ...current, [requirement.audience_id ?? -1]: value }))}
                            onCreate={() => {
                              setActionError('');
                              if (!requirement.audience_id || !facultySelections[requirement.audience_id]) return;
                              const selectedFacultyId = Number(facultySelections[requirement.audience_id]);
                              const preference = requirement.preferred_faculty.find(item => item.faculty_id === selectedFacultyId);
                              createMutation.mutate({
                                audience_id: requirement.audience_id,
                                faculty_id: selectedFacultyId,
                                role: roleSelections[requirement.audience_id] ?? roleFor(requirement.component_type),
                                source_preference_id: preference?.preference_id ?? null,
                              });
                            }}
                            onUpdate={(id, faculty_id, role) => updateMutation.mutate({ id, body: { faculty_id, role } })}
                            onDelete={setDeleteTarget}
                            busy={createMutation.isPending || updateMutation.isPending}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card padding={false}>
                <div className="border-b border-gray-100 px-5 py-4">
                  <h3 className="font-semibold text-gray-900">Faculty workload</h3>
                  <p className="mt-1 text-xs text-gray-500">Hours are derived from course-component weekly hours and existing workload-counting rules. Only configured VERIFIED workload limits are shown as enforceable.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                      <tr><th className="px-4 py-3">Faculty</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Draft</th><th className="px-4 py-3">Assigned total</th><th className="px-4 py-3">Unconfirmed load</th><th className="px-4 py-3">Remaining / overload</th><th className="px-4 py-3">Limit status</th><th className="px-4 py-3">Availability</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plan.faculty.map(person => (
                        <tr key={person.faculty_id}>
                          <td className="px-4 py-3">
                            <p className="font-medium">{person.faculty_name}</p>
                            <p className="text-xs text-gray-500">{person.designation_name || 'No designation'}{person.staff_code ? ` · ${person.staff_code}` : ''}</p>
                          </td>
                          <td className="px-4 py-3">{person.confirmed_hours.toFixed(2)} h</td>
                          <td className="px-4 py-3">{person.draft_hours.toFixed(2)} h</td>
                          <td className="px-4 py-3 font-medium">{person.assigned_hours.toFixed(2)} h</td>
                          <td className="px-4 py-3">{person.unconfirmed_hours.toFixed(2)} h</td>
                          <td className="px-4 py-3">
                            {person.max_hours == null ? 'Not configured' : person.overload_hours
                              ? `${person.overload_hours.toFixed(2)} h over`
                              : `${Number(person.remaining_hours ?? 0).toFixed(2)} h left`}
                          </td>
                          <td className="px-4 py-3"><Badge variant={person.limit_status === 'OK' ? 'green' : person.limit_status === 'OVER_LIMIT' ? 'red' : 'yellow'}>{person.limit_status.replace(/_/g, ' ')}</Badge></td>
                          <td className="px-4 py-3">
                            {person.availability_confirmed
                              ? <Badge variant="blue">Verified available · check against schedule</Badge>
                              : <Badge variant="yellow">UNKNOWN · no verified available window</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Validate and finalize</h3>
                    <p className="text-xs text-gray-500">Finalization requires verified curriculum, faculty and assignment-role data, confirmed available windows, and an applicable workload rule.</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
                      {validateMutation.isPending ? 'Validating…' : 'Validate allocations'}
                    </button>
                    <button className="btn-primary btn-sm" onClick={() => setConfirmFinalize(true)}
                      disabled={!validation?.can_finalize || validateMutation.isPending || finalizeMutation.isPending}>
                      {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize allocations'}
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {!validation && <p className="text-sm text-gray-500">Run validation after saving allocations to enable finalization.</p>}
                  {validation && errors.length === 0 && (
                    <p className="flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2Icon className="h-4 w-4" />No blocking errors. Review warnings before finalizing.</p>
                  )}
                  {issues.map((issue, index) => (
                    <p key={`${issue.code}-${issue.audience_id ?? 'context'}-${index}`}
                      className={`flex items-start gap-2 text-sm ${issue.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700'}`}>
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span><strong>{issue.severity} · {issue.code}:</strong> {issue.message}</span>
                    </p>
                  ))}
                  {validation && warnings.length > 0 && (
                    <p className="border-t border-amber-100 pt-2 text-xs text-amber-800">
                      Availability is time-window data, while faculty allocations do not contain a scheduled day/time. Conflicts against availability can only be confirmed after sessions are placed on a timetable; UNKNOWN remains unknown.
                    </p>
                  )}
                </div>
              </Card>
            </>
          )}
        </>
      )}
      <ConfirmModal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget != null && deleteMutation.mutate(deleteTarget)}
        title="Remove draft allocation"
        message="Remove this unapproved faculty allocation? Approved assignments cannot be removed here."
        confirmLabel="Remove"
        danger
        loading={deleteMutation.isPending}
      />
      <ConfirmModal
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={() => finalizeMutation.mutate()}
        title="Finalize section allocations"
        message={`Approve all remaining draft allocations for ${selectedContext?.program_name ?? 'this program'} / ${selectedContext?.section_name ?? 'this section'}? This does not publish a timetable.`}
        confirmLabel="Finalize allocations"
        loading={finalizeMutation.isPending}
      />
    </section>
  );
}

function RequirementRow({
  requirement, plan, selectedFaculty, selectedRole, onFacultyChange, onRoleChange, onCreate, onUpdate, onDelete, busy,
}: {
  requirement: AllocationRequirement;
  plan: AllocationPlan;
  selectedFaculty: string;
  selectedRole: string;
  onFacultyChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onCreate: () => void;
  onUpdate: (id: number, facultyId: number, role: string) => void;
  onDelete: (id: number) => void;
  busy: boolean;
}) {
  const [draftFaculty, setDraftFaculty] = useState<Record<number, string>>({});
  const [draftRole, setDraftRole] = useState<Record<number, string>>({});
  const scope = requirement.batch_name ? `Batch: ${requirement.batch_name}` : 'Whole section';
  const savedStatus = requirement.assignments.length
    ? requirement.assignments.some(assignment => assignment.is_approved) ? 'Assigned' : 'Draft'
    : 'Unassigned';
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{requirement.course_name}</p>
        <p className="text-xs text-gray-500">{requirement.course_code || 'No course code'} · {requirement.component_type}</p>
      </td>
      <td className="px-4 py-3">
        <p>{requirement.weekly_hours == null ? 'Hours missing' : `${requirement.weekly_hours.toFixed(2)} h/week`}</p>
        <p className="text-xs text-gray-500">{scope}{requirement.strength == null ? '' : ` · ${requirement.strength} students`}</p>
        {requirement.periods_per_session && <p className="text-xs text-gray-500">{requirement.periods_per_session} periods/session{requirement.is_consecutive ? ' · consecutive' : ''}{requirement.required_room_type ? ` · ${requirement.required_room_type}` : ''}</p>}
        <Badge variant={savedStatus === 'Assigned' ? 'green' : savedStatus === 'Draft' ? 'yellow' : 'red'}>{savedStatus}</Badge>
      </td>
      <td className="px-4 py-3"><Badge variant={requirement.data_status === 'VERIFIED' ? 'green' : 'yellow'}>{requirement.data_status}</Badge></td>
      <td className="min-w-64 px-4 py-3">
        {requirement.assignments.length === 0 ? <span className="text-xs text-gray-500">No faculty assigned</span> : (
          <div className="space-y-3">
            {requirement.assignments.map(assignment => (
              <div key={assignment.assignment_id} className="rounded-md border border-gray-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{assignment.faculty_name}</p>
                    <p className="text-xs text-gray-500">{assignment.role.replace(/_/g, ' ')}{assignment.designation_name ? ` · ${assignment.designation_name}` : ''}</p>
                  </div>
                  <Badge variant={assignment.is_approved ? 'green' : 'yellow'}>{assignment.is_approved ? 'Approved' : 'Draft'}</Badge>
                </div>
                {assignment.preference_rank
                  ? <p className="mt-1 text-xs text-green-700">Faculty preference #{assignment.preference_rank}</p>
                  : requirement.accepted_preference_count > 0
                    ? <p className="mt-1 text-xs text-amber-700">Not in this faculty member’s accepted preferences</p>
                    : null}
                {!assignment.availability_confirmed && <p className="mt-1 text-xs text-amber-700">Availability UNKNOWN</p>}
                {!assignment.is_approved && (
                  <div className="mt-2 grid grid-cols-[1fr_1fr_auto_auto] gap-1">
                    <select className="input min-w-0 text-xs" value={draftFaculty[assignment.assignment_id] ?? String(assignment.faculty_id)}
                      onChange={e => setDraftFaculty(current => ({ ...current, [assignment.assignment_id]: e.target.value }))}>
                      {plan.faculty.map(person => <option key={person.faculty_id} value={person.faculty_id}>{person.faculty_name}</option>)}
                    </select>
                    <select className="input min-w-0 text-xs" value={draftRole[assignment.assignment_id] ?? assignment.role}
                      onChange={e => setDraftRole(current => ({ ...current, [assignment.assignment_id]: e.target.value }))}>
                      {['UNSPECIFIED', 'LECTURER', 'LAB_LEAD', 'LAB_ASSISTANT', 'TUTOR'].map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
                    </select>
                    <button className="btn-secondary btn-sm" title="Save draft changes" disabled={busy}
                      onClick={() => onUpdate(assignment.assignment_id, Number(draftFaculty[assignment.assignment_id] ?? assignment.faculty_id), draftRole[assignment.assignment_id] ?? assignment.role)}>
                      <SaveIcon className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn-ghost btn-sm text-red-600" title="Remove draft" onClick={() => onDelete(assignment.assignment_id)}>
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="min-w-56 px-4 py-3">
        {requirement.audience_id == null || requirement.offering_status !== 'OFFERED' ? (
          <span className="text-xs text-amber-700">{requirement.audience_id == null ? 'Offer this component and configure its audience before assigning.' : 'Mark the term offering OFFERED before assigning faculty.'}</span>
        ) : (
          <div className="space-y-2">
            <select className="input w-full text-xs" value={selectedFaculty} onChange={e => onFacultyChange(e.target.value)}>
              <option value="">Select faculty</option>
              {plan.faculty.map(person => {
                const pref = requirement.preferred_faculty.find(item => item.faculty_id === person.faculty_id);
                return <option key={person.faculty_id} value={person.faculty_id}>
                  {person.faculty_name}{pref ? ` · Preference #${pref.preference_rank}` : ''} · {person.assigned_hours.toFixed(1)}h assigned
                </option>;
              })}
            </select>
            <select className="input w-full text-xs" value={selectedRole} onChange={e => onRoleChange(e.target.value)}>
              {['UNSPECIFIED', 'LECTURER', 'LAB_LEAD', 'LAB_ASSISTANT', 'TUTOR'].map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
            </select>
            <button className="btn-secondary btn-sm" disabled={!selectedFaculty || busy} onClick={onCreate}>
              <UserPlusIcon className="h-3.5 w-3.5" /> Add draft
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export { AllocationPlanner };
