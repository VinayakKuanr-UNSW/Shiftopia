/**
 * F1 — Fairness Ledger Domain Logic Tests.
 *
 * Covers:
 *   - Shift classification (Saturday, Sunday, night, PH)
 *   - Debt computation from raw entries
 *   - Metric aggregation from shifts
 *   - Objective coefficient conversion
 *   - Denial rate (stakeholder decision Q5)
 */
import { describe, it, expect } from 'vitest';
import {
    isWeekendShift,
    isNightShift,
    classifyShift,
    computeDebts,
    aggregateShiftsToEntries,
    debtToObjectiveCoeff,
    debtsToMap,
    projectFairnessImpact,
    smoothedDenialRate,
    orgDenialRate,
    type EmployeeLedgerEntry,
    type FairnessDebt,
    type ShiftFairnessFlags,
    type ShiftForFairness,
} from '../fairness-ledger';

// ─── isWeekendShift ─────────────────────────────────────────────────────────────

describe('isWeekendShift', () => {
    it('returns true for Saturday', () => {
        // 2026-06-13 is a Saturday
        expect(isWeekendShift('2026-06-13')).toBe(true);
    });

    it('returns true for Sunday', () => {
        // 2026-06-14 is a Sunday
        expect(isWeekendShift('2026-06-14')).toBe(true);
    });

    it('returns false for Monday–Friday', () => {
        // 2026-06-15 is Monday
        expect(isWeekendShift('2026-06-15')).toBe(false);
        // 2026-06-16 is Tuesday
        expect(isWeekendShift('2026-06-16')).toBe(false);
        // 2026-06-17 is Wednesday
        expect(isWeekendShift('2026-06-17')).toBe(false);
        // 2026-06-18 is Thursday
        expect(isWeekendShift('2026-06-18')).toBe(false);
        // 2026-06-19 is Friday
        expect(isWeekendShift('2026-06-19')).toBe(false);
    });
});

// ─── isNightShift ───────────────────────────────────────────────────────────────

describe('isNightShift', () => {
    it('returns true for shift entirely in night zone (00:00–06:00)', () => {
        expect(isNightShift('01:00', '05:00')).toBe(true);
    });

    it('returns true for shift starting before and ending in night zone', () => {
        expect(isNightShift('00:00', '03:00')).toBe(true);
    });

    it('returns true for cross-midnight shift that enters night zone', () => {
        // 22:00 → 04:00 (next day) — overlaps 00:00–06:00
        expect(isNightShift('22:00', '04:00')).toBe(true);
    });

    it('returns true for shift overlapping tail of night zone', () => {
        // 05:00 → 07:00 — overlaps 05:00–06:00
        expect(isNightShift('05:00', '07:00')).toBe(true);
    });

    it('returns false for daytime shift', () => {
        expect(isNightShift('09:00', '17:00')).toBe(false);
    });

    it('returns false for evening shift ending before midnight', () => {
        expect(isNightShift('18:00', '23:00')).toBe(false);
    });

    it('returns true for shift starting at 23:00 ending at 02:00', () => {
        expect(isNightShift('23:00', '02:00')).toBe(true);
    });

    it('returns false for shift exactly at 06:00–12:00', () => {
        expect(isNightShift('06:00', '12:00')).toBe(false);
    });
});

// ─── classifyShift ──────────────────────────────────────────────────────────────

describe('classifyShift', () => {
    it('classifies a Saturday night shift on a public holiday', () => {
        // 2026-12-26 is Saturday + Boxing Day
        const result = classifyShift('2026-12-26', '23:00', '05:00');
        expect(result.isSaturday).toBe(true);
        expect(result.isSunday).toBe(false);
        expect(result.isNight).toBe(true);
        expect(result.isPublicHoliday).toBe(true);
        expect(result.durationMinutes).toBe(360); // 6h
    });

    it('distinguishes Sunday from Saturday (EBA cl 41 prices them differently)', () => {
        const sat = classifyShift('2026-06-13', '09:00', '17:00'); // Saturday
        const sun = classifyShift('2026-06-14', '09:00', '17:00'); // Sunday

        expect(sat.isSaturday).toBe(true);
        expect(sat.isSunday).toBe(false);
        expect(sun.isSaturday).toBe(false);
        expect(sun.isSunday).toBe(true);
    });

    it('classifies a regular Monday daytime shift', () => {
        const result = classifyShift('2026-06-15', '09:00', '17:00');
        expect(result.isSaturday).toBe(false);
        expect(result.isSunday).toBe(false);
        expect(result.isNight).toBe(false);
        expect(result.isPublicHoliday).toBe(false);
        expect(result.durationMinutes).toBe(480); // 8h
    });

    it('uses custom PH set when provided', () => {
        const customPH = new Set(['2026-06-15']);
        const result = classifyShift('2026-06-15', '09:00', '17:00', customPH);
        expect(result.isPublicHoliday).toBe(true);
    });
});

// ─── computeDebts ───────────────────────────────────────────────────────────────

describe('computeDebts', () => {
    it('computes correct debts for 3 employees', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { saturday_shifts: 5, sunday_shifts: 1, night_shifts: 2, public_holiday_shifts: 1, overtime_minutes: 60, total_hours: 120, denial_rate: 0.4 } },
            { employeeId: 'B', values: { saturday_shifts: 2, sunday_shifts: 1, night_shifts: 2, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 100, denial_rate: 0.2 } },
            { employeeId: 'C', values: { saturday_shifts: 0, sunday_shifts: 1, night_shifts: 4, public_holiday_shifts: 2, overtime_minutes: 30, total_hours: 110, denial_rate: 0 } },
        ];

        const debts = computeDebts(entries);

        // Saturday: avg = (5+2+0)/3 = 2.33
        const satDebts = debts.filter(d => d.metric === 'saturday_shifts');
        expect(satDebts).toHaveLength(3);

        const aSat = satDebts.find(d => d.employeeId === 'A')!;
        expect(aSat.rollingValue).toBe(5);
        expect(aSat.teamAverage).toBeCloseTo(2.33, 1);
        expect(aSat.debt).toBeCloseTo(2.67, 1); // 5 - 2.33

        const cSat = satDebts.find(d => d.employeeId === 'C')!;
        expect(cSat.debt).toBeCloseTo(-2.33, 1); // 0 - 2.33

        // Sunday is tracked independently — all three are equal here, so nobody
        // carries Sunday debt even though Saturday debt is wide apart.
        for (const d of debts.filter(d => d.metric === 'sunday_shifts')) {
            expect(d.debt).toBe(0);
        }

        // Denial rate: avg = (0.4+0.2+0)/3 = 0.2
        const prefDebts = debts.filter(d => d.metric === 'denial_rate');
        expect(prefDebts).toHaveLength(3);
        const aPref = prefDebts.find(d => d.employeeId === 'A')!;
        expect(aPref.debt).toBeCloseTo(0.2, 4); // 0.4 - 0.2
    });

    it('returns zero debts when all employees are equal', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { saturday_shifts: 3, sunday_shifts: 2, night_shifts: 3, public_holiday_shifts: 1, overtime_minutes: 0, total_hours: 100, denial_rate: 0.2 } },
            { employeeId: 'B', values: { saturday_shifts: 3, sunday_shifts: 2, night_shifts: 3, public_holiday_shifts: 1, overtime_minutes: 0, total_hours: 100, denial_rate: 0.2 } },
        ];

        const debts = computeDebts(entries);
        for (const d of debts) {
            expect(d.debt).toBe(0);
        }
    });

    it('returns empty array for empty input', () => {
        expect(computeDebts([])).toEqual([]);
    });

    it('handles single employee (debt = 0)', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { saturday_shifts: 5, sunday_shifts: 0, night_shifts: 0, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 40, denial_rate: 0.5 } },
        ];
        const debts = computeDebts(entries);
        for (const d of debts) {
            expect(d.debt).toBe(0);
            expect(d.rollingValue).toBe(d.teamAverage);
        }
    });
});

// ─── aggregateShiftsToEntries ───────────────────────────────────────────────────

describe('aggregateShiftsToEntries', () => {
    it('aggregates shifts by employee correctly', () => {
        const shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }> = [
            { shiftDate: '2026-06-13', startTime: '09:00', endTime: '17:00', employeeId: 'A', flags: { isSaturday: true, isSunday: false, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
            { shiftDate: '2026-06-14', startTime: '22:00', endTime: '06:00', employeeId: 'A', flags: { isSaturday: false, isSunday: true, isNight: true, isPublicHoliday: false, durationMinutes: 480 } },
            { shiftDate: '2026-06-15', startTime: '09:00', endTime: '17:00', employeeId: 'B', flags: { isSaturday: false, isSunday: false, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
        ];

        const bids = new Map([
            ['A', { denied: 3, submitted: 4 }],
            ['C', { denied: 1, submitted: 2 }],
        ]);
        const entries = aggregateShiftsToEntries(shifts, undefined, undefined, bids);

        const entryA = entries.find(e => e.employeeId === 'A')!;
        expect(entryA.values.saturday_shifts).toBe(1);
        expect(entryA.values.sunday_shifts).toBe(1);
        expect(entryA.values.night_shifts).toBe(1);
        expect(entryA.values.total_hours).toBe(16); // 960 min / 60
        // 4 of 6 org-wide bids were denied → prior 0.667.
        // A: (3 + 5×0.667) / (4 + 5) = 0.7037
        expect(entryA.values.denial_rate).toBeCloseTo(0.7037, 3);

        const entryB = entries.find(e => e.employeeId === 'B')!;
        expect(entryB.values.saturday_shifts).toBe(0);
        expect(entryB.values.sunday_shifts).toBe(0);
        expect(entryB.values.night_shifts).toBe(0);
        expect(entryB.values.total_hours).toBe(8);
        // B never bid → lands exactly on the org rate, so carries no claim.
        expect(entryB.values.denial_rate).toBeCloseTo(0.6667, 3);

        const entryC = entries.find(e => e.employeeId === 'C')!;
        expect(entryC.values.total_hours).toBe(0);
        // C: (1 + 5×0.667) / (2 + 5) = 0.6190 — below the org rate despite a
        // 50% raw rate, because a 2-bid record is mostly prior.
        expect(entryC.values.denial_rate).toBeCloseTo(0.619, 3);
    });

    it('deducts unpaid breaks from total hours', () => {
        const shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }> = [
            { shiftDate: '2026-06-15', startTime: '09:00', endTime: '17:00', employeeId: 'A', unpaidBreakMinutes: 30, flags: { isSaturday: false, isSunday: false, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
        ];

        const entries = aggregateShiftsToEntries(shifts);
        expect(entries[0].values.total_hours).toBe(7.5); // (480-30)/60
    });
});

// ─── availability denominator (stakeholder decision Q4) ─────────────────────────

describe('computeDebts — availability scaling', () => {
    const entry = (id: string, saturdays: number, availability?: number): EmployeeLedgerEntry => ({
        employeeId: id,
        availability,
        values: {
            saturday_shifts: saturdays, sunday_shifts: 0, night_shifts: 0,
            public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 0, denial_rate: 0,
        },
    });

    it('reduces to the plain mean when everyone is fully available', () => {
        // The backward-compatibility property: a stable workforce must see
        // EXACTLY the numbers it saw before availability existed.
        const withOut = computeDebts([entry('A', 6), entry('B', 0)]);
        const withFull = computeDebts([entry('A', 6, 1), entry('B', 0, 1)]);

        expect(withOut.map(d => d.debt)).toEqual(withFull.map(d => d.debt));
        const a = withOut.find(d => d.employeeId === 'A' && d.metric === 'saturday_shifts')!;
        expect(a.teamAverage).toBe(3);
        expect(a.debt).toBe(3);
    });

    it('two people working at the SAME RATE both carry zero debt', () => {
        // A present all window worked 10; B present half the window worked 5.
        // Neither is over- or under-working. The old flat mean scored B at
        // -2.5, i.e. "owed 2.5 shifts", purely for having been absent.
        const debts = computeDebts([entry('A', 10, 1), entry('B', 5, 0.5)]);
        const sat = debts.filter(d => d.metric === 'saturday_shifts');

        expect(sat.find(d => d.employeeId === 'A')!.debt).toBe(0);
        expect(sat.find(d => d.employeeId === 'B')!.debt).toBe(0);
    });

    it('a new starter is not handed a large negative debt', () => {
        // Joined with ~2 weeks of a 13-week window left (availability 0.15) and
        // worked proportionally. Under the old maths they looked ~5 shifts
        // "owed" and the solver funnelled work at them.
        const debts = computeDebts([
            entry('TENURED_1', 10, 1),
            entry('TENURED_2', 10, 1),
            entry('NEW', 1.5, 0.15),
        ]);
        const newStarter = debts.find(d => d.employeeId === 'NEW' && d.metric === 'saturday_shifts')!;

        expect(newStarter.debt).toBeCloseTo(0, 4);
        expect(Math.abs(newStarter.debt)).toBeLessThan(0.5);
    });

    it('still detects genuine over- and under-working within a short window', () => {
        // Availability does not make someone un-auditable: two employees with
        // the SAME availability who worked different amounts still differ.
        const debts = computeDebts([entry('LOTS', 8, 0.5), entry('FEW', 2, 0.5)]);
        const sat = debts.filter(d => d.metric === 'saturday_shifts');

        expect(sat.find(d => d.employeeId === 'LOTS')!.debt).toBeGreaterThan(0);
        expect(sat.find(d => d.employeeId === 'FEW')!.debt).toBeLessThan(0);
    });

    it('does NOT scale denial_rate — it is already a rate', () => {
        const mk = (id: string, rate: number, availability: number): EmployeeLedgerEntry => ({
            employeeId: id,
            availability,
            values: {
                saturday_shifts: 0, sunday_shifts: 0, night_shifts: 0,
                public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 0,
                denial_rate: rate,
            },
        });
        // Same denial rate, very different availability → same debt. Scaling it
        // would double-count the absence already priced into the rate.
        const debts = computeDebts([mk('A', 0.4, 1), mk('B', 0.4, 0.2)]);
        for (const d of debts.filter(d => d.metric === 'denial_rate')) {
            expect(d.debt).toBe(0);
        }
    });

    it('an employee available for none of the window is neither owed nor owing', () => {
        const debts = computeDebts([entry('PRESENT', 10, 1), entry('ABSENT', 0, 0)]);
        const absent = debts.find(d => d.employeeId === 'ABSENT' && d.metric === 'saturday_shifts')!;
        expect(absent.teamAverage).toBe(0);
        expect(absent.debt).toBe(0);
    });

    it('clamps out-of-range availability rather than trusting it', () => {
        // A bad availability figure must not be able to inflate or invert an
        // employee's expected share — 4 behaves as 1, and -2 behaves as 0.
        const outOfRange = computeDebts([entry('A', 5, 4), entry('B', 5, -2)]);
        const clamped = computeDebts([entry('A', 5, 1), entry('B', 5, 0)]);

        expect(outOfRange.map(d => [d.employeeId, d.metric, d.teamAverage, d.debt]))
            .toEqual(clamped.map(d => [d.employeeId, d.metric, d.teamAverage, d.debt]));
    });

    it('treats missing availability as fully available', () => {
        const implicit = computeDebts([entry('A', 7), entry('B', 1)]);
        const explicit = computeDebts([entry('A', 7, 1), entry('B', 1, 1)]);
        expect(implicit.map(d => d.debt)).toEqual(explicit.map(d => d.debt));
    });

    it('preserves the invariant debt = rollingValue − teamAverage (Q9 auditability)', () => {
        const debts = computeDebts([entry('A', 9, 1), entry('B', 3, 0.4), entry('C', 0, 0.75)]);
        for (const d of debts) {
            expect(d.debt).toBeCloseTo(d.rollingValue - d.teamAverage, 4);
        }
    });
});

// ─── denial rate (stakeholder decision Q5) ──────────────────────────────────────

describe('smoothedDenialRate — the volume exploit is closed', () => {
    it('cannot be farmed by bidding on everything', () => {
        // Two employees lose the SAME SHARE of their bids. Under the old raw
        // COUNT the volume bidder scored 10× higher and captured the bonus;
        // under a rate they are equal, which is the point.
        const prior = 0.5;
        const occasional = smoothedDenialRate({ denied: 3, submitted: 6 }, prior);
        const volumeBidder = smoothedDenialRate({ denied: 30, submitted: 60 }, prior);

        expect(occasional).toBeCloseTo(volumeBidder, 2);
        expect(volumeBidder).toBeCloseTo(0.5, 2);
    });

    it('still rewards genuinely losing more often than the org', () => {
        const prior = 0.5;
        const unlucky = smoothedDenialRate({ denied: 18, submitted: 20 }, prior);
        const lucky = smoothedDenialRate({ denied: 2, submitted: 20 }, prior);

        expect(unlucky).toBeGreaterThan(prior);
        expect(lucky).toBeLessThan(prior);
    });

    it('shrinks a thin record toward the org rate', () => {
        const prior = 0.4;
        // One bid, one loss is NOT evidence of a 100% denial rate.
        const oneBid = smoothedDenialRate({ denied: 1, submitted: 1 }, prior);
        expect(oneBid).toBeLessThan(0.6);
        expect(oneBid).toBeGreaterThan(prior);

        // Forty bids at the same raw rate is evidence.
        const manyBids = smoothedDenialRate({ denied: 40, submitted: 40 }, prior);
        expect(manyBids).toBeGreaterThan(0.9);
    });

    it('places a non-bidder exactly on the org rate, so their debt is zero', () => {
        const prior = 0.35;
        expect(smoothedDenialRate(undefined, prior)).toBeCloseTo(prior, 6);
        expect(smoothedDenialRate({ denied: 0, submitted: 0 }, prior)).toBeCloseTo(prior, 6);
    });

    it('orgDenialRate pools across employees, not per-employee means', () => {
        const outcomes = new Map([
            ['A', { denied: 1, submitted: 1 }],   // 100% of a tiny record
            ['B', { denied: 10, submitted: 100 }], // 10% of a large one
        ]);
        // Pooled = 11/101 ≈ 0.109. A per-employee mean would give 0.55 and let
        // one employee with one bid dominate the baseline.
        expect(orgDenialRate(outcomes)).toBeCloseTo(0.109, 3);
    });
});

// ─── debtToObjectiveCoeff ───────────────────────────────────────────────────────

describe('debtToObjectiveCoeff', () => {
    it('returns 0 for zero debt', () => {
        expect(debtToObjectiveCoeff(0, 'saturday_shifts')).toBe(0);
    });

    it('returns positive coefficient for positive debt (penalty)', () => {
        // Employee has done 2 more Saturdays than average
        const coeff = debtToObjectiveCoeff(2, 'saturday_shifts', 50);
        expect(coeff).toBe(400); // 2 × 200 × 1.0
        expect(coeff).toBeGreaterThan(0);
    });

    it('returns negative coefficient for negative debt (bonus)', () => {
        // Employee has done 2 fewer Saturdays than average
        const coeff = debtToObjectiveCoeff(-2, 'saturday_shifts', 50);
        expect(coeff).toBe(-400);
        expect(coeff).toBeLessThan(0);
    });

    it('scales with fairness weight', () => {
        const coeff50 = debtToObjectiveCoeff(1, 'saturday_shifts', 50); // weight=50 → mult=1.0
        const coeff100 = debtToObjectiveCoeff(1, 'saturday_shifts', 100); // weight=100 → mult=2.0
        const coeff0 = debtToObjectiveCoeff(1, 'saturday_shifts', 0); // weight=0 → mult=0.5

        expect(coeff100).toBe(coeff50 * 2);
        expect(coeff0).toBe(Math.round(coeff50 * 0.5));
    });

    /**
     * Stakeholder decision Q6. These ratios are not ours to choose — EBA cl 41
     * prices Saturday at +25%, Sunday at +50% and a public holiday at +150%,
     * so fairness weights them 1 : 2 : 6. If the agreement is renegotiated,
     * this test is the thing that should fail.
     */
    it('weights Saturday : Sunday : public holiday as 1 : 2 : 6, per EBA cl 41', () => {
        const sat = debtToObjectiveCoeff(1, 'saturday_shifts');
        const sun = debtToObjectiveCoeff(1, 'sunday_shifts');
        const ph  = debtToObjectiveCoeff(1, 'public_holiday_shifts');

        expect(sun).toBe(sat * 2);
        expect(ph).toBe(sat * 6);
    });

    it('keeps the mean weekend weight at its historical scale', () => {
        // Sat 200 + Sun 400 averages the 300 the single `weekend_shifts` metric
        // used, so splitting the metric changed the RATIO without inflating the
        // fairness term against cost and coverage.
        const sat = debtToObjectiveCoeff(1, 'saturday_shifts');
        const sun = debtToObjectiveCoeff(1, 'sunday_shifts');
        expect((sat + sun) / 2).toBe(300);
    });
});

// ─── debtsToMap ─────────────────────────────────────────────────────────────────

describe('debtsToMap', () => {
    it('groups debts by employee', () => {
        const debts: FairnessDebt[] = [
            { employeeId: 'A', metric: 'saturday_shifts', rollingValue: 5, teamAverage: 3, debt: 2 },
            { employeeId: 'A', metric: 'night_shifts', rollingValue: 1, teamAverage: 2, debt: -1 },
            { employeeId: 'B', metric: 'saturday_shifts', rollingValue: 1, teamAverage: 3, debt: -2 },
        ];

        const map = debtsToMap(debts);

        expect(map.get('A')).toEqual({ saturday_shifts: 2, night_shifts: -1 });
        expect(map.get('B')).toEqual({ saturday_shifts: -2 });
        expect(map.has('C')).toBe(false);
    });
});

// ─── projectFairnessImpact (bid-review what-if) ──────────────────────────────────

describe('projectFairnessImpact', () => {
    // Two teammates each with 2 Saturdays already → team avg Saturday = 2.
    const team = (): EmployeeLedgerEntry[] => [
        { employeeId: 'A', values: { saturday_shifts: 2, sunday_shifts: 0, night_shifts: 0, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 40, denial_rate: 0 } },
        { employeeId: 'B', values: { saturday_shifts: 2, sunday_shifts: 0, night_shifts: 1, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 40, denial_rate: 0 } },
    ];

    it('a Saturday shift bumps the bidder Saturday count and worsens that debt', () => {
        // 2026-06-13 = Saturday, 09:00–17:00 (day, not night)
        const impact = projectFairnessImpact(team(), 'A', {
            shiftDate: '2026-06-13', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 30,
        });
        expect(impact.changed).toContain('saturday_shifts');
        expect(impact.changed).toContain('total_hours');
        expect(impact.changed).not.toContain('night_shifts');
        expect(impact.changed).not.toContain('sunday_shifts');
        expect(impact.before.saturday_shifts.value).toBe(2);
        expect(impact.after.saturday_shifts.value).toBe(3);
        // A goes from on-par to above the (recomputed) team average → debt rises.
        expect(impact.after.saturday_shifts.debt).toBeGreaterThan(impact.before.saturday_shifts.debt);
    });

    it('a Sunday shift moves Sunday only, leaving Saturday standing untouched', () => {
        // 2026-06-14 = Sunday. Under the old binary `weekend_shifts` this was
        // indistinguishable from the Saturday case above.
        const impact = projectFairnessImpact(team(), 'A', {
            shiftDate: '2026-06-14', startTime: '09:00', endTime: '17:00',
        });
        expect(impact.changed).toContain('sunday_shifts');
        expect(impact.changed).not.toContain('saturday_shifts');
        expect(impact.after.sunday_shifts.value).toBe(1);
        expect(impact.after.saturday_shifts.value).toBe(2);
    });

    it('a weekday night shift flags night, not a weekend day', () => {
        // 2026-06-15 = Monday, 22:00–06:00 overlaps the 00:00–06:00 night zone
        const impact = projectFairnessImpact(team(), 'A', {
            shiftDate: '2026-06-15', startTime: '22:00', endTime: '06:00',
        });
        expect(impact.changed).toContain('night_shifts');
        expect(impact.changed).not.toContain('saturday_shifts');
        expect(impact.changed).not.toContain('sunday_shifts');
        expect(impact.after.night_shifts.value).toBe(1);
    });

    it('handles a bidder with no prior history (added as a zero entry)', () => {
        const impact = projectFairnessImpact(team(), 'NEW', {
            shiftDate: '2026-06-13', startTime: '09:00', endTime: '17:00',
        });
        expect(impact.before.saturday_shifts.value).toBe(0);
        expect(impact.after.saturday_shifts.value).toBe(1);
        // Below the team average both before and after → still owes Saturday work.
        expect(impact.after.saturday_shifts.debt).toBeLessThan(0);
    });

    it('is read-only — does not mutate the input entries', () => {
        const entries = team();
        projectFairnessImpact(entries, 'A', { shiftDate: '2026-06-13', startTime: '09:00', endTime: '17:00' });
        expect(entries[0].values.saturday_shifts).toBe(2);
    });
});
