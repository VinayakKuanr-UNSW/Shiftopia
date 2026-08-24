import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractLevel } from '../../projections/utils/cost/index';

/**
 * Regression tests for the Schedule 1 classification-inference audit finding
 * (2026-08-02): `extractLevel()` silently returned `undefined` — and every
 * caller resolved that to the Level-1-casual default rate — whenever a real
 * role name didn't match any of its keyword patterns. It now logs a
 * de-duplicated warning in that specific case, while staying silent for the
 * benign "no role name supplied at all" case (unassigned shifts etc.).
 */

describe('extractLevel — Schedule 1 keyword mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves explicit level shorthand', () => {
    expect(extractLevel('Steward (L1)')).toBe('LEVEL_1');
    expect(extractLevel('Level 6 Control Room Operator')).toBe('LEVEL_6');
    expect(extractLevel('TM3')).toBe('LEVEL_3');
    expect(extractLevel('TM 3')).toBe('LEVEL_3');
    expect(extractLevel('Event Setup TM3')).toBe('LEVEL_3');
    expect(extractLevel('TM1')).toBe('LEVEL_1');
  });

  it('resolves the common ICC Sydney keyword mappings', () => {
    expect(extractLevel('Event Delivery Supervisor')).toBe('LEVEL_5');
    expect(extractLevel('Steward Team Leader Grade 1')).toBe('LEVEL_4');
    expect(extractLevel('Security Officer')).toBe('LEVEL_2');
    expect(extractLevel('F & B Team Member Grade 1')).toBeUndefined(); // no keyword match by design
    expect(extractLevel('Trainee')).toBe('TRAINEE');
    expect(extractLevel('Merchandise Team Leader')).toBe('LEVEL_4');
  });

  it('does not warn when no role name is supplied at all (benign case)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extractLevel(undefined)).toBeUndefined();
    expect(extractLevel(null)).toBeUndefined();
    expect(extractLevel('')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns exactly once when a real role name fails to classify, then stays silent on repeats', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unmatched = `Totally Unmapped Role ${Date.now()}`; // unique per test run
    expect(extractLevel(unmatched)).toBeUndefined();
    expect(extractLevel(unmatched)).toBeUndefined();
    expect(extractLevel(unmatched)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(unmatched);
  });
});
