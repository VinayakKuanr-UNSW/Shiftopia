import { describe, it, expect } from 'vitest';
import { evaluateShiftAvailability, evaluateShiftAvailabilityFromSlots } from '../availability-check';
import type { EmployeeAvailability } from '../availabilityResolution.types';

function avail(partial: Partial<EmployeeAvailability>): EmployeeAvailability {
  return {
    employeeId: 'e1',
    date: '2026-07-08',
    availableWindows: [],
    unavailableWindows: [],
    isFullyAvailable: false,
    isFullyUnavailable: false,
    hasData: true,
    ...partial,
  };
}

describe('evaluateShiftAvailability — unset = unavailable policy', () => {
  it('treats missing availability as unavailable (warn)', () => {
    const r = evaluateShiftAvailability(null, '09:00', '17:00');
    expect(r.verdict).toBe('no_availability');
    expect(r.isWarning).toBe(true);
  });

  it('treats hasData=false as unavailable (warn)', () => {
    const r = evaluateShiftAvailability(avail({ hasData: false }), '09:00', '17:00');
    expect(r.verdict).toBe('no_availability');
    expect(r.isWarning).toBe(true);
  });

  it('flags a fully-unavailable day', () => {
    const r = evaluateShiftAvailability(avail({ isFullyUnavailable: true }), '09:00', '17:00');
    expect(r.verdict).toBe('outside_window');
    expect(r.isWarning).toBe(true);
  });

  it('passes when the shift is fully inside a declared window (no warn)', () => {
    const r = evaluateShiftAvailability(
      avail({ availableWindows: [{ start: '08:00', end: '18:00' }] }),
      '09:00',
      '17:00',
    );
    expect(r.verdict).toBe('available');
    expect(r.isWarning).toBe(false);
  });

  it('warns when the shift spills outside the declared window', () => {
    const r = evaluateShiftAvailability(
      avail({ availableWindows: [{ start: '08:00', end: '12:00' }] }),
      '09:00',
      '17:00',
    );
    expect(r.verdict).toBe('outside_window');
    expect(r.isWarning).toBe(true);
  });

  it('passes when marked fully available', () => {
    const r = evaluateShiftAvailability(avail({ isFullyAvailable: true }), '22:00', '06:00');
    expect(r.verdict).toBe('available');
    expect(r.isWarning).toBe(false);
  });

  it('handles overnight shifts contained in an overnight window', () => {
    const r = evaluateShiftAvailability(
      avail({ availableWindows: [{ start: '20:00', end: '08:00' }] }),
      '22:00',
      '06:00',
    );
    expect(r.verdict).toBe('available');
    expect(r.isWarning).toBe(false);
  });

  it('accepts HH:MM:SS times', () => {
    const r = evaluateShiftAvailability(
      avail({ availableWindows: [{ start: '08:00', end: '18:00' }] }),
      '09:00:00',
      '17:00:00',
    );
    expect(r.verdict).toBe('available');
  });
});

describe('evaluateShiftAvailabilityFromSlots — slot-based (auto-scheduler parity)', () => {
  const D = '2026-07-08';

  it('no slot for the shift date → unavailable (warn)', () => {
    const r = evaluateShiftAvailabilityFromSlots([], D, '09:00:00', '17:00:00');
    expect(r.verdict).toBe('no_availability');
    expect(r.isWarning).toBe(true);
  });

  it('a slot on a different date does not count → unavailable', () => {
    const r = evaluateShiftAvailabilityFromSlots(
      [{ slot_date: '2026-07-09', start_time: '08:00:00', end_time: '18:00:00' }],
      D, '09:00:00', '17:00:00',
    );
    expect(r.verdict).toBe('no_availability');
  });

  it('a slot fully containing the shift → available', () => {
    const r = evaluateShiftAvailabilityFromSlots(
      [{ slot_date: D, start_time: '08:00:00', end_time: '18:00:00' }],
      D, '09:00:00', '17:00:00',
    );
    expect(r.verdict).toBe('available');
    expect(r.isWarning).toBe(false);
  });

  it('a slot that only partially covers the shift → warn', () => {
    const r = evaluateShiftAvailabilityFromSlots(
      [{ slot_date: D, start_time: '08:00:00', end_time: '12:00:00' }],
      D, '09:00:00', '17:00:00',
    );
    expect(r.verdict).toBe('outside_window');
    expect(r.isWarning).toBe(true);
  });

  it('an overnight slot containing an overnight shift → available', () => {
    const r = evaluateShiftAvailabilityFromSlots(
      [{ slot_date: D, start_time: '20:00:00', end_time: '08:00:00' }],
      D, '22:00:00', '06:00:00',
    );
    expect(r.verdict).toBe('available');
  });
});
