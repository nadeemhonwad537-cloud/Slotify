import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from 'lucide-react';
import type { WorkloadResult, Term } from '@/types';

interface PendingSourceWorkload {
  workload_import_row_id: number;
  source_row_number: number;
  source_page: number;
  source_name: string | null;
  faculty_category: string;
  subjects: Array<{ rawLabel: string | null; weeklyHours: number | null }>;
  lab_duty: { rawLabel: string | null; weeklyHours: number | null };
  sdp_hours: number | null;
  minor_project_hours: number | null;
  printed_theory_hours: number | null;
  printed_lab_hours: number | null;
  printed_total_hours: number | null;
  printed_load_source_text: string;
  issues: Array<{ code: string; message: string }>;
}

export function WorkloadPage() {
  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  const { data: activeTerms = [] } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=10'),
    select: r => r.data,
  });
  const [termId, setTermId] = useState('');
  useEffect(() => { if (activeTerms[0] && !termId) setTermId(String(activeTerms[0].term_id)); }, [activeTerms, termId]);

  const { data: workload, isLoading, error } = useQuery<WorkloadResult>({
    queryKey: ['my-workload', profile?.faculty_id, termId],
    queryFn: () => api.get<WorkloadResult>(`/assignments/workload?faculty_id=${profile!.faculty_id}&term_id=${termId}`),
    enabled: !!profile && !!termId,
  });
  const { data: pendingSourceRows = [], error: pendingError } = useQuery({
    queryKey: ['my-import-workload', profile?.faculty_id],
    queryFn: () => api.get<PendingSourceWorkload[]>('/workload-imports/mine'),
    enabled: !!profile,
  });

  if (error || pendingError) return <ErrorMessage error={error ?? pendingError!} />;
  if (profileQuery.isPending || profileQuery.isError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }

  return (
    <div>
      <PageHeader title="My Workload" subtitle="Confirmed hours use approved assignments. Source-sheet rows stay pending until mappings are reviewed." />

      <div className="flex items-center gap-3 mb-5">
        <select className="input w-52" value={termId} onChange={e => setTermId(e.target.value)}>
          {activeTerms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading workload…</p>}

      <Card padding>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Pending source-sheet workload</h2>
          <Badge variant="yellow">Not an assignment</Badge>
        </div>
        {pendingSourceRows.length === 0 ? (
          <p className="text-xs text-gray-500">No CSE workbook rows are linked to your profile. Unmatched source identities remain visible to administrators only.</p>
        ) : (
          <div className="space-y-3">
            {pendingSourceRows.map(row => (
              <div key={row.workload_import_row_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">
                    Source row {row.source_row_number} · {row.source_name ?? 'Name missing'} · {row.faculty_category}
                  </p>
                  <Badge variant="yellow">Pending verification</Badge>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                  <div>
                    <p className="font-medium">Subject labels / source hours</p>
                    {row.subjects.filter(subject => subject.rawLabel || subject.weeklyHours !== null).map((subject, index) => (
                      <p key={`${subject.rawLabel}-${index}`}>{subject.rawLabel ?? 'Unlabeled'} · {subject.weeklyHours ?? 'unreadable'}h</p>
                    ))}
                    {row.lab_duty.rawLabel && <p>Lab duty: {row.lab_duty.rawLabel} · {row.lab_duty.weeklyHours ?? 'unreadable'}h</p>}
                  </div>
                  <div>
                    <p className="font-medium">Printed source load (theory / lab / total)</p>
                    <p>{row.printed_theory_hours ?? 'unreadable'} / {row.printed_lab_hours ?? 'unreadable'} / {row.printed_total_hours ?? 'unreadable'}h</p>
                    <p>SDP: {row.sdp_hours ?? '—'} · Minor project: {row.minor_project_hours ?? '—'}</p>
                  </div>
                </div>
                {row.issues.length > 0 && <p className="mt-2 text-xs text-amber-900">Awaiting review: {row.issues.map(issue => issue.code).join(', ')}</p>}
                <p className="mt-1 text-[11px] text-gray-500">Source totals are shown as printed and are not added to confirmed assignment workload.</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {workload && (
        <div className="space-y-4 max-w-lg">
          {/* Status card */}
          <Card padding>
            <div className="flex items-center gap-3 mb-4">
              {workload.limit_status === 'OK' && <CheckCircleIcon className="w-6 h-6 text-green-500" />}
              {workload.limit_status === 'OVER_LIMIT' && <AlertTriangleIcon className="w-6 h-6 text-red-500" />}
              {(workload.limit_status === 'WARNING' || workload.limit_status === 'NO_RULE') && <InfoIcon className="w-6 h-6 text-yellow-500" />}
              <div>
                <p className="text-base font-semibold text-gray-900">Workload Status</p>
                <StatusBadge status={workload.limit_status} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Confirmed teaching hours</span>
                <span className="text-lg font-bold text-gray-900">{workload.confirmed_hours}h / week</span>
              </div>
              {workload.max_hours && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Workload limit</span>
                  <span className="text-sm font-medium text-gray-900">{workload.max_hours}h / week</span>
                </div>
              )}
              {workload.enforcement_mode && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Enforcement</span>
                  <Badge variant={workload.enforcement_mode === 'HARD' ? 'red' : 'yellow'}>{workload.enforcement_mode}</Badge>
                </div>
              )}

              {/* Progress bar */}
              {workload.max_hours && (
                <div className="pt-1">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>0h</span>
                    <span>{workload.max_hours}h</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${workload.confirmed_hours > workload.max_hours ? 'bg-red-500' : workload.confirmed_hours / workload.max_hours > 0.85 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(100, (workload.confirmed_hours / workload.max_hours) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {workload.warning_message && (
              <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-800">
                {workload.warning_message}
              </div>
            )}
          </Card>

          {/* Unconfirmed activities */}
          {workload.unconfirmed_hours > 0 && (
            <Card padding>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Unconfirmed Activities</h3>
              <p className="text-xs text-gray-500 mb-3">
                These {workload.unconfirmed_hours}h are not counted toward your confirmed limit because the university has not confirmed how they should be counted.
              </p>
              <div className="space-y-1">
                {workload.unconfirmed_activities.map((a, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600 py-1 border-b border-gray-50 last:border-0">
                    <span>{a.role} ({a.activity_type})</span>
                    <span className="text-gray-400">{a.weekly_hours ?? '?'}h · {a.counts_toward_limit}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
