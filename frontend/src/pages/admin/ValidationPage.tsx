import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ShieldCheckIcon, ShieldXIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import type { Term, ValidationRun, ValidationIssue } from '@/types';

interface SchedulingReadiness {
  ready: boolean;
  term: { term_id: number; term_name: string; parity: string; status: string };
  expected_semesters: number[];
  expected_divisions: number;
  actual_divisions: number;
  active_semesters: number[];
  rooms: Array<{ room_id: number; room_code: string; type_code: string; data_status: string }>;
  calendar_supported: boolean;
  practical_approval_supported: boolean;
  workload_rules: { active: number; verified: number };
  issues: ValidationIssue[];
}

interface ValidationRunDetail {
  run: ValidationRun;
  issues: ValidationIssue[];
  summary: { issue_count: number; error_count: number; warning_count: number };
}

interface DryRunResult {
  dry_run: true;
  version_id: number;
  session_count: number;
  issue_count: number;
  error_count: number;
  warning_count: number;
  passed: boolean;
  issues: ValidationIssue[];
}

const severityIcon = {
  ERROR: <ShieldXIcon className="w-4 h-4 text-red-500" />,
  WARNING: <AlertTriangleIcon className="w-4 h-4 text-yellow-500" />,
  INFO: <InfoIcon className="w-4 h-4 text-blue-500" />,
};

const severityBadge = {
  ERROR: <Badge variant="red">ERROR</Badge>,
  WARNING: <Badge variant="yellow">WARNING</Badge>,
  INFO: <Badge variant="blue">INFO</Badge>,
};

interface VersionListRow {
  version_id: number;
  term_id: number;
  term_name: string;
  version_no: number;
  status: string;
}

export function ValidationPage() {
  const [versionId, setVersionId] = useState('');
  const [runId, setRunId] = useState<number | null>(null);
  const [dryResult, setDryResult] = useState<DryRunResult | null>(null);
  const [configurationTermId, setConfigurationTermId] = useState('');
  const [requestedConfigurationTermId, setRequestedConfigurationTermId] = useState<number | null>(null);

  const { data: versionsResult } = useQuery({
    queryKey: ['timetable-versions-list', '', ''],
    queryFn: () => listRequest<VersionListRow>('/timetable/versions?limit=100'),
  });
  const versions = versionsResult?.data ?? [];
  const { data: termsResult } = useQuery({
    queryKey: ['scheduling-configuration-terms'],
    queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'),
  });
  const terms = termsResult?.data ?? [];
  const {
    data: schedulingReadiness,
    error: schedulingReadinessError,
    isFetching: configurationIsFetching,
  } = useQuery({
    queryKey: ['scheduling-configuration', requestedConfigurationTermId],
    queryFn: () => api.get<SchedulingReadiness>(`/timetable/configuration/${requestedConfigurationTermId}`),
    enabled: requestedConfigurationTermId != null,
  });

  const { data: runDetail } = useQuery<ValidationRunDetail>({    queryKey: ['validation-run', runId],
    queryFn: () => api.get<ValidationRunDetail>(`/timetable/validate/${runId}`),
    enabled: !!runId,
  });

  const dryMutation = useMutation({
    mutationFn: (vid: number) => api.post<DryRunResult>('/timetable/validate', { version_id: vid, dry_run: true }),
    onSuccess: d => {
      setRunId(null);
      setDryResult(d);
    },
  });

  const persistMutation = useMutation({
    mutationFn: (vid: number) => api.post<{ validation_id: number }>('/timetable/validate', { version_id: vid, dry_run: false }),
    onSuccess: d => { setRunId((d as any).validation_id); setDryResult(null); },
  });

  const vid = parseInt(versionId);
  const isValidId = !isNaN(vid) && vid > 0;
  const activeIssues = runDetail?.issues ?? dryResult?.issues ?? [];
  const activeSummary = runDetail?.summary ?? (dryResult ? { issue_count: dryResult.issue_count, error_count: dryResult.error_count, warning_count: dryResult.warning_count } : null);
  const passed = runDetail ? runDetail.run.status === 'PASSED' : dryResult?.passed ?? null;

  return (
    <div>
      <PageHeader title="Validation & Conflict Resolution" subtitle="Run constraint checks on a timetable version and review all scheduling issues." />

      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="label">Academic Term Configuration Readiness</label>
            <select className="input" value={configurationTermId} onChange={e => setConfigurationTermId(e.target.value)}>
              <option value="">Select a term</option>
              {terms.map(term => <option key={term.term_id} value={term.term_id}>{term.term_name} ({term.parity}, {term.status})</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500">Read-only check of term mappings, division counts, shared rooms, time grids, calendar support, and verified workload policy.</p>
          </div>
          <button
            className="btn-secondary"
            disabled={!configurationTermId || configurationIsFetching}
            onClick={() => setRequestedConfigurationTermId(Number(configurationTermId))}
          >
            {configurationIsFetching ? 'Checking…' : 'Check Configuration'}
          </button>
        </div>
        {schedulingReadinessError && (
          <div className="mt-4"><ErrorMessage error={schedulingReadinessError} title="Configuration check failed" /></div>
        )}
        {schedulingReadiness && (
          <div className="mt-4 space-y-3">
            <div className={`rounded-md border px-3 py-2 text-sm ${schedulingReadiness.ready ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {schedulingReadiness.ready ? 'Configuration is ready for scheduling.' : 'Configuration is blocked; resolve the listed errors before scheduling.'}
              <span className="ml-2">
                {schedulingReadiness.actual_divisions}/{schedulingReadiness.expected_divisions} active divisions · semesters {schedulingReadiness.expected_semesters.join(', ')} · {schedulingReadiness.rooms.length}/12 active rooms
              </span>
            </div>
            {schedulingReadiness.issues.length > 0 ? (
              <div className="space-y-2">
                {schedulingReadiness.issues.map((issue, index) => (
                  <div key={`${issue.rule_code}-${index}`} className="rounded-md border border-red-200 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant={issue.severity === 'ERROR' ? 'red' : 'yellow'}>{issue.severity}</Badge>
                      <code className="text-xs text-gray-600">{issue.rule_code}</code>
                    </div>
                    <p className="text-sm text-gray-800">{issue.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-green-700">No configuration blockers found.</p>
            )}
          </div>
        )}
      </Card>

      {/* Version input */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="flex-1">
            <label className="label">Timetable Version</label>
            {versions.length > 0 ? (
              <select className="input" value={versionId} onChange={e => { setVersionId(e.target.value); setDryResult(null); setRunId(null); }}>
                <option value="">— Select a version —</option>
                {versions.map(v => <option key={v.version_id} value={v.version_id}>v{v.version_no} — {v.term_name} ({v.status})</option>)}
              </select>
            ) : (
              <input
                className="input"
                type="number"
                placeholder="Enter version_id"
                value={versionId}
                onChange={e => { setVersionId(e.target.value); setDryResult(null); setRunId(null); }}
              />
            )}
            <p className="text-xs text-gray-400 mt-1">
              Select a draft or validated version to run constraint checks.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={!isValidId || dryMutation.isPending}
              onClick={() => dryMutation.mutate(vid)}
            >
              {dryMutation.isPending ? 'Running…' : 'Dry Run (Preview)'}
            </button>
            <button
              className="btn-primary"
              disabled={!isValidId || persistMutation.isPending}
              onClick={() => persistMutation.mutate(vid)}
            >
              {persistMutation.isPending ? 'Validating…' : 'Run & Save'}
            </button>
          </div>
        </div>
      </Card>

      {/* Errors */}
      {(dryMutation.error || persistMutation.error) && (
        <div className="mb-4">
          <ErrorMessage error={dryMutation.error || persistMutation.error} title="Validation failed to run" />
        </div>
      )}

      {/* Results */}
      {activeSummary && (
        <>
          {/* Summary bar */}
          <div className={`rounded-xl border px-5 py-4 mb-5 flex items-center gap-4 ${passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            {passed
              ? <ShieldCheckIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
              : <ShieldXIcon className="w-6 h-6 text-red-600 flex-shrink-0" />
            }
            <div className="flex-1">
              <p className={`text-base font-semibold ${passed ? 'text-green-800' : 'text-red-800'}`}>
                {passed ? 'Validation Passed — No Errors' : `Validation Failed — ${activeSummary.error_count} Error${activeSummary.error_count !== 1 ? 's' : ''}`}
              </p>
              {dryResult && <p className="text-xs text-gray-500">{dryResult.session_count} sessions checked · Dry run (not saved)</p>}
              {runDetail && <p className="text-xs text-gray-500">Run ID {runId} · {new Date(runDetail.run.started_at).toLocaleString()}</p>}
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-red-700 font-medium">{activeSummary.error_count} errors</span>
              <span className="text-yellow-700 font-medium">{activeSummary.warning_count} warnings</span>
            </div>
          </div>

          {/* Issues list */}
          {activeIssues.length === 0 ? (
            <Card>
              <div className="py-8 text-center">
                <ShieldCheckIcon className="w-10 h-10 text-green-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">No issues found</p>
                <p className="text-xs text-gray-400 mt-1">This timetable version has no scheduling conflicts.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {activeIssues.map((issue, i) => (
                <div key={issue.issue_id ?? i} className={`card p-4 flex gap-3 ${issue.severity === 'ERROR' ? 'border-red-200' : issue.severity === 'WARNING' ? 'border-yellow-200' : 'border-blue-200'}`}>
                  <div className="flex-shrink-0 mt-0.5">{severityIcon[issue.severity]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {severityBadge[issue.severity]}
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{issue.rule_code}</code>
                    </div>
                    <p className="text-sm text-gray-800">{issue.message}</p>
                    {issue.details && Object.keys(issue.details).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Show details</summary>
                        <pre className="mt-1 text-xs bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
                          {JSON.stringify(issue.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!activeSummary && !dryMutation.isPending && !persistMutation.isPending && (
        <Card>
          <div className="py-12 text-center">
            <ShieldCheckIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">Enter a version ID and run validation to see results.</p>
            <p className="text-xs text-gray-400 mt-1">
              Use Dry Run for a preview without saving, or Run &amp; Save to record results in the database.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
