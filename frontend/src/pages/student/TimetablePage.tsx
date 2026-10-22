import { AlertTriangleIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';

export function StudentTimetablePage() {
  return (
    <div>
      <PageHeader title="My Timetable" subtitle="View your published class schedule." />
      <Card padding>
        <div className="flex items-start gap-3 py-4">
          <AlertTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Timetable unavailable — backend gap</p>
            <p className="text-sm text-gray-600 mt-1">
              Displaying your timetable requires knowing which section and elective group you belong to.
              The <code className="bg-gray-100 px-1 rounded mx-0.5">student_profiles</code> table that would link
              your account to a section has not been implemented yet.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Administrators can now review and publish timetable versions, but automatic timetable generation
              is not implemented. Student timetable access remains disabled until a verified student-to-division
              mapping and a student-scoped published-session API are available.
            </p>
            <p className="text-xs text-gray-400 mt-3">
              Required: verified student identity and section/elective mapping, scoped read authorization, and a published timetable.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
