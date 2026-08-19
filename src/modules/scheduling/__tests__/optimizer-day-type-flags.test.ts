/**
 * Audit F-01 — the optimizer request must carry the day-type flags.
 *
 * `is_sunday` and `is_public_holiday` were declared on `OptimizerShift`, accepted
 * by the pydantic wire model, and read by the solver in two places —
 * `_penalty_day` (EBA cl 41 Sat/Sun/PH loadings) and `undesirable_shift_ids`
 * (the SC-10 / SC-11 fairness terms) — but the ONLY producer of that payload
 * never set them. They therefore arrived permanently `false`, which meant:
 *
 *   - Sunday and public-holiday work was priced at the ORDINARY rate, and
 *   - Sunday / Saturday / PH shifts were invisible to every fairness balancing
 *     term (the `public_holiday_shifts` debt branch was unreachable outright).
 *
 * A field-existence contract test cannot catch this — both sides HAD the field.
 * Only a producer test can, so this asserts on the request the controller
 * actually hands to `optimizerClient.optimize`.
 *
 * Sat/Sun are now ALSO derived server-side in `ShiftInput.__post_init__`
 * (see `optimizer-service/tests/test_solver_regressions.py`), so this test is
 * the sole guard for `is_public_holiday` — which the solver cannot derive,
 * having no holiday calendar of its own.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { OptimizerShift } from '../types';

// ── Module mocks (mirrors auto-scheduler-commit.test.ts) ────────────────────

vi.mock('@/modules/scheduling/validation', () => ({
    assignmentValidator: { simulate: vi.fn() },
}));
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', () => ({
    assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({ auditor: { audit: vi.fn() } }));

vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));

vi.mock('@/modules/scheduling/data/roster-fetcher', async (importOriginal) => {
    const original = await importOriginal() as Record<string, unknown>;
    return {
        ...original,
        rosterFetcher: {
            fetchExistingRoster:        vi.fn().mockResolvedValue(new Map()),
            fetchAvailability:          vi.fn().mockResolvedValue(new Map()),
            fetchApprovedLeave:         vi.fn().mockResolvedValue(new Map()),
            fetchPendingLeave:          vi.fn().mockResolvedValue(new Map()),
            fetchAvailabilityExceptions: vi.fn().mockResolvedValue(new Map()),
            fetchEmployeeContractDetails: vi.fn().mockResolvedValue(new Map()),
            // Empty = no contract has an ordinary-hours envelope, which is
            // production's state and keeps this test about day-type flags only.
            fetchOrdinaryHoursEnvelopes: vi.fn().mockResolvedValue(new Map()),
        },
    };
});

// The ledger read is org-scoped and hits Supabase; the payload build must not
// depend on it (it is explicitly skipped when no org is supplied).
vi.mock('@/modules/rosters/services/fairnessLedger.service', () => ({
    fairnessLedgerService: {
        getEmployeeDebts: vi.fn().mockResolvedValue([]),
        updateAfterCommit: vi.fn().mockResolvedValue(undefined),
        recomputeLedger: vi.fn().mockResolvedValue(undefined),
    },
}));

import { AutoSchedulerController } from '../auto-scheduler.controller';
import { optimizerClient } from '@/modules/scheduling/optimizer/optimizer.client';

const mockOptimize = optimizerClient.optimize as ReturnType<typeof vi.fn>;

// ── Fixture dates (2027, so they stay comfortably in the future) ────────────
const SUNDAY        = '2027-05-16';   // Sunday
const SATURDAY      = '2027-05-15';   // Saturday
const WEEKDAY       = '2027-05-12';   // Wednesday
const ANZAC_DAY     = '2027-04-26';   // ANZAC Day observed (Mon) — NSW public holiday
const CHRISTMAS     = '2027-12-25';   // Christmas Day

function shiftMeta(id: string, shift_date: string) {
    return {
        id,
        shift_date,
        start_time: '09:00',
        end_time: '17:00',
        role_id: 'role-A',
        roleName: 'Attendant',
        demand_source: 'baseline' as const,
        level: 1,
        unpaid_break_minutes: 0,
    };
}

/** Runs the controller and returns the shifts it actually sent to the solver. */
async function shiftsSentToOptimizer(dates: Record<string, string>): Promise<Map<string, OptimizerShift>> {
    mockOptimize.mockResolvedValue({
        status: 'OPTIMAL', assignments: [], unassigned_shift_ids: [],
        solve_time_ms: 1, objective_value: 0, metrics: {},
    });

    const controller = new AutoSchedulerController();
    await controller.run({
        shifts: Object.entries(dates).map(([id, d]) => shiftMeta(id, d)),
        employees: [{ id: 'e1', name: 'Emp One', contract_type: 'FT', contracted_role_ids: ['role-A'] }],
    } as never);

    expect(mockOptimize).toHaveBeenCalled();
    const request = mockOptimize.mock.calls[0][0] as { shifts: OptimizerShift[] };
    return new Map(request.shifts.map(s => [s.id, s]));
}

describe('F-01: optimizer payload day-type flags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Pin "now" well before the fixture dates so none are filtered out as
        // past or emergent (TTS ≤ 4h) before the payload is built.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-01-05T00:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('marks Sunday shifts with is_sunday', async () => {
        const sent = await shiftsSentToOptimizer({ sun: SUNDAY, wed: WEEKDAY });

        expect(sent.get('sun')?.is_sunday).toBe(true);
        expect(sent.get('wed')?.is_sunday).toBe(false);
    });

    it('does NOT mark Saturday as Sunday (the solver derives Saturday itself)', async () => {
        const sent = await shiftsSentToOptimizer({ sat: SATURDAY });

        expect(sent.get('sat')?.is_sunday).toBe(false);
    });

    it('marks NSW public holidays with is_public_holiday', async () => {
        const sent = await shiftsSentToOptimizer({
            anzac: ANZAC_DAY, xmas: CHRISTMAS, wed: WEEKDAY,
        });

        // The solver has no holiday calendar — if these are false, PH work is
        // billed at the ordinary rate and the 500c PH fairness debt never fires.
        expect(sent.get('anzac')?.is_public_holiday).toBe(true);
        expect(sent.get('xmas')?.is_public_holiday).toBe(true);
        expect(sent.get('wed')?.is_public_holiday).toBe(false);
    });

    it('sets both flags on every shift — never leaves them undefined', async () => {
        const sent = await shiftsSentToOptimizer({
            sun: SUNDAY, sat: SATURDAY, wed: WEEKDAY, xmas: CHRISTMAS,
        });

        for (const [id, s] of sent) {
            expect(typeof s.is_sunday, `${id}.is_sunday`).toBe('boolean');
            expect(typeof s.is_public_holiday, `${id}.is_public_holiday`).toBe('boolean');
        }
    });
});
