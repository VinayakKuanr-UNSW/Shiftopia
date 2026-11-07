import { describe, expect, it } from 'vitest';
import {
    FAIRNESS_BAND_LABEL,
    buildFatigueByEmployee,
    dayFairnessContribution,
    fairnessBand,
    holdsCasualContract,
    unsociableDebt,
    utilizationStatus,
    weekUtilization,
    type MemberFairness,
} from '../team-metrics';
import type { RawTeamShift } from '../../model/team-availability.types';

/**
 * These tests exist mostly to pin the GRANULARITY, not the arithmetic.
 *
 * Fatigue is a real per-day quantity. Utilization is per ISO week because its
 * denominator is a weekly contract. Fairness is a per-person standing against
 * their fair share of casual work, so what a cell can show is a day's
 * CONTRIBUTION, never a fairness score. Any
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
    targetEmploymentType: 'Casual',
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

    // Fairness is casual-only: a Full-Time shift contributes nothing at all.
    it('returns nothing for a day with no casual shift', () => {
        expect(dayFairnessContribution([shift({ shiftDate: '2026-08-16', targetEmploymentType: 'FT' })])).toBeNull();
    });

    it('gives an ordinary weekday shift no unsociable weight', () => {
        // 2026-08-12 is a Wednesday.
        const c = dayFairnessContribution([shift({ shiftDate: '2026-08-12' })])!;
        expect(c.weight).toBe(0);
        expect(c.labels).toEqual([]);
    });

    // Weighted HOURS, at the solver's EBA cl 41 ratio — Sat : Sun = 1 : 2.
    it('weights each unsociable hour, Sunday double Saturday', () => {
        const sat = dayFairnessContribution([shift({ shiftDate: '2026-08-15' })])!;
        const sun = dayFairnessContribution([shift({ shiftDate: '2026-08-16' })])!;
        expect(sat).toEqual({ weight: 7.5, labels: ['Saturday'] });   // 7.5 net hours × 1
        expect(sun).toEqual({ weight: 15, labels: ['Sunday'] });      // 7.5 net hours × 2
    });

    it('splits an overnight shift across the days and adds its night hours', () => {
        // Sat 22:00 → Sun 06:00, 30 min unpaid: 2h Sat, 6h Sun, 8h night, ×450/480.
        const c = dayFairnessContribution([
            shift({ shiftDate: '2026-08-15', startTime: '22:00', endTime: '06:00' }),
        ])!;
        expect(c.labels).toEqual(['Sunday', 'Saturday', 'Night']);
        expect(c.weight).toBe(24.4); // 1.875×1 + 5.625×2 + 7.5×1.5
    });

    // Night is 22:00–06:00 now, the same window the ledger and solver use.
    it('counts a late evening shift as night work from 22:00', () => {
        const c = dayFairnessContribution([
            shift({ shiftDate: '2026-08-12', startTime: '20:00', endTime: '23:30', netMinutes: 210, unpaidBreakMinutes: 0 }),
        ])!;
        expect(c.labels).toEqual(['Night']);
        expect(c.weight).toBe(2.3); // 1.5 night hours × 1.5
    });

    it('folds several casual shifts on one day into one contribution', () => {
        const c = dayFairnessContribution([
            shift({ shiftDate: '2026-08-12', startTime: '06:00', endTime: '10:00', netMinutes: 240, unpaidBreakMinutes: 0 }),
            shift({ shiftDate: '2026-08-12', startTime: '22:00', endTime: '23:00', netMinutes: 60, unpaidBreakMinutes: 0 }),
        ])!;
        expect(c).toEqual({ weight: 1.5, labels: ['Night'] });
    });
});

describe('unsociableDebt', () => {
    type Entry = { debtHours: number; confidence: number };
    const member = (entries: Partial<Record<keyof MemberFairness['byMetric'], Entry>>): MemberFairness => ({
        byMetric: Object.fromEntries(
            Object.entries(entries).map(([m, e]) => [m, { ...e, opportunityCount: 10 }]),
        ) as MemberFairness['byMetric'],
        windowStart: null,
        windowEnd: null,
    });

    it('is null when the person has no ledger entry', () => {
        expect(unsociableDebt(undefined)).toBeNull();
        expect(unsociableDebt(member({}))).toBeNull();
    });

    it('weights the debts by the solver’s ratio — Sat 1, Sun 2, PH 6, night 1.5', () => {
        expect(unsociableDebt(member({
            sunday_hours: { debtHours: 3, confidence: 1 },
            saturday_hours: { debtHours: 1, confidence: 1 },
            night_hours: { debtHours: 2, confidence: 1 },
        }))).toBe(10); // 3×2 + 1×1 + 2×1.5
    });

    it('lets a thin record steer only as far as its confidence', () => {
        expect(unsociableDebt(member({ sunday_hours: { debtHours: 4, confidence: 0.5 } }))).toBe(4);
    });

    /**
     * Total and overtime hours are fairness metrics but they are not
     * UNSOCIABILITY. Folding them in would make someone who simply works a lot
     * indistinguishable from someone who works every Sunday.
     */
    it('excludes total and overtime hours from the unsociability figure', () => {
        expect(unsociableDebt(member({
            total_hours: { debtHours: 100, confidence: 1 },
            overtime_hours: { debtHours: 5, confidence: 1 },
        }))).toBeNull();
    });

    it('carries the sign — negative means carrying less than their share', () => {
        expect(unsociableDebt(member({ public_holiday_hours: { debtHours: -1, confidence: 1 } }))).toBe(-6);
    });
});

describe('fairnessBand', () => {
    const member = (debtHours: number, confidence = 1): MemberFairness =>
        ({ byMetric: { sunday_hours: { debtHours, confidence, opportunityCount: 10 } }, windowStart: null, windowEnd: null });

    // Debt is a deviation from a fair share, so zero is the ideal and the band
    // is a tolerance — half a shift (4 weighted hours) is not unfairness.
    it('treats a debt within half a shift as balanced', () => {
        expect(fairnessBand(member(0), true)).toBe('balanced');
        expect(fairnessBand(member(2), true)).toBe('balanced');   // weighted 4
        expect(fairnessBand(member(-2), true)).toBe('balanced');
    });

    it('separates carrying more from carrying less', () => {
        expect(fairnessBand(member(4), true)).toBe('over');
        expect(fairnessBand(member(-4), true)).toBe('under');
    });

    // Too few opportunities is neither balanced nor unbalanced: it is unknown.
    it('says history is still building rather than calling it balanced', () => {
        expect(fairnessBand(undefined, true)).toBe('building');
        expect(fairnessBand(member(8, 0.2), true)).toBe('building');
        expect(FAIRNESS_BAND_LABEL.building).toBe('Building history');
    });

    // Fairness is casual-only: a Full-Time or Part-Time member is outside the
    // model, not a casual whose history is still building.
    it('reports non-casual members as casual-only, whatever the ledger holds', () => {
        expect(fairnessBand(undefined, false)).toBe('na');
        expect(fairnessBand(member(8), false)).toBe('na');
        expect(FAIRNESS_BAND_LABEL.na).toBe('Casual only');
    });
});

describe('holdsCasualContract', () => {
    it('is true when any contract in scope is Casual, even beside a Full-Time one', () => {
        expect(holdsCasualContract({ employmentStatus: 'Full-Time', contracts: [
            { roleId: 'r1', roleName: 'Supervisor', employmentStatus: 'Full-Time' },
            { roleId: 'r2', roleName: 'Team Leader', employmentStatus: 'Casual' },
        ] })).toBe(true);
    });

    it('is false for Full-Time / Part-Time only, and falls back to the member status without contracts', () => {
        expect(holdsCasualContract({ employmentStatus: 'Casual', contracts: [
            { roleId: 'r1', roleName: 'Supervisor', employmentStatus: 'Part-Time' },
        ] })).toBe(false);
        expect(holdsCasualContract({ employmentStatus: 'Casual' })).toBe(true);
        expect(holdsCasualContract({ employmentStatus: 'Full-Time', contracts: [] })).toBe(false);
    });
});
