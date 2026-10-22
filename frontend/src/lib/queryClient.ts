import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => {
        // Don't retry auth errors
        if (error instanceof ApiRequestError && [401, 403].includes(error.status)) return false;
        return count < 2;
      },
      staleTime: 30_000, // 30 seconds
    },
  },
});
