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
});
