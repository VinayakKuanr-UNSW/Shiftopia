import { describe, expect, it } from 'vitest';
import {
    buildFatigueByEmployee,
    dayFairnessContribution,
    fairnessBand,
    unsociableDebt,
    utilizationStatus,
    weekUtilization,
} from '../team-metrics';
import type { RawTeamShift } from '../../model/team-availability.types';

/**
 * These tests exist mostly to pin the GRANULARITY, not the arithmetic.
 *
 * Fatigue is a real per-day quantity. Utilization is per ISO week because its
 * denominator is a weekly contract. Fairness is a 91-day cohort comparison, so
 * what a cell can show is a day's CONTRIBUTION, never a fairness score. Any
 * future change that quietly pushes one of them to a finer grain should fail
 * here.
 */

let seq = 0;
const shift = (over: Partial<RawTeamShift> & { shiftDate: string }): RawTeamShift => ({
    id: `s-${++seq}`,
    startTime: '09:00',
    endTime: '17:00',
    assignedEmployeeId: 'p1',
    roleName: null,
    netMinutes: 450,
    isDraft: false,
    deptName: null,
    subDeptName: null,
    unpaidBreakMinutes: 30,
    ...over,
});

const members = (...ids: string[]) => ids.map((profileId) => ({ profileId }));

// ── FATIGUE — genuinely per (member, day) ───────────────────────────────────

describe('buildFatigueByEmployee', () => {
    it('scores each worked day separately', () => {
        const out = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-10' }), shift({ shiftDate: '2026-08-12' })],
            members('p1'),
            ['2026-08-10', '2026-08-11', '2026-08-12'],
        );
        const p1 = out.get('p1')!;
        expect(p1.byDate.has('2026-08-10')).toBe(true);
        expect(p1.byDate.has('2026-08-12')).toBe(true);
        expect(p1.byDate.get('2026-08-10')!.score).toBeGreaterThan(0);
    });

    // A fatigue number on a day off is a decayed residue; painting it across
    // empty cells would make a fortnight of leave look like a risk gradient.
    it('leaves days the member did not work with no score at all', () => {
        const out = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-10' })],
            members('p1'),
            ['2026-08-10', '2026-08-11'],
        );
        expect(out.get('p1')!.byDate.has('2026-08-11')).toBe(false);
    });

    it('scores a night shift above the same-length day shift', () => {
        const day = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-10', startTime: '09:00', endTime: '17:00' })],
            members('p1'),
            ['2026-08-10'],
        );
        const night = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-10', startTime: '22:00', endTime: '06:00' })],
            members('p1'),
            ['2026-08-10'],
        );
        expect(night.get('p1')!.byDate.get('2026-08-10')!.score)
            .toBeGreaterThan(day.get('p1')!.byDate.get('2026-08-10')!.score);
    });

    /**
     * The model reads a 7-day trailing window, which is why the grid feeds it
     * the WIDENED shift set and not just the visible days.
     *
     * The pattern is a clopening: a night shift ending 06:00 followed by a
     * 09:00 start is three hours of rest against an 11-hour standard, so the
     * previous day's fatigue is still mostly there when the next shift begins.
     * (A LONG gap genuinely does clear it — 16 hours of rest recovers more than
     * a night shift accumulates, which is the model working, not a bug.)
     */
    it('carries fatigue in from a day that is not on screen', () => {
        const visible = ['2026-08-14'];
        const alone = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-14', startTime: '09:00', endTime: '17:00' })],
            members('p1'),
            visible,
        );
        const afterClopening = buildFatigueByEmployee(
            [
                // Off-screen, ends 06:00 on the 14th.
                shift({ shiftDate: '2026-08-13', startTime: '22:00', endTime: '06:00' }),
                shift({ shiftDate: '2026-08-14', startTime: '09:00', endTime: '17:00' }),
            ],
            members('p1'),
            visible,
        );
        expect(afterClopening.get('p1')!.byDate.get('2026-08-14')!.score)
            .toBeGreaterThan(alone.get('p1')!.byDate.get('2026-08-14')!.score);
    });

    it('lets a full rest break clear the previous day', () => {
        // 16 hours between shifts is above the 11-hour standard the recovery
        // rate is anchored to, so the second day starts from baseline.
        const rested = buildFatigueByEmployee(
            [
                shift({ shiftDate: '2026-08-13', startTime: '22:00', endTime: '06:00' }),
                shift({ shiftDate: '2026-08-14', startTime: '22:00', endTime: '06:00' }),
            ],
            members('p1'),
            ['2026-08-14'],
        );
        const single = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-14', startTime: '22:00', endTime: '06:00' })],
            members('p1'),
            ['2026-08-14'],
        );
        expect(rested.get('p1')!.byDate.get('2026-08-14')!.score)
            .toBeCloseTo(single.get('p1')!.byDate.get('2026-08-14')!.score, 1);
    });

    it('gives a member with no shifts an entry rather than nothing', () => {
        const out = buildFatigueByEmployee([], members('p1'), ['2026-08-10']);
        expect(out.get('p1')).toEqual({ byDate: new Map(), worstBand: 'ok', peak: 0 });
    });

    it('ignores unassigned shifts', () => {
        const out = buildFatigueByEmployee(
            [shift({ shiftDate: '2026-08-10', assignedEmployeeId: null })],
            members('p1'),
            ['2026-08-10'],
        );
        expect(out.get('p1')!.peak).toBe(0);
    });
});

// ── UTILIZATION — per ISO week, never per day ───────────────────────────────

describe('weekUtilization', () => {
    it('measures a full week against the weekly contract', () => {
        expect(weekUtilization(38, 38).pct).toBeCloseTo(100);
        expect(weekUtilization(38, 38).status).toBe('ideal');
    });

    it('bands under, over and well over', () => {
        expect(weekUtilization(20, 38).status).toBe('under');
        expect(weekUtilization(42, 38).status).toBe('over');
        expect(weekUtilization(50, 38).status).toBe('critical');
    });

    /**
     * The reason there is no per-day utilization. A casual carries
     * `contracted_weekly_hours = 0` in production, so a daily denominator would
     * be 0/7 and every hour they work reads as infinite over-utilization.
     */
    it('reports "no contract" rather than 0% when there is nothing to measure against', () => {
        expect(weekUtilization(8, 0)).toEqual({ pct: 0, status: 'none' });
        expect(weekUtilization(8, undefined)).toEqual({ pct: 0, status: 'none' });
    });

    it('never reports a contractless person as under-utilized', () => {
        expect(utilizationStatus(0, false)).toBe('none');
        expect(utilizationStatus(0, true)).toBe('under');
    });
});

// ── FAIRNESS — contribution per day, standing per person ────────────────────

describe('dayFairnessContribution', () => {
    it('returns nothing for a day with no shifts', () => {
        expect(dayFairnessContribution([])).toBeNull();
    });

    it('gives an ordinary weekday shift no unsociable weight', () => {
        // 2026-08-12 is a Wednesday.
        const c = dayFairnessContribution([shift({ shiftDate: '2026-08-12' })])!;
        expect(c.weight).toBe(0);
        expect(c.labels).toEqual([]);
    });

    // EBA cl 41 — Sat : Sun : PH = 1 : 2 : 6.
    it('weights Saturday below Sunday', () => {
        const sat = dayFairnessContribution([shift({ shiftDate: '2026-08-15' })])!;
        const sun = dayFairnessContribution([shift({ shiftDate: '2026-08-16' })])!;
        expect(sat.isSaturday).toBe(true);
        expect(sun.isSunday).toBe(true);
        expect(sun.weight).toBeGreaterThan(sat.weight);
    });

    it('adds a night loading on top of the day-of-week loading', () => {
        const satDay = dayFairnessContribution([
            shift({ shiftDate: '2026-08-15', startTime: '09:00', endTime: '17:00' }),
        ])!;
        const satNight = dayFairnessContribution([
            shift({ shiftDate: '2026-08-15', startTime: '22:00', endTime: '06:00' }),
        ])!;
        expect(satNight.weight).toBeGreaterThan(satDay.weight);
        expect(satNight.labels).toContain('Night');
    });

    // The ledger's night zone is 00:00–06:00, so a late-evening shift that
    // never crosses midnight is NOT night work. Worth pinning: "starts at 22:00"
    // is the intuitive reading and it is not this codebase's.
    it('does not count a late evening shift that never reaches midnight', () => {
        const c = dayFairnessContribution([
            shift({ shiftDate: '2026-08-15', startTime: '22:00', endTime: '23:30' }),
        ])!;
        expect(c.isNight).toBe(false);
    });

    it('folds several shifts on one day into a single classification', () => {
        const c = dayFairnessContribution([
            shift({ shiftDate: '2026-08-15', startTime: '06:00', endTime: '10:00' }),
            shift({ shiftDate: '2026-08-15', startTime: '22:00', endTime: '02:00' }),
        ])!;
        expect(c.isSaturday).toBe(true);
        expect(c.isNight).toBe(true);
    });
});

describe('unsociableDebt', () => {
    it('is null when the person has no ledger entry', () => {
        expect(unsociableDebt(undefined)).toBeNull();
        expect(unsociableDebt({ debtByMetric: {}, windowStart: null, windowEnd: null })).toBeNull();
    });

    it('weights the metrics by their cl 41 loading', () => {
        const debt = unsociableDebt({
            debtByMetric: { sunday_shifts: 1, saturday_shifts: 1 },
            windowStart: null,
            windowEnd: null,
        });
        // Sunday counts double a Saturday: 1*2 + 1*1.
        expect(debt).toBe(3);
    });

    /**
     * `total_hours` and `denial_rate` are fairness metrics but they are not
     * UNSOCIABILITY. Folding them in would make someone who simply works a lot
     * indistinguishable from someone who works every Sunday.
     */
    it('excludes total_hours and denial_rate from the unsociability figure', () => {
        expect(
            unsociableDebt({
                debtByMetric: { total_hours: 100, denial_rate: 0.5 },
                windowStart: null,
                windowEnd: null,
            }),
        ).toBeNull();
    });

    it('carries the sign — negative means carrying less than their share', () => {
        const debt = unsociableDebt({
            debtByMetric: { public_holiday_shifts: -1 },
            windowStart: null,
            windowEnd: null,
        });
        expect(debt).toBe(-6);
    });
});

describe('fairnessBand', () => {
    // Debt is a deviation from the team mean, so exact zero is the ideal and
    // the band has to be a tolerance — a rounding-level 0.1 is not unfairness.
    it('treats a near-zero debt as balanced', () => {
        expect(fairnessBand(0)).toBe('balanced');
        expect(fairnessBand(0.5)).toBe('balanced');
        expect(fairnessBand(-0.9)).toBe('balanced');
    });

    it('separates carrying more from carrying less', () => {
        expect(fairnessBand(4)).toBe('over');
        expect(fairnessBand(-4)).toBe('under');
    });

    it('reads a missing standing as balanced rather than as a problem', () => {
        expect(fairnessBand(null)).toBe('balanced');
    });
});
