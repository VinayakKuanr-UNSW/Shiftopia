/**
 * The toolbar's "Reload data": refetch everything the roster grid draws from.
 *
 * It used to invalidate only the shift lists. The default Group view draws its
 * cells from the summary aggregate, its footer from the planner stats and its
 * rows from the roster structure — none of which were touched — and in Month +
 * Group the list query is switched off altogether. So Reload changed nothing on
 * screen and toasted "Refreshed" straight away, before anything had loaded.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { ROSTER_STRUCTURE_KEY } from '@/modules/rosters/state/useRosterStructure';

/** Every cache the grid renders from. */
const ROSTER_RELOAD_KEYS: readonly QueryKey[] = [
    shiftKeys.lists,
    shiftKeys.summaries,
    shiftKeys.plannerStatsRoot,
    [ROSTER_STRUCTURE_KEY],
];

/**
 * Invalidate and refetch the active roster queries. Resolves once they have
 * reloaded; rejects if any of them failed to, so the caller reports the truth.
 */
export async function reloadRosterData(queryClient: QueryClient): Promise<void> {
    await Promise.all(
        ROSTER_RELOAD_KEYS.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }, { throwOnError: true }),
        ),
    );
}
