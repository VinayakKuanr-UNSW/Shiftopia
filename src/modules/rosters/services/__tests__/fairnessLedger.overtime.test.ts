/**
 * Audit F-02 / F-06 / F-20 — the ledger has exactly ONE write path.
 *
 * `updateAfterCommit` used to be a client-side read-modify-write: fetch the
 * whole team's rows, add per-shift deltas in memory, upsert everything back.
 * That single function carried three defects simultaneously:
 *
 *   F-02  It aggregated the delta with `windowWeeks = 0`, collapsing the
 *         contracted threshold to zero, so 100% of every committed minute was
 *         booked as OVERTIME. A plain 09:00–17:00 weekday shift produced
 *         `overtime_minutes: 480` where a full recompute produced 0. That debt
 *         then fed SC-11b and biased the solver AGAINST whoever it had just
 *         assigned — self-reinforcing exclusion.
 *   F-06  It added FUTURE shifts to a TRAILING 91-day window, so the next
 *         authoritative recompute (which only reads `[today-90, today]`)
 *         silently discarded them. It also only ever ADDED — cancel, unassign
 *         and swap-away never decremented anything.
 *   F-20  No version check and no transaction, so two concurrent commits both
 *         read the same baseline and the second silently overwrote the first.
 *         On a monotonic accumulator a lost update never self-corrects.
 *
 * All three are now structurally impossible: the client does not compute or
 * write ledger values at all. It asks the database to recompute, and the
 * database owns the maths in one idempotent statement.
 *
 * These tests pin that architecture. If someone reintroduces a client-side
 * upsert, `does not write ledger rows from the client` fails.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { ctx } = vi.hoisted(() => ({
    ctx: {
        recomputeCalls: [] as Array<{ orgId: string; asOf: string }>,
        upsertCalls: 0,
        getAllForWindowCalls: 0,
    },
}));

vi.mock('../../api/fairnessLedger.queries', () => ({
    fairnessLedgerQueries: {
        requestRecompute: vi.fn(async (orgId: string, asOf: string) => {
            ctx.recomputeCalls.push({ orgId, asOf });
            return 12;
        }),
        upsertBatch: vi.fn(async () => { ctx.upsertCalls++; }),
        getAllForWindow: vi.fn(async () => { ctx.getAllForWindowCalls++; return []; }),
        getLatestDebts: vi.fn(async () => []),
        deleteForWindow: vi.fn(async () => undefined),
        fetchAssignedShifts: vi.fn(async () => []),
        fetchDeniedPreferences: vi.fn(async () => []),
    },
}));

import { fairnessLedgerService } from '../fairnessLedger.service';

const ORG = 'org-1';
const AS_OF = new Date('2026-08-04T09:00:00');

/** A plain 8h weekday shift — the case that used to produce 480 phantom OT minutes. */
const committed = [{
    id: 'shift-1',
    employeeId: 'e1',
    shiftDate: '2026-08-10',
    startTime: '09:00',
    endTime: '17:00',
}];

describe('F-02/F-06/F-20: single ledger write path', () => {
    beforeEach(() => {
        ctx.recomputeCalls = [];
        ctx.upsertCalls = 0;
        ctx.getAllForWindowCalls = 0;
    });

    it('delegates to the authoritative server-side recompute', async () => {
        await fairnessLedgerService.updateAfterCommit(ORG, committed, AS_OF);

        expect(ctx.recomputeCalls).toEqual([{ orgId: ORG, asOf: '2026-08-04' }]);
    });

    it('does not write ledger rows from the client', async () => {
        await fairnessLedgerService.updateAfterCommit(ORG, committed, AS_OF);

        // No client-side upsert means no client-computed value can be wrong —
        // this is what makes F-02's phantom overtime structurally impossible
        // rather than merely fixed.
        expect(ctx.upsertCalls).toBe(0);
    });

    it('does not read-modify-write — no baseline fetch to lose an update against', async () => {
        await fairnessLedgerService.updateAfterCommit(ORG, committed, AS_OF);

        // The lost-update race (F-20) required reading a baseline first.
        expect(ctx.getAllForWindowCalls).toBe(0);
    });

    it('is a no-op when nothing was committed', async () => {
        await fairnessLedgerService.updateAfterCommit(ORG, [], AS_OF);

        expect(ctx.recomputeCalls).toEqual([]);
    });

    it('recomputeLedger itself is the same single delegation', async () => {
        await fairnessLedgerService.recomputeLedger(ORG, AS_OF);

        expect(ctx.recomputeCalls).toEqual([{ orgId: ORG, asOf: '2026-08-04' }]);
        expect(ctx.upsertCalls).toBe(0);
    });
});
