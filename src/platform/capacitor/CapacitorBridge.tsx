import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useLocation, useNavigate } from 'react-router-dom';
import { focusManager } from '@tanstack/react-query';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

const APP_HOME_PATH = '/my-roster';
const EXIT_PATHS = new Set(['/', '/login', '/signup', '/pending-access', '/unauthorized', APP_HOME_PATH]);
const TRANSPARENT_SYSTEM_BAR_COLOR = '#00000000';

function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

function canExitFromPath(pathname: string): boolean {
  return EXIT_PATHS.has(pathname);
}

/**
 * Close the topmost open overlay, if there is one.
 *
 * Radix marks every open dialog, sheet, popover and dropdown with
 * `data-state="open"`, and closes on Escape. Android's hardware back is a
 * separate event that Radix never sees, so without this the back press fell
 * through to router navigation: the page changed underneath an open dialog,
 * or on an exit path the app minimised outright. Either way the dialog looked
 * like it had no way out.
 *
 * Returns true when an overlay was dismissed, so the caller leaves navigation
 * alone.
 */
function dismissTopOverlay(): boolean {
  const open = document.querySelectorAll<HTMLElement>(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]',
  );
  if (open.length === 0) return false;

  // Last in document order is the most recently mounted, so it is the one on
  // top when overlays are stacked.
  const topmost = open[open.length - 1];
  topmost.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  return true;
}

async function applyStatusBarTheme(isDark: boolean): Promise<void> {
  if (!isNativeRuntime()) return;

  const style = isDark ? Style.Dark : Style.Light;

  await StatusBar.setStyle({ style });
  await StatusBar.setBackgroundColor({ color: TRANSPARENT_SYSTEM_BAR_COLOR });
  await StatusBar.setOverlaysWebView({ overlay: true });
}

export function CapacitorBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useTheme();
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!isNativeRuntime()) return;
    document.documentElement.classList.add('capacitor-native');
    return () => document.documentElement.classList.remove('capacitor-native');
  }, []);

  useEffect(() => {
    void applyStatusBarTheme(isDark).catch((error) => {
      console.warn('[CapacitorBridge] Failed to apply status bar theme', error);
    });
  }, [isDark]);

  useEffect(() => {
    if (!isNativeRuntime()) return;

    let listener: PluginListenerHandle | undefined;

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      // An open dialog owns the back press before the router does.
      if (dismissTopOverlay()) {
        return;
      }

      if (canGoBack) {
        navigate(-1);
        return;
      }

      if (!canExitFromPath(pathnameRef.current)) {
        navigate(APP_HOME_PATH, { replace: true });
        return;
      }

      void CapacitorApp.minimizeApp();
    }).then((handle) => {
      listener = handle;
    });

    return () => {
      void listener?.remove();
    };
  }, [navigate]);

  /**
   * Teach React Query what "focused" means on a phone.
   *
   * `refetchOnWindowFocus` — on by default for every query in the app — hangs
   * off React Query's focusManager, which subscribes to the document's
   * `visibilitychange`. In a browser tab that fires whenever you switch back to
   * the window, so data quietly refreshes itself. The Capacitor WebView is not
   * a tab: it stays visible for the whole life of the process, so the event
   * never arrives and nothing is ever revalidated on return. Anything cached
   * before the app was backgrounded is replayed on the way back in, however
   * long that was — which is how a shift offered minutes earlier could be
   * missing from the inbox while the same account saw it on desktop.
   *
   * Android's `appStateChange` is the signal that actually corresponds to
   * "the user came back", so it drives the focus state instead.
   */
  useEffect(() => {
    if (!isNativeRuntime()) return;

    let listener: PluginListenerHandle | undefined;

    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      focusManager.setFocused(isActive);
    }).then((handle) => {
      listener = handle;
    });

    return () => {
      void listener?.remove();
      // Hand control back to the default (document-visibility) behaviour
      // rather than leaving the app pinned to whatever the last state was.
      focusManager.setFocused(undefined);
    };
  }, []);

  return null;
}
