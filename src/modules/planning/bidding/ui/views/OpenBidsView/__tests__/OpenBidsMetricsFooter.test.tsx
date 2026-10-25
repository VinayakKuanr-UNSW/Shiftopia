import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenBidsMetricsFooter } from '../OpenBidsMetricsFooter';
import type { ManagerBidShift } from '../types';

describe('OpenBidsMetricsFooter', () => {
  const sampleShifts: Partial<ManagerBidShift>[] = [
    {
      id: 'shift-1',
      bidCount: 3,
      toggle: 'standard',
    },
    {
      id: 'shift-2',
      bidCount: 1,
      toggle: 'urgent',
    },
    {
      id: 'shift-3',
      bidCount: 0,
      toggle: 'standard',
    },
    {
      id: 'shift-4',
      bidCount: 2,
      toggle: 'resolved',
    },
    {
      id: 'shift-5',
      bidCount: 0,
      toggle: 'expired',
    },
    {
      id: 'shift-6',
      bidCount: 0,
      toggle: 'expired',
    },
  ];

  it('renders marketplace overview pill and shift count correctly', () => {
    render(
      <OpenBidsMetricsFooter
        shifts={sampleShifts as ManagerBidShift[]}
        activeToggle="standard"
      />
    );

    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();

    expect(screen.getByText('Open Shifts')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('shifts')).toBeInTheDocument();
  });

  it('computes and displays the 4 core metric cards correctly', () => {
    render(
      <OpenBidsMetricsFooter
        shifts={sampleShifts as ManagerBidShift[]}
        activeToggle="standard"
      />
    );

    // Total bids = 3 + 1 + 0 + 2 + 0 + 0 = 6 bids across 6 shifts -> 1.0 avg
    expect(screen.getByText('Demand')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('From 6 bids')).toBeInTheDocument();

    // Coverage: 3 shifts with bids (shift-1, shift-2, shift-4) out of 6 -> 50%
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('3 of 6 shifts')).toBeInTheDocument();

    // Awarded: 1 resolved out of 6 -> 17%
    expect(screen.getByText('Awarded')).toBeInTheDocument();
    expect(screen.getByText('17%')).toBeInTheDocument();
    expect(screen.getByText('1 filled')).toBeInTheDocument();

    // Expired without bids: 2 expired with 0 bids out of 6 -> 33%
    expect(screen.getByText('Expired w/o Bid')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('2 expired')).toBeInTheDocument();
  });

  it('fires onToggleChange when clicking interactive metric cards', () => {
    const handleToggleChange = vi.fn();
    render(
      <OpenBidsMetricsFooter
        shifts={sampleShifts as ManagerBidShift[]}
        activeToggle="urgent"
        onToggleChange={handleToggleChange}
      />
    );

    // Click Demand card -> toggles to standard
    fireEvent.click(screen.getByTitle('Filter by standard shifts'));
    expect(handleToggleChange).toHaveBeenCalledWith('standard');

    // Click Awarded card -> toggles to resolved
    fireEvent.click(screen.getByTitle('Filter by resolved shifts'));
    expect(handleToggleChange).toHaveBeenCalledWith('resolved');

    // Click Expired card -> toggles to expired
    fireEvent.click(screen.getByTitle('Filter by expired shifts'));
    expect(handleToggleChange).toHaveBeenCalledWith('expired');
  });

  it('handles empty shifts list gracefully without crashing or showing NaN', () => {
    render(
      <OpenBidsMetricsFooter
        shifts={[]}
        activeToggle="standard"
      />
    );

    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('From 0 bids')).toBeInTheDocument();
    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('0 of 0 shifts')).toBeInTheDocument();
    expect(screen.getByText('0 filled')).toBeInTheDocument();
    expect(screen.getByText('0 expired')).toBeInTheDocument();
  });
});
