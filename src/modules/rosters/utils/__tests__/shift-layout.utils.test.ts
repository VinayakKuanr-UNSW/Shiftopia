import { describe, it, expect } from 'vitest';
import { calculateShiftLayout } from '../shift-layout.utils';
import { Shift } from '../../domain/shift.entity';

describe('calculateShiftLayout', () => {
  const hourHeight = 60;
  const minHeight = 32;

  const mockShift = (overrides: Partial<Shift> = {}): Shift => ({
    id: '1',
    shift_date: '2026-03-26',
    start_time: '09:00',
    end_time: '17:00',
    is_overnight: false,
    ...overrides,
  } as Shift);

  it('calculates regular same-day shift layout', () => {
    const shift = mockShift({ start_time: '09:00', end_time: '17:00' });
    const result = calculateShiftLayout(shift, '2026-03-26', hourHeight, minHeight);
    
    expect(result.top).toBe(9 * 60);
    expect(result.height).toBe(8 * 60);
  });

  it('calculates overnight shift layout - day 1 (start day)', () => {
    const shift = mockShift({ start_time: '20:00', end_time: '04:00', is_overnight: true });
    const result = calculateShiftLayout(shift, '2026-03-26', hourHeight, minHeight);
    
    // Should span from 20:00 to 24:00
    expect(result.top).toBe(20 * 60);
    expect(result.height).toBe(4 * 60);
  });

  it('calculates overnight shift layout - day 2 (end day)', () => {
    const shift = mockShift({ start_time: '20:00', end_time: '04:00', is_overnight: true });
    const result = calculateShiftLayout(shift, '2026-03-27', hourHeight, minHeight);
    
    // Should span from 00:00 to 04:00
    expect(result.top).toBe(0);
    expect(result.height).toBe(4 * 60);
  });

  it('handles cross-midnight detection even if is_overnight is false', () => {
    const shift = mockShift({ start_time: '22:00', end_time: '02:00', is_overnight: false });
    const result = calculateShiftLayout(shift, '2026-03-26', hourHeight, minHeight);
    
    expect(result.top).toBe(22 * 60);
    expect(result.height).toBe(2 * 60);
  });

  it('enforces minimum height', () => {
    const shift = mockShift({ start_time: '09:00', end_time: '09:15' });
    const result = calculateShiftLayout(shift, '2026-03-26', hourHeight, minHeight);
    
    expect(result.top).toBe(9 * 60);
    expect(result.height).toBe(minHeight);
  });
});
