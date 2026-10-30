import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

import { SwapRequestsFunctionBar } from '../SwapRequestsFunctionBar';

describe('SwapRequestsFunctionBar', () => {
  const defaultProps = {
    viewMode: 'card' as const,
    onViewModeChange: vi.fn(),
    selectedDate: new Date(2026, 9, 23),
    viewType: 'month' as const,
    onDateChange: vi.fn(),
    onViewTypeChange: vi.fn(),
    onRangeChange: vi.fn(),
    groupBy: 'none' as const,
    onGroupByChange: vi.fn(),
    statusFilter: 'MANAGER_PENDING' as const,
    onStatusFilterChange: vi.fn(),
    statusCounts: { MANAGER_PENDING: 3, OPEN: 5, APPROVED: 8, REJECTED: 2, all: 18 },
    onRefresh: vi.fn(),
    isLoading: false,
  };

  it('renders 3 zones: Views on left, Date navigator in center, and Functions as icons on right', () => {
    render(<SwapRequestsFunctionBar {...defaultProps} />);

    // Left Zone: Views
    const listView = screen.getByRole('radio', { name: /list view/i });
    const cardView = screen.getByRole('radio', { name: /card view/i });
    expect(listView).toBeInTheDocument();
    expect(cardView).toBeInTheDocument();
    expect(cardView).toHaveAttribute('data-state', 'on');

    fireEvent.click(listView);
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('table');

    // Center Zone: D/3D/W/M & Date navigator
    expect(screen.getByRole('button', { name: /snap to today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous date period/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next date period/i })).toBeInTheDocument();

    // Right Zone: Filters, Group By, Refresh
    const filterBtn = screen.getByRole('button', { name: /filter by status: pending/i });
    expect(filterBtn).toBeInTheDocument();

    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    expect(groupByBtn).toBeInTheDocument();

    const reloadBtn = screen.getByRole('button', { name: /reload swap requests/i });
    expect(reloadBtn).toBeInTheDocument();
  });

  it('verifies search input is completely removed from the function row', () => {
    render(<SwapRequestsFunctionBar {...defaultProps} />);
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it('triggers onRefresh when Reload icon button is clicked', () => {
    render(<SwapRequestsFunctionBar {...defaultProps} />);
    const reloadBtn = screen.getByRole('button', { name: /reload swap requests/i });
    fireEvent.click(reloadBtn);
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('opens Global Scope popover when Filters icon button is clicked and allows selecting status', () => {
    render(<SwapRequestsFunctionBar {...defaultProps} />);
    const filterBtn = screen.getByRole('button', { name: /filter by status: pending/i });
    fireEvent.click(filterBtn);

    // Verify search input in detached top card
    expect(screen.getByPlaceholderText(/search status filters\.\.\./i)).toBeInTheDocument();

    // Verify status options
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();

    // Select 'Open'
    fireEvent.click(screen.getByText('Open'));
    expect(defaultProps.onStatusFilterChange).toHaveBeenCalledWith('OPEN');
  });

  it('opens Global Scope popover when Group By icon button is clicked and allows selecting grouping', () => {
    render(<SwapRequestsFunctionBar {...defaultProps} />);
    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    fireEvent.click(groupByBtn);

    // Verify search input in detached top card
    expect(screen.getByPlaceholderText(/search grouping\.\.\./i)).toBeInTheDocument();

    // Verify grouping options
    expect(screen.getByText('Flat List')).toBeInTheDocument();
    expect(screen.getByText('By Date')).toBeInTheDocument();
    expect(screen.getByText('By Status')).toBeInTheDocument();
    expect(screen.getByText('By Role')).toBeInTheDocument();
    expect(screen.getByText('By Venue Group')).toBeInTheDocument();

    // Select 'By Status'
    fireEvent.click(screen.getByText('By Status'));
    expect(defaultProps.onGroupByChange).toHaveBeenCalledWith('status');
  });
});
