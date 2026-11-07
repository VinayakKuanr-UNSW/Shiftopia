/**
 * Audit F-04 — an empty or old ledger must be visible, never silent zeros.
 *
 * The casual ledger is recomputed nightly, so its window_end should be today
 * or yesterday. The caller is told whether fairness is `unavailable` (nothing
 * applied), `stale` (applied, but the nightly job has stopped) or `ok`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format, subDays } from 'date-fns';
import type { FairnessStanding } from '../../domain/fairness-ledger';

const { ctx } = vi.hoisted(() => ({
    ctx: {
        rows: [] as FairnessStanding[],
        calls: [] as Array<{ orgId: string; employeeIds: string[] | null }>,
    },
}));

vi.mock('../../api/fairnessLedger.queries', () => ({
    fairnessLedgerQueries: {
        getStandings: vi.fn(async (orgId: string, employeeIds: string[] | null) => {
            ctx.calls.push({ orgId, employeeIds });
            return ctx.rows;
        }),
    },
}));

import { fairnessLedgerService, LEDGER_STALE_AFTER_DAYS } from '../fairnessLedger.service';

const ORG = 'org-1';
const AS_OF = new Date('2026-12-10T09:00:00');

const rowsAt = (windowEnd: string, employeeId = 'e1'): FairnessStanding[] => [{
    employeeId,
    metric: 'sunday_hours',
    actualHours: 16,
    expectedHours: 20,
    debtHours: -4,
    opportunityCount: 4,
    confidence: 0.4,
    windowStart: '2026-11-07',
    windowEnd,
}];

describe('fairness ledger read: freshness is explicit', () => {
    beforeEach(() => {
        ctx.rows = [];
        ctx.calls = [];
    });

    it('reports `unavailable`, not silent zeros, when there are no standings', async () => {
        const read = await fairnessLedgerService.getStandingsWithStatus(ORG, ['e1'], AS_OF);
        expect(read).toEqual({ standings: [], status: 'unavailable', windowEnd: null, ageDays: null });
    });

    it('is ok when last night’s recompute is present', async () => {
        ctx.rows = rowsAt('2026-12-09');
        const read = await fairnessLedgerService.getStandingsWithStatus(ORG, ['e1'], AS_OF);
        expect(read.status).toBe('ok');
        expect(read.windowEnd).toBe('2026-12-09');
        expect(read.ageDays).toBe(1);
        expect(read.standings).toEqual(ctx.rows);
        expect(ctx.calls).toEqual([{ orgId: ORG, employeeIds: ['e1'] }]);
    });

    it('flips to stale one day past the threshold, and still returns the standings', async () => {
        ctx.rows = rowsAt(format(subDays(AS_OF, LEDGER_STALE_AFTER_DAYS), 'yyyy-MM-dd'));
        expect((await fairnessLedgerService.getStandingsWithStatus(ORG, ['e1'], AS_OF)).status).toBe('ok');

        ctx.rows = rowsAt(format(subDays(AS_OF, LEDGER_STALE_AFTER_DAYS + 1), 'yyyy-MM-dd'));
        const past = await fairnessLedgerService.getStandingsWithStatus(ORG, ['e1'], AS_OF);
        expect(past.status).toBe('stale');
        expect(past.standings).toHaveLength(1);
    });

    // 01:30 on 10 Dec in Sydney is still 9 Dec in UTC (and in any browser west
    // of Sydney). The ledger's dates are Sydney dates, so its age must be too.
    it('ages the ledger against the Sydney calendar date, whatever the browser timezone', async () => {
        ctx.rows = rowsAt('2026-12-09');
        const read = await fairnessLedgerService.getStandingsWithStatus(ORG, ['e1'], new Date('2026-12-09T14:30:00Z'));
        expect(read.ageDays).toBe(1);
    });

    it('short-circuits on an empty employee list without reporting a fault', async () => {
        const read = await fairnessLedgerService.getStandingsWithStatus(ORG, [], AS_OF);
        expect(read.status).toBe('ok');
        expect(read.standings).toEqual([]);
        expect(ctx.calls).toHaveLength(0);
    });

    it('passes null through to read everyone visible', async () => {
        await fairnessLedgerService.getStandingsWithStatus(ORG, null, AS_OF);
        expect(ctx.calls).toEqual([{ orgId: ORG, employeeIds: null }]);
    });
});
