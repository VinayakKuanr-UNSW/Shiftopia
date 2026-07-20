import { useEffect, useRef } from 'react';
import { supabase } from '@/platform/supabase/client';

/**
 * Subscribe to Supabase Realtime `postgres_changes` for one or more public
 * tables and run `onChange` whenever any of them change. RLS is enforced for
 * realtime, so a subscriber only receives rows it is allowed to read — the
 * Phase-1 scoped policies apply, so this never leaks cross-tenant activity.
 *
 * Usage: pair with react-query `invalidateQueries` (or a manual reload) to keep
 * the My Bids / My Swaps / My Leaves lists fresh without polling.
 *
 * - `channelName` must be stable per mounting surface (include the user id).
 * - `onChange` is held in a ref so a new closure each render does NOT thrash the
 *   subscription; only `channelName`/`tables`/`enabled` re-subscribe.
 */
export function useRealtimeInvalidate(
  channelName: string,
  tables: readonly string[],
  onChange: () => void,
  enabled: boolean = true,
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    const channel = supabase.channel(channelName);
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => cbRef.current(),
      );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tablesKey, enabled]);
}
