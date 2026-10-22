import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, UserXIcon, UserCheckIcon, PencilIcon, KeyRoundIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import type { User } from '@/types';

const ROLES = ['ADMIN', 'FACULTY', 'STUDENT', 'COORDINATOR'] as const;

export function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [actionError, setActionError] = useState('');

  const { data: users = [], isLoading, error } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  });

  // ── Create form ──────────────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState({ username: '', email: '', name: '', password: '', roles: ['FACULTY'] as string[] });
  const [createError, setCreateError] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: typeof createForm) => api.post('/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setCreateForm({ username: '', email: '', name: '', password: '', roles: ['FACULTY'] });
      setCreateError('');
    },
    onError: (e: any) => setCreateError(e?.error?.message ?? 'Failed to create user'),
  });

  function toggleCreateRole(role: string) {
    setCreateForm(f => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role] }));
  }

  // ── Edit form ────────────────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState({ name: '', email: '', roles: [] as string[] });
  const [editError, setEditError] = useState('');

  function openEdit(u: User) {
    setEditTarget(u);
    setEditForm({ name: u.name, email: u.email, roles: [...u.roles] });
    setEditError('');
  }

  function toggleEditRole(role: string) {
    setEditForm(f => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role] }));
  }

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => api.patch(`/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditTarget(null); setEditError(''); },
    onError: (e: any) => setEditError(e?.error?.message ?? 'Update failed'),
  });

  // ── Password reset ─────────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');

  function openReset(u: User) {
    setResetTarget(u);
    setNewPassword('');
    setResetError('');
  }

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => api.post(`/users/${id}/reset-password`, { password }),
    onSuccess: () => { setResetTarget(null); setResetError(''); setNewPassword(''); },
    onError: (e: any) => setResetError(e?.error?.message ?? 'Reset failed'),
  });

  // ── Status toggle ─────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch(`/users/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setToggleTarget(null); setActionError(''); },
    onError: (e: any) => setActionError(e?.error?.message ?? 'Status change failed'),
  });

  const filtered = users.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));

  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <PageHeader
        title="Manage Users"
        subtitle="Create accounts and control access."
        actions={<button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}><PlusIcon className="w-4 h-4" /> New User</button>}
      />

      <div className="mb-4">
        <input className="input max-w-xs" placeholder="Search by name, username or email…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <DataTable<User>
        columns={[
          { header: 'Name', accessor: u => <div><p className="font-medium text-gray-900">{u.name}</p><p className="text-xs text-gray-400">{u.username}</p></div> },
          { header: 'Email', accessor: 'email' },
          { header: 'Roles', accessor: u => (
            <div className="flex flex-wrap gap-1">
              {u.roles.map(r => <Badge key={r} variant={r === 'ADMIN' ? 'purple' : r === 'FACULTY' ? 'blue' : r === 'STUDENT' ? 'green' : 'gray'}>{r}</Badge>)}
            </div>
          )},
          { header: 'Status', accessor: u => <StatusBadge status={u.status} /> },
          { header: 'Joined', accessor: u => new Date(u.createdAt).toLocaleDateString() },
          { header: '', accessor: u => (
            <div className="flex gap-1">
              <button className="btn-ghost btn-sm" title="Edit" onClick={() => openEdit(u)}><PencilIcon className="w-3.5 h-3.5" /></button>
              <button className="btn-ghost btn-sm" title="Reset password" onClick={() => openReset(u)}><KeyRoundIcon className="w-3.5 h-3.5" /></button>
              <button className={`btn-ghost btn-sm ${u.status === 'ACTIVE' ? 'text-red-600' : 'text-green-600'}`}
                onClick={() => { setToggleTarget(u); setActionError(''); }}>
                {u.status === 'ACTIVE' ? <UserXIcon className="w-3.5 h-3.5" /> : <UserCheckIcon className="w-3.5 h-3.5" />}
              </button>
            </div>
          )},
        ]}
        data={filtered}
        keyField="userId"
        loading={isLoading}
        emptyTitle="No users found"
        emptyDescription="Create the first user account."
      />

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateError(''); }} title="Create User Account" size="md">
        <form onSubmit={e => { e.preventDefault(); setCreateError(''); createMutation.mutate(createForm); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full Name</label><input className="input" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><label className="label">Username</label><input className="input" value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} required pattern="[a-zA-Z0-9._-]{3,50}" title="3–50 chars: letters, digits, . _ -" /></div>
          </div>
          <div><label className="label">Email</label><input className="input" type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required /></div>
          <div><label className="label">Password (min 12 chars)</label><input className="input" type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} required minLength={12} /></div>
          <div>
            <label className="label">Roles</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ROLES.map(r => (
                <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={createForm.roles.includes(r)} onChange={() => toggleCreateRole(r)} className="rounded" />
                  <span className="text-sm text-gray-700">{r}</span>
                </label>
              ))}
            </div>
          </div>
          {createError && <FormError message={createError} />}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create User'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Edit — ${editTarget?.name}`} size="md">
        <form onSubmit={e => {
          e.preventDefault(); setEditError('');
          const body: any = {};
          if (editForm.name !== editTarget?.name) body.name = editForm.name;
          if (editForm.email !== editTarget?.email) body.email = editForm.email;
          const rolesChanged = JSON.stringify([...editForm.roles].sort()) !== JSON.stringify([...(editTarget?.roles ?? [])].sort());
          if (rolesChanged) body.roles = editForm.roles;
          if (Object.keys(body).length === 0) { setEditTarget(null); return; }
          editMutation.mutate({ id: editTarget!.userId, body });
        }} className="space-y-4">
          <div><label className="label">Full Name</label><input className="input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} required /></div>
          <div>
            <label className="label">Roles</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ROLES.map(r => (
                <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={editForm.roles.includes(r)} onChange={() => toggleEditRole(r)} className="rounded" />
                  <span className="text-sm text-gray-700">{r}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Role changes take effect on next login. At least one ADMIN must remain.</p>
          </div>
          {editError && <FormError message={editError} />}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={editMutation.isPending}>{editMutation.isPending ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </Modal>

      {/* Password reset modal */}
      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Reset Password — ${resetTarget?.name}`} size="sm">
        <form onSubmit={e => { e.preventDefault(); setResetError(''); resetMutation.mutate({ id: resetTarget!.userId, password: newPassword }); }} className="space-y-4">
          <div>
            <label className="label">New Password (min 12 chars)</label>
            <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={12} autoComplete="new-password" />
            <p className="text-xs text-gray-400 mt-1">All existing sessions will be revoked and the account lockout cleared.</p>
          </div>
          {resetError && <FormError message={resetError} />}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={resetMutation.isPending}>{resetMutation.isPending ? 'Resetting…' : 'Reset Password'}</button>
          </div>
        </form>
      </Modal>

      {/* Toggle status confirm */}
      <ConfirmModal
        open={!!toggleTarget}
        onClose={() => { setToggleTarget(null); setActionError(''); }}
        onConfirm={() => toggleTarget && statusMutation.mutate({ id: toggleTarget.userId, status: toggleTarget.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}
        title={toggleTarget?.status === 'ACTIVE' ? 'Disable Account' : 'Enable Account'}
        message={`${toggleTarget?.status === 'ACTIVE' ? 'Disable' : 'Enable'} account for ${toggleTarget?.name} (${toggleTarget?.username})?`}
        confirmLabel={toggleTarget?.status === 'ACTIVE' ? 'Disable' : 'Enable'}
        danger={toggleTarget?.status === 'ACTIVE'}
        loading={statusMutation.isPending}>
        {actionError && <p className="text-xs text-red-600 mt-2">{actionError}</p>}
      </ConfirmModal>
    </div>
  );
}
