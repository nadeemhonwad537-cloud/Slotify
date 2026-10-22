import { useQuery } from '@tanstack/react-query';
import { listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { AlertTriangleIcon } from 'lucide-react';
import type { Course } from '@/types';

export function StudentSubjectsPage() {
  const { data: courses = [], isLoading } = useQuery({
    queryKey: ['courses-active'],
    queryFn: () => listRequest<Course>('/masterdata/courses?limit=500'),
    select: r => r.data.filter(c => c.is_active),
  });

  return (
    <div>
      <PageHeader title="Subjects & Courses" subtitle="View available courses in the system." />

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2 mb-4 text-xs text-amber-800">
        <AlertTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          This shows all active courses in the system. Filtering to <em>your</em> semester and section requires student profile linking, which has not been implemented yet.
        </span>
      </div>

      <DataTable<Course>
        columns={[
          { header: 'Code', accessor: c => c.course_code ?? '—' },
          { header: 'Course Name', accessor: 'course_name' },
          { header: 'Credits', accessor: c => c.credits ?? '—' },
          { header: 'Category', accessor: c => c.category ?? '—' },
          { header: 'Data', accessor: c => <StatusBadge status={c.data_status} /> },
        ]}
        data={courses}
        keyField="course_id"
        loading={isLoading}
        emptyTitle="No active courses"
        emptyDescription="No active courses are currently available."
      />
    </div>
  );
}
