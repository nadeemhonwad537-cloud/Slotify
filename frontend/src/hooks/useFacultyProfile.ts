import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { fetchNullableFacultyProfile } from '@/lib/facultyProfileQuery';
import type { FacultyProfile } from '@/types';

export function useFacultyProfile(enabled = true) {
  const { user } = useAuth();

  return useQuery<FacultyProfile | null>({
    queryKey: ['my-faculty-profile', user?.userId],
    queryFn: () => fetchNullableFacultyProfile(
      () => api.get<FacultyProfile | null>('/faculty-submissions/mine/profile'),
    ),
    enabled: !!user && enabled,
    staleTime: 30_000,
  });
}
