import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GridFunctionBar, { type ViewKey, type SortOptionKey } from '../GridFunctionBar';
import type { CellMode } from '../TeamAvailabilityGrid';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

describe('GridFunctionBar', () => {
  const defaultProps = {
    view: 'grid' as ViewKey,
    onViewChange: vi.fn(),
    selectedDate: new Date('2026-10-23T10:00:00Z'),
    viewType: 'week' as const,
    onDateChange: vi.fn(),
    onViewTypeChange: vi.fn(),
    cellMode: 'availability' as CellMode,
    onCellModeChange: vi.fn(),
    sortKey: 'name' as SortOptionKey,
    onSortChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    employmentStatuses: [] as string[],
    onEmploymentStatusesChange: vi.fn(),
    onOpenStats: vi.fn(),
    onExport: vi.fn(),
    canExport: true,
    onRefresh: vi.fn(),
    isLoading: false,
  };

  it('renders 3 zones: Views on left, Date navigator in center, and Functions as icons on right', () => {
    render(<GridFunctionBar {...defaultProps} />);

    // Zone 1: Views
    expect(screen.getByRole('radio', { name: /Team view/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Coverage view/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Near misses view/i })).toBeInTheDocument();

    // Zone 2: Date navigator
    expect(screen.getByLabelText(/Previous date period/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Next date period/i)).toBeInTheDocument();

    // Zone 3: Functions as Icons
    expect(screen.getByLabelText(/Cells Show/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sort by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter members/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Badge legend & status reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Availability Stats/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Export CSV/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reload grid/i)).toBeInTheDocument();
  });

  it('verifies search input is completely removed from the function row toolbar', () => {
    const { container } = render(<GridFunctionBar {...defaultProps} />);
    // A labelled group: role=toolbar would promise arrow-key movement the row does not have.
    const toolbar = screen.getByRole('group', { name: /Grid navigation and functions/i });
    expect(toolbar.querySelector('input[type="search"]')).toBeNull();
  });

  it('triggers onViewChange when a view tab is clicked', () => {
    render(<GridFunctionBar {...defaultProps} />);
    const coverageTab = screen.getByRole('radio', { name: /Coverage view/i });
    fireEvent.click(coverageTab);
    expect(defaultProps.onViewChange).toHaveBeenCalledWith('coverage');
  });

  it('triggers onOpenStats, onExport, and onRefresh when their respective icon buttons are clicked', () => {
    render(<GridFunctionBar {...defaultProps} />);

    fireEvent.click(screen.getByLabelText(/Availability Stats/i));
    expect(defaultProps.onOpenStats).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/Export CSV/i));
    expect(defaultProps.onExport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/Reload grid/i));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('opens Global Scope popover when Filters icon button is clicked and allows toggling status', () => {
    render(<GridFunctionBar {...defaultProps} />);
    const filterBtn = screen.getByLabelText(/Filter members/i);
    fireEvent.click(filterBtn);

    expect(screen.getByPlaceholderText(/Search team member or status.../i)).toBeInTheDocument();
    expect(screen.getByText('Full-Time')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Full-Time'));
    expect(defaultProps.onEmploymentStatusesChange).toHaveBeenCalledWith(['Full-Time']);
  });

  it('opens Global Scope popover when Cell Mode icon button is clicked and allows selecting mode', () => {
    render(<GridFunctionBar {...defaultProps} />);
    const cellModeBtn = screen.getByLabelText(/Cells Show/i);
    fireEvent.click(cellModeBtn);

    expect(screen.getByPlaceholderText(/Search cell mode.../i)).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Compliance'));
    expect(defaultProps.onCellModeChange).toHaveBeenCalledWith('compliance');
  });

  it('opens Global Scope popover when Sort icon button is clicked and allows selecting sort order', () => {
    render(<GridFunctionBar {...defaultProps} />);
    const sortBtn = screen.getByLabelText(/Sort by/i);
    fireEvent.click(sortBtn);

    expect(screen.getByPlaceholderText(/Search sort order.../i)).toBeInTheDocument();
    expect(screen.getByText('Most Days')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Most Days'));
    expect(defaultProps.onSortChange).toHaveBeenCalledWith('most-days');
  });

  it('opens Badge Legend popover when info icon button is clicked', () => {
    render(<GridFunctionBar {...defaultProps} />);
    const infoBtn = screen.getByLabelText(/Badge legend & status reference/i);
    fireEvent.click(infoBtn);

    expect(screen.getByText(/INDICATOR & STATUS REFERENCE/i)).toBeInTheDocument();
    expect(screen.getByText(/Daily Availability States/i)).toBeInTheDocument();
    expect(screen.getByText(/Assigned/i)).toBeInTheDocument();
    expect(screen.getByText(/Contract based/i)).toBeInTheDocument();
  });
});
