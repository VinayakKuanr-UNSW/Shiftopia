import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

/**
 * "Add to Home Screen" install prompt (R2 / ALM-10).
 *
 * Listens for the browser's `beforeinstallprompt` event, suppresses the default
 * mini-infobar, and surfaces a branded banner so the user can install Shiftopia
 * as a PWA. Hidden when already installed (standalone), inside the Capacitor
 * native shell, or recently dismissed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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

export function PWAInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || isNativeShell() || recentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop the default mini-infobar; we show our own UI
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
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
    setVisible(false);
    setPromptEvent(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  if (!visible || !promptEvent) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Shiftopia"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-xl dark:border-indigo-900 dark:bg-slate-900"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Install Shiftopia</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Add it to your home screen for quick, app-like access.
        </p>
      </div>
      <button
        type="button"
        onClick={handleInstall}
        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
      >
        Install
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default PWAInstallPrompt;
