import { describe, expect, it } from 'vitest';
import { resolveNotificationLink } from '../deepLink';

describe('notification deep links', () => {
  it('routes canonical event names case-insensitively', () => {
    expect(resolveNotificationLink({ type: 'SWAP_APPROVAL_REQUIRED' })).toBe('/management/swaps');
    expect(resolveNotificationLink({ type: 'CLOCK_IN_RECORDED' })).toBe('/timesheet');
  });

  it('repairs legacy links before navigation', () => {
    expect(resolveNotificationLink({ type: 'bid_rejected', link: '/bids' })).toBe('/my-bids');
  });
});
