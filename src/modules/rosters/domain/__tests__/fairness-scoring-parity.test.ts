/**
 * Audit F-10 / F-11 / F-13 — one classifier, one coefficient table.
 *
 * The greedy fallback used to carry private copies of both:
 *
 *   F-11  `new Date(shift_date).getDay()` parses as UTC midnight and reads back
 *         in LOCAL time, so a Saturday shift classified as Friday anywhere west
 *         of UTC; and `startH < 6 || endH <= startH` called every shift merely
 *         ENDING at midnight (18:00–00:00 — a very common close) night work,
 *         which neither the ledger nor the solver does.
 *   F-13  coefficients of 50/50/20 against the solver's 300/300/500/200, so
 *         fairness was weighted 6× weaker (and preference equity 10× weaker)
 *         whenever the fallback ran — which is precisely when the optimizer is
 *         unhealthy and nobody is watching.
 *   F-10  a leftover duplicated line counted the negative-weekend-debt bonus
 *         TWICE, so the fallback over-preferred weekend assignment 2:1 against
 *         night and was asymmetric within the metric (the penalty branch was
 *         not doubled).
 *
 * Both engines now score through `shiftFairnessPenaltyCents`.
 */

import { describe, expect, it } from 'vitest';
import {
    classifyShift,
    isNightShift,
    isWeekendShift,
    shiftFairnessPenaltyCents,
    debtToObjectiveCoeff,
    strategyMult,
} from '../fairness-ledger';

describe('F-11: one classifier', () => {
    it('a shift ending at midnight is NOT night work', () => {
        // The fallback's old `endH <= startH` cross-midnight test called all of
        // these night shifts.
        expect(isNightShift('18:00', '00:00')).toBe(false);
        expect(isNightShift('20:00', '00:00')).toBe(false);
        expect(isNightShift('12:00', '00:00')).toBe(false);
    });

    it('a shift that genuinely reaches into 00:00–06:00 IS night work', () => {
        expect(isNightShift('22:00', '06:00')).toBe(true);
        expect(isNightShift('23:00', '02:00')).toBe(true);
        expect(isNightShift('05:00', '13:00')).toBe(true);
        expect(isNightShift('00:00', '08:00')).toBe(true);
    });

    it('weekend classification is timezone-independent', () => {
        // 2026-05-16 is a Saturday, 2026-05-17 a Sunday. Parsed at local noon,
        // these hold in every timezone; `new Date('2026-05-16')` would report
        // Friday anywhere west of UTC.
        expect(isWeekendShift('2026-05-16')).toBe(true);
        expect(isWeekendShift('2026-05-17')).toBe(true);
        expect(isWeekendShift('2026-05-15')).toBe(false);
        expect(isWeekendShift('2026-05-18')).toBe(false);
    });
});

describe('F-13: one coefficient table', () => {
    /**
     * These numbers are duplicated in model_builder.py SC-11 and SC-1. If one
     * side is edited without the other, the CP-SAT solver and the greedy
     * fallback rank the same two candidates differently and a fallback run
     * silently produces a different roster. This test is the tripwire.
     */
    it('matches the solver — 200/400 Sat/Sun, 300 night, 1200 PH, 2000 denial rate', () => {
        expect(debtToObjectiveCoeff(1, 'saturday_shifts')).toBe(200);
        expect(debtToObjectiveCoeff(1, 'sunday_shifts')).toBe(400);
        expect(debtToObjectiveCoeff(1, 'night_shifts')).toBe(300);
        expect(debtToObjectiveCoeff(1, 'public_holiday_shifts')).toBe(1200);
        expect(debtToObjectiveCoeff(1, 'denial_rate')).toBe(2000);
    });

    it('sign convention: positive debt penalises, negative debt rewards', () => {
        expect(debtToObjectiveCoeff(2, 'saturday_shifts')).toBeGreaterThan(0);
        expect(debtToObjectiveCoeff(-2, 'saturday_shifts')).toBeLessThan(0);
        expect(debtToObjectiveCoeff(0, 'saturday_shifts')).toBe(0);
    });

    it('strategyMult mirrors the solver: 0→0.5×, 50→1.0×, 100→2.0×', () => {
        expect(strategyMult(0)).toBeCloseTo(0.5, 6);
        expect(strategyMult(50)).toBeCloseTo(1.0, 6);
        expect(strategyMult(100)).toBeCloseTo(2.0, 6);
    });
});

describe('F-10 / Q6: undesirability weighting', () => {
    const saturdayDay = classifyShift('2026-05-16', '09:00', '17:00');  // Sat, not night
    const sundayDay = classifyShift('2026-05-17', '09:00', '17:00');    // Sun, not night
    const weekdayNight = classifyShift('2026-05-13', '22:00', '06:00'); // Wed→Thu night

    it('the penalty branch mirrors the bonus branch exactly', () => {
        const owed = shiftFairnessPenaltyCents({ saturday_shifts: -2 }, saturdayDay);
        const overworked = shiftFairnessPenaltyCents({ saturday_shifts: 2 }, saturdayDay);

        expect(overworked).toBe(-owed);
    });

    it('a Sunday of debt moves the objective twice as far as a Saturday (cl 41)', () => {
        const sat = shiftFairnessPenaltyCents({ saturday_shifts: 2 }, saturdayDay);
        const sun = shiftFairnessPenaltyCents({ sunday_shifts: 2 }, sundayDay);

        expect(sun).toBe(sat * 2);
    });

    it('Saturday debt does not leak into a Sunday shift, or vice versa', () => {
        // The whole point of splitting the metric: someone who has worked many
        // Saturdays and no Sundays must not be steered away from a Sunday.
        expect(shiftFairnessPenaltyCents({ saturday_shifts: 5 }, sundayDay)).toBe(0);
        expect(shiftFairnessPenaltyCents({ sunday_shifts: 5 }, saturdayDay)).toBe(0);
    });

    it('only the metrics a shift actually moves contribute', () => {
        const weekday = classifyShift('2026-05-13', '09:00', '17:00');
        // A plain weekday day shift is untouched by day/night/PH debt —
        // mirrors SC-11, which only iterates "undesirable" shifts.
        expect(shiftFairnessPenaltyCents(
            { saturday_shifts: 5, sunday_shifts: 5, night_shifts: 5, public_holiday_shifts: 5 },
            weekday,
        )).toBe(0);
    });

    it('a shift on several undesirable axes sums their debts', () => {
        const satNight = classifyShift('2026-05-16', '22:00', '06:00');
        expect(satNight.isSaturday).toBe(true);
        expect(satNight.isSunday).toBe(false);
        expect(satNight.isNight).toBe(true);

        // 200 (Sat) + 300 (night)
        expect(shiftFairnessPenaltyCents({ saturday_shifts: 1, night_shifts: 1 }, satNight))
            .toBe(500);
    });

    it('night is weighted independently of the calendar day it falls on', () => {
        // Night is the cl 41.4 allowance, not a cl 41 day loading — the burden
        // is circadian, so an equal night debt costs the same whatever day it is.
        const satNight = classifyShift('2026-05-16', '22:00', '06:00');
        expect(shiftFairnessPenaltyCents({ night_shifts: -2 }, satNight))
            .toBe(shiftFairnessPenaltyCents({ night_shifts: -2 }, weekdayNight));
    });

    it('missing debts are inert, never a crash', () => {
        expect(shiftFairnessPenaltyCents(undefined, saturdayDay)).toBe(0);
        expect(shiftFairnessPenaltyCents({}, saturdayDay)).toBe(0);
    });
});

describe('F-21: public holidays come from the shared calendar, not a 2026 literal', () => {
    it('classifies holidays beyond 2026 (the old literal expired 2027-01-01)', () => {
        expect(classifyShift('2027-12-25', '09:00', '17:00').isPublicHoliday).toBe(true);
        expect(classifyShift('2028-01-01', '09:00', '17:00').isPublicHoliday).toBe(true);
        expect(classifyShift('2030-04-25', '09:00', '17:00').isPublicHoliday).toBe(true);
    });

    it('still recognises 2026 holidays and ordinary days', () => {
        expect(classifyShift('2026-12-25', '09:00', '17:00').isPublicHoliday).toBe(true);
        expect(classifyShift('2026-05-13', '09:00', '17:00').isPublicHoliday).toBe(false);
    });

    it('an explicit override still wins', () => {
        const custom = new Set(['2026-07-04']);
        expect(classifyShift('2026-07-04', '09:00', '17:00', custom).isPublicHoliday).toBe(true);
        expect(classifyShift('2026-12-25', '09:00', '17:00', custom).isPublicHoliday).toBe(false);
    });
});
