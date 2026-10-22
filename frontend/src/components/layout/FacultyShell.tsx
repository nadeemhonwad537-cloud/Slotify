/**
 * FacultyShell — layout + first-login gate.
 *
 * Gate logic (checks DB submission_status on every navigation):
 *   - NOT_STARTED / DRAFT / RETURNED  → redirect to /faculty/preferences
 *   - SUBMITTED (any review_status)   → allow full navigation
 *   - No active term configured       → allow navigation (admin hasn't set up term)
 *   - Still resolving                 → show loading spinner (never flash wrong page)
 */

import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import {
  LayoutDashboardIcon, BookOpenIcon, ClockIcon, CalendarDaysIcon,
  ListIcon, ActivityIcon, LogOutIcon, MenuIcon, AlertTriangleIcon,
  SettingsIcon, RouteIcon, Loader2Icon,
} from 'lucide-react';
import type { SubmissionDetail, Term } from '@/types';

const nav = [
  { to: '/faculty',              label: 'Dashboard',           icon: LayoutDashboardIcon, end: true },
  { to: '/faculty/preferences',  label: 'Subject Preferences', icon: BookOpenIcon },
  { to: '/faculty/availability', label: 'My Availability',     icon: ClockIcon },
  { to: '/faculty/track',        label: 'My Teaching Track',   icon: RouteIcon },
  { to: '/faculty/timetable',    label: 'My Timetable',        icon: CalendarDaysIcon },
  { to: '/faculty/subjects',     label: 'Assigned Subjects',   icon: ListIcon },
  { to: '/faculty/workload',     label: 'My Workload',         icon: ActivityIcon },
  { to: '/faculty/profile',      label: 'Account Settings',    icon: SettingsIcon },
];

/** Submission statuses that allow unrestricted navigation. */
const GATE_PASS = new Set<string>(['SUBMITTED']);

function SubmissionGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onPreferencesPage = location.pathname === '/faculty/preferences';

  // --- 1. Resolve faculty profile -------------------------------------------
  const profileQuery = useFacultyProfile(!onPreferencesPage);
  const profile = profileQuery.data;
  const profileLoading = profileQuery.fetchStatus === 'fetching';

  // --- 2. Resolve active term ------------------------------------------------
  const { data: activeTerms = [], fetchStatus: termsFetch } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=500'),
    select: r => r.data,
    enabled: !onPreferencesPage,
    staleTime: 30_000,
  });
  const termStorageKey = `slotify:faculty-term:${user?.userId ?? 'unknown'}`;
  const [selectedTermId, setSelectedTermId] = useState('');
  useEffect(() => {
    if (!activeTerms.length) return;
    if (!activeTerms.some(candidate => String(candidate.term_id) === selectedTermId)) {
      const rememberedTerm = sessionStorage.getItem(termStorageKey);
      const nextTerm = activeTerms.find(candidate => String(candidate.term_id) === rememberedTerm) ?? activeTerms[0];
      setSelectedTermId(String(nextTerm.term_id));
    }
  }, [activeTerms, selectedTermId, termStorageKey]);
  useEffect(() => {
    if (activeTerms.some(candidate => String(candidate.term_id) === selectedTermId)) {
      sessionStorage.setItem(termStorageKey, selectedTermId);
    }
  }, [activeTerms, selectedTermId, termStorageKey]);
  const termsLoading = termsFetch === 'fetching';
  const term = activeTerms.find(candidate => String(candidate.term_id) === selectedTermId);

  // --- 3. Check submission status for this term ----------------------------
  // Only fires when both term and profile are resolved and non-null.
  const submissionEnabled = !onPreferencesPage && !!term && !!profile;
  const { data: detail, fetchStatus: submissionFetch } = useQuery<SubmissionDetail>({
    queryKey: ['my-submission', term?.term_id],
    queryFn: () => api.get<SubmissionDetail>(`/faculty-submissions/mine?term_id=${term!.term_id}`),
    enabled: submissionEnabled,
    staleTime: 10_000,
  });

  // In TanStack Query v5, disabled queries have isLoading=true until first fetch.
  // Use fetchStatus instead: 'fetching' means actively in-flight, 'idle' means not started/disabled.
  const stillLoading = !onPreferencesPage && (
    profileLoading ||
    termsLoading ||
    (submissionEnabled && submissionFetch === 'fetching')
  );

  const submissionStatus = detail?.submission?.submission_status ?? 'NOT_STARTED';

  // Gate: block navigation if:
  //  - there IS an active term, AND
  //  - (no profile found after loading finished) OR (submission not yet submitted)
  // Allow through when: no active term, OR submission is SUBMITTED.
  const needsForm = !!term && profileQuery.isSuccess && !GATE_PASS.has(submissionStatus);

  useEffect(() => {
    if (stillLoading) return;
    if (needsForm && !onPreferencesPage) {
      navigate('/faculty/preferences', { replace: true });
    }
  }, [stillLoading, needsForm, onPreferencesPage, navigate]);

  // Show spinner while we are still deciding
  if (stillLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2Icon className="w-6 h-6 text-brand-600 animate-spin" />
      </div>
    );
  }

  if (profileQuery.isError && !onPreferencesPage) {
    return <div className="p-6"><ErrorMessage error={profileQuery.error} title="Unable to resolve your faculty profile" /></div>;
  }

  // Gate fired — show brief message while navigate() takes effect
  if (needsForm && !onPreferencesPage) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangleIcon className="w-6 h-6 text-amber-600" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-2">
            {submissionStatus === 'RETURNED'
              ? 'Your form has been returned for corrections'
              : 'Please complete your preference form'}
          </h2>
          <p className="text-sm text-gray-600">
            {submissionStatus === 'RETURNED'
              ? 'The department returned your form with feedback. Please review and resubmit.'
              : term
                ? `Submit your subject preferences and availability for ${term.term_name} to access other features.`
                : 'Complete your subject preferences to access other features.'}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function FacultyShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(false);

  async function handleLogout() { await logout(); navigate('/login'); }

  const sidebar = (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
            <CalendarDaysIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Slotify</p>
            <p className="text-xs text-green-600 font-medium">Faculty Portal</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item-inactive'}>
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-sm">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 text-xs font-semibold">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400">Faculty</p>
          </div>
          <button onClick={handleLogout} className="btn-ghost p-1.5" title="Logout">
            <LogOutIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="hidden lg:flex">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative flex">{sidebar}</div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setOpen(true)} className="btn-ghost p-1.5"><MenuIcon className="w-5 h-5" /></button>
          <span className="text-sm font-semibold text-gray-900">Slotify Faculty</span>
        </div>
        <main className="flex-1 overflow-y-auto p-6">
          <SubmissionGate>
            <Outlet />
          </SubmissionGate>
        </main>
      </div>
    </div>
  );
}
