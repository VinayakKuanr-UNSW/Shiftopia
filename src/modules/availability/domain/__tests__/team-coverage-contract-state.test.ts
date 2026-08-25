/**
 * The CONTRACT day-state — Full-Time staff on the Team Availability page.
 *
 * FT hold no availability rows at all after 20260817120000, so every code path
 * that keyed off "has a declaration" had to learn the difference between
 * "declared nothing and should have" (unset — a chase-list) and "declared
 * nothing and never will" (contract — a fact). Folding the second into the first
 * reported the entire permanent workforce as undeclared AND subtracted all of
 * them from AVAILABLE, on a page whose whole job is Required vs Available.
 *
 * The line between them is `isWhollyFullTime`, not `contractType`, and the
 * difference is a real population: someone Full-Time in one role and Casual in
 * another within the SAME sub-department (EBA cl 13 Multi-Hiring, which
 * migration 20260824130200 made declarable). Their governing contract is
 * Full-Time, so `contractType` said "fact" while their casual engagement was
 * opt-in, undeclared, and hard-filtered off every casual shift in that
 * sub-department.
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

// A WHOLLY Full-Time member: every contract in scope is Full-Time. Both fields
// are set deliberately — `contractType` is the governing contract and
// `isWhollyFullTime` is "all of them", and the mixed case below is the one
// where those two disagree.
const ft = (id: string) => member({
    profileId: id,
    contractType: 'FT',
    isWhollyFullTime: true,
    employmentStatus: 'Full-Time',
});

// Multi-hired (EBA cl 13): Full-Time and Casual in the SAME scope. The
// governing contract is still Full-Time — casual-last ordering, and correctly
// so for the hours caps — but the scope is not wholly Full-Time.
const multiHired = (id: string) => member({
    profileId: id,
    contractType: 'FT',
    isWhollyFullTime: false,
    employmentStatus: 'Full-Time, Casual',
});

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
    it('ignores employmentStatus, which is a display label and may list several', () => {
        const cells = buildTeamDayCells(inputs({
            members: [member({
                profileId: 'p1',
                contractType: 'FT',
                isWhollyFullTime: true,
                employmentStatus: 'Casual',
            })],
        }));
        expect(cells.get('p1')!.get(DATE)!.state).toBe('contract');
    });

    // THE REGRESSION. `contractType` reports the GOVERNING contract, and the
    // governing contract of a Full-Time + Casual sub-department is the
    // Full-Time one. Keying the cell off it read "Contract based" — no
    // declaration expected, counted in AVAILABLE — for someone whose casual
    // engagement is OPT_IN, has declared nothing, and is therefore hard-filtered
    // off every casual shift in that sub-department. The page promised supply
    // the solver would not place.
    it('reads a multi-hired member as unset, not contract, when the scope is not wholly FT', () => {
        const cells = buildTeamDayCells(inputs({ members: [multiHired('mixed')] }));
        expect(cells.get('mixed')!.get(DATE)!.state).toBe('unset');
    });

    // Same predicate as `sm_all_active_contracts_ft_in` and as the editor gate
    // in `AvailabilityPage`. A member the page puts on the chase-list must be a
    // member the page will let declare.
    it('says WHY a full-time-chipped member is on the chase-list', () => {
        const cell = buildTeamDayCells(inputs({ members: [multiHired('mixed')] }))
            .get('mixed')!.get(DATE)!;
        expect(cell.note).toMatch(/opt-in/i);

        // Not noise on the states that explain themselves.
        const plain = buildTeamDayCells(inputs({
            members: [ft('ft1'), member({ profileId: 'c1' })],
        }));
        expect(plain.get('ft1')!.get(DATE)!.note).toBeUndefined();
        expect(plain.get('c1')!.get(DATE)!.note).toBeUndefined();
    });

    // A producer that never resolved the basis has not established that the
    // scope is wholly Full-Time. The safe failure is a name on the chase-list,
    // not a silent addition to AVAILABLE — the HC-5d 0/144 shape.
    it('treats a missing isWhollyFullTime as NOT contract-rostered', () => {
        const cells = buildTeamDayCells(inputs({
            members: [member({ profileId: 'p1', contractType: 'FT', employmentStatus: 'Full-Time' })],
        }));
        expect(cells.get('p1')!.get(DATE)!.state).toBe('unset');
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

    // The other half of the same fix. An undeclared multi-hired member is not
    // supply: the solver will not place them on the casual work, so counting
    // them here is the false reassurance this page exists to remove.
    it('does not count an undeclared multi-hired member as supply', () => {
        const i = inputs({ members: [multiHired('mixed')], dates: [DATE, '2026-08-15'] });
        const s = summarise(i, buildTeamDayCells(i), buildCoverageBuckets(i), DATE);
        expect(s.avgWeekdayAvailable).toBe(0);
        expect(s.avgWeekendAvailable).toBe(0);
        expect(s.declaredCount).toBe(0);
        expect(s.unsetCount).toBe(1);
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
