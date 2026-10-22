import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PencilIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/ErrorMessage';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import type { Department } from '@/types';

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ dept_code: '', dept_name: '', is_active: 1 });
  const [formError, setFormError] = useState('');

  const { data: departments = [], isLoading, error } = useQuery({
    queryKey: ['departments'],
    queryFn: () => listRequest<Department>('/masterdata/departments?limit=500'),
    select: r => r.data,
  });

  const saveMutation = useMutation({
    mutationFn: (body: typeof form) =>
      editing
        ? api.patch(`/masterdata/departments/${editing.dept_id}`, body)
        : api.post('/masterdata/departments', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); closeForm(); },
    onError: (e: any) => setFormError(e?.error?.message ?? 'Save failed'),
  });

  function openCreate() { setEditing(null); setForm({ dept_code: '', dept_name: '', is_active: 1 }); setFormError(''); setShowForm(true); }
  function openEdit(d: Department) { setEditing(d); setForm({ dept_code: d.dept_code, dept_name: d.dept_name, is_active: d.is_active }); setFormError(''); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(null); setFormError(''); }

  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <PageHeader title="Departments" subtitle="Manage university departments."
        actions={<button className="btn-primary btn-sm" onClick={openCreate}><PlusIcon className="w-4 h-4" /> Add Department</button>} />

      <DataTable<Department>
        columns={[
          { header: 'Code', accessor: 'dept_code' },
          { header: 'Name', accessor: 'dept_name' },
          { header: 'Status', accessor: d => <Badge variant={d.is_active ? 'green' : 'gray'}>{d.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: '', accessor: d => <button className="btn-ghost btn-sm" onClick={() => openEdit(d)}><PencilIcon className="w-3.5 h-3.5" /> Edit</button> },
        ]}
        data={departments} keyField="dept_id" loading={isLoading}
        emptyTitle="No departments" emptyDescription="Add the first department to begin." />

      <Modal open={showForm} onClose={closeForm} title={editing ? 'Edit Department' : 'Add Department'} size="sm">
        <form onSubmit={e => { e.preventDefault(); setFormError(''); saveMutation.mutate(form); }} className="space-y-4">
          <div>
            <label className="label">Department Code</label>
            <input className="input" value={form.dept_code} onChange={e => setForm(f => ({ ...f, dept_code: e.target.value.toUpperCase() }))} required placeholder="e.g. CSE" disabled={!!editing} />
          </div>
          <div>
            <label className="label">Department Name</label>
            <input className="input" value={form.dept_name} onChange={e => setForm(f => ({ ...f, dept_name: e.target.value }))} required placeholder="e.g. Computer Science and Engineering" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_active" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
          </div>
          {formError && <FormError message={formError} />}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
