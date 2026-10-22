/**
 * Faculty Account Settings / Profile page.
 *
 * Displays the faculty member's user account details and their linked faculty
 * profile (read-only — profile fields are managed by the administrator).
 * Allows changing password through the existing reset-password API.
 *
 * Corresponds to "My Profile" and "Account Settings" in the Faculty Role diagram.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { api, listRequest, ApiRequestError } from '@/lib/api';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormError } from '@/components/ui/ErrorMessage';
import {
  UserIcon, LockIcon, ShieldIcon, CheckCircleIcon, EyeIcon, EyeOffIcon,
  InfoIcon,
} from 'lucide-react';
import type { Designation, Department } from '@/types';

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-3 grid grid-cols-3 gap-4 border-b border-gray-50 last:border-0">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 col-span-2">{value}</dd>
    </div>
  );
}

export function FacultyProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // ── Data ──────────────────────────────────────────────────────────────────
  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  const { data: designations = [] } = useQuery({
    queryKey: ['designations'],
    queryFn: () => listRequest<Designation>('/masterdata/designations?limit=200'),
    select: r => r.data,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => listRequest<Department>('/masterdata/departments?limit=200'),
    select: r => r.data,
  });

  const desgMap = Object.fromEntries(designations.map(d => [d.designation_id, d.designation_name]));
  const deptMap = Object.fromEntries(departments.map(d => [d.dept_id, d.dept_name]));

  // ── Password change ───────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  const changePwMutation = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', {
        current_password: currentPw,
        new_password: newPw,
      }),
    onSuccess: async () => {
      // Backend revoked all sessions; clear local state then redirect to login
      setPwSuccess('Password changed successfully. Signing you out…');
      await logout();
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    },
    onError: (e: unknown) => {
      if (e instanceof ApiRequestError) {
        setPwError(e.error.message);
      } else {
        setPwError('Failed to change password. Please try again.');
      }
      setPwSuccess('');
    },
  });

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (!currentPw) { setPwError('Enter your current password.'); return; }
    if (newPw.length < 12) { setPwError('New password must be at least 12 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    changePwMutation.mutate();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="My Profile & Account Settings"
        subtitle="View your profile and update your account password."
      />

      {/* Account info */}
      <Card padding>
        <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-brand-600" /> Account
        </h2>
        <dl>
          <FieldRow label="Name" value={user?.name ?? '—'} />
          <FieldRow label="Username" value={
            <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{user?.username}</span>
          } />
          <FieldRow label="Roles" value={
            <div className="flex gap-1 flex-wrap">
              {user?.roles.map(r => (
                <Badge key={r} variant="blue">{r}</Badge>
              ))}
            </div>
          } />
        </dl>
      </Card>

      {/* Faculty profile (read-only) */}
      <Card padding>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <ShieldIcon className="w-4 h-4 text-brand-600" /> Faculty Profile
          </h2>
          {profile && (
            <StatusBadge status={profile.data_status} />
          )}
        </div>

        {profileQuery.isPending ? (
          <p className="text-sm text-gray-500">Loading your faculty profile…</p>
        ) : profileQuery.isError ? (
          <FormError message={profileQuery.error instanceof Error ? profileQuery.error.message : 'Unable to load your faculty profile.'} />
        ) : !profile ? (
          <div className="flex items-start gap-3 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <InfoIcon className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-sm">No active faculty profile is linked</p>
              <p className="text-sm mt-1">Contact the administrator to link your account to, or reactivate, an existing faculty profile.</p>
            </div>
          </div>
        ) : (
          <dl>
            <FieldRow label="Full Name" value={<span className="font-medium">{profile.name}</span>} />
            <FieldRow label="Faculty ID" value={profile.faculty_id} />
            <FieldRow label="Staff Code" value={profile.staff_code ?? <span className="text-gray-400">Not set</span>} />
            <FieldRow label="Email" value={profile.email ?? <span className="text-gray-400">Not set</span>} />
            <FieldRow label="Phone" value={profile.phone ?? <span className="text-gray-400">Not set</span>} />
            <FieldRow label="Designation" value={
              profile.designation_id
                ? (desgMap[profile.designation_id] ?? `ID ${profile.designation_id}`)
                : <span className="text-amber-700">Not set — workload limits may not apply</span>
            } />
            <FieldRow label="Department" value={
              profile.dept_id
                ? (deptMap[profile.dept_id] ?? `ID ${profile.dept_id}`)
                : <span className="text-gray-400">Not assigned</span>
            } />
            <FieldRow label="Employment Type" value={profile.employment_type ?? <span className="text-gray-400">Not set</span>} />
            <FieldRow label="Status" value={<Badge variant={profile.is_active ? 'green' : 'red'}>{profile.is_active ? 'Active' : 'Inactive'}</Badge>} />
          </dl>
        )}
        <p className="mt-4 text-xs text-gray-400 flex items-center gap-1">
          <InfoIcon className="w-3 h-3" /> Profile fields are managed by the administrator. Contact them for corrections.
        </p>
      </Card>

      {/* Change password */}
      <Card padding>
        <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <LockIcon className="w-4 h-4 text-brand-600" /> Change Password
        </h2>

        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-sm">
          {/* Current password */}
          <div>
            <label className="label">Current password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                className="input pr-10"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowCurrent(v => !v)}
                tabIndex={-1}
              >
                {showCurrent ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <label className="label">New password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                className="input pr-10"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowNew(v => !v)}
                tabIndex={-1}
              >
                {showNew ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Minimum 12 characters.</p>
          </div>

          {/* Confirm */}
          <div>
            <label className="label">Confirm new password</label>
            <input
              type="password"
              className="input"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              required
            />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
            )}
          </div>

          {pwError && <FormError message={pwError} />}

          {pwSuccess && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4" /> {pwSuccess}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={changePwMutation.isPending || !currentPw || !newPw || !confirmPw}
          >
            <LockIcon className="w-4 h-4" />
            {changePwMutation.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </Card>
    </div>
  );
}
