import { useQuery } from '@tanstack/react-query';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import type { Assignment } from '@/types';

export function AssignedSubjectsPage() {
  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  const { data: assignments = [], isLoading, error } = useQuery({
    queryKey: ['my-assignments', profile?.faculty_id],
    queryFn: () => listRequest<Assignment>(`/assignments?faculty_id=${profile!.faculty_id}&is_approved=1&limit=500`),
    select: r => r.data,
    enabled: !!profile,
  });

  if (error) return <ErrorMessage error={error} />;
  if (profileQuery.isPending || profileQuery.isError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }

  return (
    <div>
      <PageHeader
        title="My Assigned Subjects"
        subtitle="Subjects assigned to you by the department. Only approved assignments are shown."
      />
      <DataTable<Assignment>
        columns={[
          { header: 'Course', accessor: a => (
            <div>
              <p className="font-medium text-gray-900">{a.course_name}</p>
              {a.course_code && <p className="text-xs text-gray-400">{a.course_code}</p>}
            </div>
          )},
          { header: 'Component', accessor: a => <Badge variant="blue">{a.component_type}</Badge> },
          { header: 'Academic context', accessor: a => (
            <div>
              <p className="font-medium text-gray-900">{a.year_label} · {a.term_name} ({a.parity})</p>
              <p className="text-xs text-gray-500">
                {a.program_code} · Semester {a.semester_no}{a.semester_name ? ` (${a.semester_name})` : ''}
              </p>
            </div>
          )},
          { header: 'Division', accessor: a => (
            <div>
              <p className="font-medium text-gray-900">{a.section_name ?? 'Division not recorded'}</p>
              {a.batch_name && <p className="text-xs text-gray-500">{a.batch_name}</p>}
            </div>
          )},
          { header: 'Role', accessor: a => a.role === 'UNSPECIFIED'
            ? <span className="text-gray-400 text-xs">Not specified</span>
            : <Badge variant="purple">{a.role}</Badge>
          },
          { header: 'Approval', accessor: a => a.is_approved
            ? <Badge variant="green">Approved</Badge>
            : <Badge variant="yellow">Pending</Badge>
          },
        ]}
        data={assignments}
        keyField="assignment_id"
        loading={isLoading}
        emptyTitle="No approved assignments"
        emptyDescription="You have no approved teaching assignments. Contact your department head."
      />
    </div>
  );
}
