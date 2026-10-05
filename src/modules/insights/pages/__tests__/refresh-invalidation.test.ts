/**
 * Refresh must invalidate every query key the active tab actually reads.
 *
 * This is not a nicety. Inside the Capacitor WebView, Refresh is the ONLY
 * invalidation path: the app-wide `refetchOnWindowFocus` hangs off
 * `visibilitychange`, which the WebView never fires, so every `staleTime`
 * becomes cache-forever on a phone. A key missing from TAB_QUERY_KEYS is a tab
 * that silently cannot be refreshed there — and it would look fine on desktop,
 * where a focus refetch hides it.
 *
 * The coupling is structural (a tab calls a hook; the hook owns a key; the page
 * lists keys per tab) and nothing in the type system holds it together, so this
 * reads the source and checks the three line up.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TAB_QUERY_KEYS } from '../InsightsPage';

const ROOT = join(process.cwd(), 'src', 'modules', 'insights');
const HOOKS = join(ROOT, 'hooks');
const TABS = join(ROOT, 'ui', 'tabs');

const read = (p: string) => readFileSync(p, 'utf8');

/** hook export name -> the react-query key it owns. */
const hookKeys: Record<string, string> = {};
for (const file of readdirSync(HOOKS).filter((f) => f.endsWith('.ts'))) {
    const src = read(join(HOOKS, file));
    const key = src.match(/queryKey:\s*\[\s*'([^']+)'/)?.[1];
    const name = src.match(/export (?:const|function)\s+(use[A-Za-z]+)/)?.[1];
    if (key && name) hookKeys[name] = key;
}
// The per-employee report lives in the users module, not insights.
hookKeys.useQuarterlyReport =
    read(join(process.cwd(), 'src', 'modules', 'users', 'hooks', 'usePerformanceMetrics.ts'))
        .match(/queryKey:\s*\[\s*'(quarterly_performance_report)'/)?.[1] ?? 'quarterly_performance_report';

/** Which components back each tab value in TAB_QUERY_KEYS. */
const TAB_FILES: Record<string, string[]> = {
    overview:      ['OverviewKpiTab.tsx', 'ManagerScorecardBand.tsx', 'EmployeePerformanceTable.tsx'],
    attendance:    ['AttendanceTab.tsx'],
    bids:          ['BidsTab.tsx'],
    swaps:         ['SwapsTab.tsx'],
    cancellations: ['CancellationsTab.tsx'],
};

/** Every hook a tab (and its child bands) calls. */
function hooksUsedBy(files: string[]): string[] {
    const used = new Set<string>();
    for (const f of files) {
        const src = read(join(TABS, f));
        for (const name of Object.keys(hookKeys)) {
            // Called, not merely imported.
            if (new RegExp(`\\b${name}\\s*\\(`).test(src)) used.add(name);
        }
    }
    return [...used];
}

describe('hook key extraction', () => {
    it('found a query key for the hooks the tabs use', () => {
        // Guards the test itself: if the regex stops matching, every assertion
        // below would pass vacuously.
        for (const name of [
            'useBiddingKpis', 'useMarketplaceKpis', 'useBehaviourSummary',
            'useBehaviourTrend', 'useMarketplaceTrend',
            'useCancellationReasonBreakdown', 'useQuarterlyReport',
        ]) {
            expect(hookKeys[name], `no query key parsed for ${name}`).toBeTruthy();
        }
    });
});

describe('TAB_QUERY_KEYS covers what each tab reads', () => {
    it.each(Object.keys(TAB_FILES))('%s', (tab) => {
        const listed = new Set(TAB_QUERY_KEYS[tab] ?? []);
        const required = hooksUsedBy(TAB_FILES[tab]).map((h) => hookKeys[h]);

        expect(required.length, `${tab} appears to call no data hooks`).toBeGreaterThan(0);

        for (const key of required) {
            expect(
                listed,
                `Refresh on the "${tab}" tab would not invalidate "${key}" — ` +
                'in the Capacitor WebView that query can never be refreshed.',
            ).toContain(key);
        }
    });

    it('every tab in the map has at least one key', () => {
        for (const [tab, keys] of Object.entries(TAB_QUERY_KEYS)) {
            expect(keys.length, `${tab} has no keys`).toBeGreaterThan(0);
        }
    });

    it('lists no key that no tab reads', () => {
        // A stale key is harmless at runtime but means the map has drifted from
        // the tabs, which is how a real gap gets hidden.
        const allUsed = new Set(
            Object.values(TAB_FILES).flatMap((files) => hooksUsedBy(files).map((h) => hookKeys[h])),
        );
        for (const [tab, keys] of Object.entries(TAB_QUERY_KEYS)) {
            for (const key of keys) {
                expect(allUsed, `TAB_QUERY_KEYS.${tab} lists "${key}", which no tab reads`)
                    .toContain(key);
            }
        }
    });
});
