import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

import { TimesheetFunctionBar } from '../TimesheetFunctionBar';

describe('TimesheetFunctionBar', () => {
  const defaultProps = {
    viewMode: 'timecard' as const,
    onViewModeChange: vi.fn(),
    selectedDate: new Date(2026, 9, 23),
    viewType: 'day' as const,
    onDateChange: vi.fn(),
    onViewTypeChange: vi.fn(),
    onRangeChange: vi.fn(),
    onRefresh: vi.fn(),
    isLoading: false,
    entries: [],
    appliedFilters: {
      groupTypes: [],
      subGroups: [],
      roles: [],
      payTypes: [],
    },
    onApplyFilters: vi.fn(),
    activeFilterCount: 0,
    groupBy: 'date' as const,
    onGroupByChange: vi.fn(),
    statusFilter: 'all',
    onStatusFilterChange: vi.fn(),
    statusCounts: {
      all: 10,
      pending: 4,
      auto_approved: 2,
      approved: 3,
      denied: 1,
      no_show: 0,
    },
  };

  it('renders left views toggle with List and Card modes', () => {
    render(<TimesheetFunctionBar {...defaultProps} />);

    const listViewBtn = screen.getByRole('radio', { name: /list view/i });
    const cardViewBtn = screen.getByRole('radio', { name: /card view/i });

    expect(listViewBtn).toBeInTheDocument();
    expect(cardViewBtn).toBeInTheDocument();
    expect(cardViewBtn).toHaveAttribute('data-state', 'on');
    expect(listViewBtn).toHaveAttribute('data-state', 'off');

    fireEvent.click(listViewBtn);
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('renders center date picker with Today button and period stepper', () => {
    render(<TimesheetFunctionBar {...defaultProps} />);

    expect(screen.getByRole('button', { name: /snap to today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous date period/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next date period/i })).toBeInTheDocument();
  });

  it('renders right functions including Refresh, Filters, and Group By', () => {
    render(<TimesheetFunctionBar {...defaultProps} />);

    const refreshBtn = screen.getByRole('button', { name: /reload data/i });
    expect(refreshBtn).toBeInTheDocument();

    fireEvent.click(refreshBtn);
    expect(defaultProps.onRefresh).toHaveBeenCalled();

    const filterBtn = screen.getByRole('button', { name: /filters/i });
    expect(filterBtn).toBeInTheDocument();

    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    expect(groupByBtn).toBeInTheDocument();
  });

  it('renders filter active badge when activeFilterCount > 0', () => {
    render(<TimesheetFunctionBar {...defaultProps} activeFilterCount={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filters \(5 active\)/i })).toBeInTheDocument();
  });

  it('marks groupBy icon button active when groupBy is not none', () => {
    render(<TimesheetFunctionBar {...defaultProps} groupBy="role" />);

    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    expect(groupByBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
