import { describe, it, expect } from 'vitest';
import { coverageHealth } from '../../projections/utils/coverage';

describe('coverageHealth', () => {
  it('returns No Shifts sentinel when total is zero', () => {
    const h = coverageHealth(0, 0);
    expect(h.label).toBe('No Shifts');
    // ratio and pct are set to 1 / 100 so progress bars render at 100%
    expect(h.ratio).toBe(1);
    expect(h.pct).toBe(100);
  });

  it('100 % coverage → Fully Staffed (emerald)', () => {
    const h = coverageHealth(5, 5);
    expect(h.label).toBe('Fully Staffed');
    expect(h.colorClass).toContain('emerald');
    expect(h.pct).toBe(100);
  });

  it('80 % coverage → Nearly Staffed (amber)', () => {
    const h = coverageHealth(4, 5);
    expect(h.label).toBe('Nearly Staffed');
    expect(h.colorClass).toContain('amber');
    expect(h.pct).toBe(80);
  });

  it('60 % coverage → Low Coverage (orange)', () => {
    const h = coverageHealth(3, 5);
    expect(h.label).toBe('Low Coverage');
    expect(h.colorClass).toContain('orange');
    expect(h.pct).toBe(60);
  });

  it('40 % coverage → Critical (red)', () => {
    const h = coverageHealth(2, 5);
    expect(h.label).toBe('Critical');
    expect(h.colorClass).toContain('red');
    expect(h.pct).toBe(40);
  });

  it('over-staffed (ratio > 1) still returns Fully Staffed', () => {
    const h = coverageHealth(6, 5);
    expect(h.label).toBe('Fully Staffed');
    expect(h.ratio).toBeCloseTo(1.2);
  });
});
