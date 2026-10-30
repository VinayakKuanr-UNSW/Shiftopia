import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterHorizontalFilterBar } from '../RosterHorizontalFilterBar';
import { useRosterStore, DEFAULT_ADVANCED_FILTERS } from '@/modules/rosters/state/useRosterStore';

describe('RosterHorizontalFilterBar', () => {
  const onCloseMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useRosterStore.setState({
      advancedFilters: DEFAULT_ADVANCED_FILTERS,
      isFilterBarOpen: true,
    });
  });

  it('renders all six horizontal filters with labels inside and the two action icon buttons (Clear and Apply)', () => {
    render(<RosterHorizontalFilterBar onClose={onCloseMock} />);

    // Check all six filter trigger buttons
    expect(screen.getByRole('button', { name: /State ID: All States/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lifecycle: All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assignment: All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Outcome: All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bidding: All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Trading: All/i })).toBeInTheDocument();

    // Check internal uppercase labels
    expect(screen.getByText('State ID')).toBeInTheDocument();
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Assignment')).toBeInTheDocument();
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('Bidding')).toBeInTheDocument();
    expect(screen.getByText('Trading')).toBeInTheDocument();

    // Check the two action icon buttons: Red Brush for Clear, Green Tick for Apply
    expect(screen.getByRole('button', { name: /^Clear filters$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Apply filters$/i })).toBeInTheDocument();

    // Verify X (close button) is removed
    expect(screen.queryByRole('button', { name: /Close filters/i })).not.toBeInTheDocument();
  });

  it('initially disables Clear when all filters are at default', () => {
    render(<RosterHorizontalFilterBar onClose={onCloseMock} />);
    const clearBtn = screen.getByRole('button', { name: /^Clear filters$/i });
    expect(clearBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables Clear when draft filters change and resets them on click', async () => {
    render(<RosterHorizontalFilterBar onClose={onCloseMock} />);

    // Open Lifecycle filter dropdown
    const lifecycleTrigger = screen.getByRole('button', { name: /Lifecycle: All/i });
    fireEvent.click(lifecycleTrigger);

    // Select "Draft"
    const draftOption = await screen.findByRole('menuitem', { name: /Draft/i }).catch(() =>
      screen.findByText('Draft')
    );
    fireEvent.click(draftOption);

    // Lifecycle button should now reflect Draft
    expect(screen.getByRole('button', { name: /Lifecycle: Draft/i })).toBeInTheDocument();

    // Clear button should now be enabled
    const clearBtn = screen.getByRole('button', { name: /^Clear filters$/i });
    expect(clearBtn).not.toHaveAttribute('aria-disabled', 'true');

    // Click Clear
    fireEvent.click(clearBtn);

    // Lifecycle should reset back to All
    expect(screen.getByRole('button', { name: /Lifecycle: All/i })).toBeInTheDocument();
  });

  it('applies draft filter changes to useRosterStore and closes the bar on Apply', async () => {
    render(<RosterHorizontalFilterBar onClose={onCloseMock} />);

    // Open Assignment filter dropdown
    const assignmentTrigger = screen.getByRole('button', { name: /Assignment: All/i });
    fireEvent.click(assignmentTrigger);

    // Select "Unassigned"
    const unassignedOption = await screen.findByRole('menuitem', { name: /Unassigned/i }).catch(() =>
      screen.findByText('Unassigned')
    );
    fireEvent.click(unassignedOption);

    expect(screen.getByRole('button', { name: /Assignment: Unassigned/i })).toBeInTheDocument();

    // Click Apply (Green Tick)
    const applyBtn = screen.getByRole('button', { name: /^Apply filters$/i });
    fireEvent.click(applyBtn);

    // Check store updated
    expect(useRosterStore.getState().advancedFilters.assignmentStatus).toBe('unassigned');
    // Check onClose was called
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
});
