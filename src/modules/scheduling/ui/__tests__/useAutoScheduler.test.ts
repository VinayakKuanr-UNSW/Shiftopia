import { describe, expect, it } from 'vitest';
import { addHours, format } from 'date-fns';
import {
    windowPresetRange,
    summariseScope,
    sortEmployeeGroups,
    complianceRateOf,
    type EmployeeGroup,
} from '../useAutoScheduler';

/** A Wednesday, so week boundaries are visible in both directions. */
const WED_12_AUG_2026 = new Date(2026, 7, 12);

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const soon = () => {
    // Inside the 4-hour emergent window, whatever "now" is when the suite runs.
    const t = addHours(new Date(), 1);
    return { shift_date: iso(t), start_time: format(t, 'HH:mm') };
};
const farFuture = { shift_date: '2099-01-01', start_time: '09:00' };

describe('windowPresetRange', () => {
    it('snaps "this week" to the Monday-Sunday roster week', () => {
        // date-fns defaults to Sunday-start; an AU roster week must not.
        expect(windowPresetRange('week', WED_12_AUG_2026)).toEqual({
            start: '2026-08-10', // Monday
            end: '2026-08-16',   // Sunday
        });
    });

    it('spans two whole weeks for the fortnight preset', () => {
        expect(windowPresetRange('fortnight', WED_12_AUG_2026)).toEqual({
            start: '2026-08-10',
            end: '2026-08-23',
        });
    });

    it('spans the calendar month', () => {
        expect(windowPresetRange('month', WED_12_AUG_2026)).toEqual({
            start: '2026-08-01',
            end: '2026-08-31',
        });
    });

    it('keeps every preset inside the 31-day limit the form enforces', () => {
        // A 31-day month is the widest preset; anything longer would produce a
        // window the validator immediately rejects.
        for (const day of [new Date(2026, 0, 15), new Date(2026, 1, 15), new Date(2026, 7, 31)]) {
            for (const preset of ['week', 'fortnight', 'month'] as const) {
                const { start, end } = windowPresetRange(preset, day);
                const days =
                    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 + 1;
                expect(days).toBeLessThanOrEqual(31);
                expect(days).toBeGreaterThan(0);
            }
        }
    });
});

describe('summariseScope', () => {
    it('counts an unassigned future draft as eligible', () => {
        expect(summariseScope([{ ...farFuture, is_draft: true }])).toEqual({
            total: 1, eligible: 1, assigned: 0, published: 0, startingSoon: 0,
        });
    });

    it('treats a missing is_draft as draft, matching the run filter', () => {
        expect(summariseScope([{ ...farFuture }]).eligible).toBe(1);
    });

    it('attributes each exclusion to exactly one reason', () => {
        const breakdown = summariseScope([
            { ...farFuture, is_draft: true },
            { ...farFuture, is_draft: true, assigned_employee_id: 'e1' },
            { ...farFuture, is_draft: false },
            { ...soon(), is_draft: true },
        ]);

        expect(breakdown).toEqual({
            total: 4, eligible: 1, assigned: 1, published: 1, startingSoon: 1,
        });
        // Categories must partition the total, or the "why" list misleads.
        expect(
            breakdown.eligible + breakdown.assigned + breakdown.published + breakdown.startingSoon,
        ).toBe(breakdown.total);
    });

    it('prefers "assigned" over "published" for a shift that is both', () => {
        const breakdown = summariseScope([
            { ...farFuture, is_draft: false, assigned_employee_id: 'e1' },
        ]);
        expect(breakdown.assigned).toBe(1);
        expect(breakdown.published).toBe(0);
    });

    it('leaves cancelled and deleted shifts out of the total entirely', () => {
        const breakdown = summariseScope([
            { ...farFuture, is_cancelled: true },
            { ...farFuture, deleted_at: '2026-08-01T00:00:00Z' },
            { ...farFuture, is_draft: true },
        ]);
        expect(breakdown.total).toBe(1);
        expect(breakdown.eligible).toBe(1);
    });
});

describe('sortEmployeeGroups', () => {
    const g = (over: Partial<EmployeeGroup>): EmployeeGroup => ({
        id: over.name ?? 'x',
        name: 'X',
        proposals: [],
        roleDistribution: [],
        totalCost: 0,
        avgFatigue: 0,
        utilization: 0,
        employmentType: 'Casual',
        contractedHours: 0,
        assignedRoles: [],
        ...over,
    });

    it('does not mutate the input array', () => {
        const groups = [g({ name: 'B' }), g({ name: 'A' })];
        sortEmployeeGroups(groups, 'name', 'asc');
        expect(groups.map(x => x.name)).toEqual(['B', 'A']);
    });

    it('orders by the requested field and direction', () => {
        const groups = [g({ name: 'A', utilization: 20 }), g({ name: 'B', utilization: 90 })];
        expect(sortEmployeeGroups(groups, 'utilization', 'desc').map(x => x.name)).toEqual(['B', 'A']);
        expect(sortEmployeeGroups(groups, 'utilization', 'asc').map(x => x.name)).toEqual(['A', 'B']);
    });

    it('sorts by compliance rate, not raw pass count', () => {
        const many = g({
            name: 'many',
            proposals: [
                { complianceStatus: 'PASS' }, { complianceStatus: 'PASS' },
                { complianceStatus: 'FAIL' }, { complianceStatus: 'FAIL' },
            ] as any,
        });
        const few = g({ name: 'few', proposals: [{ complianceStatus: 'PASS' }] as any });

        expect(complianceRateOf(many)).toBe(0.5);
        expect(complianceRateOf(few)).toBe(1);
        expect(sortEmployeeGroups([many, few], 'compliance', 'desc').map(x => x.name))
            .toEqual(['few', 'many']);
    });

    it('reports a zero rate for someone with no proposals rather than dividing by zero', () => {
        expect(complianceRateOf(g({ proposals: [] }))).toBe(0);
    });
});
