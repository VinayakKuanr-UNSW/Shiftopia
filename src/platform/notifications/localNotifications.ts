import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { resolveNotificationLink } from './deepLink';
import {
  renderNotificationMessage,
  resolveNotificationPolicy,
  type NotificationPolicy,
  type NotificationPriority,
} from './notificationPolicy';
import {
  createNextDigestState,
  readNotificationDigestState,
  writeNotificationDigestState,
} from './digestState';

/**
 * OS system-tray notifications for the native Android shell via
 * `@capacitor/local-notifications`. Used to surface incoming notifications
 * (Supabase Realtime while the app is alive, and foreground FCM pushes) as
 * device notifications. Web is a no-op — browsers use the in-app bell instead.
 *
 * "Device notifications" is a per-device opt-in (like biometric unlock): the
 * enabled flag lives in localStorage and is read at present-time so toggling it
 * in Settings takes effect immediately, without waiting for an auth refresh.
 */

const DEVICE_ENABLED_KEY = 'shiftopia.deviceNotifications';

export type LocalNotificationInput = {
  id: string;
  title: string;
  body: string | null;
  link?: string | null;
  type: string;
  scopeId?: string;
};

export type LocalNotificationPresentation =
  | 'scheduled'
  | 'in_app_only'
  | 'permission_denied'
  | 'unavailable'
  | 'disabled'
  | 'failed';

type LocalNotificationsPlugin = typeof import('@capacitor/local-notifications')['LocalNotifications'];

type NotificationScheduleInput = {
  id: string;
  input: LocalNotificationInput;
  policy: NotificationPolicy;
  body: string;
  deliverAt?: number;
};

type NotificationPresentationOptions = {
  input: LocalNotificationInput;
  requireDeviceOptIn: boolean;
};

const NOTIFICATION_CHANNELS: Readonly<
  Record<NotificationPriority, { id: string; name: string; importance: 2 | 3 | 4 | 5 }>
> = {
  low: { id: 'shiftopia-low', name: 'Shiftopia updates', importance: 2 },
  medium: { id: 'shiftopia-default', name: 'Shiftopia notifications', importance: 3 },
  high: { id: 'shiftopia-high', name: 'Important shift alerts', importance: 4 },
  critical: { id: 'shiftopia-critical', name: 'Critical shift alerts', importance: 5 },
};

export function isNotificationCapable(): boolean {
  return Capacitor.isNativePlatform();
}

export function isDeviceNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(DEVICE_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDeviceNotificationsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(DEVICE_ENABLED_KEY, 'true');
    else localStorage.removeItem(DEVICE_ENABLED_KEY);
  } catch {
    /* ignore storage errors */
  }
}

/** Request the Android 13+ POST_NOTIFICATIONS permission. Resolves granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNotificationCapable()) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  } catch (error) {
    console.warn('[notifications] permission request failed', error);
    return false;
  }
}

/**
 * Apply the policy matrix to an incoming notification. In-app-only events are
 * suppressed, immediate events use priority channels, and digest events share a
 * scheduled tray entry for the configured cooldown window.
 */
export function presentLocalNotification(input: LocalNotificationInput): Promise<LocalNotificationPresentation> {
  return presentNotificationWithPolicy({ input, requireDeviceOptIn: true });
}

/**
 * Present an explicitly requested demo notification. The button click itself is
 * the opt-in intent, so this path requests OS permission without requiring the
 * persistent device-notifications toggle. Event delivery policy still applies.
 */
export function presentLocalDemoNotification(input: LocalNotificationInput): Promise<LocalNotificationPresentation> {
  return presentNotificationWithPolicy({ input, requireDeviceOptIn: false });
}

async function presentNotificationWithPolicy(
  options: NotificationPresentationOptions,
): Promise<LocalNotificationPresentation> {
  const { input, requireDeviceOptIn } = options;
  if (!isNotificationCapable()) return 'unavailable';
  if (requireDeviceOptIn && !isDeviceNotificationsEnabled()) return 'disabled';
  const policy = resolveNotificationPolicy(input.type);
  if (policy.delivery === 'in_app_only') return 'in_app_only';
  if (!(await ensureNotificationPermission())) return 'permission_denied';
  return schedulePolicyNotification(input, policy);
}

async function schedulePolicyNotification(
  input: LocalNotificationInput,
  policy: NotificationPolicy,
): Promise<LocalNotificationPresentation> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await ensureNotificationChannels(LocalNotifications);
    if (policy.delivery === 'digest') {
      await scheduleDigestNotification(LocalNotifications, input, policy);
      return 'scheduled';
    }
    await scheduleImmediateNotification(LocalNotifications, input, policy);
    return 'scheduled';
  } catch (error) {
    console.warn('[notifications] failed to present local notification', error);
    return 'failed';
  }
}

async function scheduleImmediateNotification(
  plugin: LocalNotificationsPlugin,
  input: LocalNotificationInput,
  policy: NotificationPolicy,
): Promise<void> {
  await plugin.schedule({
    notifications: [toNotificationSchema({ id: input.id, input, policy, body: input.body ?? '' })],
  });
}

async function scheduleDigestNotification(
  plugin: LocalNotificationsPlugin,
  input: LocalNotificationInput,
  policy: NotificationPolicy,
): Promise<void> {
  const digestKey = `${input.scopeId ?? 'device'}:${policy.eventType}`;
  const state = createNextDigestState(readNotificationDigestState(digestKey), Date.now(), policy.cooldownMinutes);
  writeNotificationDigestState(digestKey, state);
  const notificationId = `digest:${digestKey}`;
  await plugin.cancel({ notifications: [{ id: toNumericId(notificationId) }] });
  await plugin.schedule({
    notifications: [
      toNotificationSchema({
        id: notificationId,
        input,
        policy,
        body: renderNotificationMessage(policy, state.count, input.body),
        deliverAt: state.deliverAt,
      }),
    ],
  });
}

function toNotificationSchema(options: NotificationScheduleInput) {
  const { id, input, policy, body, deliverAt } = options;
  return {
    id: toNumericId(id),
    title: input.title,
    body,
    channelId: NOTIFICATION_CHANNELS[policy.priority].id,
    schedule: deliverAt ? { at: new Date(deliverAt), allowWhileIdle: true } : undefined,
    extra: { link: resolveNotificationLink(input), eventType: policy.eventType },
  };
}

async function ensureNotificationChannels(plugin: LocalNotificationsPlugin): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  await Promise.all(
    Object.values(NOTIFICATION_CHANNELS).map((channel) =>
      plugin.createChannel({ ...channel, description: channel.name, visibility: 1 }),
    ),
  );
}

/**
 * Fire a sample notification on demand so the user can confirm the device path
 * works. Bypasses the opt-in flag (the tap itself is the intent) but still needs
 * OS permission. Resolves whether a notification was shown.
 */
export async function sendTestNotification(): Promise<boolean> {
  if (!isNotificationCapable()) return false;
  if (!(await ensureNotificationPermission())) return false;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await ensureNotificationChannels(LocalNotifications);
      await LocalNotifications.schedule({
      notifications: [
        {
          id: toNumericId(`test-${Date.now()}`),
            title: 'Shiftopia test notification',
            body: 'Device notifications are working. Tap to open your notifications.',
            channelId: NOTIFICATION_CHANNELS.medium.id,
            extra: { link: '/my-notifications' },
        },
      ],
    });
    return true;
  } catch (error) {
    console.warn('[notifications] test notification failed', error);
    return false;
  }
}

/** Attach the tap handler. Returns a disposer; a no-op on web. */
export async function addLocalNotificationTapListener(
  onNavigate: (path: string) => void,
): Promise<() => void> {
  if (!isNotificationCapable()) return () => {};
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const handle: PluginListenerHandle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action) => {
        const link = action.notification.extra?.link;
        if (typeof link === 'string') onNavigate(link);
      },
    );
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}

/** Capacitor local notifications require a 32-bit int id; hash the UUID. */
function toNumericId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return (hash & 0x7fffffff) || 1;
}
