import { useEffect, useState } from 'react';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  isBiometricSupportedPlatform,
  setBiometricEnabled,
} from '@/platform/biometric/biometric';

/**
 * Security-tab card for native biometric verification (T17BALMOND-30).
 *
 * The user chooses WHEN verification is required:
 *   • "Every app open"      — the whole app locks on open / resume (app-lock ON).
 *   • "Only sensitive data" — the app opens freely; only sensitive pages
 *     (e.g. timesheets) step up (app-lock OFF).
 * Sensitive-data step-up is always on either way and is intentionally NOT a
 * setting.
 */
export function BiometricToggle() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(isBiometricEnabled()); // true = every app open
  const [checking, setChecking] = useState(true);
  const isNative = isBiometricSupportedPlatform();

  useEffect(() => {
    let mounted = true;
    checkBiometricAvailable().then((ok) => {
      if (mounted) {
        setAvailable(ok);
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const chooseMode = (everyOpen: boolean) => {
    if (everyOpen === enabled) return;
    // Just save the preference — no prompt here. The lock (and its biometric
    // prompt) is applied by BiometricLockGate on the next app open / resume,
    // which is user-triggered, so enabling can never freeze on a native dialog.
    setBiometricEnabled(everyOpen);
    setEnabled(everyOpen);
  };

  const optionBtn = (everyOpen: boolean, title: string, sub: string) => {
    const active = enabled === everyOpen;
    return (
      <button
        type="button"
        onClick={() => chooseMode(everyOpen)}
        className={
          'flex-1 text-left p-4 rounded-xl border transition-colors ' +
          (active ? 'bg-primary/20 border-primary/50' : 'bg-white/5 border-white/10 hover:bg-white/10')
        }
      >
        <div className={'text-sm font-medium ' + (active ? 'text-white' : 'text-white/80')}>{title}</div>
        <div className="text-xs text-blue-200/60 mt-1">{sub}</div>
      </button>
    );
  };

  return (
    <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
      <div>
        <h4 className="text-white font-medium">Biometric verification</h4>
        <p className="text-sm text-blue-200/60 mt-1">
          Sensitive data (e.g. timesheets) always requires your fingerprint or
          face. Choose whether opening the app also requires it.
        </p>
      </div>

      {!isNative ? (
        <p className="text-sm text-white/40 mt-4">Available in the mobile app.</p>
      ) : checking ? (
        <p className="text-sm text-white/40 mt-4">Checking device…</p>
      ) : !available ? (
        <p className="text-sm text-white/40 mt-4">
          No biometrics enrolled on this device — set up a fingerprint or face in
          your device settings to use this.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          {optionBtn(true, 'Every app open', 'Locks the whole app; unlock with your fingerprint or face.')}
          {optionBtn(false, 'Only sensitive data', 'App opens freely; only sensitive pages verify.')}
        </div>
      )}
    </div>
  );
}

export default BiometricToggle;
