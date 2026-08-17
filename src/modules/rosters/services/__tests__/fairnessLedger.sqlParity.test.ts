/**
 * SQL ↔ TS ledger parity (audit F-04).
 *
 * The AUTHORITATIVE ledger rebuild now lives in SQL (`recompute_fairness_ledger`)
 * so it can be scheduled by pg_cron. The TS domain module still classifies
 * shifts for the read-only what-if preview (`projectFairnessImpact` behind the
 * bid-review panel). Two implementations of the same classification means they
 * can drift — and if they do, the fairness numbers a manager is shown while
 * approving a bid stop matching the ledger the solver actually optimises
 * against. That is the precise failure mode audit F-13 documents for the
 * coefficient tables, so it is pinned here before it can happen.
 *
 * This test asserts the TS side of a shared fixture. The SAME fixture and the
 * SAME expected numbers are asserted against the SQL function by
 *   supabase/tests/fairness_ledger_parity.sql
 * Change one, change the other. (Verified equal on PostgreSQL 15 —
 * all 12 rows matched exactly on value, team average and debt.)
 *
 * The fixture deliberately exercises every classifier branch:
 *   - a Saturday with an unpaid break            → saturday_shifts + net hours
 *   - a cross-midnight 22:00–06:00               → night, incl. the tail rule
 *   - a King's Birthday shift                    → public holiday
 *   - a plain weekday with a longer break        → neither
 *   - a CANCELLED shift                          → excluded entirely
 *   - bids won and lost                          → denial_rate, both sides
 *
 * No fixture shift falls on a Sunday, so `sunday_shifts` is 0 for everyone.
 * That is deliberate: it pins that Saturday work does NOT leak into the Sunday
 * metric, which is the whole reason the two were split (decision Q6).
 */

import { describe, expect, it } from 'vitest';
import {
    classifyShift,
    aggregateShiftsToEntries,
    computeDebts,
    DEFAULT_WINDOW_DAYS,
    type FairnessMetric,
} from '../../domain/fairness-ledger';

const EA = 'aaaaaaaa-0000-0000-0000-000000000001';
const EB = 'bbbbbbbb-0000-0000-0000-000000000002';

/** Mirrors the INSERTs in supabase/tests/fairness_ledger_parity.sql. */
const FIXTURE_SHIFTS = [
    { id: '1', employeeId: EA, shiftDate: '2026-05-16', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 30 },
    { id: '2', employeeId: EA, shiftDate: '2026-06-10', startTime: '22:00', endTime: '06:00', unpaidBreakMinutes: 0 },
    { id: '3', employeeId: EA, shiftDate: '2026-06-08', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 0 },
    { id: '4', employeeId: EB, shiftDate: '2026-06-11', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 60 },
    // the Cancelled 2026-06-12 shift is absent here exactly as the SQL WHERE
    // clause excludes it — B's total must come out at 7h, not 15h.
];

/**
 * Bid outcomes, matching the parity fixture's shift_bids rows.
 *
 * A won 4 of 4; B lost their only bid. Org rate = 1/5 = 0.2, so with the
 * 5-virtual-bid prior:
 *   A → (0 + 5×0.2) / (4 + 5) = 1/9 = 0.1111
 *   B → (1 + 5×0.2) / (1 + 5) = 2/6 = 0.3333
 *
 * Counts chosen so every intermediate is a clean repeating decimal — an
 * average landing exactly on a 5 at the 5th decimal place would make the
 * SQL/JS comparison a coin-flip on rounding mode rather than a parity check.
 */
const FIXTURE_BIDS = new Map([
    [EA, { denied: 0, submitted: 4 }],
    [EB, { denied: 1, submitted: 1 }],
]);

/** The shared expectation. Must equal the SQL harness's VALUES list. */
const EXPECTED: Array<[string, FairnessMetric, number, number, number]> = [
    [EA, 'saturday_shifts',        1,      0.5,    0.5],
    [EA, 'sunday_shifts',          0,      0,      0],
    [EA, 'night_shifts',           1,      0.5,    0.5],
    [EA, 'public_holiday_shifts',  1,      0.5,    0.5],
    [EA, 'total_hours',           23.5,   15.25,   8.25],
    [EA, 'overtime_minutes',       0,      0,      0],
    [EA, 'denial_rate',            0.1111, 0.2222, -0.1111],
    [EB, 'saturday_shifts',        0,      0.5,   -0.5],
    [EB, 'sunday_shifts',          0,      0,      0],
    [EB, 'night_shifts',           0,      0.5,   -0.5],
    [EB, 'public_holiday_shifts',  0,      0.5,   -0.5],
    [EB, 'total_hours',            7,     15.25,  -8.25],
    [EB, 'overtime_minutes',       0,      0,      0],
    [EB, 'denial_rate',            0.3333, 0.2222,  0.1111],
];

describe('fairness ledger: TS side of the SQL parity fixture', () => {
    const classified = FIXTURE_SHIFTS.map(s => ({
        ...s,
        flags: classifyShift(s.shiftDate, s.startTime, s.endTime),
    }));
    const entries = aggregateShiftsToEntries(
        classified,
        new Map([[EA, 38], [EB, 38]]),
        DEFAULT_WINDOW_DAYS / 7,
        FIXTURE_BIDS,
    );
    const debts = computeDebts(entries);

    it.each(EXPECTED)(
        '%s / %s → value=%s avg=%s debt=%s',
        (employeeId, metric, value, avg, debt) => {
            const row = debts.find(d => d.employeeId === employeeId && d.metric === metric);
            expect(row, `no debt row for ${employeeId}/${metric}`).toBeDefined();
            expect(row!.rollingValue).toBe(value);
            expect(row!.teamAverage).toBe(avg);
            expect(row!.debt).toBe(debt);
        },
    );

    it('produces exactly 2 employees × 7 metrics', () => {
        expect(debts).toHaveLength(14);
        expect(new Set(debts.map(d => d.employeeId)).size).toBe(2);
    });

    it('Saturday work does not leak into the Sunday metric (Q6)', () => {
        // A worked a Saturday and no Sundays. Under the old binary
        // `weekend_shifts` this was one number and the distinction was
        // unrepresentable.
        const sat = debts.find(d => d.employeeId === EA && d.metric === 'saturday_shifts');
        const sun = debts.find(d => d.employeeId === EA && d.metric === 'sunday_shifts');
        expect(sat!.rollingValue).toBe(1);
        expect(sun!.rollingValue).toBe(0);
        expect(sun!.debt).toBe(0); // nobody worked a Sunday → nobody is owed one
    });

    it('excludes the cancelled shift — B is 7h, not 15h', () => {
        const total = debts.find(d => d.employeeId === EB && d.metric === 'total_hours');
        expect(total!.rollingValue).toBe(7);
    });

    it('classifies the 22:00–06:00 cross-midnight shift as night', () => {
        expect(classifyShift('2026-06-10', '22:00', '06:00').isNight).toBe(true);
        // …and does NOT over-reach: a shift merely ENDING at midnight is not
        // night work. (The greedy fallback still gets this wrong — audit F-11.)
        expect(classifyShift('2026-06-10', '18:00', '00:00').isNight).toBe(false);
    });
});
