import { describe, expect, it } from 'vitest';
import { createNextDigestState } from '../digestState';

describe('notification digest state', () => {
  it('opens a cooldown window for the first event', () => {
    expect(createNextDigestState(null, 1_000, 30)).toEqual({
      count: 1,
      deliverAt: 1_801_000,
    });
  });

  it('adds events to an active window without moving its deadline', () => {
    const current = { count: 2, deliverAt: 5_000 };
    expect(createNextDigestState(current, 2_000, 30)).toEqual({ count: 3, deliverAt: 5_000 });
  });

  it('starts a fresh window after the previous deadline', () => {
    const expired = { count: 4, deliverAt: 2_000 };
    expect(createNextDigestState(expired, 3_000, 15)).toEqual({ count: 1, deliverAt: 903_000 });
  });
});
