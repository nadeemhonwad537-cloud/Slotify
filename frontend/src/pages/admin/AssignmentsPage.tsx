import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { AllocationPlanner } from './AllocationPlanner';
import type { Assignment, Term, FacultyProfile } from '@/types';

const ROLES = ['UNSPECIFIED', 'LECTURER', 'LAB_LEAD', 'LAB_ASSISTANT', 'TUTOR'] as const;

// The assignments/audiences endpoint returns these enriched fields
interface AudienceRow {
  audience_id: number;
  offering_id: number;
  section_id: number;
  batch_id: number | null;
  term_id: number;
  course_name: string;
  course_code: string | null;
  component_type: string;
  section_name: string;
  batch_name: string | null;
}

function CreateAssignmentModal({ open, onClose, terms }: { open: boolean; onClose: () => void; terms: Term[] }) {
  const qc = useQueryClient();
  const [termId, setTermId] = useState('');
  const [audienceId, setAudienceId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [role, setRole] = useState<string>('UNSPECIFIED');
  const [err, setErr] = useState('');

  // Load enriched audiences for selected term from the assignments router
  const { data: audiences = [], isLoading: loadingAud } = useQuery({
    queryKey: ['assignment-audiences', termId],
    queryFn: () => listRequest<AudienceRow>(`/assignments/audiences?term_id=${termId}`),
    select: r => r.data,
    enabled: !!termId,
  });

  const { data: faculty = [] } = useQuery({
    queryKey: ['faculty'],
    queryFn: () => listRequest<FacultyProfile>('/masterdata/faculty?limit=500'),
    select: r => r.data.filter(f => f.is_active),
  });

  function audienceLabel(a: AudienceRow) {
    const coursePart = a.course_name ?? `Offering ${a.offering_id}`;
    const typePart = a.component_type ?? '?';
    const sectionPart = a.section_name ?? `Section ${a.section_id}`;
    const batchPart = a.batch_name ? ` / ${a.batch_name}` : '';
    return `${coursePart} – ${typePart} | ${sectionPart}${batchPart}`;
  }

  const mut = useMutation({
    mutationFn: (b: any) => api.post('/assignments', b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      onClose();
      setErr(''); setTermId(''); setAudienceId(''); setFacultyId(''); setRole('UNSPECIFIED');
    },
    onError: (e: any) => setErr(e?.error?.message ?? 'Failed to create assignment'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!audienceId || !facultyId) { setErr('Please select both an audience and a faculty member'); return; }
    mut.mutate({ audience_id: +audienceId, faculty_id: +facultyId, role });
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Faculty Assignment" size="md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Step 1 — Select Term</label>
          <select className="input" value={termId} onChange={e => { setTermId(e.target.value); setAudienceId(''); }} required>
            <option value="">— Choose term —</option>
            {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
          </select>
        </div>

        {termId && (
          <div>
            <label className="label">Step 2 — Select Course Audience</label>
            {loadingAud
              ? <p className="text-sm text-gray-400">Loading audiences…</p>
              : audiences.length === 0
                ? <p className="text-sm text-amber-600">No audiences found for this term. Add course offerings and audiences first.</p>
                : <select className="input" value={audienceId} onChange={e => setAudienceId(e.target.value)} required>
                    <option value="">— Choose audience —</option>
                    {audiences.map(a => <option key={a.audience_id} value={a.audience_id}>{audienceLabel(a)}</option>)}
                  </select>
            }
          </div>
        )}

        {termId && (
          <div>
            <label className="label">Step 3 — Select Faculty</label>
            <select className="input" value={facultyId} onChange={e => setFacultyId(e.target.value)} required>
              <option value="">— Choose faculty —</option>
              {faculty.map(f => <option key={f.faculty_id} value={f.faculty_id}>{f.name}{f.staff_code ? ` (${f.staff_code})` : ''}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {err && <FormError message={err} />}
        <p className="text-xs text-gray-400">Workload limits are checked when the assignment is created.</p>
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || !termId}>
            {mut.isPending ? 'Creating…' : 'Create Assignment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignmentsPage() {
  const qc = useQueryClient();
  const [termId, setTermId] = useState('');
  const [approveTarget, setApproveTarget] = useState<Assignment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState('');

  const { data: terms = [] } = useQuery({
    queryKey: ['terms'],
    queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'),
    select: r => r.data,
  });

  const { data: assignments = [], isLoading, error } = useQuery({
    queryKey: ['assignments', termId],
    queryFn: () => listRequest<Assignment>(`/assignments${termId ? `?term_id=${termId}` : ''}`),
    select: r => r.data,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/assignments/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); setApproveTarget(null); setActionError(''); },
    onError: (e: any) => setActionError(e?.error?.message ?? 'Approve failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/assignments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); setDeleteTarget(null); setActionError(''); },
    onError: (e: any) => setActionError(e?.error?.message ?? 'Delete failed'),
  });

  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <PageHeader
        title="Assign Faculty"
        subtitle="Allocate faculty against term curriculum requirements and review weekly workload."
        actions={<button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}><PlusIcon className="w-4 h-4" /> New Assignment</button>}
      />

      <AllocationPlanner />

      <div className="flex items-center gap-3 mb-4">
        <select className="input w-52" value={termId} onChange={e => setTermId(e.target.value)}>
          <option value="">All terms</option>
          {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{assignments.length} assignment{assignments.length !== 1 ? 's' : ''}</span>
      </div>

      <DataTable<Assignment>
        columns={[
          { header: 'Faculty', accessor: a => (
            <div>
              <p className="font-medium text-gray-900">{a.faculty_name}</p>
              <p className="text-xs text-gray-400">ID {a.faculty_id}</p>
            </div>
          )},
          { header: 'Course', accessor: a => (
            <div>
              <p className="font-medium text-gray-900">{a.course_name}</p>
              {a.course_code && <p className="text-xs text-gray-400">{a.course_code}</p>}
            </div>
          )},
          { header: 'Type', accessor: a => <Badge variant="blue">{a.component_type}</Badge> },
          { header: 'Role', accessor: a => a.role === 'UNSPECIFIED'
            ? <span className="text-gray-400 text-xs">Unspecified</span>
            : <Badge variant="purple">{a.role}</Badge>
          },
          { header: 'Approval', accessor: a => a.is_approved
            ? <Badge variant="green">Approved</Badge>
            : <Badge variant="yellow">Pending</Badge>
          },
          { header: 'Role Status', accessor: a => <StatusBadge status={a.role_status} /> },
          { header: '', accessor: a => (
            <div className="flex gap-1">
              {!a.is_approved && (
                <button className="btn-primary btn-sm" onClick={() => { setApproveTarget(a); setActionError(''); }}>
                  Approve
                </button>
              )}
              {!a.is_approved && (
                <button className="btn-ghost btn-sm text-red-500" title="Delete" onClick={() => { setDeleteTarget(a); setActionError(''); }}>
                  <Trash2Icon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )},
        ]}
        data={assignments} keyField="assignment_id" loading={isLoading}
        emptyTitle="No assignments"
        emptyDescription="Create assignments to link faculty to course audiences." />

      <CreateAssignmentModal open={showCreate} onClose={() => setShowCreate(false)} terms={terms} />

      <ConfirmModal
        open={!!approveTarget}
        onClose={() => { setApproveTarget(null); setActionError(''); }}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.assignment_id)}
        title="Approve Assignment"
        message={`Approve ${approveTarget?.faculty_name} for ${approveTarget?.course_name} (${approveTarget?.component_type})?`}
        confirmLabel="Approve"
        loading={approveMutation.isPending}>
        {actionError && <p className="text-xs text-red-600 mt-2">{actionError}</p>}
      </ConfirmModal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setActionError(''); }}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.assignment_id)}
        title="Delete Assignment"
        message={`Delete the unapproved assignment for ${deleteTarget?.faculty_name} — ${deleteTarget?.course_name} (${deleteTarget?.component_type})?`}
        confirmLabel="Delete" danger
        loading={deleteMutation.isPending}>
        {actionError && <p className="text-xs text-red-600 mt-2">{actionError}</p>}
      </ConfirmModal>
    </div>
  );
}
