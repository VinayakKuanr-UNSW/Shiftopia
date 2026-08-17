import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useAuth } from '@/platform/auth/useAuth';
import { resolveNotificationLink } from '@/platform/notifications/deepLink';
import {
  dismissLocalDemoNotification,
  isLocalDemoNotificationId,
  markAllLocalDemoNotificationsRead,
  markLocalDemoNotificationRead,
  readLocalDemoNotifications,
  subscribeToLocalDemoNotifications,
  type LocalDemoNotification,
} from '@/platform/notifications/localDemoNotifications';

// Re-exported so existing UI consumers keep their import path while the
// type→route map lives in one place (see platform/notifications/deepLink).
export { resolveNotificationLink };

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  entity_id: string | null;
  entity_type: string | null;
  read_at: string | null;
  created_at: string;
  source?: 'local-demo';
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useNotifications() {
  const { user } = useAuth();
  const [rawNotifications, setRawNotifications] = useState<AppNotification[]>([]);
  const [localDemoNotifications, setLocalDemoNotifications] = useState<LocalDemoNotification[]>([]);
  const [loading, setLoading] = useState(true);
  // Local-only "seen" state — no DB round-trip needed
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  // Initial fetch
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase
      .from('notifications')
      .select('id, type, title, message, link, entity_id, entity_type, read_at, created_at')
      .eq('profile_id', user.id)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRawNotifications((data as AppNotification[]) ?? []);
        setLoading(false);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLocalDemoNotifications([]);
      return;
    }
    setLocalDemoNotifications(readLocalDemoNotifications(user.id));
    return subscribeToLocalDemoNotifications(user.id, setLocalDemoNotifications);
  }, [user?.id]);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const incoming = payload.new as AppNotification;
          setRawNotifications((prev) => {
            // Map-based dedup: handles initial fetch overlap + backend retries
            const map = new Map(prev.map((n) => [n.id, n]));
            if (map.has(incoming.id)) return prev;
            map.set(incoming.id, incoming);
            return Array.from(map.values())
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, 50);
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          setRawNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? (payload.new as AppNotification) : n))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Auto-clean: hide read notifications older than 7 days from the displayed list
  const notifications = useMemo(() => {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    return [...localDemoNotifications, ...rawNotifications]
      .filter((notification) => !notification.read_at || notification.created_at >= cutoff)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [localDemoNotifications, rawNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications]
  );

  // Mark visible unread notifications as "seen" (local state only — no DB write)
  const markSeen = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSeenIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const markRead = useCallback(async (id: string) => {
    if (user?.id && isLocalDemoNotificationId(id)) {
      setLocalDemoNotifications(markLocalDemoNotificationRead(user.id, id));
      return;
    }
    const now = new Date().toISOString();
    await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    setRawNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: now } : n))
    );
  }, [user?.id]);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    setLocalDemoNotifications(markAllLocalDemoNotificationsRead(user.id));
    await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('profile_id', user.id)
      .is('read_at', null);
    setRawNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
  }, [user?.id]);

  const dismiss = useCallback(async (id: string) => {
    if (user?.id && isLocalDemoNotificationId(id)) {
      setLocalDemoNotifications(dismissLocalDemoNotification(user.id, id));
      return;
    }
    await supabase
      .from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id);
    setRawNotifications((prev) => prev.filter((n) => n.id !== id));
  }, [user?.id]);

  return {
    notifications,
    unreadCount,
    loading,
    seenIds,
    markSeen,
    markRead,
    markAllRead,
    dismiss,
  };
}
