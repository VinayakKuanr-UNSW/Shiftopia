import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

import { TimesheetFilterDrawer, EMPTY_FILTERS } from '../TimesheetFilterDrawer';
import { GroupBySelector } from '@/modules/core/ui/components/GroupBySelector';
import { TIMESHEET_GROUP_BY_OPTIONS } from '../../../domain/timesheet-grouping';
import type { TimesheetRow } from '../../../model/timesheet.types';

describe('Timesheet Filter & Group By Global Scope UI', () => {
  const mockEntries = [
    {
      id: 'shift-1',
      date: '2026-10-23',
      employee: 'Hannah Mehta',
      employeeId: 'EMP-001',
      group: 'convention_centre',
      subGroup: 'AM Base',
      role: 'Event Setup Team Member',
      scheduledStart: '08:00',
      scheduledEnd: '16:00',
      clockIn: '08:00',
      clockOut: '16:00',
      department: 'Events',
      remunerationLevel: 'Level 1',
      length: '8h 00m',
      netLength: '7h 30m',
      paidBreak: '0',
      unpaidBreak: '30',
      differential: '0',
      timesheetStatus: 'approved',
      liveStatus: 'completed',
    },
    {
      id: 'shift-2',
      date: '2026-10-23',
      employee: 'Chloe Alvarez',
      employeeId: 'EMP-002',
      group: 'office',
      subGroup: 'Administration',
      role: 'Event Setup Team Leader',
      scheduledStart: '09:00',
      scheduledEnd: '17:00',
      clockIn: '09:00',
      clockOut: '17:00',
      department: 'Events',
      remunerationLevel: 'Level 2',
      length: '8h 00m',
      netLength: '7h 30m',
      paidBreak: '0',
      unpaidBreak: '30',
      differential: '0',
      timesheetStatus: 'pending',
      liveStatus: 'completed',
    },
  ] as unknown as TimesheetRow[];

  it('renders GroupBySelector icon trigger and opens Global Scope popover on click', () => {
    const onChange = vi.fn();
    render(
      <GroupBySelector
        value="none"
        onChange={onChange}
        options={TIMESHEET_GROUP_BY_OPTIONS}
        triggerVariant="icon"
      />
    );

    const triggerBtn = screen.getByRole('button', { name: /group by: none/i });
    expect(triggerBtn).toBeInTheDocument();
    expect(triggerBtn).toHaveAttribute('aria-pressed', 'false');

    // Click to open popover
    fireEvent.click(triggerBtn);

    // Verify search bar input is present
    expect(screen.getByPlaceholderText(/search grouping.../i)).toBeInTheDocument();

    // Verify option items are present
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();

    // Select 'Role' option
    fireEvent.click(screen.getByText('Role'));
    expect(onChange).toHaveBeenCalledWith('role');
  });

  it('renders TimesheetFilterDrawer icon trigger and opens Global Scope UI popover on click', () => {
    const onApply = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <TimesheetFilterDrawer
        entries={mockEntries}
        appliedFilters={EMPTY_FILTERS}
        onApply={onApply}
        activeCount={0}
        statusFilter="all"
        onStatusFilterChange={onStatusChange}
        statusCounts={{ all: 2, pending: 1, approved: 1 }}
        statusOptions={[
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
        ]}
        statusSectionLabel="Timesheet Status"
        triggerVariant="icon"
      />
    );

    const filterBtn = screen.getByRole('button', { name: /^filters$/i });
    expect(filterBtn).toBeInTheDocument();

    // Click to open popover
    fireEvent.click(filterBtn);

    // Verify search bar
    expect(screen.getByPlaceholderText(/search filters \(status, group, role\)\.\.\./i)).toBeInTheDocument();

    // Verify categories & options
    expect(screen.getByText('Timesheet Status')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Convention')).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();

    // Click 'Pending' status filter
    fireEvent.click(screen.getByText('Pending'));
    expect(onStatusChange).toHaveBeenCalledWith('pending');

    // Click 'Convention' group filter
    fireEvent.click(screen.getByText('Convention'));
    expect(onApply).toHaveBeenCalledWith({
      groupTypes: ['convention_centre'],
      subGroups: [],
      roles: [],
    });
  });
});
