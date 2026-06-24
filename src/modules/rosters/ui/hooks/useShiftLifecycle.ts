import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import {
  deriveEpisodes,
  type ShiftLifecycleEvent,
  type AssignmentEpisode,
  type DeriveEpisodesOptions,
} from '@/modules/rosters/domain/shift-episodes';

// ─── UUID validation (mirrors shift.entity.ts) ─────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// ─── Return type ────────────────────────────────────────────────────────────

export interface UseShiftLifecycleResult {
  events: ShiftLifecycleEvent[];
  episodes: AssignmentEpisode[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Fetches a shift's lifecycle events and derives assignment episodes.
 *
 * @param shiftId - UUID of the shift
 * @param opts    - Optional: scheduledStart (for late-cancel classification),
 *                  completed (for fulfilled determination)
 */
export function useShiftLifecycle(
  shiftId: string | null | undefined,
  opts?: DeriveEpisodesOptions,
) {
  return useQuery<UseShiftLifecycleResult>({
    queryKey: ['shift_lifecycle', shiftId, opts?.scheduledStart, opts?.completed],
    queryFn: async (): Promise<UseShiftLifecycleResult> => {
      // Cast through `any` because get_shift_lifecycle is not in the
      // generated RPC type registry yet (migration pending deployment).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_shift_lifecycle', {
        p_shift_id: shiftId,
      });

      if (error) throw error;

      const events = (data ?? []) as ShiftLifecycleEvent[];
      const episodes = deriveEpisodes(events, opts);

      return { events, episodes };
    },
    enabled: isValidUuid(shiftId),
  });
}
