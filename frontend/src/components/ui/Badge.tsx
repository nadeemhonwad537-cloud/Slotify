import clsx from 'clsx';

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'orange';

const variants: Record<Variant, string> = {
  green:  'bg-green-100 text-green-800',
  red:    'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue:   'bg-blue-100 text-blue-800',
  gray:   'bg-gray-100 text-gray-700',
  purple: 'bg-purple-100 text-purple-800',
  orange: 'bg-orange-100 text-orange-800',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function Badge({ children, variant = 'gray', className }: BadgeProps) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    ACTIVE: 'green', DISABLED: 'red',
    DRAFT: 'gray', ACTIVE_TERM: 'green', CLOSED: 'red',
    NOT_STARTED: 'gray', SUBMITTED: 'blue', RETURNED: 'orange', ACCEPTED: 'green',
    PENDING: 'gray', IN_REVIEW: 'blue', CHANGES_REQUESTED: 'orange',
    OFFERED: 'green', CANCELLED: 'red',
    VERIFIED: 'green', VERIFY: 'yellow', DISCREPANCY: 'red', SYNTHETIC: 'purple',
    VALIDATED: 'blue', IN_REVIEW_TT: 'blue', APPROVED: 'green', PUBLISHED: 'purple', ARCHIVED: 'gray',
    PASSED: 'green', FAILED: 'red', RUNNING: 'blue',
    OK: 'green', OVER_LIMIT: 'red', WARNING: 'yellow', NO_RULE: 'orange',
    ERROR_SEV: 'red', WARNING_SEV: 'yellow', INFO: 'blue',
  };
  const variant = map[status] ?? 'gray';
  return <Badge variant={variant}>{status.replace(/_/g, ' ')}</Badge>;
}
