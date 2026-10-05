import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MobileRosterAgendaView from '../MobileRosterAgendaView';

vi.mock('../ShiftDetailsDialog', () => ({ default: () => null }));
vi.mock('../MobileShiftCard', () => ({
  MobileShiftCard: ({ shiftData }: any) => <div>{shiftData.shift.id}</div>,
}));

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 17 + i));

describe('MobileRosterAgendaView — the grid survives an empty range', () => {
  it('still renders one section per day when nothing is scheduled', () => {
    // The regression: a `totalShifts === 0` short-circuit replaced the whole
    // agenda with a single centred panel, so an empty week lost its dates,
    // its today marker and anything to scroll — the calendar simply vanished.
    render(
      <MobileRosterAgendaView days={WEEK} getShiftsForDate={() => []} />,
    );

    for (const day of WEEK) {
      const heading = day.toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      expect(
        screen.getByRole('region', { name: new RegExp(heading.replace(/,/g, ''), 'i') }),
      ).toBeInTheDocument();
    }

    // Each day states its own emptiness rather than the range stating it once.
    expect(screen.getAllByText('No shifts')).toHaveLength(WEEK.length);
    expect(screen.getAllByText(/0 shifts/)).toHaveLength(WEEK.length);
  });

  it('announces the empty range once for screen readers', () => {
    render(<MobileRosterAgendaView days={WEEK} getShiftsForDate={() => []} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'No shifts scheduled across 7 days.',
    );
  });

  it('renders shifts on the days that have them and empty rows elsewhere', () => {
    const shift = {
      shift: { id: 'shift-1' },
      groupName: 'Theatre',
      groupColor: 'theatre',
      subGroupName: 'Set-up',
    } as any;

    render(
      <MobileRosterAgendaView
        days={WEEK}
        getShiftsForDate={(d) => (d.getDate() === 20 ? [shift] : [])}
      />,
    );

    expect(screen.getByText('shift-1')).toBeInTheDocument();
    expect(screen.getAllByText('No shifts')).toHaveLength(WEEK.length - 1);
    expect(screen.getByRole('status')).toHaveTextContent('1 shift across 7 days.');
  });
});
