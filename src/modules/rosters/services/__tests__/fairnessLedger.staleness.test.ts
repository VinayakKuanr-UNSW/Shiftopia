/**
 * Audit F-04 — the ledger read must be resilient, and its freshness explicit.
 *
 * Reads used to demand an EXACT `window_end = today`. `window_end` advances
 * daily and the only writer of a fresh window was a fire-and-forget call in the
 * `usePublishRoster` success handler — there is no scheduled recompute. So on
 * any day nobody published, the read matched nothing and returned `[]`, which
 * is indistinguishable from "everyone's debt is genuinely zero". Both solver
 * blocks then hit `if not debts: continue` and longitudinal fairness silently
 * switched itself off, with no signal anywhere.
 *
 * Two behaviours are pinned here:
 *   1. the read resolves to the most recent window AT OR BEFORE the as-of date,
 *      so yesterday's data is used rather than discarded, and
 *   2. the caller is told how fresh that data is — `unavailable` (nothing
 *      applied) vs `stale` (applied, but old) vs `ok`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { format, subDays } from 'date-fns';
import { ALL_FAIRNESS_METRICS, type FairnessMetric } from '../../domain/fairness-ledger';
import type { FairnessLedgerLatestRow } from '../../api/fairnessLedger.queries';

const { ctx } = vi.hoisted(() => ({
    ctx: {
        rows: [] as FairnessLedgerLatestRow[],
        calls: [] as Array<{ orgId: string; employeeIds: string[] | null; asOf: string }>,
    },
}));

vi.mock('../../api/fairnessLedger.queries', () => ({
    fairnessLedgerQueries: {
        getLatestDebts: vi.fn(async (orgId: string, employeeIds: string[] | null, asOf: string) => {
            ctx.calls.push({ orgId, employeeIds, asOf });
            return ctx.rows;
        }),
        getAllForWindow:        vi.fn(async () => []),
        upsertBatch:            vi.fn(async () => undefined),
        deleteForWindow:        vi.fn(async () => undefined),
        fetchAssignedShifts:    vi.fn(async () => []),
        fetchDeniedPreferences: vi.fn(async () => []),
    },
}));

import { fairnessLedgerService, LEDGER_STALE_AFTER_DAYS } from '../fairnessLedger.service';

const ORG = 'org-1';
const AS_OF = new Date('2026-08-04T09:00:00');

function rowsAt(windowEnd: string, employeeId = 'e1'): FairnessLedgerLatestRow[] {
    return ALL_FAIRNESS_METRICS.map((metric: FairnessMetric) => ({
        employee_id: employeeId,
        metric,
        window_start: '2026-05-06',
        window_end: windowEnd,
        rolling_value: 10,
        team_average: 8,
        debt: 2,
    }));
}

describe('F-04: fairness ledger read resilience + staleness', () => {
    beforeEach(() => {
        ctx.rows = [];
        ctx.calls = [];
    });

    it('reports `unavailable` — not silent zeros — when the ledger has never been computed', async () => {
        ctx.rows = [];

        const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);

        expect(read.status).toBe('unavailable');
        expect(read.debts).toEqual([]);
        expect(read.windowEnd).toBeNull();
        expect(read.ageDays).toBeNull();
    });

    it('queries by as-of date, not by exact window_end equality', async () => {
        ctx.rows = rowsAt('2026-08-01');

        await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);

        // The RPC filters `window_end <= p_as_of`; the service must pass the
        // as-of date through unchanged rather than pre-narrowing to one day.
        expect(ctx.calls).toHaveLength(1);
        expect(ctx.calls[0]).toMatchObject({ orgId: ORG, employeeIds: ['e1'], asOf: '2026-08-04' });
    });

    it('uses a recent-but-not-today window and reports it as ok', async () => {
        ctx.rows = rowsAt('2026-08-02');   // 2 days old

        const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);

        // Pre-fix this returned [] because window_end !== today.
        expect(read.status).toBe('ok');
        expect(read.debts).toHaveLength(ALL_FAIRNESS_METRICS.length);
        expect(read.windowEnd).toBe('2026-08-02');
        expect(read.ageDays).toBe(2);
    });

    it('still returns the debts when stale — stale debts beat no debts', async () => {
        ctx.rows = rowsAt('2026-07-01');   // 34 days old

        const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);

        expect(read.status).toBe('stale');
        expect(read.ageDays).toBe(34);
        expect(read.debts).toHaveLength(ALL_FAIRNESS_METRICS.length);
        expect(read.debts[0]).toMatchObject({ employeeId: 'e1', debt: 2, rollingValue: 10 });
    });

    it('flips to stale exactly one day past the threshold', async () => {
        // Build the window dates with the SAME local-calendar arithmetic the
        // service uses (date-fns `parseISO` + `differenceInCalendarDays`).
        // Going via `toISOString()` here would silently shift the day by one in
        // any non-UTC zone and make this boundary assertion test the timezone
        // rather than the threshold.
        const atLimit = format(subDays(AS_OF, LEDGER_STALE_AFTER_DAYS), 'yyyy-MM-dd');
        const pastLimit = format(subDays(AS_OF, LEDGER_STALE_AFTER_DAYS + 1), 'yyyy-MM-dd');

        ctx.rows = rowsAt(atLimit);
        const at = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);
        expect(at.ageDays).toBe(LEDGER_STALE_AFTER_DAYS);
        expect(at.status).toBe('ok');

        ctx.rows = rowsAt(pastLimit);
        const past = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1'], undefined, AS_OF);
        expect(past.ageDays).toBe(LEDGER_STALE_AFTER_DAYS + 1);
        expect(past.status).toBe('stale');
    });

    it('ages against the FRESHEST window when employees straddle recomputes', async () => {
        ctx.rows = [...rowsAt('2026-06-01', 'e1'), ...rowsAt('2026-08-03', 'e2')];

        const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, ['e1', 'e2'], undefined, AS_OF);

        expect(read.windowEnd).toBe('2026-08-03');
        expect(read.ageDays).toBe(1);
        expect(read.status).toBe('ok');
    });

    it('short-circuits on an empty employee list without reporting a fault', async () => {
        const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(ORG, [], undefined, AS_OF);

        expect(read.status).toBe('ok');   // nothing asked for is not a degradation
        expect(read.debts).toEqual([]);
        expect(ctx.calls).toHaveLength(0);
    });

    it('getEmployeeDebts stays a thin debts-only wrapper', async () => {
        ctx.rows = rowsAt('2026-08-02');

        const debts = await fairnessLedgerService.getEmployeeDebts(ORG, ['e1'], undefined, AS_OF);

        expect(debts).toHaveLength(ALL_FAIRNESS_METRICS.length);
        expect(debts[0]).toMatchObject({ employeeId: 'e1', debt: 2 });
    });
});
