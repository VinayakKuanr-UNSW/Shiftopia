import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_POLICIES,
  isHighPriority,
  isRemoteDeliveryAllowed,
  renderNotificationMessage,
  resolveNotificationPolicy,
} from '../notificationPolicy';

describe('notification policy matrix', () => {
  it('captures every event from the notification settings matrix', () => {
    expect(Object.keys(NOTIFICATION_POLICIES)).toHaveLength(35);
  });

  it('maps legacy database event types to canonical policies', () => {
    expect(resolveNotificationPolicy('bid_rejected').eventType).toBe('BID_UNSUCCESSFUL');
    expect(resolveNotificationPolicy('emergency_assignment').priority).toBe('critical');
  });

  it('keeps in-app-only events out of remote delivery', () => {
    expect(isRemoteDeliveryAllowed(resolveNotificationPolicy('BID_SUBMITTED'))).toBe(false);
    expect(isRemoteDeliveryAllowed(resolveNotificationPolicy('SHIFT_ASSIGNED'))).toBe(true);
  });

  it('renders digest counts and applies a safe unknown-event default', () => {
    const digest = resolveNotificationPolicy('SHIFT_BIDDING_OPEN');
    expect(renderNotificationMessage(digest, 3, null)).toBe('3 new shifts are available for bidding.');

    const fallback = resolveNotificationPolicy('timesheet_approved');
    expect(fallback.delivery).toBe('immediate');
    expect(isHighPriority(fallback)).toBe(false);
  });
});
