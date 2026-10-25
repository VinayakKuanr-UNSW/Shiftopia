import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AttendanceMetricsBar } from '../AttendanceMetricsBar';
import type { AttendanceMetrics } from '@/modules/rosters/domain/attendance-metrics';

describe('AttendanceMetricsBar', () => {
  const sampleMetrics: AttendanceMetrics = {
    workedCount: 14,
    heldCount: 14,
    noShowCount: 0,
    autoClockOutCount: 0,
    earlyInCount: 3,
    onTimeInCount: 11,
    lateInCount: 0,
    earlyOutCount: 1,
    onTimeOutCount: 12,
    lateOutCount: 1,
    earlyClockInPct: 21.4,
    onTimeInPct: 78.6,
    lateClockInPct: 0.0,
    earlyClockOutPct: 7.1,
    onTimeOutPct: 85.7,
    lateClockOutPct: 7.1,
    autoClockOutPct: 0.0,
    noShowPct: 0.0,
  };

  it('renders footer container with role="region" and all 9 metric labels', () => {
    render(<AttendanceMetricsBar metrics={sampleMetrics} />);

    const footer = screen.getByRole('region', { name: /attendance statistics scorecard/i });
    expect(footer).toBeInTheDocument();
    expect(footer.className).toContain('w-full');
    expect(footer.className).toContain('shrink-0');

    // 9 metric labels
    expect(screen.getByText('Worked')).toBeInTheDocument();
    expect(screen.getByText('Early In')).toBeInTheDocument();
    expect(screen.getByText('On-Time In')).toBeInTheDocument();
    expect(screen.getByText('Late In')).toBeInTheDocument();
    expect(screen.getByText('Early Out')).toBeInTheDocument();
    expect(screen.getByText('On-Time Out')).toBeInTheDocument();
    expect(screen.getByText('Late Out')).toBeInTheDocument();
    expect(screen.getByText('Missing Out')).toBeInTheDocument();
    expect(screen.getByText('No-Show')).toBeInTheDocument();
  });

  it('renders worked count and formatted rate percentages correctly', () => {
    render(<AttendanceMetricsBar metrics={sampleMetrics} />);

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('21.4%')).toBeInTheDocument();
    expect(screen.getByText('78.6%')).toBeInTheDocument();
    expect(screen.getAllByText('7.1%').length).toBe(2);
    expect(screen.getByText('85.7%')).toBeInTheDocument();
    expect(screen.getAllByText('0.0%').length).toBeGreaterThanOrEqual(3);
  });

  it('renders container with exact h-14 and rounded-2xl glassmorphism classes', () => {
    const { container } = render(<AttendanceMetricsBar metrics={sampleMetrics} />);
    const innerContainer = container.querySelector('.h-14');
    expect(innerContainer).toBeInTheDocument();
    expect(innerContainer?.className).toContain('rounded-2xl');
    expect(innerContainer?.className).toContain('bg-white/95');
    expect(innerContainer?.className).toContain('dark:bg-[#1c2333]/85');
    expect(innerContainer?.className).toContain('border-slate-300');
  });
});
