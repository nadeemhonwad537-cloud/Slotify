import { AlertCircleIcon } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';

interface ErrorMessageProps {
  error: unknown;
  title?: string;
}

export function ErrorMessage({ error, title = 'Something went wrong' }: ErrorMessageProps) {
  let message = 'An unexpected error occurred.';
  let code: string | undefined;

  if (error instanceof ApiRequestError) {
    message = error.error.message;
    code = error.error.code;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex gap-3">
      <AlertCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
        {code && <p className="mt-0.5 text-xs text-red-500 font-mono">{code}</p>}
      </div>
    </div>
  );
}

interface FormErrorProps { message?: string }
export function FormError({ message }: FormErrorProps) {
  if (!message) return null;
  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}
