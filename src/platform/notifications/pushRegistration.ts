import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { supabase } from '@/platform/supabase/client';
import { presentLocalNotification } from './localNotifications';
import { resolveNotificationLink } from './deepLink';

/**
 * FCM remote-push registration for the native Android shell via
 * `@capacitor/push-notifications`. Registers the device, stores its FCM token
 * in `device_push_tokens`, shows foreground pushes as local notifications, and
 * deep-links on tap. Inert on web and until Firebase (`google-services.json` +
 * the send-push Edge Function) is configured.
 */

export function isPushCapable(): boolean {
  return Capacitor.isNativePlatform();
}

export function isRemotePushEnabled(): boolean {
  return isPushCapable() && import.meta.env.VITE_FIREBASE_PUSH_ENABLED === 'true';
}

async function upsertToken(token: string): Promise<void> {
  // register_push_token is a post-baseline migration not yet in generated types.
  const { error } = await (supabase as any).rpc('register_push_token', {
    p_token: token,
    p_platform: Capacitor.getPlatform(),
  });
  if (error) console.warn('[notifications] failed to store push token', error);
}

/**
 * Request permission, attach listeners, and register for push. Returns a
 * disposer that only detaches listeners — it deliberately does NOT disable the
 * stored token, so push keeps working after the app is closed. Dead tokens are
 * cleaned up server-side (FCM `UNREGISTERED`); send-gating is the account-wide
 * `preferences.notifications.push` checked by the Edge Function.
 */
export async function registerForPush(
  profileId: string,
  onNavigate: (path: string) => void,
): Promise<() => void> {
  if (!isRemotePushEnabled()) return () => {};
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return () => {};

    const handles = await attachPushListeners(profileId, onNavigate);
    await PushNotifications.register();
    return () => handles.forEach((handle) => void handle.remove());
  } catch (error) {
    console.warn('[notifications] push registration failed', error);
    return () => {};
  }
}

async function attachPushListeners(
  profileId: string,
  onNavigate: (path: string) => void,
): Promise<PluginListenerHandle[]> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return Promise.all([
    PushNotifications.addListener('registration', (token) => {
      void upsertToken(token.value);
    }),
    PushNotifications.addListener('registrationError', (error) => {
      console.warn('[notifications] push registrationError', error);
    }),
    PushNotifications.addListener('pushNotificationReceived', (message) => {
      void presentLocalNotification({
        // Key on the notification row id (also sent by the Realtime path) so a
        // foreground push and its Realtime twin collapse to one tray entry.
        id: asString(message.data?.notification_id) ?? message.id ?? `${profileId}-${message.title ?? 'push'}`,
        title: message.title ?? 'Shiftopia',
        body: message.body ?? null,
              link: asString(message.data?.link),
              type: asString(message.data?.type) ?? 'general',
              scopeId: profileId,
            });
    }),
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data ?? {};
      onNavigate(resolveNotificationLink({ type: asString(data.type) ?? 'general', link: asString(data.link) }));
    }),
  ]);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
