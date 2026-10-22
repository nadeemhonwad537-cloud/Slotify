import { Loader2Icon, UserRoundXIcon } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import type { FacultyProfile } from '@/types';

export function FacultyProfileStatus({
  query,
}: {
  query: Pick<UseQueryResult<FacultyProfile | null>, 'data' | 'error' | 'isError' | 'isPending'>;
}) {
  if (query.isPending) {
    return (
      <Card padding>
        <div className="flex items-center gap-2 py-2 text-sm text-gray-600" role="status">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          Loading your faculty profile…
        </div>
      </Card>
    );
  }
  if (query.isError) return <ErrorMessage error={query.error} title="Unable to load your faculty profile" />;
  if (query.data != null) return null;

  return (
    <Card padding>
      <div className="flex items-start gap-3 py-2 text-amber-800">
        <UserRoundXIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-semibold">No active faculty profile is linked to your account</p>
          <p className="mt-1 text-sm">
            Contact an administrator to link your account to, or reactivate, an existing faculty profile. No profile or assignment has been created.
          </p>
        </div>
      </div>
    </Card>
  );
}
