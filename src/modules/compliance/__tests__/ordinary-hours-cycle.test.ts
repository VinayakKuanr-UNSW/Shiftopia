/**
 * The cycle arithmetic is the keystone of the ordinary-hours remediation: the
 * solver, the V8 auditor and the Availability Manager all bucket against it, so
 * an off-by-one here becomes three disagreeing compliance verdicts.
 *
 * These pin the two things most likely to drift — the Monday invariant, and
 * timezone independence.
 */
import { describe, expect, it } from 'vitest';
import {
    ORD_CYCLE_ANCHOR_DEFAULT,
    ORD_CYCLE_CEILINGS,
    ORD_CYCLE_WEEKS_DEFAULT,
    cycleBoundsFor,
    cycleCeilingHours,
    cycleIndexFor,
    cycleLabel,
    normaliseCycleAnchor,
    normaliseCycleWeeks,
    resolveGoverningCycleWeeks,
    type OrdinaryCycleWeeks,
} from '../ordinary-hours-cycle';

const ANCHOR = ORD_CYCLE_ANCHOR_DEFAULT; // 2024-01-01, a Monday

describe('the shared epoch', () => {
    it('is a Monday, which is what makes every cycle edge a Monday', () => {
        // Independent of the module's own arithmetic: ask the calendar.
        expect(new Date(`${ANCHOR}T00:00:00Z`).getUTCDay()).toBe(1);
    });

    it('matches the DB default so TS and Postgres bucket identically', () => {
        expect(ANCHOR).toBe('2024-01-01');
    });
});

describe('normaliseCycleWeeks', () => {
    it('accepts the four rungs cl 35.x(a) enumerates', () => {
        expect([1, 2, 3, 4].map(normaliseCycleWeeks)).toEqual([1, 2, 3, 4]);
    });

    it('accepts a PostgREST-stringified smallint', () => {
        expect(normaliseCycleWeeks('2')).toBe(2);
    });

    it('falls back to four weeks for out-of-range, null and junk', () => {
        for (const bad of [0, 5, 8, -1, null, undefined, '', 'x', NaN]) {
            expect(normaliseCycleWeeks(bad)).toBe(ORD_CYCLE_WEEKS_DEFAULT);
        }
    });
});

describe('normaliseCycleAnchor', () => {
    it('keeps a Monday', () => {
        expect(normaliseCycleAnchor('2026-08-24')).toBe('2026-08-24'); // a Monday
    });

    it('snaps a non-Monday back to the epoch rather than shifting every edge', () => {
        expect(normaliseCycleAnchor('2026-08-25')).toBe(ANCHOR); // Tuesday
        expect(normaliseCycleAnchor('2026-08-30')).toBe(ANCHOR); // Sunday
    });

    it('tolerates a full timestamp by taking the date part', () => {
        expect(normaliseCycleAnchor('2026-08-24T09:30:00+10:00')).toBe('2026-08-24');
    });

    it('falls back for null, junk and short strings', () => {
        for (const bad of [null, undefined, '', 'nope', 123]) {
            expect(normaliseCycleAnchor(bad)).toBe(ANCHOR);
        }
    });
});

describe('cycleIndexFor', () => {
    it('puts the anchor day itself in cycle 0', () => {
        expect(cycleIndexFor(ANCHOR, ANCHOR, 4)).toBe(0);
    });

    it('advances one cycle per span, not per week', () => {
        expect(cycleIndexFor('2024-01-28', ANCHOR, 4)).toBe(0); // day 27 — last day
        expect(cycleIndexFor('2024-01-29', ANCHOR, 4)).toBe(1); // day 28 — rolls
    });

    it('rolls weekly on a one-week cycle', () => {
        expect(cycleIndexFor('2024-01-07', ANCHOR, 1)).toBe(0);
        expect(cycleIndexFor('2024-01-08', ANCHOR, 1)).toBe(1);
    });

    it('rolls fortnightly on a two-week cycle', () => {
        expect(cycleIndexFor('2024-01-14', ANCHOR, 2)).toBe(0);
        expect(cycleIndexFor('2024-01-15', ANCHOR, 2)).toBe(1);
    });

    it('goes negative before the anchor rather than clamping to zero', () => {
        expect(cycleIndexFor('2023-12-31', ANCHOR, 4)).toBe(-1);
        expect(cycleIndexFor('2023-12-04', ANCHOR, 4)).toBe(-1);
        expect(cycleIndexFor('2023-12-03', ANCHOR, 4)).toBe(-2);
    });

    it('groups two dates in different ISO weeks that share one cycle', () => {
        // Cycle 71 runs 2026-09-21 → 2026-10-04. These sit in its two halves.
        expect(cycleIndexFor('2026-09-22', ANCHOR, 2)).toBe(71);
        expect(cycleIndexFor('2026-09-28', ANCHOR, 2)).toBe(71);
    });

    /**
     * THE WHOLE POINT OF ANCHORING. These two dates are 13 days apart, so a
     * rolling 14-day window sums them together and reports a breach. The cycle
     * they actually belong to separates them, and cl 35.x(a) caps the cycle —
     * not every 14 consecutive days. This is the false-violation mechanism.
     */
    it('separates dates a rolling window would have summed together', () => {
        expect(cycleIndexFor('2026-09-28', ANCHOR, 2)).toBe(71);
        expect(cycleIndexFor('2026-10-11', ANCHOR, 2)).toBe(72);
    });
});

describe('cycleBoundsFor', () => {
    it('returns half-open bounds that start on the anchor weekday', () => {
        const b = cycleBoundsFor('2024-01-15', ANCHOR, 4);
        expect(b.start).toBe('2024-01-01');
        expect(b.endExclusive).toBe('2024-01-29');
        expect(b.endInclusive).toBe('2024-01-28');
    });

    it('makes every cycle start a Monday, for all four lengths', () => {
        for (const weeks of [1, 2, 3, 4] as OrdinaryCycleWeeks[]) {
            for (const probe of ['2026-02-11', '2026-07-04', '2026-10-20', '2027-01-01']) {
                const { start } = cycleBoundsFor(probe, ANCHOR, weeks);
                expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
            }
        }
    });

    it('contains the probe date in every cycle length', () => {
        for (const weeks of [1, 2, 3, 4] as OrdinaryCycleWeeks[]) {
            const probe = '2026-10-07';
            const { start, endExclusive } = cycleBoundsFor(probe, ANCHOR, weeks);
            expect(start <= probe).toBe(true);
            expect(probe < endExclusive).toBe(true);
        }
    });

    it('tiles without gap or overlap — one cycle ends where the next begins', () => {
        const a = cycleBoundsFor('2026-03-02', ANCHOR, 3);
        const b = cycleBoundsFor(a.endExclusive, ANCHOR, 3);
        expect(b.start).toBe(a.endExclusive);
    });
});

describe('timezone independence', () => {
    // The bug this guards: `new Date('2026-10-05')` parses as UTC midnight, which
    // in Sydney is already the 5th at 11am — but any local-time arithmetic on it
    // lands a day early for half the year. Cycle edges are calendar facts.
    it('is unaffected by the host timezone', () => {
        const original = process.env.TZ;
        const results: string[] = [];
        for (const tz of ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
            process.env.TZ = tz;
            results.push(
                `${cycleIndexFor('2026-10-05', ANCHOR, 2)}|` +
                `${cycleBoundsFor('2026-10-05', ANCHOR, 2).start}`,
            );
        }
        process.env.TZ = original;
        expect(new Set(results).size).toBe(1);
    });

    it('does not shift a date that sits on a DST boundary in Sydney', () => {
        // 2026-10-04 is the first Sunday in October — Sydney's DST switch.
        expect(cycleBoundsFor('2026-10-04', ANCHOR, 1).start).toBe('2026-09-28');
        expect(cycleBoundsFor('2026-10-05', ANCHOR, 1).start).toBe('2026-10-05');
    });
});

describe('cycleCeilingHours', () => {
    it('reproduces the ladder in cl 35.x(a) at the 38h basis', () => {
        for (const weeks of [1, 2, 3, 4] as OrdinaryCycleWeeks[]) {
            expect(cycleCeilingHours(weeks, 38)).toBe(ORD_CYCLE_CEILINGS[weeks]);
            expect(cycleCeilingHours(weeks, null)).toBe(ORD_CYCLE_CEILINGS[weeks]);
        }
    });

    it('scales to a part-timer’s contracted basis — 20h/wk is a 40h fortnight', () => {
        expect(cycleCeilingHours(2, 20)).toBe(40);
        expect(cycleCeilingHours(4, 20)).toBe(80);
    });

    it('ignores a zero or negative basis rather than producing a zero ceiling', () => {
        expect(cycleCeilingHours(2, 0)).toBe(76);
        expect(cycleCeilingHours(2, -5)).toBe(76);
    });
});

describe('cycleLabel', () => {
    it('reads back as the clause does', () => {
        expect(cycleLabel(2, 38)).toBe('76h in 2 weeks');
        expect(cycleLabel(1, 38)).toBe('38h in 1 week');
        expect(cycleLabel(4, 38)).toBe('152h in 4 weeks');
    });

    it('keeps one decimal for a fractional basis', () => {
        expect(cycleLabel(2, 22.8)).toBe('45.6h in 2 weeks');
    });
});

describe('resolveGoverningCycleWeeks', () => {
    it('takes the SHORTEST cycle — the least smoothing, so the strictest', () => {
        expect(resolveGoverningCycleWeeks([4, 2, 4])).toBe(2);
        expect(resolveGoverningCycleWeeks([4, 1])).toBe(1);
    });

    it('defaults an empty or all-null list to four weeks', () => {
        expect(resolveGoverningCycleWeeks([])).toBe(4);
        expect(resolveGoverningCycleWeeks([null, undefined])).toBe(4);
    });

    it('normalises before comparing, so junk cannot win the minimum', () => {
        expect(resolveGoverningCycleWeeks(['3', 4])).toBe(3);
        expect(resolveGoverningCycleWeeks([0, 4])).toBe(4);
    });
});
