import { describe, expect, it } from 'vitest';
import {
    addDaysISO,
    buildCoverageBuckets,
    buildTeamDayCells,
    containmentShortfallMinutes,
    findNearMisses,
    isFullyContained,
    isWeekendISO,
    normaliseInterval,
    overlappedHours,
    requiredFromShifts,
    summarise,
} from '../team-coverage';
import type {
    TeamAvailabilityInputs,
    TeamMember,
} from '../../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * The hours fields every `RawTeamShift` carries. Coverage and cell-state logic
 * reads none of them — it works in start/end intervals — so they are spread in
 * rather than restated, and a test that cares about hours overrides them.
 */
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

function avail(
    date: string,
    windows: Array<{ start: string; end: string }>,
): EmployeeAvailability {
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
        dates: ['2026-08-10'],
        availability: new Map(),
        shifts: [],
        leaveDays: [],
        required: null,
        requiredSource: 'shifts',
        ...over,
    };
}

// ── interval maths ──────────────────────────────────────────────────────────

describe('interval helpers', () => {
    it('extends an interval past midnight when the end wraps', () => {
        expect(normaliseInterval('22:00', '02:00')).toEqual({ from: 1320, to: 1560 });
    });

    it('treats an equal start and end as a full 24 hours', () => {
        expect(normaliseInterval('00:00', '00:00')).toEqual({ from: 0, to: 1440 });
    });

    it('rolls overnight hours onto the following date', () => {
        const hours = overlappedHours('2026-08-10', '23:00', '01:00');
        expect(hours).toEqual([
            ['2026-08-10', 23],
            ['2026-08-11', 0],
        ]);
    });

    it('crosses a month boundary correctly', () => {
        expect(addDaysISO('2026-08-31', 1)).toBe('2026-09-01');
        expect(addDaysISO('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('identifies Saturday and Sunday as the weekend', () => {
        expect(isWeekendISO('2026-08-15')).toBe(true); // Sat
        expect(isWeekendISO('2026-08-16')).toBe(true); // Sun
        expect(isWeekendISO('2026-08-14')).toBe(false); // Fri
    });
});

// ── containment (the 0/144 bug) ─────────────────────────────────────────────

describe('full containment', () => {
    it('rejects a shift starting before the declared window', () => {
        const windows = [{ start: '07:00', end: '23:00' }];
        expect(isFullyContained(windows, '06:30', '14:30')).toBe(false);
    });

    it('accepts a shift fully inside the declared window', () => {
        const windows = [{ start: '07:00', end: '23:00' }];
        expect(isFullyContained(windows, '07:00', '15:00')).toBe(true);
    });

    it('reports the exact shortfall of a near miss', () => {
        // The AutoScheduler 0/144 case: 06:30 start against a 07:00 declaration.
        const windows = [{ start: '07:00', end: '23:00' }];
        expect(containmentShortfallMinutes(windows, '06:30', '14:30')).toBe(30);
    });

    it('sums an uncovered head and tail', () => {
        const windows = [{ start: '09:00', end: '17:00' }];
        expect(containmentShortfallMinutes(windows, '08:45', '17:30')).toBe(45);
    });

    it('returns Infinity for a disjoint window rather than a huge number', () => {
        const windows = [{ start: '18:00', end: '22:00' }];
        expect(containmentShortfallMinutes(windows, '06:00', '10:00')).toBe(Infinity);
    });

    it('returns 0 when already contained', () => {
        expect(containmentShortfallMinutes([{ start: '07:00', end: '23:00' }], '08:00', '12:00'))
            .toBe(0);
    });
});

// ── day-state resolution ────────────────────────────────────────────────────

describe('buildTeamDayCells', () => {
    const date = '2026-08-10';

    it('distinguishes UNSET from UNAVAILABLE — the whole point of the page', () => {
        const never = member({ profileId: 'never', hasDeclared: false });
        const declined = member({ profileId: 'declined', hasDeclared: true });

        const cells = buildTeamDayCells(
            inputs({
                members: [never, declined],
                // `getResolvedAvailabilities` omits profiles with no rules, so
                // 'never' is absent from the map entirely.
                availability: new Map([['declined', new Map([[date, avail(date, [])]])]]),
            }),
        );

        expect(cells.get('never')!.get(date)!.state).toBe('unset');
        expect(cells.get('declined')!.get(date)!.state).toBe('unavailable');
    });

    it('ranks assigned above leave above declared availability', () => {
        const m = member({ profileId: 'p1' });
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '07:00', end: '23:00' }])]])],
        ]);

        const withShift = buildTeamDayCells(
            inputs({
                members: [m],
                availability,
                leaveDays: [{ profileId: 'p1', date }],
                shifts: [
                    {
                        id: 's1',
                        shiftDate: date,
                        startTime: '09:00',
                        endTime: '17:00',
                        assignedEmployeeId: 'p1',
                        roleName: 'Guard',
                        ...shiftBase,
                    },
                ],
            }),
        );
        expect(withShift.get('p1')!.get(date)!.state).toBe('assigned');

        const onLeave = buildTeamDayCells(
            inputs({ members: [m], availability, leaveDays: [{ profileId: 'p1', date }] }),
        );
        expect(onLeave.get('p1')!.get(date)!.state).toBe('leave');

        const free = buildTeamDayCells(inputs({ members: [m], availability }));
        expect(free.get('p1')!.get(date)!.state).toBe('available');
    });

});

// ── coverage buckets ────────────────────────────────────────────────────────

describe('buildCoverageBuckets', () => {
    const date = '2026-08-10';

    it('derives REQUIRED from every non-cancelled shift, filled or not', () => {
        const required = requiredFromShifts(
            [
                {
                    id: 'a',
                    shiftDate: date,
                    startTime: '09:00',
                    endTime: '11:00',
                    assignedEmployeeId: 'p1',
                    roleName: null,
                    ...shiftBase,
                },
                {
                    id: 'b',
                    shiftDate: date,
                    startTime: '09:00',
                    endTime: '11:00',
                    assignedEmployeeId: null,
                    roleName: null,
                    ...shiftBase,
                },
            ],
            [date],
        );
        expect(required.get(date)!.get(9)).toBe(2);
        expect(required.get(date)!.get(10)).toBe(2);
    });

    it('computes gap and shortfall, with spare capacity closing the gap', () => {
        const members = [member({ profileId: 'p1' }), member({ profileId: 'p2' })];
        // p1 is rostered; p2 is available but free — so the gap is coverable.
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '08:00', end: '18:00' }])]])],
            ['p2', new Map([[date, avail(date, [{ start: '08:00', end: '18:00' }])]])],
        ]);
        const shifts = [
            {
                id: 'a',
                shiftDate: date,
                startTime: '09:00',
                endTime: '10:00',
                assignedEmployeeId: 'p1',
                roleName: null,
                ...shiftBase,
            },
            {
                id: 'b',
                shiftDate: date,
                startTime: '09:00',
                endTime: '10:00',
                assignedEmployeeId: null,
                roleName: null,
                ...shiftBase,
            },
        ];

        const buckets = buildCoverageBuckets(
            inputs({ members, dates: [date], availability, shifts }),
        );
        const nine = buckets.find((b) => b.hour === 9)!;

        expect(nine.required).toBe(2);
        expect(nine.assigned).toBe(1);
        expect(nine.available).toBe(2);
        expect(nine.gap).toBe(1);
        expect(nine.shortfall).toBe(0); // p2 is spare, so the gap is fillable
    });

    it('reports a shortfall when nobody spare is available', () => {
        const members = [member({ profileId: 'p1' })];
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '08:00', end: '18:00' }])]])],
        ]);
        const shifts = [
            {
                id: 'a',
                shiftDate: date,
                startTime: '09:00',
                endTime: '10:00',
                assignedEmployeeId: 'p1',
                roleName: null,
                ...shiftBase,
            },
            {
                id: 'b',
                shiftDate: date,
                startTime: '09:00',
                endTime: '10:00',
                assignedEmployeeId: null,
                roleName: null,
                ...shiftBase,
            },
        ];

        const nine = buildCoverageBuckets(
            inputs({ members, dates: [date], availability, shifts }),
        ).find((b) => b.hour === 9)!;

        expect(nine.gap).toBe(1);
        expect(nine.shortfall).toBe(1); // p1 is the only body and is already on
    });

    it('never lets a member rostered outside their declared window make shortfall negative', () => {
        // The warn-only manual path allows this: assigned but not available.
        const members = [member({ profileId: 'p1' })];
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '18:00', end: '22:00' }])]])],
        ]);
        const shifts = [
            {
                id: 'a',
                shiftDate: date,
                startTime: '09:00',
                endTime: '10:00',
                assignedEmployeeId: 'p1',
                roleName: null,
                ...shiftBase,
            },
        ];

        const nine = buildCoverageBuckets(
            inputs({ members, dates: [date], availability, shifts }),
        ).find((b) => b.hour === 9)!;

        expect(nine.available).toBe(0);
        expect(nine.assigned).toBe(1);
        expect(nine.gap).toBe(0);
        expect(nine.shortfall).toBeGreaterThanOrEqual(0);
    });

    it('excludes members on approved leave from AVAILABLE', () => {
        const members = [member({ profileId: 'p1' })];
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '08:00', end: '18:00' }])]])],
        ]);

        const nine = buildCoverageBuckets(
            inputs({
                members,
                dates: [date],
                availability,
                leaveDays: [{ profileId: 'p1', date }],
            }),
        ).find((b) => b.hour === 9)!;

        expect(nine.available).toBe(0);
    });

    it('honours an externally supplied REQUIRED source over the shift fallback', () => {
        const required = new Map([[date, new Map([[9, 7]])]]);
        const nine = buildCoverageBuckets(
            inputs({ members: [], dates: [date], required, requiredSource: 'demand' }),
        ).find((b) => b.hour === 9)!;

        expect(nine.required).toBe(7);
        expect(nine.gap).toBe(7);
    });
});

// ── summary ─────────────────────────────────────────────────────────────────

describe('summarise', () => {
    it('splits mean availability across weekday and weekend', () => {
        const dates = ['2026-08-14', '2026-08-15']; // Fri, Sat
        const members = [member({ profileId: 'p1' }), member({ profileId: 'p2' })];
        const availability = new Map([
            [
                'p1',
                new Map([
                    ['2026-08-14', avail('2026-08-14', [{ start: '09:00', end: '17:00' }])],
                    ['2026-08-15', avail('2026-08-15', [])],
                ]),
            ],
            [
                'p2',
                new Map([
                    ['2026-08-14', avail('2026-08-14', [{ start: '09:00', end: '17:00' }])],
                    ['2026-08-15', avail('2026-08-15', [])],
                ]),
            ],
        ]);

        const i = inputs({ members, dates, availability });
        const cells = buildTeamDayCells(i);
        const summary = summarise(i, cells, buildCoverageBuckets(i), '2026-08-10');

        expect(summary.avgWeekdayAvailable).toBe(2);
        expect(summary.avgWeekendAvailable).toBe(0);
    });

    it('counts never-declared members separately from unavailable ones', () => {
        const members = [
            member({ profileId: 'p1', hasDeclared: false }),
            member({ profileId: 'p2', hasDeclared: true }),
        ];
        const i = inputs({
            members,
            availability: new Map([
                ['p2', new Map([['2026-08-10', avail('2026-08-10', [])]])],
            ]),
        });
        const cells = buildTeamDayCells(i);
        const summary = summarise(i, cells, buildCoverageBuckets(i), '2026-08-10');

        expect(summary.unsetCount).toBe(1);
        expect(summary.declaredCount).toBe(0);
        expect(summary.memberCount).toBe(2);
    });

    it('totals required and assigned as staffed-hours (buckets are one hour wide)', () => {
        const date = '2026-08-10';
        const members = [member({ profileId: 'p1' })];
        const i = inputs({
            members,
            dates: [date],
            shifts: [
                {
                    id: 'a',
                    shiftDate: date,
                    startTime: '09:00',
                    endTime: '12:00',
                    assignedEmployeeId: 'p1',
                    roleName: null,
                    ...shiftBase,
                },
                {
                    id: 'b',
                    shiftDate: date,
                    startTime: '09:00',
                    endTime: '11:00',
                    assignedEmployeeId: null,
                    roleName: null,
                    ...shiftBase,
                },
            ],
        });
        const cells = buildTeamDayCells(i);
        const summary = summarise(i, cells, buildCoverageBuckets(i), '2026-08-10');

        // 3h assigned + 2h unfilled = 5 required staffed-hours; 3 assigned.
        expect(summary.requiredHours).toBe(5);
        expect(summary.assignedHours).toBe(3);
    });

});

// ── near misses ─────────────────────────────────────────────────────────────

describe('findNearMisses', () => {
    const date = '2026-08-10';

    it('surfaces the 30-minute miss that reads as fully unavailable elsewhere', () => {
        const members = [member({ profileId: 'p1', fullName: 'Priya R.' })];
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '07:00', end: '23:00' }])]])],
        ]);
        const i = inputs({
            members,
            dates: [date],
            availability,
            shifts: [
                {
                    id: 'unfilled',
                    shiftDate: date,
                    startTime: '06:30',
                    endTime: '14:30',
                    assignedEmployeeId: null,
                    roleName: 'Guard',
                    ...shiftBase,
                },
            ],
        });

        const misses = findNearMisses(i, buildTeamDayCells(i));
        expect(misses).toHaveLength(1);
        expect(misses[0].memberName).toBe('Priya R.');
        expect(misses[0].shortfallMinutes).toBe(30);
    });

    it('ignores filled shifts and fully-contained candidates', () => {
        const members = [member({ profileId: 'p1' })];
        const availability = new Map([
            ['p1', new Map([[date, avail(date, [{ start: '06:00', end: '23:00' }])]])],
        ]);
        const i = inputs({
            members,
            dates: [date],
            availability,
            shifts: [
                {
                    id: 'contained',
                    shiftDate: date,
                    startTime: '06:30',
                    endTime: '14:30',
                    assignedEmployeeId: null,
                    roleName: null,
                    ...shiftBase,
                },
                {
                    id: 'filled',
                    shiftDate: date,
                    startTime: '20:00',
                    endTime: '23:30',
                    assignedEmployeeId: 'someone',
                    roleName: null,
                    ...shiftBase,
                },
            ],
        });

        expect(findNearMisses(i, buildTeamDayCells(i))).toHaveLength(0);
    });

    it('drops misses wider than the threshold and ranks the rest by shortfall', () => {
        const members = [
            member({ profileId: 'near', fullName: 'Near' }),
            member({ profileId: 'far', fullName: 'Far' }),
        ];
        const availability = new Map([
            ['near', new Map([[date, avail(date, [{ start: '07:00', end: '23:00' }])]])],
            ['far', new Map([[date, avail(date, [{ start: '10:00', end: '23:00' }])]])],
        ]);
        const i = inputs({
            members,
            dates: [date],
            availability,
            shifts: [
                {
                    id: 'u',
                    shiftDate: date,
                    startTime: '06:30',
                    endTime: '14:30',
                    assignedEmployeeId: null,
                    roleName: null,
                    ...shiftBase,
                },
            ],
        });

        const misses = findNearMisses(i, buildTeamDayCells(i), 60);
        expect(misses.map((m) => m.memberName)).toEqual(['Near']); // 'Far' is 210 min short
        expect(misses[0].shortfallMinutes).toBe(30);
    });
});
