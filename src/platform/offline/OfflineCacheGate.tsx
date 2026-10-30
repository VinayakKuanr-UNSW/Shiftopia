import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import { offlinePersister, startOfflinePersistence } from './offlineQueryPersistence';

/**
 * Saves the signed-in user's offline views while they are signed in. When the
 * user changes (sign-out, rejected session, another account) everything of
 * the previous user is dropped, in memory and on disk, before anything else
 * can render or save it. Renders nothing; sits inside AuthProvider.
 */
export function OfflineCacheGate() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) {
      queryClient.clear();
      offlinePersister.clear().catch((error) =>
        console.error('[offline] Failed to clear the offline cache:', error));
    }
    previousUserId.current = userId;
    if (!userId) return;
    return startOfflinePersistence(queryClient, userId);
  }, [userId, queryClient]);

  return null;
}
