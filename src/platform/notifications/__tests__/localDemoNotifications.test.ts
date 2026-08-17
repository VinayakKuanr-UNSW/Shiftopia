import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLocalDemoNotifications,
  createLocalDemoNotification,
  dismissLocalDemoNotification,
  markAllLocalDemoNotificationsRead,
  markLocalDemoNotificationRead,
  readLocalDemoNotifications,
  subscribeToLocalDemoNotifications,
} from '../localDemoNotifications';

const PROFILE_ID = 'demo-profile';

describe('local demo notifications', () => {
  beforeEach(() => localStorage.clear());

  it('stores demo notifications per profile and emits updates', () => {
    const onChange = vi.fn();
    const dispose = subscribeToLocalDemoNotifications(PROFILE_ID, onChange);
    const created = createLocalDemoNotification(PROFILE_ID, demoInput());

    expect(created.id).toMatch(/^demo:/);
    expect(readLocalDemoNotifications(PROFILE_ID)).toHaveLength(1);
    expect(readLocalDemoNotifications('another-profile')).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('supports read, mark-all, dismiss, and clear operations', () => {
    const first = createLocalDemoNotification(PROFILE_ID, demoInput());
    createLocalDemoNotification(PROFILE_ID, { ...demoInput(), title: 'Second' });

    expect(markLocalDemoNotificationRead(PROFILE_ID, first.id).find((item) => item.id === first.id)?.read_at).toBeTruthy();
    expect(markAllLocalDemoNotificationsRead(PROFILE_ID).every((item) => item.read_at)).toBe(true);
    expect(dismissLocalDemoNotification(PROFILE_ID, first.id)).toHaveLength(1);
    clearLocalDemoNotifications(PROFILE_ID);
    expect(readLocalDemoNotifications(PROFILE_ID)).toEqual([]);
  });
});

function demoInput() {
  return {
    type: 'shift_assigned',
    title: 'Demo shift assigned',
    message: 'This is a local demo notification.',
    link: '/my-roster',
  };
}
