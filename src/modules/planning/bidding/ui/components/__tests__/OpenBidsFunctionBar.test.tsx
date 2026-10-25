import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

import { OpenBidsFunctionBar } from '../OpenBidsFunctionBar';

describe('OpenBidsFunctionBar', () => {
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
    activeToggle: 'urgent' as const,
    onToggleChange: vi.fn(),
    counts: { standard: 5, urgent: 2, resolved: 8, expired: 1 },
    onRunBatch: vi.fn(),
    isBatchRunning: false,
    canRunBatch: true,
  };

  it('renders 3 zones: Views on left, Date navigator in center, and Functions as icons on right', () => {
    render(<OpenBidsFunctionBar {...defaultProps} />);

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

    // Right Zone: Run Batch, Filters, Group By
    const runBatchBtn = screen.getByRole('button', { name: /run batch assignment/i });
    expect(runBatchBtn).toBeInTheDocument();

    const filterBtn = screen.getByRole('button', { name: /filter by status: urgent/i });
    expect(filterBtn).toBeInTheDocument();

    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    expect(groupByBtn).toBeInTheDocument();
  });

  it('verifies search input is completely removed from the function row', () => {
    render(<OpenBidsFunctionBar {...defaultProps} />);
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it('triggers onRunBatch when Run Batch icon button is clicked', () => {
    render(<OpenBidsFunctionBar {...defaultProps} />);
    const runBatchBtn = screen.getByRole('button', { name: /run batch assignment/i });
    fireEvent.click(runBatchBtn);
    expect(defaultProps.onRunBatch).toHaveBeenCalledTimes(1);
  });

  it('opens Global Scope popover when Filters icon button is clicked and allows selecting status', () => {
    render(<OpenBidsFunctionBar {...defaultProps} />);
    const filterBtn = screen.getByRole('button', { name: /filter by status: urgent/i });
    fireEvent.click(filterBtn);

    // Verify search input in detached top card
    expect(screen.getByPlaceholderText(/search status filters\.\.\./i)).toBeInTheDocument();

    // Verify status options
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();

    // Select 'Standard'
    fireEvent.click(screen.getByText('Standard'));
    expect(defaultProps.onToggleChange).toHaveBeenCalledWith('standard');
  });

  it('opens Global Scope popover when Group By icon button is clicked and allows selecting grouping', () => {
    render(<OpenBidsFunctionBar {...defaultProps} />);
    const groupByBtn = screen.getByRole('button', { name: /group by/i });
    fireEvent.click(groupByBtn);

    // Verify search input in detached top card
    expect(screen.getByPlaceholderText(/search grouping\.\.\./i)).toBeInTheDocument();

    // Verify grouping options
    expect(screen.getByText('Flat List')).toBeInTheDocument();
    expect(screen.getByText('By Date')).toBeInTheDocument();
    expect(screen.getByText('By Role')).toBeInTheDocument();

    // Select 'By Date'
    fireEvent.click(screen.getByText('By Date'));
    expect(defaultProps.onGroupByChange).toHaveBeenCalledWith('date');
  });
});
