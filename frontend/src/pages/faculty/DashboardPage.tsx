import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { Card, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import { ActivityIcon, BookOpenIcon, ClockIcon, AlertTriangleIcon, ArrowRightIcon, CheckCircleIcon, RouteIcon } from 'lucide-react';
import type { WorkloadResult, Term, Assignment, SubmissionDetail } from '@/types';

export function FacultyDashboard() {
  const { user } = useAuth();

  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  // Active terms
  const { data: activeTerms = [] } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=5'),
    select: r => r.data,
  });
  const primaryTerm = activeTerms[0];

  // Workload for primary term
  const { data: workload } = useQuery<WorkloadResult>({
    queryKey: ['my-workload', profile?.faculty_id, primaryTerm?.term_id],
    queryFn: () => api.get<WorkloadResult>(`/assignments/workload?faculty_id=${profile!.faculty_id}&term_id=${primaryTerm!.term_id}`),
    enabled: !!profile && !!primaryTerm,
  });

  // Assigned subjects
  const { data: assignments = [] } = useQuery({
    queryKey: ['my-assignments', profile?.faculty_id],
    queryFn: () => listRequest<Assignment>(`/assignments?faculty_id=${profile!.faculty_id}&is_approved=1`),
    select: r => r.data,
    enabled: !!profile,
  });

  // Submission status for primary term — query key matches FacultyShell gate + other pages
  const { data: submissionDetail } = useQuery<SubmissionDetail>({
    queryKey: ['my-submission', primaryTerm?.term_id],
    queryFn: () => api.get<SubmissionDetail>(`/faculty-submissions/mine?term_id=${primaryTerm!.term_id}`),
    enabled: !!profile && !!primaryTerm,
    staleTime: 10_000,
  });

  if (profileQuery.isPending || profileQuery.isError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0]}`}
        subtitle={primaryTerm ? `Current term: ${primaryTerm.term_name}` : 'No active term configured'}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Assigned Subjects"
          value={assignments.length}
          icon={<BookOpenIcon className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Confirmed Hours/Week"
          value={workload ? `${workload.confirmed_hours}h` : '—'}
          icon={<ActivityIcon className="w-5 h-5" />}
          color={workload?.limit_status === 'OVER_LIMIT' ? 'red' : workload?.limit_status === 'OK' ? 'green' : 'yellow'}
          sub={workload?.max_hours ? `Limit: ${workload.max_hours}h` : undefined}
        />
        <StatCard
          label="Preference Submission"
          value={submissionDetail?.submission?.submission_status ?? 'NOT STARTED'}
          icon={<ClockIcon className="w-5 h-5" />}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workload status */}
        {workload && (
          <Card padding>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-brand-600" />
              Workload Summary
            </h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Confirmed hours</span>
                <span className="font-medium">{workload.confirmed_hours}h</span>
              </div>
              {workload.unconfirmed_hours > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Unconfirmed hours</span>
                  <span className="font-medium text-yellow-700">{workload.unconfirmed_hours}h</span>
                </div>
              )}
              {workload.max_hours && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Limit</span>
                  <span className="font-medium">{workload.max_hours}h</span>
                </div>
              )}
              <div className="pt-1 border-t">
                <StatusBadge status={workload.limit_status} />
              </div>
              {workload.warning_message && (
                <p className="text-xs text-yellow-700 bg-yellow-50 rounded p-2">{workload.warning_message}</p>
              )}
            </div>
          </Card>
        )}

        {/* Assigned subjects */}
        <Card padding>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BookOpenIcon className="w-4 h-4 text-brand-600" />
              My Assigned Subjects
            </h2>
            <Link to="/faculty/subjects" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
              All <ArrowRightIcon className="w-3 h-3" />
            </Link>
          </div>
          {assignments.length === 0 ? (
            <EmptyState title="No approved assignments" description="You have no approved teaching assignments for this term." />
          ) : (
            <div className="space-y-2">
              {assignments.slice(0, 5).map(a => (
                <div key={a.assignment_id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{a.course_name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="blue">{a.component_type}</Badge>
                      {a.is_approved ? <CheckCircleIcon className="w-3 h-3 text-green-500" /> : null}
                    </div>
                  </div>
                  <Badge variant="purple">{a.role === 'UNSPECIFIED' ? 'Assigned' : a.role}</Badge>
                </div>
              ))}
              {assignments.length > 5 && (
                <p className="text-xs text-gray-400 text-center pt-1">+{assignments.length - 5} more</p>
              )}
            </div>
          )}
        </Card>

        {/* Submission status */}
        {submissionDetail && (
          <Card padding>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Preference Submission</h2>
              <Link to="/faculty/track" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
                <RouteIcon className="w-3 h-3" /> Track
              </Link>
            </div>
            {!submissionDetail.submission ? (
              <EmptyState title="No submission yet" description="Submit your subject preferences via Submit Subject Preferences." />
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Submission</span>
                  <StatusBadge status={submissionDetail.submission.submission_status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Review</span>
                  <StatusBadge status={submissionDetail.submission.review_status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Preferences</span>
                  <span className="font-medium">{submissionDetail.preferences.length} / 3</span>
                </div>
                {submissionDetail.submission.review_comment && (
                  <div className="rounded bg-yellow-50 border border-yellow-200 p-2 text-xs text-yellow-800">
                    <AlertTriangleIcon className="w-3.5 h-3.5 inline mr-1" />
                    {submissionDetail.submission.review_comment}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
