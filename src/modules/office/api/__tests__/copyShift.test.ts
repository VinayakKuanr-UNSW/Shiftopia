/**
 * Copy writes a few dates at a time and reports progress — a 19-date copy
 * written one by one took ~95s behind a bare "Applying…".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, failOn: new Set<string>(), written: [] as string[] }));

vi.mock('../rosterTarget', () => ({
    resolveRosterTarget: async ({ shiftDate }: { shiftDate: string }) => ({
        rosterId: `roster-${shiftDate}`, rosterSubgroupId: `sg-${shiftDate}`,
        groupType: 'convention_centre', subGroupName: 'Administration',
    }),
}));

vi.mock('@/modules/rosters/api/shifts.commands', () => ({
    shiftsCommands: {
        createShift: async (dto: { shift_date: string }) => {
            state.inFlight++;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            await new Promise(r => setTimeout(r, 5));
            state.inFlight--;
            if (state.failOn.has(dto.shift_date)) throw new Error('Shape gate: below the 7.6h floor');
            state.written.push(dto.shift_date);
            return { id: dto.shift_date };
        },
    },
}));

const { copyShiftToDates, COPY_CONCURRENCY } = await import('../copyShift');

const source = {
    employeeId: 'e1', organizationId: 'o', departmentId: 'd', subDepartmentId: 's',
    startTime: '08:00', endTime: '16:36', unpaidBreakMinutes: 30, paidBreakMinutes: 0, roleId: 'r',
};
const dates = Array.from({ length: 19 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`);

beforeEach(() => {
    state.inFlight = 0; state.maxInFlight = 0; state.failOn.clear(); state.written.length = 0;
});

describe('copyShiftToDates', () => {
    it('writes several at once, but never more than the limit', async () => {
        await copyShiftToDates(source, dates);
        expect(state.maxInFlight).toBeGreaterThan(1);
        expect(state.maxInFlight).toBeLessThanOrEqual(COPY_CONCURRENCY);
        expect(state.written.sort()).toEqual(dates);
    });

    it('reports progress once per date, ending at the total', async () => {
        const seen: Array<[number, number]> = [];
        await copyShiftToDates(source, dates, { onProgress: (d, t) => seen.push([d, t]) });
        expect(seen).toHaveLength(19);
        expect(seen[seen.length - 1]).toEqual([19, 19]);
        expect(seen.map(s => s[0])).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    });

    it('returns created and failed in date order, whatever order they finished in', async () => {
        state.failOn.add('2026-10-07').add('2026-10-20');
        const out = await copyShiftToDates(source, [...dates].reverse());
        expect(out.created).toEqual(dates.filter(d => !state.failOn.has(d)));
        expect(out.failed).toEqual([
            { date: '2026-10-07', reason: 'Shape gate: below the 7.6h floor' },
            { date: '2026-10-20', reason: 'Shape gate: below the 7.6h floor' },
        ]);
    });

    it('still works one at a time when asked', async () => {
        await copyShiftToDates(source, dates.slice(0, 5), { concurrency: 1 });
        expect(state.maxInFlight).toBe(1);
    });
});
