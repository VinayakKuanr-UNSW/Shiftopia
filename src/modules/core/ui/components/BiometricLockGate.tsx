import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import {
  authenticateBiometric,
  checkBiometricAvailable,
  isBiometricEnabled,
  isBiometricPromptActive,
  isBiometricSupportedPlatform,
  setBiometricEnabled,
} from '@/platform/biometric/biometric';

/**
 * Biometric app-lock (T17BALMOND-30, stretch). When the user has chosen
 * "Every app open" on a native device, this gates access on app open and on
 * return from a real background. The Supabase session stays valid — this only
 * controls access, it isn't a fresh login. Web is unaffected.
 *
 * No content flash: `locked` starts true synchronously when the lock is enabled.
 * Auto-prompt: once locked + authenticated we fire the biometric dialog itself.
 * Anti-loop / no double-verify: any biometric dialog (this lock OR a sensitive
 * step-up) backgrounds/foregrounds the app; while ANY dialog is active
 * (isBiometricPromptActive) we ignore app-state changes, so it can't re-trigger
 * a lock.
 */
const RESUME_LOCK_THRESHOLD_MS = 3000;

export function BiometricLockGate() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const [locked, setLocked] = useState(
    () => isBiometricSupportedPlatform() && isBiometricEnabled(),
  );
  const [authenticating, setAuthenticating] = useState(false);
  const unlockingRef = useRef(false); // an unlock attempt is in flight — don't stack prompts
  const backgroundedAtRef = useRef(0);

  const tryUnlock = useCallback(async () => {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    setAuthenticating(true);
    const ok = await authenticateBiometric('Unlock Shiftopia');
    setAuthenticating(false);
    unlockingRef.current = false;
    if (ok) setLocked(false);
  }, []);

  // Reconcile the lock with auth, and auto-prompt when appropriate.
  useEffect(() => {
    if (!locked) return;
    if (isLoading) return; // wait for auth to resolve (overlay stays up over the loader)
    if (!isAuthenticated) {
      setLocked(false); // logged out (e.g. login page) — nothing to lock
      return;
    }
    let cancelled = false;
    void checkBiometricAvailable().then((ok) => {
      if (cancelled) return;
      if (!ok) setLocked(false); // can't authenticate on this device — don't trap the user
      else void tryUnlock(); // auto-fire the biometric dialog
    });
    return () => {
      cancelled = true;
    };
  }, [locked, isAuthenticated, isLoading, tryUnlock]);

  // Re-lock after a *real* background. Ignore flips caused by ANY biometric
  // dialog (this lock's or a sensitive step-up's) so we never double-prompt.
  useEffect(() => {
    if (!isBiometricSupportedPlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isBiometricPromptActive()) return; // a biometric dialog caused this flip
        if (isActive) {
          if (
            isBiometricEnabled() &&
            isAuthenticated &&
            Date.now() - backgroundedAtRef.current > RESUME_LOCK_THRESHOLD_MS
          ) {
            setLocked(true);
          }
        } else {
          backgroundedAtRef.current = Date.now();
        }
      });
      if (cancelled) handle.remove();
      else remove = () => handle.remove();
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [isAuthenticated]);

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-600/20">
        <Fingerprint className="h-10 w-10 text-indigo-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white">Shiftopia is locked</h2>
        <p className="mt-1 text-sm text-slate-400">
          Unlock with your fingerprint or face to continue.
        </p>
      </div>
      <button
        type="button"
        onClick={tryUnlock}
        disabled={authenticating}
        className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {authenticating ? 'Authenticating…' : 'Unlock'}
      </button>
      <button
        type="button"
        onClick={() => {
          // Falling back to password means biometric isn't working for the user —
          // turn the app-lock OFF so re-login doesn't immediately re-lock them.
          setBiometricEnabled(false);
          setLocked(false);
          unlockingRef.current = false;
          void logout();
        }}
        className="text-sm text-slate-400 underline underline-offset-4 transition hover:text-slate-200"
      >
        Use password instead
      </button>
    </div>
  );
}

export default BiometricLockGate;
