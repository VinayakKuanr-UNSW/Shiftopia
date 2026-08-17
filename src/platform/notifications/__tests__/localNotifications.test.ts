import { beforeEach, describe, expect, it, vi } from 'vitest';

const localNotifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  createChannel: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: localNotifications }));

import {
  presentLocalDemoNotification,
  presentLocalNotification,
} from '@/platform/notifications/localNotifications';

const notification = {
  id: 'demo:assigned',
  title: 'New shift assigned',
  body: 'You have been assigned a shift.',
  type: 'SHIFT_ASSIGNED',
};

describe('local notification presentation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    localNotifications.checkPermissions.mockResolvedValue({ display: 'granted' });
    localNotifications.createChannel.mockResolvedValue(undefined);
    localNotifications.schedule.mockResolvedValue(undefined);
  });

  it('keeps production notifications behind the device opt-in', async () => {
    await expect(presentLocalNotification(notification)).resolves.toBe('disabled');
    expect(localNotifications.schedule).not.toHaveBeenCalled();
  });

  it('presents an explicit demo in the Android system tray without the persistent opt-in', async () => {
    await expect(presentLocalDemoNotification(notification)).resolves.toBe('scheduled');
    expect(localNotifications.schedule).toHaveBeenCalledOnce();
  });

  it('continues to suppress system alerts for in-app-only policies', async () => {
    await expect(
      presentLocalDemoNotification({ ...notification, id: 'demo:bid', type: 'BID_SUBMITTED' }),
    ).resolves.toBe('in_app_only');
    expect(localNotifications.schedule).not.toHaveBeenCalled();
  });
});
