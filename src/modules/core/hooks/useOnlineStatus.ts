import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Checks if the network is actually reachable by making a lightweight HEAD request.
 * Catches browser/DevTools false negatives where navigator.onLine is false
 * despite active connectivity.
 */
async function probeConnectivity(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`/favicon.ico?_t=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || (res.status >= 200 && res.status < 400);
  } catch {
    return false;
  }
}

/**
 * Tracks online/offline status (R2 / ALM-16).
 *
 * In the Capacitor native shell `navigator.onLine` and the window online/offline
 * events are unreliable in the WebView, so we read the real device connectivity
 * via `@capacitor/network`.
 *
 * On the web, `navigator.onLine` and window events are used as primary signals,
 * augmented with active connectivity probing and window focus re-checks to
 * prevent false-negative offline states (e.g. from Chrome DevTools device mode
 * throttling glitches or sleep/wake blips).
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

    // Web: navigator.onLine + online/offline events + active probe fallback.
    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const verifyOnline = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (isMounted) setOnline(true);
        return;
      }
      // If navigator.onLine is false, verify via probe in case of browser/emulator false negative.
      const isReachable = await probeConnectivity();
      if (isMounted) {
        setOnline(isReachable);
      }
    };

    const handleOnline = () => {
      if (isMounted) setOnline(true);
    };

    const handleOffline = () => {
      // Don't immediately lock to offline; probe to confirm.
      verifyOnline();
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        verifyOnline();
      }
    };

    // Initial verification if starting in false state.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      verifyOnline();
    }

    // Periodic heartbeat only when in offline state to self-heal when connection restores.
    pollInterval = setInterval(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        verifyOnline();
      }
    }, 10_000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  return online;
}

export default useOnlineStatus;

