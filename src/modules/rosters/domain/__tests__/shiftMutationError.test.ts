import { describe, expect, it } from 'vitest';
import { describeShiftMutationError } from '../shiftMutationError';

/**
 * The state-invariant triggers raise messages that already explain the
 * rejection. The planner used to discard them and show "Failed to unassign
 * shifts", which told a manager nothing about what to do next.
 */
describe('describeShiftMutationError', () => {
  it('keeps the trigger sentence and strips the internal decoration', () => {
    expect(
      describeShiftMutationError({
        message:
          '[v3] Shift 37c0602c-1f2e-4a3b-9c8d-0e1f2a3b4c5d: Published+unassigned requires bidding_status != not_on_bidding',
      }),
    ).toBe('Published+unassigned requires bidding_status != not_on_bidding');
  });

  it('accepts a bare string error', () => {
    expect(describeShiftMutationError('Shift is locked')).toBe('Shift is locked');
  });

  it('strips the version tag on its own', () => {
    expect(describeShiftMutationError({ message: '[v12] Roster is locked' })).toBe('Roster is locked');
  });

  it('leaves an already-clean message untouched', () => {
    expect(describeShiftMutationError({ message: 'Roster is locked' })).toBe('Roster is locked');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an error with no message', {}],
    ['an empty message', { message: '' }],
  ])('returns undefined for %s so the caller can fall back', (_label, input) => {
    expect(describeShiftMutationError(input)).toBeUndefined();
  });

  it('returns undefined when the message is only decoration', () => {
    // Nothing useful survives stripping — better to show the caller's fallback
    // than an empty toast body.
    expect(
      describeShiftMutationError({ message: '[v3] Shift 37c0602c-1f2e-4a3b-9c8d-0e1f2a3b4c5d: ' }),
    ).toBeUndefined();
  });

  it('is case-insensitive on the Shift prefix', () => {
    expect(
      describeShiftMutationError({
        message: 'shift 37C0602C-1F2E-4A3B-9C8D-0E1F2A3B4C5D: Cannot unassign a completed shift',
      }),
    ).toBe('Cannot unassign a completed shift');
  });
});
