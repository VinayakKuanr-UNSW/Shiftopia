import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
    useTheme: () => ({ isDark: false }),
}));

import TeamMobileDayList from '../TeamMobileDayList';
import TeamMobileCoverage from '../TeamMobileCoverage';
import { buildTeamDayCells } from '../../../domain/team-coverage';
import { buildHoursByEmployee, computeEmpComp } from '../../../domain/hours-compliance';
import type {
    CoverageBucket,
    RawTeamShift,
    TeamAvailabilityInputs,
    TeamMember,
} from '../../../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

/**
 * The phone composition exists because a people x days matrix cannot satisfy
 * SC 1.4.10 (Reflow) at 320px. These tests hold the accessibility contract that
 * replaces it: real list semantics, every state carried in TEXT, and controls
 * that meet the 44px target floor.
 */

const DATE = '2026-08-10';

const member = (over: Partial<TeamMember> & { profileId: string }): TeamMember => ({
    fullName: over.profileId,
    roleId: null,
    roleName: 'Guard',
    departmentId: null,
    subDepartmentId: null,
    employmentStatus: 'Casual',
    ...over,
});

const shiftBase = { netMinutes: 480, isDraft: false, deptName: null, subDeptName: null, unpaidBreakMinutes: 30 };

const shift = (over: Partial<RawTeamShift> & { shiftDate: string }): RawTeamShift => ({
    id: `s-${over.shiftDate}-${over.assignedEmployeeId ?? 'x'}`,
    startTime: '09:00',
    endTime: '17:00',
    assignedEmployeeId: 'p1',
    roleName: 'Guard',
    ...shiftBase,
    ...over,
});

const avail = (windows: Array<{ start: string; end: string }>): EmployeeAvailability =>
    ({
        employeeId: 'p1',
        date: DATE,
        availableWindows: windows,
        unavailableWindows: [],
        isFullyAvailable: false,
        isFullyUnavailable: windows.length === 0,
        hasData: true,
    }) as EmployeeAvailability;

const MEMBERS = [
    member({ profileId: 'p1', fullName: 'Priya Raman' }),
    member({ profileId: 'p2', fullName: 'Sam Okoro', hasDeclared: false }),
];

function inputs(): TeamAvailabilityInputs {
    return {
        members: MEMBERS,
        dates: [DATE],
        availability: new Map([['p1', new Map([[DATE, avail([{ start: '07:00', end: '23:00' }])]])]]),
        shifts: [],
        leaveDays: [],
        required: null,
        requiredSource: 'shifts',
    };
}

const HOURS_SHIFTS: RawTeamShift[] = [
    shift({ shiftDate: DATE, netMinutes: 450, assignedEmployeeId: 'p1' }),
    shift({ shiftDate: '2026-08-11', netMinutes: 420, assignedEmployeeId: 'p1', isDraft: true }),
];

const fold = () =>
    buildHoursByEmployee(HOURS_SHIFTS, MEMBERS, {
        start: new Date('2026-07-20T00:00:00'),
        end: new Date('2026-08-16T00:00:00'),
    });

const renderList = (
    over: Partial<React.ComponentProps<typeof TeamMobileDayList>> = {},
) => {
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
        <TeamMobileDayList
            members={MEMBERS}
            date={DATE}
            cells={buildTeamDayCells(inputs())}
            hoursByProfile={hours.byProfile}
            complianceByProfile={compliance}
            {...over}
        />,
    );
};

describe('TeamMobileDayList — structure (SC 1.3.1)', () => {
    it('is a real list with one item per member', () => {
        renderList();
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(MEMBERS.length);
    });

    it('names the day for assistive tech even though the heading is visually hidden', () => {
        renderList();
        expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
        expect(screen.getByText(/Monday 10 August 2026/)).toBeTruthy();
    });

    it('pairs each label with its value in a definition list', () => {
        const { container } = renderList();
        expect(container.querySelectorAll('dl').length).toBe(MEMBERS.length);
        expect(container.querySelectorAll('dt').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('dt').length).toBe(
            container.querySelectorAll('dd').length,
        );
    });

    it('renders an empty state rather than a bare list when nobody matches', () => {
        render(<TeamMobileDayList members={[]} date={DATE} cells={new Map()} />);
        expect(screen.getByText(/No team members match/)).toBeTruthy();
    });
});

describe('TeamMobileDayList — text, never colour alone (SC 1.4.1)', () => {
    it('announces the availability state as words', () => {
        renderList({ cellMode: 'availability' });
        expect(screen.getByLabelText(/Priya Raman.*Available/)).toBeTruthy();
        // Never-declared reads as "Not declared", not as "unavailable".
        expect(screen.getByLabelText(/Sam Okoro.*Not declared/)).toBeTruthy();
    });

    it('shows the declared window as visible text', () => {
        renderList({ cellMode: 'availability' });
        expect(screen.getByText('07:00–23:00')).toBeTruthy();
    });

    it('states hours and the week total in words', () => {
        renderList({ cellMode: 'hours' });
        // 7.5h on the 10th + 7h on the 11th, both in ISO week 33.
        expect(screen.getByLabelText(/Priya Raman.*7.5 hours.*week 14.5 hours/)).toBeTruthy();
        expect(screen.getByText('7.5h')).toBeTruthy();
        expect(screen.getByText('14.5h')).toBeTruthy();
    });

    it('says "not rostered" rather than showing an empty cell', () => {
        renderList({ cellMode: 'hours' });
        expect(screen.getByLabelText(/Sam Okoro.*not rostered/)).toBeTruthy();
    });

    it('writes the compliance verdict next to its icon', () => {
        renderList({ cellMode: 'compliance' });
        // The word is present, not only the severity hue.
        expect(screen.getAllByText(/^OK$/).length).toBeGreaterThan(0);
    });

    it('marks draft hours in text', () => {
        renderList({ cellMode: 'hours', date: '2026-08-11' });
        expect(screen.getByText(/^Draft$/)).toBeTruthy();
    });

    it('badges a work-limited visa with a word, not just an icon', () => {
        renderList({ cellMode: 'hours', restrictedWorkLimits: new Set(['p1']) });
        expect(screen.getByText('Visa')).toBeTruthy();
        expect(screen.getByLabelText(/Priya Raman.*work-limited visa/)).toBeTruthy();
    });

    it('keeps the severity out of the availability mode, where it means nothing', () => {
        renderList({ cellMode: 'availability' });
        expect(screen.queryByText(/^OK$/)).toBeNull();
    });
});

describe('TeamMobileDayList — interaction contract (SC 4.1.2, 2.5.5)', () => {
    it('exposes each card as a button only when it activates something', () => {
        const onSelectMember = vi.fn();
        renderList({ onSelectMember });
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(MEMBERS.length);
        fireEvent.click(buttons[0]);
        expect(onSelectMember).toHaveBeenCalledWith(
            expect.objectContaining({ profileId: 'p1' }),
        );
    });

    it('does not fake a button when there is nothing to activate', () => {
        renderList();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.getAllByRole('group')).toHaveLength(MEMBERS.length);
    });

    it('gives the whole card as the touch target, past the 44px floor', () => {
        const { container } = renderList({ onSelectMember: vi.fn() });
        const card = container.querySelector('button');
        expect(card?.className).toContain('min-h-[44px]');
    });

    it('announces the whole card summary as its accessible name', () => {
        renderList({ onSelectMember: vi.fn(), cellMode: 'compliance' });
        const name = screen.getAllByRole('button')[0].getAttribute('aria-label') ?? '';
        // Identity, role, employment, hours and verdict — all in one string.
        expect(name).toMatch(/Priya Raman/);
        expect(name).toMatch(/Guard/);
        expect(name).toMatch(/Casual/);
        expect(name).toMatch(/OK/);
    });
});

describe('TeamMobileCoverage', () => {
    const buckets: CoverageBucket[] = [
        { date: DATE, hour: 9, required: 3, available: 5, assigned: 2, gap: 1, shortfall: 0 },
        { date: DATE, hour: 10, required: 2, available: 1, assigned: 0, gap: 2, shortfall: 1 },
        { date: DATE, hour: 3, required: 0, available: 0, assigned: 0, gap: 0, shortfall: 0 },
    ];

    it('states every number in text rather than only as a fill', () => {
        render(<TeamMobileCoverage buckets={buckets} date={DATE} />);
        expect(screen.getByLabelText(/09:00, 3 required, 2 assigned, 5 available, short 1/)).toBeTruthy();
    });

    it('drops hours with no demand instead of drawing 24 empty rows', () => {
        render(<TeamMobileCoverage buckets={buckets} date={DATE} />);
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.queryByText('03:00')).toBeNull();
    });

    it('separates an unfillable shortfall from an ordinary gap', () => {
        render(<TeamMobileCoverage buckets={buckets} date={DATE} />);
        expect(screen.getByText(/1 of this gap cannot be filled/)).toBeTruthy();
        expect(
            screen.getByLabelText(/10:00.*cannot be filled from declared availability/),
        ).toBeTruthy();
    });

    it('says "staffed" and "over" rather than relying on the diverging hue', () => {
        render(
            <TeamMobileCoverage
                buckets={[
                    { date: DATE, hour: 9, required: 2, available: 4, assigned: 2, gap: 0, shortfall: 0 },
                    { date: DATE, hour: 10, required: 1, available: 4, assigned: 3, gap: -2, shortfall: 0 },
                ]}
                date={DATE}
            />,
        );
        expect(screen.getByText('Staffed')).toBeTruthy();
        expect(screen.getByText('Over 2')).toBeTruthy();
    });

    it('renders an empty state when nothing is scheduled', () => {
        render(<TeamMobileCoverage buckets={[]} date={DATE} />);
        expect(screen.getByText(/Nothing is scheduled/)).toBeTruthy();
    });
});
