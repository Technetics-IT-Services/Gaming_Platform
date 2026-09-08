'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { gamesApi } from '@/lib/games-api';
import { useAuthStore } from '@/stores/auth-store';

/** Shared favorites state: the set of favorited game ids plus a toggle. */
export function useFavorites() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const queryClient = useQueryClient();

  const idsQuery = useQuery({
    queryKey: ['favorite-ids'],
    queryFn: gamesApi.favoriteIds,
    enabled: isAuthenticated && !isDemoSession,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: (gameId: string) => gamesApi.toggleFavorite(gameId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorite-ids'] });
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const ids = new Set(idsQuery.data ?? []);
  return {
    ids,
    isFavorite: (gameId: string) => ids.has(gameId),
    toggle,
    isAuthenticated,
  };
}
