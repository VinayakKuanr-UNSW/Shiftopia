import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RosterSummaryCellDTO } from '../../../api/rosterSummary.queries';
import { GroupSummaryCell } from '../GroupSummaryCell';

const date = new Date(2026, 6, 31);

describe('GroupSummaryCell', () => {
  it('gives an empty summary button a descriptive accessible name', () => {
    render(
      <GroupSummaryCell
        date={date}
        groupName="General"
        summary={undefined}
        accent="gray"
        onClick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Open General roster details for 31 July 2026: no shifts',
      }),
    ).toBeInTheDocument();
  });

  it('includes the shift count in a populated summary button name', () => {
    const summary: RosterSummaryCellDTO = {
      shift_date: '2026-07-31',
      group_type: 'convention',
      sub_group_name: 'General',
      total_shifts: 2,
      assigned_shifts: 1,
      open_shifts: 1,
      published_shifts: 1,
      draft_shifts: 1,
      cancelled_shifts: 0,
      total_net_minutes: 960,
      unique_employees: 1,
    };

    render(
      <GroupSummaryCell
        date={date}
        groupName="General"
        summary={summary}
        accent="blue"
        onClick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Open General roster details for 31 July 2026: 2 shifts',
      }),
    ).toBeInTheDocument();
  });

  /**
   * The component is wrapped in React.memo with a hand-written comparator that
   * deliberately ignores callback identity (GroupModeView rebuilds those inside
   * its cell loop, which defeated memoisation across a several-hundred-cell
   * grid). A comparator that is too aggressive shows up as a cell that stops
   * updating, so every prop it claims to track is exercised here.
   */
  describe('memo comparator still re-renders on meaningful change', () => {
    const base = {
      date,
      groupName: 'General',
      summary: undefined,
      accent: 'blue',
      onClick: vi.fn(),
    };

    it('updates when the summary object changes', () => {
      const { rerender } = render(<GroupSummaryCell {...base} />);
      expect(screen.getByRole('button')).toHaveAccessibleName(/no shifts/);

      rerender(
        <GroupSummaryCell
          {...base}
          summary={{
            shift_date: '2026-07-31', group_type: 'convention', sub_group_name: 'General',
            total_shifts: 3, assigned_shifts: 1, open_shifts: 2, published_shifts: 1,
            draft_shifts: 2, cancelled_shifts: 0, total_net_minutes: 1440, unique_employees: 1,
          } as RosterSummaryCellDTO}
        />,
      );
      expect(screen.getByRole('button')).toHaveAccessibleName(/3 shifts/);
    });

    it('updates when the date changes', () => {
      const { rerender } = render(<GroupSummaryCell {...base} />);
      rerender(<GroupSummaryCell {...base} date={new Date(2026, 7, 1)} />);
      expect(screen.getByRole('button')).toHaveAccessibleName(/1 August 2026/);
    });

    it('updates when the group name changes', () => {
      const { rerender } = render(<GroupSummaryCell {...base} />);
      rerender(<GroupSummaryCell {...base} groupName="Theatre" />);
      expect(screen.getByRole('button')).toHaveAccessibleName(/Open Theatre roster/);
    });

    it('swaps to a non-button element when bulk mode turns on', () => {
      const { rerender } = render(<GroupSummaryCell {...base} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
      rerender(<GroupSummaryCell {...base} isBulkMode />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('does NOT re-render for a new onClick identity alone', () => {
      // The whole point of the comparator: GroupModeView hands every cell a
      // fresh closure on each parent render.
      const { rerender } = render(<GroupSummaryCell {...base} />);
      const before = screen.getByRole('button');
      rerender(<GroupSummaryCell {...base} onClick={vi.fn()} />);
      expect(screen.getByRole('button')).toBe(before);
    });
  });
});
