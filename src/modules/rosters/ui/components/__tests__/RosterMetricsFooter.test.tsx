import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterMetricsFooter } from '../RosterMetricsFooter';

describe('RosterMetricsFooter', () => {
  const baseProps = {
    totalShifts: 134,
    assignedShifts: 87,
    unfilledShifts: 47,
    scheduledCost: 35444.96,
    actualCost: 0,
    scheduledNetMinutes: 952 * 60,
    actualNetMinutes: 0,
    costedShifts: 133,
    uncostedShifts: 1,
    actualShifts: 0,
  };

  const sampleStateCounts = {
    S1: 47,
    S2: 40,
    S3: 5,
    S4: 35,
    S5: 2,
    S9: 1,
    S10: 0,
    S11: 4,
    S13: 0,
    S15: 0,
  };

  it('renders Total Shifts dropdown trigger with All States and companion View Count card', () => {
    render(
      <RosterMetricsFooter
        {...baseProps}
        stateCounts={sampleStateCounts}
      />
    );

    // Total shifts dropdown trigger
    expect(screen.getByText('Total Shifts')).toBeInTheDocument();
    expect(screen.getByText('All States')).toBeInTheDocument();

    // Companion View Count card
    expect(screen.getByText('All In View')).toBeInTheDocument();
    expect(screen.getByText('134')).toBeInTheDocument();
    expect(screen.getByText('shifts')).toBeInTheDocument();

    // Far right Scheduled and Actual cards
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('952h 00m')).toBeInTheDocument();
    expect(screen.getByText('$35444.96')).toBeInTheDocument();
    expect(screen.getByText('133/134 priced')).toBeInTheDocument();

    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByText('0h 00m')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('none worked')).toBeInTheDocument();
  });

  it('updates display when a specific state is selected', () => {
    render(
      <RosterMetricsFooter
        {...baseProps}
        stateCounts={sampleStateCounts}
        selectedState="S1"
      />
    );

    // Dropdown trigger shows S1 — Draft without colored pill badges
    expect(screen.getByText('S1 — Draft')).toBeInTheDocument();

    // Companion card displays S1 In View and its count (47)
    expect(screen.getByText('S1 In View')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('opens popover on click and invokes onSelectState when choosing an option', () => {
    const onSelectStateMock = vi.fn();
    render(
      <RosterMetricsFooter
        {...baseProps}
        stateCounts={sampleStateCounts}
        onSelectState={onSelectStateMock}
      />
    );

    // Click Total Shifts trigger
    const trigger = screen.getByRole('button', { name: /Total Shifts/i });
    fireEvent.click(trigger);

    // Popover content is visible
    expect(screen.getByPlaceholderText('Search shift states...')).toBeInTheDocument();
    expect(screen.getByText('S1 — Draft')).toBeInTheDocument();
    expect(screen.getByText('S2 — Draft (Assigned)')).toBeInTheDocument();

    // Click S1 option
    const s1Option = screen.getByText('S1 — Draft');
    fireEvent.click(s1Option);

    expect(onSelectStateMock).toHaveBeenCalledWith('S1');
  });

  it('invokes onSelectState(null) when All States is selected in dropdown', () => {
    const onSelectStateMock = vi.fn();
    render(
      <RosterMetricsFooter
        {...baseProps}
        stateCounts={sampleStateCounts}
        selectedState="S1"
        onSelectState={onSelectStateMock}
      />
    );

    const trigger = screen.getByRole('button', { name: /Total Shifts/i });
    fireEvent.click(trigger);

    const allStatesOption = screen.getByText('All States');
    fireEvent.click(allStatesOption);

    expect(onSelectStateMock).toHaveBeenCalledWith(null);
  });

  it('renders dynamic UNKNOWN state in popover when present in stateCounts with count > 0', () => {
    const countsWithUnknown = {
      S1: 10,
      UNKNOWN: 3,
    };

    render(
      <RosterMetricsFooter
        {...baseProps}
        totalShifts={13}
        stateCounts={countsWithUnknown}
      />
    );

    const trigger = screen.getByRole('button', { name: /Total Shifts/i });
    fireEvent.click(trigger);

    expect(screen.getByText('UNKNOWN — Unknown')).toBeInTheDocument();
  });

  it('renders budget panel when showBudget is true', () => {
    render(
      <RosterMetricsFooter
        {...baseProps}
        budget={50000}
        remainingBudget={14555.04}
        showBudget={true}
      />
    );

    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('$50000.00')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('$14555.04')).toBeInTheDocument();
  });
});
