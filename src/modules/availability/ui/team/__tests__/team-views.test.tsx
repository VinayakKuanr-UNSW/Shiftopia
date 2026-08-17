import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The real ThemeProvider reaches through to AuthProvider, which would drag a
// Supabase session into a pure render test. These views only ever ask the theme
// one question, so answer it directly.
vi.mock('@/modules/core/contexts/ThemeContext', () => ({
    useTheme: () => ({ isDark: false }),
}));

import TeamAvailabilityGrid from '../TeamAvailabilityGrid';
import TeamDayTimeline from '../TeamDayTimeline';
import CoverageHeatmap from '../CoverageHeatmap';
import NearMissPanel from '../NearMissPanel';
import { pageCount, paginate } from '../TablePager';
import { gapFill, stateStyle } from '../coverage-palette';
import {
    buildCoverageBuckets,
    buildTeamDayCells,
    findNearMisses,
} from '../../../domain/team-coverage';
import {
    buildHoursByEmployee,
    buildWeekColumns,
    computeEmpComp,
} from '../../../domain/hours-compliance';
import {
    buildFatigueByEmployee,
    dayFairnessContribution,
} from '../../../domain/team-metrics';
import {
    TEAM_DAY_STATE_LABELS,
    type RawTeamShift,
    type TeamAvailabilityInputs,
    type TeamMember,
} from '../../../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

/**
 * Render cover for the team views.
 *
 * The domain suite proves the numbers; this proves the components mount and
 * that every state is ANNOUNCED, not just tinted — the light-mode aqua sits at
 * 2.75:1 against the surface, which makes a text channel mandatory rather than
 * optional.
 */

const DATE = '2026-08-10';

/** Hours fields every `RawTeamShift` carries; no render path reads them yet. */
const shiftBase = {
    netMinutes: 480,
    isDraft: false,
    deptName: null,
    subDeptName: null,
    unpaidBreakMinutes: 30,
};

const member = (over: Partial<TeamMember> & { profileId: string }): TeamMember => ({
    fullName: over.profileId,
    roleId: null,
    roleName: 'Guard',
    departmentId: null,
    subDepartmentId: null,
    employmentStatus: 'Casual',
    ...over,
});

const avail = (windows: Array<{ start: string; end: string }>): EmployeeAvailability =>
    ({
        employeeId: 'x',
        date: DATE,
        availableWindows: windows,
        unavailableWindows: [],
        isFullyAvailable: false,
        isFullyUnavailable: windows.length === 0,
        hasData: true,
    }) as EmployeeAvailability;

function scenario(): TeamAvailabilityInputs {
    return {
        members: [
            member({ profileId: 'p1', fullName: 'Priya Raman' }),
            member({ profileId: 'p2', fullName: 'Sam Okoro', hasDeclared: false }),
        ],
        dates: [DATE],
        availability: new Map([['p1', new Map([[DATE, avail([{ start: '07:00', end: '23:00' }])]])]]),
        shifts: [
            {
                id: 'unfilled',
                shiftDate: DATE,
                startTime: '06:30',
                endTime: '14:30',
                assignedEmployeeId: null,
                roleName: 'Guard',
                ...shiftBase,
            },
        ],
        leaveDays: [],
        required: null,
        requiredSource: 'shifts',
    };
}

describe('TeamAvailabilityGrid', () => {
    it('announces each cell state in text, not colour alone', () => {
        const inputs = scenario();
        const cells = buildTeamDayCells(inputs);

        render(
            <TeamAvailabilityGrid
                members={inputs.members}
                dates={inputs.dates}
                cells={cells}
            />,
        );

        expect(screen.getAllByText(/Priya Raman/).length).toBeGreaterThan(0);
        // The accessible name lives on `aria-label`, so query it as a label —
        // `getByText` would only see a duplicate sr-only twin, which is exactly
        // the redundancy that was removed.
        expect(
            screen.getByLabelText(/Priya Raman, Mon 10 Aug: Available 07:00–23:00/),
        ).toBeTruthy();
        // The never-declared member reads as "Not declared", never as "unavailable".
        expect(screen.getByLabelText(/Sam Okoro, Mon 10 Aug: Not declared/)).toBeTruthy();
    });

    it('does not announce cells as buttons — they have no activation', () => {
        const inputs = scenario();
        render(
            <TeamAvailabilityGrid
                members={inputs.members}
                dates={inputs.dates}
                cells={buildTeamDayCells(inputs)}
            />,
        );

        // A focusable role="button" that Enter/Space cannot operate is a broken
        // ARIA contract. Only the member row headers are real buttons.
        const buttons = screen.getAllByRole('button');
        for (const b of buttons) {
            expect(b.tagName).toBe('BUTTON');
        }
        expect(screen.getAllByRole('img').length).toBe(inputs.members.length);
    });

    it('renders an empty state rather than a bare table when nobody matches', () => {
        render(<TeamAvailabilityGrid members={[]} dates={[DATE]} cells={new Map()} />);
        expect(screen.getByText(/No team members match/)).toBeTruthy();
    });

    it('prints the declared window inline at comfortable density, glyph at compact', () => {
        const inputs = scenario();
        const cells = buildTeamDayCells(inputs);

        const { unmount } = render(
            <TeamAvailabilityGrid
                members={inputs.members}
                dates={inputs.dates}
                cells={cells}
                density="comfortable"
            />,
        );
        // The times are visible text, not only a title attribute.
        expect(screen.getAllByText('07:00–23:00').length).toBeGreaterThan(0);
        unmount();

        render(
            <TeamAvailabilityGrid
                members={inputs.members}
                dates={inputs.dates}
                cells={cells}
                density="compact"
            />,
        );
        // …and the state is still announced for screen readers.
        expect(
            screen.getByLabelText(/Priya Raman, Mon 10 Aug: Available 07:00–23:00/),
        ).toBeTruthy();
    });

    it('keeps the legend in step with the cells', () => {
        const inputs = scenario();
        render(
            <TeamAvailabilityGrid
                members={inputs.members}
                dates={inputs.dates}
                cells={buildTeamDayCells(inputs)}
            />,
        );
        // The legend renders collapsed; expanding it must show every state.
        fireEvent.click(screen.getByRole('button', { name: /badge legend/i }));
        for (const label of Object.values(TEAM_DAY_STATE_LABELS)) {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
    });
});

describe('TeamDayTimeline', () => {
    it('renders a per-member hour track for a single day', () => {
        const inputs = scenario();
        const cells = buildTeamDayCells(inputs);

        render(<TeamDayTimeline members={inputs.members} date={DATE} cells={cells} />);

        expect(screen.getByText(/Monday 10 August/)).toBeTruthy();
        expect(screen.getByText(/Priya Raman: Available, available 07:00 to 23:00/)).toBeTruthy();
        // The never-declared member still gets a row and a word, not a blank track.
        expect(screen.getByText(/Sam Okoro: Not declared/)).toBeTruthy();
    });
});

describe('pagination helpers', () => {
    it('slices the requested page', () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        expect(paginate(items, 1, 4)).toEqual([0, 1, 2, 3]);
        expect(paginate(items, 3, 4)).toEqual([8, 9]);
    });

    it('clamps a page index that ran off the end instead of returning nothing', () => {
        // Happens whenever a filter shrinks the list while you are on a late page.
        const items = Array.from({ length: 10 }, (_, i) => i);
        expect(paginate(items, 99, 4)).toEqual([8, 9]);
        expect(paginate(items, 0, 4)).toEqual([0, 1, 2, 3]);
    });

    it('always reports at least one page, even when empty', () => {
        expect(pageCount(0, 25)).toBe(1);
        expect(pageCount(26, 25)).toBe(2);
        expect(pageCount(50, 25)).toBe(2);
    });
});

describe('CoverageHeatmap', () => {
    it('labels every cell with the full Required / Available / Assigned / Gap read-out', () => {
        const inputs = scenario();
        const buckets = buildCoverageBuckets(inputs);

        render(<CoverageHeatmap buckets={buckets} dates={inputs.dates} />);

        // Hour 7 has one unfilled shift and Priya declared but is unassigned.
        const cell = screen.getByLabelText(/Mon 10 Aug 07:00 — required 1, available 1, assigned 0/);
        expect(cell).toBeTruthy();
    });
});

describe('NearMissPanel', () => {
    it('keeps hook order stable across the empty and populated states', () => {
        const inputs = scenario();
        const misses = findNearMisses(inputs, buildTeamDayCells(inputs));

        // Mounting empty first, then re-rendering with data, is exactly the
        // transition a conditional hook would break.
        const { rerender } = render(<NearMissPanel nearMisses={[]} />);
        expect(screen.getByText(/No near misses in this range/)).toBeTruthy();

        rerender(<NearMissPanel nearMisses={misses} />);
        expect(screen.getByText(/30 min short/)).toBeTruthy();
        expect(screen.getByText(/Priya Raman/)).toBeTruthy();
    });
});

describe('coverage palette', () => {
    it('maps gap sign onto opposite arms of the diverging scale', () => {
        const short = gapFill(3, true, false);
        const over = gapFill(-3, true, false);
        const balanced = gapFill(0, true, false);

        expect(short).not.toBe(over);
        expect(balanced).toBe('#f0efec'); // neutral gray midpoint, not an endpoint
    });

    it('clamps the ramp beyond its last step instead of running off the end', () => {
        expect(gapFill(4, true, false)).toBe(gapFill(99, true, false));
    });

    it('encodes UNSET as grey fill', () => {
        expect(stateStyle('unset', false).fill).toBe('#6b7280');
        expect(stateStyle('unset', true).fill).toBe('#9ca3af');
    });

    it('returns empty glyph for states', () => {
        for (const state of ['assigned', 'available', 'leave', 'unavailable', 'unset'] as const) {
            expect(stateStyle(state, false).glyph).toBe('');
        }
    });
});

// ── Cell modes, week totals, compliance column ──────────────────────────────

/**
 * The Annual Shift Grid, absorbed. Rows, filters and pagination are shared with
 * the availability view; only the cell contents change.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md
 */
describe('TeamAvailabilityGrid — hours and compliance modes', () => {
    const WEEK_DATES = [
        '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
        '2026-08-14', '2026-08-15', '2026-08-16',
    ];

    const members = [member({ profileId: 'p1', fullName: 'Priya Raman' })];

    const hoursShifts: RawTeamShift[] = [
        { ...shiftBase, id: 'a', shiftDate: '2026-08-10', startTime: '09:00', endTime: '17:00', assignedEmployeeId: 'p1', roleName: 'Guard', netMinutes: 450 },
        { ...shiftBase, id: 'b', shiftDate: '2026-08-11', startTime: '09:00', endTime: '17:00', assignedEmployeeId: 'p1', roleName: 'Guard', netMinutes: 420, isDraft: true },
    ];

    const fold = () =>
        buildHoursByEmployee(hoursShifts, members, {
            start: new Date('2026-07-20T00:00:00'),
            end: new Date('2026-08-16T00:00:00'),
        });

    const renderGrid = (over: Partial<React.ComponentProps<typeof TeamAvailabilityGrid>> = {}) => {
        const hours = fold();
        const compliance = new Map([
            ['p1', computeEmpComp(
                hours.byProfile.get('p1')!.byWeek,
                hours.byProfile.get('p1')!.byDate,
                hours.sortedWeekKeys,
                'FT',
                38,
            )],
        ]);
        return render(
            <TeamAvailabilityGrid
                members={members}
                dates={WEEK_DATES}
                cells={new Map()}
                density="comfortable"
                weekColumns={buildWeekColumns(WEEK_DATES)}
                hoursByProfile={hours.byProfile}
                complianceByProfile={compliance}
                {...over}
            />,
        );
    };

    it('announces hours in text, not as a fill alone', () => {
        renderGrid({ cellMode: 'hours' });
        expect(screen.getByLabelText(/Priya Raman, Mon 10 Aug: 7.5 hours/)).toBeTruthy();
    });

    it('says a day is draft rather than only drawing it dashed', () => {
        renderGrid({ cellMode: 'hours' });
        expect(screen.getByLabelText(/Priya Raman, Tue 11 Aug: 7 hours, draft/)).toBeTruthy();
    });

    it('distinguishes a day with no shifts from a zero-hour day', () => {
        renderGrid({ cellMode: 'hours' });
        expect(screen.getByLabelText(/Priya Raman, Wed 12 Aug: no hours/)).toBeTruthy();
    });

    it('announces a compliance verdict per cell, never colour alone', () => {
        renderGrid({ cellMode: 'compliance' });
        expect(screen.getByLabelText(/Priya Raman, Mon 10 Aug: 7.5 hours, OK/)).toBeTruthy();
    });

    it('draws one week total column carrying the true week hours', () => {
        renderGrid({ cellMode: 'hours' });
        // 7.5 + 7 = 14.5 across the ISO week.
        expect(screen.getByLabelText(/Priya Raman, week W33: 14.5 hours/)).toBeTruthy();
    });

    it('says a week total is a FULL-week figure when the range only shows part of it', () => {
        const partial = ['2026-08-14', '2026-08-15', '2026-08-16'];
        const hours = fold();
        render(
            <TeamAvailabilityGrid
                members={members}
                dates={partial}
                cells={new Map()}
                cellMode="hours"
                weekColumns={buildWeekColumns(partial)}
                hoursByProfile={hours.byProfile}
                complianceByProfile={new Map()}
            />,
        );
        expect(
            screen.getByLabelText(/week W33.*full-week total, 3 of 7 days shown/),
        ).toBeTruthy();
    });

    it('writes the row compliance status as words beside the icon', () => {
        renderGrid({ cellMode: 'compliance' });
        expect(screen.getAllByText(/^OK$/).length).toBeGreaterThan(0);
    });

    it('renders neither week totals nor a status column when given none', () => {
        render(
            <TeamAvailabilityGrid members={members} dates={WEEK_DATES} cells={new Map()} />,
        );
        expect(screen.queryByText('Compliance')).toBeNull();
        expect(screen.queryByText('W33')).toBeNull();
    });

    it('badges a work-limited visa on the member row', () => {
        renderGrid({ cellMode: 'hours', restrictedWorkLimits: new Set(['p1']) });
        expect(screen.getByTitle(/Work-limited visa/)).toBeTruthy();
    });

    // jsdom does no layout, so these assert the STRUCTURE the layout depends on.
    // The bug they exist for: sizing day columns as `100% / dates.length` while
    // week and status columns also occupy the row overflows it by exactly the
    // width of those columns.
    it('emits one header cell per day, per week, plus name and status when cellMode is compliance', () => {
        const { container } = renderGrid({ cellMode: 'compliance' });
        const headerCells = container.querySelectorAll('thead th');
        // 1 name + 7 days + 1 week total + 1 status
        expect(headerCells).toHaveLength(10);
    });

    it('keeps every body row the same width as the header', () => {
        const { container } = renderGrid({ cellMode: 'hours' });
        const headerCells = container.querySelectorAll('thead tr > *');
        const bodyCells = container.querySelectorAll('tbody tr:first-child > *');
        expect(bodyCells.length).toBe(headerCells.length);
    });

    // Asserted on the reserved width, not on the calc() spelling — jsdom
    // rewrites `(100% - Xpx) / 7` into `0.1428… * (100% - Xpx)`.
    it('subtracts the week and status columns from the width it shares out', () => {
        const { container } = renderGrid({ cellMode: 'compliance' });
        const dayHeader = container.querySelectorAll('thead th')[1] as HTMLElement;
        // NAME_COL 220 + one WEEK_COL 78 + STATUS_COL 152 = 450px reserved.
        expect(dayHeader.style.width).toContain('100% - 450px');
    });

    it('reserves nothing for columns it is not drawing', () => {
        const { container } = render(
            <TeamAvailabilityGrid
                members={members}
                dates={WEEK_DATES}
                cells={new Map()}
                density="comfortable"
            />,
        );
        const dayHeader = container.querySelectorAll('thead th')[1] as HTMLElement;
        expect(dayHeader.style.width).toContain('100% - 220px');
    });
});

// ── Fatigue · Utilization · Fairness ────────────────────────────────────────

/**
 * These three were asked for as three more per-cell modes. Only fatigue IS one.
 * Utilization's denominator is a weekly contract and fairness is a 91-day
 * cohort comparison, so the grid reports those in the week column and the row
 * summary respectively — and these tests hold that line, because the failure
 * mode is a plausible-looking number in a cell that means nothing.
 */
describe('TeamAvailabilityGrid — metric granularity', () => {
    const WEEK = [
        '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
        '2026-08-14', '2026-08-15', '2026-08-16',
    ];
    const ft = member({ profileId: 'p1', fullName: 'Priya Raman', contractedWeeklyHours: 38 });

    const shifts: RawTeamShift[] = [
        { ...shiftBase, id: 'n', shiftDate: '2026-08-10', startTime: '22:00', endTime: '06:00', assignedEmployeeId: 'p1', roleName: null, netMinutes: 450 },
        { ...shiftBase, id: 'sat', shiftDate: '2026-08-15', startTime: '09:00', endTime: '17:00', assignedEmployeeId: 'p1', roleName: null, netMinutes: 450 },
    ];

    const renderMode = (cellMode: React.ComponentProps<typeof TeamAvailabilityGrid>['cellMode'], over = {}) => {
        const range = { start: new Date('2026-07-20T00:00:00'), end: new Date('2026-08-16T00:00:00') };
        const hours = buildHoursByEmployee(shifts, [ft], range);
        return render(
            <TeamAvailabilityGrid
                members={[ft]}
                dates={WEEK}
                cells={new Map()}
                density="comfortable"
                cellMode={cellMode}
                weekColumns={buildWeekColumns(WEEK)}
                hoursByProfile={hours.byProfile}
                complianceByProfile={new Map()}
                fatigueByProfile={buildFatigueByEmployee(shifts, [ft], WEEK)}
                fairnessContribution={new Map([['p1', new Map([
                    ['2026-08-15', dayFairnessContribution([shifts[1]])!],
                ])]])}
                {...over}
            />,
        );
    };

    it('announces a fatigue score and its band per day', () => {
        renderMode('fatigue');
        expect(screen.getByLabelText(/Priya Raman, Mon 10 Aug: fatigue [\d.]+, /)).toBeTruthy();
    });

    it('says "not rostered" on a day with no shift rather than showing a decayed residue', () => {
        renderMode('fatigue');
        expect(screen.getByLabelText(/Priya Raman, Tue 11 Aug: not rostered/)).toBeTruthy();
    });

    // Utilization has no daily value; the cell must not imply one.
    it('labels utilization cells as hours toward the week, not as a percentage', () => {
        renderMode('utilization');
        expect(screen.getByLabelText(/Priya Raman, Mon 10 Aug: 7.5 hours toward the week/)).toBeTruthy();
    });

    it('reports the utilization percentage in the week column, where its contract lives', () => {
        renderMode('utilization');
        // 15h across the week against a 38h contract ≈ 39%.
        expect(screen.getByLabelText(/week W33.*39 percent of contract/)).toBeTruthy();
        expect(screen.getByText('39%')).toBeTruthy();
    });

    it('says so rather than showing 0% when there is no contract to measure against', () => {
        const casual = member({ profileId: 'p1', fullName: 'Priya Raman', contractedWeeklyHours: 0 });
        const range = { start: new Date('2026-07-20T00:00:00'), end: new Date('2026-08-16T00:00:00') };
        const hours = buildHoursByEmployee(shifts, [casual], range);
        render(
            <TeamAvailabilityGrid
                members={[casual]}
                dates={WEEK}
                cells={new Map()}
                cellMode="utilization"
                weekColumns={buildWeekColumns(WEEK)}
                hoursByProfile={hours.byProfile}
                complianceByProfile={new Map()}
            />,
        );
        expect(screen.getByLabelText(/no contracted hours to measure utilization against/)).toBeTruthy();
        expect(screen.getByText('No contract')).toBeTruthy();
    });

    // Fairness cells are the day's CONTRIBUTION, never a fairness score.
    it('describes a fairness cell as what the day contributed', () => {
        renderMode('fairness');
        expect(screen.getByLabelText(/Priya Raman, Sat 15 Aug: Saturday, weight 1/)).toBeTruthy();
    });

    it('marks an ordinary weekday as carrying no unsociable loading', () => {
        renderMode('fairness');
        expect(screen.getByLabelText(/Mon 10 Aug: not rostered/)).toBeTruthy();
    });

    it('reports the fairness standing per person, over the ledger window', () => {
        renderMode('fairness', {
            fairnessStanding: new Map([[
                'p1',
                { debtByMetric: { sunday_shifts: 3 }, windowStart: '2026-05-14', windowEnd: '2026-08-13' },
            ]]),
        });
        expect(screen.getByText('Over share')).toBeTruthy();
        expect(screen.getByText(/\+6 vs team over 91 days/)).toBeTruthy();
    });

    it('says there is no ledger entry rather than implying perfect balance', () => {
        renderMode('fairness');
        expect(screen.getByText('No ledger entry')).toBeTruthy();
    });
});
