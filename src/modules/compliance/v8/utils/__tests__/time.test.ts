import { describe, it, expect } from 'vitest';
import { shiftDurationMinutes, normalizedEndMinutes, parseTimeToMinutes } from '../time';

/**
 * Pins the single cross-midnight convention shared by every V8 rule (audit M1).
 * A shift crosses midnight only when end < start; end == start is 0-length.
 */
describe('shiftDurationMinutes', () => {
  it('same-day shift', () => {
    expect(shiftDurationMinutes('09:00', '17:00')).toBe(480);
  });

  it('overnight shift (end < start) adds 24h', () => {
    expect(shiftDurationMinutes('22:00', '06:00')).toBe(480);
  });

  it('shift ending exactly at midnight is measured to the boundary', () => {
    // 18:00 -> 00:00 is 6h, not 18h or -18h.
    expect(shiftDurationMinutes('18:00', '00:00')).toBe(360);
  });

  it('degenerate end == start is treated as zero length, not 24h', () => {
    // The crux of M1: rules used to disagree here (0 vs 1440). Canonical = 0.
    expect(shiftDurationMinutes('09:00', '09:00')).toBe(0);
  });

  it('handles HH:MM:SS and empty input', () => {
    expect(shiftDurationMinutes('09:00:00', '17:30:00')).toBe(510);
    expect(shiftDurationMinutes('', '')).toBe(0);
  });
});

describe('normalizedEndMinutes', () => {
  it('normalizes an overnight end past midnight', () => {
    expect(normalizedEndMinutes('22:00', '06:00')).toBe(parseTimeToMinutes('06:00') + 1440);
  });

  it('leaves a same-day end unchanged', () => {
    expect(normalizedEndMinutes('09:00', '17:00')).toBe(parseTimeToMinutes('17:00'));
  });

  it('end == start is not pushed to the next day', () => {
    expect(normalizedEndMinutes('09:00', '09:00')).toBe(parseTimeToMinutes('09:00'));
  });
});
