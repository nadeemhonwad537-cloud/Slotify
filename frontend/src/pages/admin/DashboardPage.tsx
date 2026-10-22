import { useQuery } from '@tanstack/react-query';
import {
  UsersRoundIcon, BuildingIcon, BookOpenIcon, DoorOpenIcon,
  UserCheckIcon, ShieldCheckIcon, AlertTriangleIcon, CheckCircleIcon,
} from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/contexts/AuthContext';
import type { Department, FacultyProfile, Room, Term, Assignment, WorkloadResult } from '@/types';

function useCount(resource: string) {
  return useQuery({
    queryKey: ['count', resource],
    queryFn: () => listRequest<unknown>(`/masterdata/${resource}?limit=1`),
    select: r => r.meta.total,
  });
}

export function AdminDashboard() {
  const { user } = useAuth();

  const { data: deptCount = 0 } = useCount('departments');
  const { data: facultyCount = 0 } = useCount('faculty');
  const { data: roomCount = 0 } = useCount('rooms');
  const { data: courseCount = 0 } = useCount('courses');

  const { data: terms = [] } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=5'),
    select: r => r.data,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['assignments-recent'],
    queryFn: () => listRequest<Assignment>('/assignments?limit=10'),
    select: r => r.data,
  });

  const pendingApprovals = assignments.filter(a => !a.is_approved).length;
  const approvedCount = assignments.filter(a => a.is_approved).length;

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0]}`}
        subtitle="Here's an overview of the current academic scheduling status."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Departments" value={deptCount} icon={<BuildingIcon className="w-5 h-5" />} color="blue" />
        <StatCard label="Faculty" value={facultyCount} icon={<UsersRoundIcon className="w-5 h-5" />} color="green" />
        <StatCard label="Rooms" value={roomCount} icon={<DoorOpenIcon className="w-5 h-5" />} color="purple" />
        <StatCard label="Courses" value={courseCount} icon={<BookOpenIcon className="w-5 h-5" />} color="yellow" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assignment status */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <UserCheckIcon className="w-4 h-4 text-brand-600" />
            Faculty Assignment Status
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">Approved assignments</span>
              </div>
              <span className="text-lg font-bold text-green-700">{approvedCount}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">Pending approval</span>
              </div>
              <span className="text-lg font-bold text-yellow-700">{pendingApprovals}</span>
            </div>
          </div>
        </div>

        {/* Active terms */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <ShieldCheckIcon className="w-4 h-4 text-brand-600" />
            Active Academic Terms
          </h2>
          {terms.length === 0 ? (
            <p className="text-sm text-gray-400">No active terms configured.</p>
          ) : (
            <div className="space-y-2">
              {terms.map(term => (
                <div key={term.term_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{term.term_name}</p>
                    <p className="text-xs text-gray-500">{term.parity} · {term.start_date ?? 'No dates set'}</p>
                  </div>
                  <Badge variant="green">ACTIVE</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feature status banners */}
      <div className="mt-6 space-y-3">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <AlertTriangleIcon className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Timetable Generator — Not yet available</p>
            <p className="text-xs text-amber-700 mt-0.5">
              The automatic timetable generation engine (Milestone 5) has not been implemented yet.
              Validation is available for existing timetable versions.
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3">
          <ShieldCheckIcon className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Timetable Validation — Available</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Validate term configuration readiness and run timetable constraint checks from Validation &amp; Conflicts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
