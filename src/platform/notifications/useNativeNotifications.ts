import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/platform/supabase/client';
import { useAuth } from '@/platform/auth/useAuth';
import {
  addLocalNotificationTapListener,
  isDeviceNotificationsEnabled,
  isNotificationCapable,
  presentLocalNotification,
} from './localNotifications';
import { isRemotePushEnabled, registerForPush } from './pushRegistration';

type NotificationRow = {
  id: string;
  title: string;
  message: string | null;
  link: string | null;
  type: string;
};

/**
 * Native-only bridge between incoming notifications and the OS system tray.
 * On web every branch short-circuits. While the app is alive it mirrors new
 * `notifications` rows (Supabase Realtime) into local notifications, and — when
 * the user has opted in on this device — registers for FCM remote push so
 * notifications also arrive when the app is closed.
 */
export function useNativeNotifications(): void {
  const { user } = useAuth();
  const navigate = useNavigate();
  const profileId = user?.id;

  useEffect(() => {
    let dispose = () => {};
    void addLocalNotificationTapListener((path) => navigate(path)).then((d) => {
      dispose = d;
    });
    return () => dispose();
  }, [navigate]);

  useEffect(() => {
    if (!isNotificationCapable() || !profileId) return;

    const channel = supabase
      .channel(`native-notifications:${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
                void presentLocalNotification({
                  id: row.id,
                  title: row.title,
                  body: row.message,
                  link: row.link,
                  type: row.type,
                  scopeId: profileId,
                });
        },
      )
      .subscribe();

    let disposePush = () => {};
          if (isDeviceNotificationsEnabled() && isRemotePushEnabled()) {
      void registerForPush(profileId, (path) => navigate(path)).then((d) => {
        disposePush = d;
      });
    }

    return () => {
      supabase.removeChannel(channel);
      disposePush();
    };
  }, [profileId, navigate]);
}
