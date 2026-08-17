import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Tracks online/offline status (R2 / ALM-16).
 *
 * In the Capacitor native shell `navigator.onLine` and the window online/offline
 * events are unreliable in the WebView, so we read the real device connectivity
 * via `@capacitor/network`. On the web we use `navigator.onLine` + events, which
 * is reliable in real browsers and DevTools' offline mode.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    // Native: use the Capacitor Network plugin (native ConnectivityManager).
    if (Capacitor.isNativePlatform()) {
      let remove: (() => void) | undefined;
      let cancelled = false;

      import('@capacitor/network').then(({ Network }) => {
        if (cancelled) return;
        Network.getStatus().then((s) => setOnline(s.connected));
        const handlePromise = Network.addListener('networkStatusChange', (s) =>
          setOnline(s.connected),
        );
        remove = () => {
          handlePromise.then((h) => h.remove());
        };
      });

      return () => {
        cancelled = true;
        remove?.();
      };
    }

    // Web: navigator.onLine + online/offline events.
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

export default useOnlineStatus;
