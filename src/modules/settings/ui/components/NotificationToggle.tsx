import { useState } from 'react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Button } from '@/modules/core/ui/primitives/button';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useSettings } from '@/modules/settings/hooks/useSettings';
import {
  ensureNotificationPermission,
  isDeviceNotificationsEnabled,
  isNotificationCapable,
  sendTestNotification,
  setDeviceNotificationsEnabled,
} from '@/platform/notifications/localNotifications';
import { isRemotePushEnabled } from '@/platform/notifications/pushRegistration';

/**
 * Notifications-tab card to enable device (system-tray) notifications on the
 * native app. Like biometric unlock, the enabled flag is device-local so it
 * takes effect immediately; enabling also requests the OS permission and mirrors
 * the account-wide `preferences.notifications.push` flag the push backend reads.
 * On the web it shows a hint that the feature lives in the mobile app.
 */
export function NotificationToggle() {
  const { user } = useAuth();
  const { updatePreferences } = useSettings();
  const [enabled, setEnabled] = useState(isDeviceNotificationsEnabled());
  const isNative = isNotificationCapable();
  const remotePushEnabled = isRemotePushEnabled();

  const persistPushPreference = (push: boolean) => {
    const current = user?.preferences ?? {};
    updatePreferences.mutate({
      ...current,
      notifications: { ...(current.notifications ?? {}), push },
    });
  };

  const onToggle = async (next: boolean) => {
    // Turning on requires the OS permission first — bail if the user denies it.
    if (next && !(await ensureNotificationPermission())) return;
    setDeviceNotificationsEnabled(next);
    setEnabled(next);
    persistPushPreference(next);
  };

  const onSendTest = async () => {
    const shown = await sendTestNotification();
    if (!shown) {
      toast({
        title: 'Could not send test notification',
        description: 'Notification permission is required — check your device settings.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h4 className="text-white font-medium">Device Notifications</h4>
                <p className="text-sm text-blue-200/60 mt-1">
                  Get policy-based shift, bid, and swap alerts in your device's notification tray.
                </p>
                {isNative && !remotePushEnabled && (
                  <p className="text-xs text-amber-300/70 mt-2">
                    Local alerts are available now. Closed-app delivery is pending Firebase access.
                  </p>
                )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!isNative ? (
            <span className="text-sm text-white/40">Available in the mobile app</span>
          ) : (
            <>
              <span className="text-sm text-white/70">{enabled ? 'Enabled' : 'Disabled'}</span>
              <Switch checked={enabled} onCheckedChange={onToggle} />
            </>
          )}
        </div>
      </div>

      {isNative && (
        <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-sm text-blue-200/60">Send a sample notification to this device.</span>
          <Button
            variant="outline"
            onClick={onSendTest}
            className="border-white/10 text-white hover:bg-white/5 flex-shrink-0"
          >
            Send test
          </Button>
        </div>
      )}
    </div>
  );
}

export default NotificationToggle;
