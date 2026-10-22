import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { AlertTriangleIcon, InfoIcon } from 'lucide-react';

export function StudentDashboard() {
  const { user } = useAuth();

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0]}`}
        subtitle="Your student academic portal"
      />

      {/* Honest gap notice */}
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 flex items-start gap-3">
          <AlertTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Student profile not yet implemented</p>
            <p className="text-sm text-amber-700 mt-1">
              The student portal requires a <code className="bg-amber-100 px-1 rounded">student_profiles</code> table
              mapping your account to a program, semester, section and elective groups. This table does not exist in the
              current database schema.
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Until Milestone 9 implements student profiles and section mapping, this portal shows your account
              information only. Timetable data cannot be scoped to your section without this link.
            </p>
          </div>
        </div>

        <Card padding>
          <div className="flex items-start gap-3">
            <InfoIcon className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-800">Your account</p>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                <p><span className="text-gray-400">Name:</span> {user?.name}</p>
                <p><span className="text-gray-400">Username:</span> {user?.username}</p>
                <p><span className="text-gray-400">Roles:</span> {user?.roles.join(', ')}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card padding>
          <p className="text-sm font-semibold text-gray-700 mb-2">What will be available once student profiles are implemented</p>
          <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
            <li>Your published weekly timetable (day and week views)</li>
            <li>Course and faculty details for your section</li>
            <li>Classroom and laboratory information</li>
            <li>Elective session schedule</li>
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            Backend gap: requires <code>student_profiles</code> migration + section mapping API (Milestone 9).
          </p>
        </Card>
      </div>
    </div>
  );
}
