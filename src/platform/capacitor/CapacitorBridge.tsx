import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useLocation, useNavigate } from 'react-router-dom';
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

  return null;
}
