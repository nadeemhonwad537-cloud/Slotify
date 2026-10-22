/**
 * Faculty Track — My Teaching Track
 *
 * Shows the complete workflow status for the authenticated faculty member:
 *  1. Submission status (preferences + availability)
 *  2. Review status and reviewer feedback
 *  3. Assignment status (what the department assigned)
 *  4. Approval status
 *  5. Timeline from audit_logs (real events, not invented)
 *
 * All data comes from GET /api/faculty-submissions/mine/track?term_id=X.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import {
  CheckCircleIcon, ClockIcon, AlertTriangleIcon, BookOpenIcon,
  ActivityIcon, UserIcon, CalendarDaysIcon, InfoIcon,
  ChevronRightIcon,
} from 'lucide-react';
import type { FacultyTrack, Term } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    SUBMISSION_DRAFT_SAVED: 'Draft saved',
    SUBMISSION_SUBMITTED: 'Submitted for review',
    SUBMISSION_START_REVIEW: 'Review started',
    SUBMISSION_RETURN: 'Returned for changes',
    SUBMISSION_ACCEPT: 'Submission accepted',
    ASSIGNMENT_CREATED: 'Assignment created',
    ASSIGNMENT_CHANGED: 'Assignment updated',
    ASSIGNMENT_APPROVED: 'Assignment approved',
    ASSIGNMENT_DELETED: 'Assignment removed',
  };
  return map[action] ?? action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function actionIcon(action: string) {
  if (action.includes('DRAFT')) return <ClockIcon className="w-4 h-4 text-yellow-500" />;
  if (action.includes('SUBMIT')) return <CheckCircleIcon className="w-4 h-4 text-blue-500" />;
  if (action.includes('RETURN')) return <AlertTriangleIcon className="w-4 h-4 text-amber-500" />;
  if (action.includes('ACCEPT')) return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
  if (action.includes('APPROVED')) return <CheckCircleIcon className="w-4 h-4 text-green-600" />;
  if (action.includes('ASSIGNMENT')) return <BookOpenIcon className="w-4 h-4 text-brand-500" />;
  return <InfoIcon className="w-4 h-4 text-gray-400" />;
}

// ─── Workflow stage calculation ───────────────────────────────────────────────

type Stage =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'RETURNED'
  | 'ACCEPTED'
  | 'ASSIGNMENT_IN_PROGRESS'
  | 'ASSIGNMENT_APPROVED';

function computeStage(track: FacultyTrack | undefined): Stage {
  if (!track) return 'NOT_STARTED';
  const sub = track.submission?.submission;
  if (!sub) return 'NOT_STARTED';

  // Check assignments first (highest state)
  const hasApproved = track.assignments.some(a => a.is_approved);
  if (hasApproved) return 'ASSIGNMENT_APPROVED';
  const hasPending = track.assignments.some(a => !a.is_approved);
  if (hasPending) return 'ASSIGNMENT_IN_PROGRESS';

  // Submission states
  if (sub.review_status === 'ACCEPTED') return 'ACCEPTED';
  if (sub.submission_status === 'RETURNED') return 'RETURNED';
  if (sub.review_status === 'IN_REVIEW' || sub.review_status === 'PENDING') return sub.submission_status === 'SUBMITTED' ? 'UNDER_REVIEW' : 'SUBMITTED';
  if (sub.submission_status === 'SUBMITTED') return 'SUBMITTED';
  if (sub.submission_status === 'DRAFT') return 'DRAFT';
  return 'NOT_STARTED';
}

const STAGE_ORDER: Stage[] = [
  'NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED',
  'ACCEPTED', 'ASSIGNMENT_IN_PROGRESS', 'ASSIGNMENT_APPROVED',
];

interface StageInfo { label: string; desc: string; color: 'gray' | 'yellow' | 'blue' | 'amber' | 'green' | 'brand' }
const STAGE_INFO: Record<Stage, StageInfo> = {
  NOT_STARTED:            { label: 'Not Started', desc: 'Submit your preferences and availability.', color: 'gray' },
  DRAFT:                  { label: 'Draft Saved', desc: 'Your draft is saved. Complete and submit.', color: 'yellow' },
  SUBMITTED:              { label: 'Submitted', desc: 'Awaiting department review.', color: 'blue' },
  UNDER_REVIEW:           { label: 'Under Review', desc: 'The department is reviewing your submission.', color: 'blue' },
  RETURNED:               { label: 'Returned for Changes', desc: 'Review the feedback and resubmit.', color: 'amber' },
  ACCEPTED:               { label: 'Submission Accepted', desc: 'Your preferences were accepted. Awaiting assignment.', color: 'green' },
  ASSIGNMENT_IN_PROGRESS: { label: 'Assignment in Progress', desc: 'The department is finalising your teaching assignment.', color: 'brand' },
  ASSIGNMENT_APPROVED:    { label: 'Assignment Approved', desc: 'Your teaching assignment has been approved.', color: 'green' },
};

// ─── Stage progress bar ───────────────────────────────────────────────────────
function StageProgress({ stage }: { stage: Stage }) {
  const visibleStages: Stage[] = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'ASSIGNMENT_IN_PROGRESS', 'ASSIGNMENT_APPROVED'];
  const effectiveStage = stage === 'RETURNED' ? 'SUBMITTED' : stage;
  const currentIdx = visibleStages.indexOf(effectiveStage);

  return (
    <div className="flex items-center gap-0">
      {visibleStages.map((s, i) => {
        const info = STAGE_INFO[s];
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 flex-shrink-0 min-w-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-300'}`}>
                {done ? <CheckCircleIcon className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs text-center leading-tight max-w-[5rem] hidden sm:block ${active ? 'text-brand-700 font-semibold' : done ? 'text-green-600' : 'text-gray-300'}`}>
                {info.label}
              </span>
            </div>
            {i < visibleStages.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function TrackPage() {
  const profileQuery = useFacultyProfile();
  const profile = profileQuery.data;

  const { data: activeTerms = [] } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=10'),
    select: r => r.data,
  });
  const [termId, setTermId] = useState('');
  useEffect(() => { if (activeTerms[0] && !termId) setTermId(String(activeTerms[0].term_id)); }, [activeTerms, termId]);

  const selectedTerm = activeTerms.find(t => String(t.term_id) === termId);

  const { data: track, isLoading, error } = useQuery<FacultyTrack>({
    queryKey: ['my-track', profile?.faculty_id, termId],
    queryFn: () => api.get<FacultyTrack>(`/faculty-submissions/mine/track?term_id=${termId}`),
    enabled: !!profile && !!termId,
    staleTime: 15_000,
  });

  const stage = computeStage(track);
  const stageInfo = STAGE_INFO[stage];

  if (error) return <ErrorMessage error={error} />;
  if (profileQuery.isPending || profileQuery.isError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Teaching Track"
        subtitle="Your complete submission and assignment workflow status."
      />

      {/* Term selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Term:</label>
        <select className="input w-56" value={termId} onChange={e => setTermId(e.target.value)}>
          {activeTerms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading your track…</p>}

      {!isLoading && track && (
        <>
          {/* Stage banner */}
          <Card padding>
            <div className={`flex items-center gap-3 mb-4 p-3 rounded-lg ${
              stage === 'ASSIGNMENT_APPROVED' ? 'bg-green-50 border border-green-200'
              : stage === 'RETURNED' ? 'bg-amber-50 border border-amber-200'
              : stage === 'NOT_STARTED' || stage === 'DRAFT' ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-blue-50 border border-blue-200'
            }`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                stage === 'ASSIGNMENT_APPROVED' ? 'bg-green-100' : stage === 'RETURNED' ? 'bg-amber-100' : 'bg-blue-100'
              }`}>
                {stage === 'ASSIGNMENT_APPROVED' ? <CheckCircleIcon className="w-5 h-5 text-green-600" />
                : stage === 'RETURNED' ? <AlertTriangleIcon className="w-5 h-5 text-amber-600" />
                : stage === 'ACCEPTED' || stage === 'ASSIGNMENT_IN_PROGRESS' ? <BookOpenIcon className="w-5 h-5 text-brand-600" />
                : <ClockIcon className="w-5 h-5 text-blue-600" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{stageInfo.label}</p>
                <p className="text-xs text-gray-600">{stageInfo.desc}</p>
              </div>
            </div>
            <StageProgress stage={stage} />
          </Card>

          {/* Reviewer comment */}
          {track.submission?.submission?.review_comment && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Department feedback</p>
                <p className="text-sm text-amber-700 mt-1">{track.submission.submission.review_comment}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Submission summary */}
            <Card padding>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-brand-600" /> Submission
              </h2>
              {!track.submission ? (
                <p className="text-sm text-gray-400">No submission yet for {selectedTerm?.term_name ?? 'this term'}.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <StatusBadge status={track.submission.submission.submission_status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Review</span>
                    <StatusBadge status={track.submission.submission.review_status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Submitted</span>
                    <span className="text-xs text-gray-600">{formatDate(track.submission.submission.submitted_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Preferences</span>
                    <span className="font-medium">{track.submission.preferences.length} / 3</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Availability windows</span>
                    <span className="font-medium">{track.submission.availability.filter(a => a.source === 'FACULTY_SUBMISSION').length}</span>
                  </div>
                </div>
              )}
            </Card>

            {/* Term info */}
            <Card padding>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <CalendarDaysIcon className="w-4 h-4 text-brand-600" /> Term
              </h2>
              {selectedTerm && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Term</span>
                    <span className="font-medium">{selectedTerm.term_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type</span>
                    <Badge variant="blue">{selectedTerm.parity}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <StatusBadge status={selectedTerm.status} />
                  </div>
                  {selectedTerm.start_date && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Period</span>
                      <span className="text-xs text-gray-600">{selectedTerm.start_date} – {selectedTerm.end_date ?? '?'}</span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Preferences submitted */}
          {track.submission && track.submission.preferences.length > 0 && (
            <Card padding>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <BookOpenIcon className="w-4 h-4 text-brand-600" /> Submitted Preferences
              </h2>
              <ol className="space-y-2">
                {track.submission.preferences.map(p => (
                  <li key={p.preference_id} className="flex items-start gap-3">
                    <span className="w-5 h-5 flex-shrink-0 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">{p.preference_order}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{p.preference_kind === 'SOURCE' ? p.source_label : p.course_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.preference_kind === 'SOURCE' ? (
                          <Badge variant="yellow">Pending admin verification · source row {p.source_row_number}</Badge>
                        ) : p.course_code && <span className="text-xs text-gray-400">{p.course_code}</span>}
                        {p.component_type && <Badge variant="blue">{p.component_type}</Badge>}
                        {p.note && <span className="text-xs text-gray-400 italic">"{p.note}"</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Assignments */}
          <Card padding>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-brand-600" /> My Assignments
              <span className="text-xs text-gray-400 font-normal">(assigned by the department)</span>
            </h2>
            {track.assignments.length === 0 ? (
              <p className="text-sm text-gray-400">No assignments yet for this term. The department will assign teaching duties after reviewing preferences.</p>
            ) : (
              <div className="space-y-2">
                {track.assignments.map(a => (
                  <div key={a.assignment_id} className={`flex items-start gap-3 p-3 rounded-xl border ${a.is_approved ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{a.course_name}</p>
                        {a.course_code && <span className="text-xs text-gray-400">{a.course_code}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="blue">{a.component_type}</Badge>
                        {a.role !== 'UNSPECIFIED' && <Badge variant="purple">{a.role}</Badge>}
                        <span className="text-xs text-gray-500">{a.section_name}{a.batch_name ? ` / ${a.batch_name}` : ''}</span>
                        {a.weekly_hours != null && <span className="text-xs text-gray-400">{a.weekly_hours}h/week</span>}
                      </div>
                      {a.is_approved && a.approved_by_name && (
                        <p className="text-xs text-green-600 mt-1">Approved by {a.approved_by_name} on {formatDate(a.approved_at)}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      {a.is_approved
                        ? <Badge variant="green">Approved</Badge>
                        : <Badge variant="yellow">Pending</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
              <InfoIcon className="w-3 h-3" /> Preferences are requests only. Assignments are created and approved by the department.
            </p>
          </Card>

          {/* Audit timeline */}
          {track.audit_trail.length > 0 && (
            <Card padding>
              <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <ClockIcon className="w-4 h-4 text-brand-600" /> Activity Timeline
              </h2>
              <div className="relative">
                <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200" />
                <div className="space-y-4">
                  {track.audit_trail.map((event, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      <div className="w-7 h-7 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center flex-shrink-0 z-10">
                        {actionIcon(event.action)}
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{actionLabel(event.action)}</p>
                          {event.actor_name && <span className="text-xs text-gray-400">by {event.actor_name}</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.created_at)}</p>
                        {/* Show meaningful details */}
                        {event.action === 'SUBMISSION_RETURN' && event.details && (event.details as any).comment && (
                          <p className="text-xs text-amber-700 mt-1 bg-amber-50 rounded px-2 py-1">"{(event.details as any).comment}"</p>
                        )}
                        {event.action === 'ASSIGNMENT_APPROVED' && event.details && (event.details as any).comment && (
                          <p className="text-xs text-green-700 mt-1 bg-green-50 rounded px-2 py-1">"{(event.details as any).comment}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {track.audit_trail.length === 0 && !track.submission && (
            <div className="text-center py-8 text-sm text-gray-400">
              <ClockIcon className="w-8 h-8 mx-auto mb-2 text-gray-200" />
              No activity yet for this term.
            </div>
          )}
        </>
      )}
    </div>
  );
}
