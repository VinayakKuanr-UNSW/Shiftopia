/**
 * "Reload data" refetches every cache the roster grid draws from, waits for
 * them, and fails loudly. A real QueryClient with active observers; the
 * repo's real key factories.
 */
import { describe, it, expect } from 'vitest';
import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { ROSTER_STRUCTURE_KEY } from '@/modules/rosters/state/useRosterStructure';
import { reloadRosterData } from '../reloadRoster';

const RANGE = ['org', '2026-10-01', '2026-10-31', {}] as const;
const KEYS: Record<string, QueryKey> = {
    list: shiftKeys.byDateRange(...RANGE),
    summary: shiftKeys.summary(...RANGE),
    plannerStats: shiftKeys.plannerStats(...RANGE),
    // How useRosterStructure builds its key.
    structure: [ROSTER_STRUCTURE_KEY, ...RANGE],
};

/** Mount an observer per key (as the page does), counting fetches. */
function mount(qc: QueryClient, failing?: string) {
    const fetches: Record<string, number> = {};
    const unsubs = Object.entries(KEYS).map(([name, queryKey]) => {
        fetches[name] = 0;
        const obs = new QueryObserver(qc, {
            queryKey,
            queryFn: async () => {
                fetches[name]++;
                if (failing === name && fetches[name] > 1) throw new Error(`${name} failed to reload`);
                return name;
            },
            retry: false,
            staleTime: Infinity,
        });
        return obs.subscribe(() => {});
    });
    return { fetches, unmount: () => unsubs.forEach(u => u()) };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('reloadRosterData', () => {
    it('refetches the lists, the summary cells, the footer stats and the row structure', async () => {
        const qc = new QueryClient();
        const { fetches, unmount } = mount(qc);
        await settle();
        expect(fetches).toEqual({ list: 1, summary: 1, plannerStats: 1, structure: 1 });

        await reloadRosterData(qc);

        expect(fetches).toEqual({ list: 2, summary: 2, plannerStats: 2, structure: 2 });
        unmount();
    });

    it('rejects when any of them fails to reload, instead of reporting success', async () => {
        const qc = new QueryClient();
        const { unmount } = mount(qc, 'summary');
        await settle();

        await expect(reloadRosterData(qc)).rejects.toThrow(/summary failed to reload/);
        unmount();
    });
});
