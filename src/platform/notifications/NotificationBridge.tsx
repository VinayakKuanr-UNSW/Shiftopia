import { useNativeNotifications } from './useNativeNotifications';

/**
 * Mounts the native notification bridge once inside the router. Renders nothing;
 * a no-op on web. Sits alongside `CapacitorBridge` in `ProviderWrapper`.
 */
export function NotificationBridge(): null {
  useNativeNotifications();
  return null;
}

export default NotificationBridge;
