import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PencilIcon, ActivityIcon, AlertTriangleIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { Card } from '@/components/ui/Card';
import { Link } from 'react-router-dom';
import type { FacultyProfile, Designation, Department, Term, WorkloadResult, User } from '@/types';

const EMPLOYMENT_TYPES = ['REGULAR', 'GUEST', 'PART_TIME', 'TA'] as const;
const DATA_STATUSES = ['VERIFIED', 'VERIFY', 'DISCREPANCY', 'SYNTHETIC'] as const;

// ── Faculty Modal ─────────────────────────────────────────────────────────────
function FacultyModal({ open, onClose, editing, departments, designations, users }: {
  open: boolean; onClose: () => void; editing: FacultyProfile | null;
  departments: Department[]; designations: Designation[]; users: User[];
}) {
  const qc = useQueryClient();
  const blank = { name: '', staff_code: '', user_id: '' as string, dept_id: '' as string, designation_id: '' as string, employment_type: '' as string, phone: '', email: '', is_active: 1, data_status: 'VERIFY' as string };
  const [form, setForm] = useState(editing
    ? { name: editing.name, staff_code: editing.staff_code ?? '', user_id: editing.user_id != null ? String(editing.user_id) : '', dept_id: editing.dept_id != null ? String(editing.dept_id) : '', designation_id: editing.designation_id != null ? String(editing.designation_id) : '', employment_type: editing.employment_type ?? '', phone: editing.phone ?? '', email: editing.email ?? '', is_active: editing.is_active, data_status: editing.data_status }
    : blank
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/faculty/${editing.faculty_id}`, b) : api.post('/masterdata/faculty', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['faculty'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { name: form.name, is_active: form.is_active, data_status: form.data_status };
    if (form.staff_code.trim()) b.staff_code = form.staff_code.trim();
    if (form.user_id) b.user_id = +form.user_id;
    if (form.dept_id) b.dept_id = +form.dept_id;
    if (form.designation_id) b.designation_id = +form.designation_id;
    if (form.employment_type) b.employment_type = form.employment_type;
    if (form.phone.trim()) b.phone = form.phone.trim();
    if (form.email.trim()) b.email = form.email.trim();
    mut.mutate(b);
  }

  // Faculty users (users who have FACULTY role) available to link
  const facultyUsers = users.filter(u => u.roles.includes('FACULTY'));

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Faculty Profile' : 'Add Faculty Profile'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Full Name</label><input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder="e.g. Dr. Jane Smith" /></div>
          <div><label className="label">Staff Code (optional)</label><input className="input" value={form.staff_code} onChange={e => setForm(p => ({ ...p, staff_code: e.target.value }))} placeholder="e.g. FAC001" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Link to User Account (optional)</label>
            <select className="input" value={form.user_id} onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))}>
              <option value="">— Not linked —</option>
              {facultyUsers.map(u => <option key={u.userId} value={u.userId}>{u.name} ({u.username})</option>)}
            </select></div>
          <div><label className="label">Employment Type</label>
            <select className="input" value={form.employment_type} onChange={e => setForm(p => ({ ...p, employment_type: e.target.value }))}>
              <option value="">— Not set —</option>
              {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Department</label>
            <select className="input" value={form.dept_id} onChange={e => setForm(p => ({ ...p, dept_id: e.target.value }))}>
              <option value="">— Not assigned —</option>
              {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
            </select></div>
          <div><label className="label">Designation</label>
            <select className="input" value={form.designation_id} onChange={e => setForm(p => ({ ...p, designation_id: e.target.value }))}>
              <option value="">— Not set —</option>
              {designations.map(d => <option key={d.designation_id} value={d.designation_id}>{d.designation_name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-0.5">Designation is set by an administrator — never inferred from name.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="optional" /></div>
          <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="optional" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data Status</label>
            <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
              {DATA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="flex items-center gap-2 pt-6"><input type="checkbox" id="fac_active" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} /><label htmlFor="fac_active" className="text-sm">Active</label></div>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3 pt-1"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

// ── Workload Panel ─────────────────────────────────────────────────────────────
function WorkloadPanel({ faculty, terms, onClose }: { faculty: FacultyProfile; terms: Term[]; onClose: () => void }) {
  // Default to first term, but only once terms have loaded
  const [termId, setTermId] = useState<number | undefined>(undefined);
  // Derive effective term ID: use selection if set, otherwise first available term
  const effectiveTermId = termId ?? terms[0]?.term_id;

  const { data: workload, isLoading, error } = useQuery<WorkloadResult>({
    queryKey: ['workload', faculty.faculty_id, effectiveTermId],
    queryFn: () => api.get<WorkloadResult>(`/assignments/workload?faculty_id=${faculty.faculty_id}&term_id=${effectiveTermId}`),
    enabled: !!effectiveTermId,
  });

  const statusColor: Record<string, string> = {
    OK: 'text-green-700 bg-green-50 border-green-200',
    OVER_LIMIT: 'text-red-700 bg-red-50 border-red-200',
    WARNING: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    NO_RULE: 'text-orange-700 bg-orange-50 border-orange-200',
  };

  return (
    <Modal open onClose={onClose} title={`Workload — ${faculty.name}`} size="md">
      <div className="space-y-4">
        <div>
          <label className="label">Term</label>
          <select className="input" value={effectiveTermId ?? ''} onChange={e => setTermId(+e.target.value)}>
            {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
          </select>
        </div>
        {isLoading && <div className="py-6 text-center text-sm text-gray-400">Loading workload…</div>}
        {error && <ErrorMessage error={error} />}
        {workload && (
          <>
            <div className={`rounded-lg border px-4 py-3 ${statusColor[workload.limit_status] ?? 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  {workload.limit_status === 'OK' && '✓ Within limit'}
                  {workload.limit_status === 'OVER_LIMIT' && '✕ Over limit'}
                  {workload.limit_status === 'WARNING' && '⚠ Near limit'}
                  {workload.limit_status === 'NO_RULE' && '— No verified rule'}
                </p>
                <p className="text-sm font-bold">{workload.confirmed_hours}h confirmed</p>
              </div>
              {workload.max_hours != null && (
                <p className="text-xs mt-1">Limit: {workload.max_hours}h ({workload.enforcement_mode})</p>
              )}
              {workload.warning_message && <p className="text-xs mt-1">{workload.warning_message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Card padding><p className="text-xs text-gray-400">Confirmed Hours</p><p className="text-xl font-bold text-gray-900">{workload.confirmed_hours}h</p></Card>
              <Card padding><p className="text-xs text-gray-400">Unconfirmed Hours</p><p className="text-xl font-bold text-gray-400">{workload.unconfirmed_hours}h</p></Card>
            </div>
            {workload.unconfirmed_activities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Unconfirmed Activities</p>
                <div className="space-y-1">
                  {workload.unconfirmed_activities.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-1.5">
                      <span className="text-gray-700">{a.role} — {a.activity_type}</span>
                      <span className="text-gray-400">{a.weekly_hours ?? '?'}h · {a.counts_toward_limit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function FacultyPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FacultyProfile | null>(null);
  const [workloadFaculty, setWorkloadFaculty] = useState<FacultyProfile | null>(null);

  const { data: faculty = [], isLoading, error } = useQuery({ queryKey: ['faculty'], queryFn: () => listRequest<FacultyProfile>('/masterdata/faculty?limit=500'), select: r => r.data });
  const { data: designations = [] } = useQuery({ queryKey: ['designations'], queryFn: () => listRequest<Designation>('/masterdata/designations?limit=500'), select: r => r.data });
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => listRequest<Department>('/masterdata/departments?limit=500'), select: r => r.data });
  const { data: terms = [] } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: r => r.data });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });

  const desgMap = Object.fromEntries(designations.map(d => [d.designation_id, d.designation_name]));
  const deptMap = Object.fromEntries(departments.map(d => [d.dept_id, d.dept_name]));

  const filtered = faculty.filter(f =>
    !search || f.name.toLowerCase().includes(search.toLowerCase()) || (f.staff_code ?? '').includes(search)
  );

  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <PageHeader title="Faculty & Workload" subtitle="Manage faculty profiles, designations and workload."
        actions={<button className="btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}><PlusIcon className="w-4 h-4" /> Add Faculty</button>} />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        CSE workbook names remain in source review and have not been added as faculty profiles without identity confirmation.{' '}
        <Link className="font-semibold underline" to="/admin/workload-imports">Review source workloads</Link>.
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input className="input max-w-xs" placeholder="Search by name or staff code…" value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-sm text-gray-400">{filtered.length} of {faculty.length}</span>
      </div>

      {!faculty.find(f => f.designation_id != null) && faculty.length > 0 && (
        <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangleIcon className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-800">No faculty have a designation set. Workload limits cannot be enforced until designations are assigned and workload rules are set to <strong>VERIFIED</strong>.</p>
        </div>
      )}

      <DataTable<FacultyProfile>
        columns={[
          { header: 'Name', accessor: f => (
            <div>
              <p className="font-medium text-gray-900">{f.name}</p>
              <p className="text-xs text-gray-400">{f.staff_code ?? 'No staff code'}</p>
            </div>
          )},
          { header: 'Department', accessor: f => deptMap[f.dept_id ?? 0] ?? <span className="text-gray-400">—</span> },
          { header: 'Designation', accessor: f => f.designation_id ? desgMap[f.designation_id] ?? f.designation_id : <span className="text-gray-400">Not set</span> },
          { header: 'Employment', accessor: f => f.employment_type ?? '—' },
          { header: 'Status', accessor: f => <Badge variant={f.is_active ? 'green' : 'gray'}>{f.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: 'Data', accessor: f => <StatusBadge status={f.data_status} /> },
          { header: '', accessor: f => (
            <div className="flex gap-1">
              <button className="btn-ghost btn-sm" title="View workload" onClick={() => setWorkloadFaculty(f)}><ActivityIcon className="w-3.5 h-3.5" /></button>
              <button className="btn-ghost btn-sm" onClick={() => { setEditing(f); setShowForm(true); }}><PencilIcon className="w-3.5 h-3.5" /></button>
            </div>
          )},
        ]}
        data={filtered} keyField="faculty_id" loading={isLoading}
        emptyTitle="No faculty found" emptyDescription="Add faculty profiles to begin." />

      <FacultyModal key={`faculty-${editing?.faculty_id ?? 'new'}-${showForm}`} open={showForm} onClose={() => setShowForm(false)} editing={editing} departments={departments} designations={designations} users={users} />
      {workloadFaculty && <WorkloadPanel faculty={workloadFaculty} terms={terms} onClose={() => setWorkloadFaculty(null)} />}
    </div>
  );
}
