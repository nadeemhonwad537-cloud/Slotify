import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import type { FacultySubmission, SubmissionDetail, Term } from '@/types';

export function SubmissionsPage() {
  const qc = useQueryClient();
  const [termId, setTermId] = useState('');
  const [selected, setSelected] = useState<FacultySubmission | null>(null);
  const [reviewAction, setReviewAction] = useState<'START_REVIEW' | 'ACCEPT' | 'RETURN' | null>(null);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState('');

  const { data: terms = [] } = useQuery({
    queryKey: ['terms'],
    queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'),
    select: r => r.data,
  });

  const { data: submissions = [], isLoading, error } = useQuery({
    queryKey: ['submissions', termId],
    queryFn: () => listRequest<FacultySubmission>(`/faculty-submissions${termId ? `?term_id=${termId}` : ''}` ),
    select: r => r.data,
    enabled: true,
  });

  const { data: detail } = useQuery<SubmissionDetail>({
    queryKey: ['submission-detail', selected?.submission_id],
    queryFn: () => api.get<SubmissionDetail>(`/faculty-submissions/${selected!.submission_id}`),
    enabled: !!selected,
  });
  const academicContext = detail?.preferences.find(preference => preference.program_name || preference.semester_no != null);
  const currentSubmission = detail?.submission;

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, comment }: { id: number; action: string; comment?: string }) =>
      api.post(`/faculty-submissions/${id}/review`, { action, comment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['submission-detail', selected?.submission_id] });
      setReviewAction(null);
      setComment('');
      setReviewError('');
    },
    onError: (e: any) => setReviewError(e?.error?.message ?? 'Review action failed'),
  });

  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <PageHeader title="Faculty Preferences & Availability" subtitle="Review and manage faculty subject preference submissions." />

      <div className="flex items-center gap-3 mb-4">
        <select className="input w-48" value={termId} onChange={e => setTermId(e.target.value)}>
          <option value="">All terms</option>
          {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DataTable<FacultySubmission>
            columns={[
              { header: 'Faculty', accessor: s => s.faculty_name ?? `ID ${s.faculty_id}` },
              { header: 'Submission', accessor: s => <StatusBadge status={s.submission_status} /> },
              { header: 'Review', accessor: s => <StatusBadge status={s.review_status} /> },
              { header: 'Submitted', accessor: s => s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—' },
              { header: '', accessor: s => (
                <button className="btn-ghost btn-sm text-brand-600" onClick={() => setSelected(s)}>View</button>
              )},
            ]}
            data={submissions} keyField="submission_id" loading={isLoading}
            emptyTitle="No submissions" emptyDescription="Faculty submissions will appear here once submitted." />
        </div>

        {/* Detail panel */}
        <div>
          {!selected ? (
            <div className="card p-6">
              <EmptyState title="Select a submission" description="Click View on any row to see details and take action." />
            </div>
          ) : (
            <div className="card p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-400">Faculty</p>
                <p className="font-medium text-gray-900">{selected.faculty_name ?? `ID ${selected.faculty_id}`}</p>
                <p className="text-xs text-gray-500">Faculty ID {selected.faculty_id}</p>
              </div>
              <div className="flex gap-3">
                <div>
                  <p className="text-xs text-gray-400">Submission</p>
                  <StatusBadge status={detail?.submission.submission_status ?? selected.submission_status} />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Review</p>
                  <StatusBadge status={detail?.submission.review_status ?? selected.review_status} />
                </div>
              </div>
              <div className="text-xs text-gray-600">
                <p>Term: {terms.find(term => term.term_id === selected.term_id)?.term_name ?? `Term ${selected.term_id}`}</p>
                {academicContext && (
                  <p>Curriculum: {academicContext.program_name ?? academicContext.program_code} · Semester {academicContext.semester_no}</p>
                )}
                <p>Submitted: {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : 'Not submitted'}</p>
                {(currentSubmission?.reviewer_name || currentSubmission?.reviewed_by != null) && (
                  <p>
                    Reviewed by: {currentSubmission?.reviewer_name ?? `User ${currentSubmission?.reviewed_by}`}
                    {currentSubmission?.reviewed_at ? ` · ${new Date(currentSubmission.reviewed_at).toLocaleString()}` : ''}
                  </p>
                )}
              </div>

              {/* Preferences */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Requested subject preferences</p>
                <p className="text-xs text-gray-400 mb-2">These are faculty requests, not approved teaching assignments.</p>
                {!detail ? (
                  <p className="text-sm text-gray-400">Loading submission details…</p>
                ) : detail.preferences.length > 0 ? (
                  <ol className="space-y-2">
                    {detail.preferences.map(p => (
                      <li key={p.preference_id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <span className="font-medium">{p.preference_order}.</span>{' '}
                        {p.preference_kind === 'SOURCE' ? (
                          <div className="inline">
                            <span>{p.source_label}</span>
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                              Pending course verification
                            </span>
                            <p className="ml-5 mt-1 text-xs text-gray-500">
                              Source row {p.source_row_number}, page {p.source_page}
                              {p.source_hours == null ? ' · hours unclear' : ` · ${p.source_hours}h/week`}
                            </p>
                          </div>
                        ) : (
                          <span>{p.course_name}{p.course_code ? ` (${p.course_code})` : ''}
                            {p.component_type && <span className="text-gray-400"> · {p.component_type}</span>}
                            {p.weekly_hours == null ? null : <span className="text-gray-400"> · {p.weekly_hours}h/week</span>}
                            {p.program_code && p.semester_no != null && <span className="text-gray-400"> · {p.program_code}, Semester {p.semester_no}</span>}
                          </span>
                        )}
                        {p.note && <p className="ml-5 mt-1 text-xs italic text-gray-500">Note: {p.note}</p>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-gray-500">No subject preferences recorded.</p>
                )}
              </div>

              {/* Availability */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Availability provided by faculty</p>
                {!detail ? (
                  <p className="text-sm text-gray-400">Loading availability…</p>
                ) : detail.availability.length > 0 ? (
                  <ul className="space-y-1">
                    {detail.availability.map(window => (
                      <li key={window.faculty_availability_id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                        <span className="font-medium">{window.day}</span>
                        <span>{window.start_time.slice(0, 5)}–{window.end_time.slice(0, 5)}</span>
                        <StatusBadge status={window.availability_type} />
                        <span className="text-xs text-gray-400">{window.source === 'FACULTY_SUBMISSION' ? 'Faculty-submitted' : 'Admin-entered'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    No availability windows were submitted. All unrecorded time is UNKNOWN; do not assume the faculty member is available.
                  </div>
                )}
              </div>

              {/* Review comment */}
              {(detail?.submission.review_comment ?? selected.review_comment) && (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-800">
                  <strong>Review comment:</strong> {detail?.submission.review_comment ?? selected.review_comment}
                </div>
              )}

              {/* Actions — only for SUBMITTED forms */}
              {(detail?.submission.submission_status ?? selected.submission_status) === 'SUBMITTED'
                && (detail?.submission.review_status ?? selected.review_status) !== 'ACCEPTED' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {(detail?.submission.review_status ?? selected.review_status) === 'PENDING' && (
                      <button className="btn-secondary btn-sm" onClick={() => setReviewAction('START_REVIEW')}>Start Review</button>
                    )}
                    <button className="btn-primary btn-sm" onClick={() => setReviewAction('ACCEPT')}>Accept</button>
                    <button className="btn-secondary btn-sm text-orange-600" onClick={() => { setReviewAction('RETURN'); setComment(''); }}>Return</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Review confirm modal */}
      <Modal open={!!reviewAction} onClose={() => { setReviewAction(null); setReviewError(''); }} title={`${reviewAction?.replace('_', ' ')} Submission`} size="sm">
        {reviewAction === 'RETURN' && (
          <div className="mb-4">
            <label className="label">Comment (required)</label>
            <textarea className="input" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Explain what needs to be corrected…" />
          </div>
        )}
        {reviewError && <FormError message={reviewError} />}
        <div className="flex justify-end gap-3 mt-4">
          <button className="btn-secondary" onClick={() => setReviewAction(null)}>Cancel</button>
          <button className="btn-primary" disabled={reviewMutation.isPending || (reviewAction === 'RETURN' && !comment.trim())}
            onClick={() => selected && reviewMutation.mutate({ id: selected.submission_id, action: reviewAction!, comment: comment || undefined })}>
            {reviewMutation.isPending ? 'Processing…' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
