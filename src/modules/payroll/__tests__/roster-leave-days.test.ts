import { describe, it, expect } from 'vitest';
import { rosteredLeaveDays } from '../data/leaveGrossPay';

describe('rosteredLeaveDays', () => {
  const periodStart = '2026-07-01';
  const periodEnd = '2026-07-14';

  // 2026-07-04 is a Saturday, 2026-07-05 is a Sunday
  // 2026-07-06 is a Monday

  it('uses rostered dates bounded by leave range and period', () => {
    const leaveStart = '2026-07-03'; // Friday
    const leaveEnd = '2026-07-07';   // Tuesday
    
    // Employee is rostered Fri, Sat, Sun, Mon
    const roster = ['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'];
    
    const days = rosteredLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, roster);
    
    // All 4 rostered days fall within the leave range and period
    expect(days).toEqual(['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06']);
  });

  it('falls back to Mon-Fri (eligibleLeaveDays) if no roster data exists', () => {
    const leaveStart = '2026-07-03'; // Friday
    const leaveEnd = '2026-07-07';   // Tuesday
    
    const roster: string[] = [];
    
    const days = rosteredLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, roster);
    
    // Should return Fri, Mon, Tue (skipping Sat, Sun)
    expect(days).toEqual(['2026-07-03', '2026-07-06', '2026-07-07']);
  });

  it('excludes public holidays from rostered dates if isHoliday is provided', () => {
    const leaveStart = '2026-07-03';
    const leaveEnd = '2026-07-07';
    
    const roster = ['2026-07-03', '2026-07-04', '2026-07-06'];
    const isHoliday = (ymd: string) => ymd === '2026-07-06';
    
    const days = rosteredLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, roster, isHoliday);
    
    expect(days).toEqual(['2026-07-03', '2026-07-04']);
  });

  it('bounds by periodStart/periodEnd correctly', () => {
    const leaveStart = '2026-06-25';
    const leaveEnd = '2026-07-03';
    
    const roster = ['2026-06-30', '2026-07-01', '2026-07-02'];
    
    const days = rosteredLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, roster);
    
    // Should only include dates >= periodStart (2026-07-01)
    expect(days).toEqual(['2026-07-01', '2026-07-02']);
  });

  it('returns empty array if leave range is entirely outside period', () => {
    const leaveStart = '2026-06-01';
    const leaveEnd = '2026-06-15';
    const roster = ['2026-06-10'];
    
    const days = rosteredLeaveDays(leaveStart, leaveEnd, periodStart, periodEnd, roster);
    expect(days).toEqual([]);
  });
});
