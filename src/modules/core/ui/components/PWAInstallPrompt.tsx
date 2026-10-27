import { useEffect, useState, type ReactNode } from 'react';
import { Download, EllipsisVertical, Share, X } from 'lucide-react';

/**
 * "Add to Home Screen" install prompt (R2 / ALM-10).
 *
 * Three cases:
 *   - `beforeinstallprompt` fires (Chrome / Edge / Samsung on Android, desktop
 *     Chromium): a one-tap Install button.
 *   - iPhone / iPad: no browser there offers an install event, so we show the
 *     manual steps (Share, then "Add to Home Screen"). The iOS branch is ported
 *     from the t19b-donut fork (6cae98a2, Jianwei Gao).
 *   - Android browsers without the event (e.g. Firefox): the menu steps. Only
 *     when the browser lacks the event entirely; a Chromium browser that stays
 *     silent usually means the app is already installed.
 * Hidden when already installed (standalone), inside the Capacitor native
 * shell, or recently dismissed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type PromptMode = 'install' | 'ios' | 'android';

const DISMISS_KEY = 'shiftopia.pwa-install-dismissed';
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // re-ask after 7 days

function recentlyDismissed(): boolean {
  const ts = localStorage.getItem(DISMISS_KEY);
  return ts ? Date.now() - Number(ts) < DISMISS_WINDOW_MS : false;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari uses a non-standard navigator flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isNativeShell(): boolean {
  // Capacitor injects this global in the native Android/iOS app.
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

function isIOS(): boolean {
  const { userAgent, maxTouchPoints } = window.navigator;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

function manualMode(): PromptMode | null {
  if (isIOS()) return 'ios';
  if (/Android/i.test(window.navigator.userAgent) && !('onbeforeinstallprompt' in window)) return 'android';
  return null;
}

const COPY: Record<PromptMode, { title: string; body: ReactNode }> = {
  install: {
    title: 'Install Shiftopia',
    body: 'Add it to your home screen for quick, app-like access.',
  },
  ios: {
    title: 'Add Shiftopia to your Home Screen',
    body: (
      <>
        Tap <Share className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" /> Share,
        then <strong>Add to Home Screen</strong>.
      </>
    ),
  },
  android: {
    title: 'Add Shiftopia to your Home screen',
    body: (
      <>
        Open the browser menu{' '}
        <EllipsisVertical className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />, then tap{' '}
        <strong>Install app</strong> or <strong>Add to Home screen</strong>.
      </>
    ),
  },
};

export function PWAInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<PromptMode | null>(null);

  useEffect(() => {
    if (isStandalone() || isNativeShell() || recentlyDismissed()) return;

    setMode(manualMode());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop the default mini-infobar; we show our own UI
      setPromptEvent(e as BeforeInstallPromptEvent);
      setMode('install');
    };
    const onInstalled = () => {
      setMode(null);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setMode(null);
    setPromptEvent(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setMode(null);
  };

  if (!mode || (mode === 'install' && !promptEvent)) return null;
  const { title, body } = COPY[mode];

  return (
    <div
      role="dialog"
      aria-label={title}
      // Above the phone bottom nav (z-60, fixed), not behind it.
      className="fixed inset-x-4 bottom-[calc(var(--mobile-bottom-nav-clearance,90px)+0.75rem)] md:bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-xl dark:border-indigo-900 dark:bg-slate-900"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{body}</p>
      </div>
      {mode === 'install' && (
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-indigo-700"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default PWAInstallPrompt;
