/**
 * The CONTRACT day-state — Full-Time staff on the Team Availability page.
 *
 * FT hold no availability rows at all after 20260817120000, so every code path
 * that keyed off "has a declaration" had to learn the difference between
 * "declared nothing and should have" (unset — a chase-list) and "declared
 * nothing and never will" (contract — a fact). Folding the second into the first
 * reported the entire permanent workforce as undeclared AND subtracted all of
 * them from AVAILABLE, on a page whose whole job is Required vs Available.
 */

import { describe, expect, it } from 'vitest';
import { buildCoverageBuckets, buildTeamDayCells, findNearMisses, summarise } from '../team-coverage';
import type { TeamAvailabilityInputs, TeamMember } from '../../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

const DATE = '2026-08-10'; // Monday
const shiftBase = {
    netMinutes: 480,
    isDraft: false,
    deptName: null,
    subDeptName: null,
    unpaidBreakMinutes: 30,
};

function member(over: Partial<TeamMember> & { profileId: string }): TeamMember {
    return {
        fullName: over.profileId,
        roleId: null,
        roleName: null,
        departmentId: null,
        subDepartmentId: null,
        employmentStatus: 'Casual',
        ...over,
    };
}

function avail(date: string, windows: Array<{ start: string; end: string }>): EmployeeAvailability {
    return {
        employeeId: 'x',
        date,
        availableWindows: windows,
        unavailableWindows: [],
        isFullyAvailable: false,
        isFullyUnavailable: windows.length === 0,
        hasData: true,
    } as EmployeeAvailability;
}

function inputs(over: Partial<TeamAvailabilityInputs> = {}): TeamAvailabilityInputs {
    return {
        members: [],
        dates: [DATE],
        availability: new Map(),
        shifts: [],
        leaveDays: [],
        required: null,
        requiredSource: 'shifts',
        ...over,
    };
}

const ft = (id: string) => member({ profileId: id, contractType: 'FT', employmentStatus: 'Full-Time' });

describe('CONTRACT vs UNSET', () => {
    it('reads an FT with no declaration as contract, and a casual as unset', () => {
        const cells = buildTeamDayCells(inputs({
            members: [ft('ft1'), member({ profileId: 'c1' })],
        }));

        expect(cells.get('ft1')!.get(DATE)!.state).toBe('contract');
        expect(cells.get('c1')!.get(DATE)!.state).toBe('unset');
    });

    // The basis, not the display label. 30 of 103 people hold several active
    // contracts and the chip the UI shows is not necessarily the deciding one.
    it('keys off contractType (the compliance basis), not employmentStatus', () => {
        const cells = buildTeamDayCells(inputs({
            members: [member({ profileId: 'p1', contractType: 'FT', employmentStatus: 'Casual' })],
        }));
        expect(cells.get('p1')!.get(DATE)!.state).toBe('contract');
    });

    it('leaves PT on the declaration model — their slots still narrow the day', () => {
        const cells = buildTeamDayCells(inputs({
            members: [member({ profileId: 'pt1', contractType: 'PT' })],
        }));
        expect(cells.get('pt1')!.get(DATE)!.state).toBe('unset');
    });

    it('still ranks assigned and leave above contract', () => {
        const onLeave = buildTeamDayCells(inputs({
            members: [ft('ft1')],
            leaveDays: [{ profileId: 'ft1', date: DATE }],
        }));
        expect(onLeave.get('ft1')!.get(DATE)!.state).toBe('leave');

        const assigned = buildTeamDayCells(inputs({
            members: [ft('ft1')],
            shifts: [{
                ...shiftBase,
                id: 's1', shiftDate: DATE, startTime: '09:00', endTime: '17:00',
                roleName: null, assignedEmployeeId: 'ft1',
            }],
        }));
        expect(assigned.get('ft1')!.get(DATE)!.state).toBe('assigned');
    });
});

describe('coverage counts contract staff as available', () => {
    it('counts an FT as available across the day despite holding no windows', () => {
        const buckets = buildCoverageBuckets(inputs({ members: [ft('ft1')] }));
        // Every hour of the single date in range.
        expect(buckets.filter((b) => b.available === 1)).toHaveLength(24);
    });

    it('does not count an FT on approved leave', () => {
        const buckets = buildCoverageBuckets(inputs({
            members: [ft('ft1')],
            leaveDays: [{ profileId: 'ft1', date: DATE }],
        }));
        expect(buckets.every((b) => b.available === 0)).toBe(true);
    });

    it('closes the shortfall an FT can actually cover', () => {
        const shift = {
            ...shiftBase,
            id: 's1', shiftDate: DATE, startTime: '09:00', endTime: '17:00',
            roleName: null, assignedEmployeeId: null as string | null,
        };
        const buckets = buildCoverageBuckets(inputs({ members: [ft('ft1')], shifts: [shift] }));
        const nine = buckets.find((b) => b.hour === 9)!;

        expect(nine.required).toBe(1);
        expect(nine.assigned).toBe(0);
        expect(nine.gap).toBe(1);
        // Spare available (the FT) absorbs it — the gap is real, the SHORTFALL is not.
        expect(nine.shortfall).toBe(0);
    });

    it('reports a genuine shortfall when only an undeclared casual is in scope', () => {
        const shift = {
            ...shiftBase,
            id: 's1', shiftDate: DATE, startTime: '09:00', endTime: '17:00',
            roleName: null, assignedEmployeeId: null as string | null,
        };
        const buckets = buildCoverageBuckets(inputs({
            members: [member({ profileId: 'c1' })], shifts: [shift],
        }));
        expect(buckets.find((b) => b.hour === 9)!.shortfall).toBe(1);
    });
});

describe('summary', () => {
    it('excludes contract staff from the "not declared" chase-list', () => {
        const i = inputs({
            members: [
                ft('ft1'),
                member({ profileId: 'c1', hasDeclared: false }),
            ],
        });
        // `hasDeclared: false` is true of the FT too — they have no rows.
        i.members[0].hasDeclared = false;

        const s = summarise(i, buildTeamDayCells(i), buildCoverageBuckets(i), DATE);
        expect(s.unsetCount).toBe(1);
    });

    it('counts contract staff as declared, so the tile can reach 100%', () => {
        const i = inputs({ members: [ft('ft1')] });
        const s = summarise(i, buildTeamDayCells(i), buildCoverageBuckets(i), DATE);
        expect(s.declaredCount).toBe(1);
        expect(s.memberCount).toBe(1);
    });

    it('counts contract staff in the weekday/weekend availability averages', () => {
        const i = inputs({ members: [ft('ft1')], dates: [DATE, '2026-08-15'] }); // Mon + Sat
        const s = summarise(i, buildTeamDayCells(i), buildCoverageBuckets(i), DATE);
        expect(s.avgWeekdayAvailable).toBe(1);
        expect(s.avgWeekendAvailable).toBe(1);
    });
});

describe('near misses', () => {
    // A near miss is a declared window that ALMOST contains the shift. A
    // full-timer has no window and is available all day, so they are an outright
    // candidate — listing them would bury the real 30-minute misses.
    it('never lists a contract-rostered member', () => {
        const i = inputs({
            members: [ft('ft1')],
            shifts: [{
                ...shiftBase,
                id: 's1', shiftDate: DATE, startTime: '09:00', endTime: '17:00',
                roleName: null, assignedEmployeeId: null,
            }],
        });
        expect(findNearMisses(i, buildTeamDayCells(i))).toEqual([]);
    });

    it('still lists a casual who falls just short', () => {
        const i = inputs({
            members: [member({ profileId: 'c1', hasDeclared: true })],
            availability: new Map([['c1', new Map([[DATE, avail(DATE, [{ start: '09:30', end: '17:00' }])]])]]),
            shifts: [{
                ...shiftBase,
                id: 's1', shiftDate: DATE, startTime: '09:00', endTime: '17:00',
                roleName: null, assignedEmployeeId: null,
            }],
        });
        const misses = findNearMisses(i, buildTeamDayCells(i));
        expect(misses).toHaveLength(1);
        expect(misses[0].shortfallMinutes).toBe(30);
    });
});
