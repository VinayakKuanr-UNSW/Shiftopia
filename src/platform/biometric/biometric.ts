import { Capacitor } from '@capacitor/core';

/**
 * Biometric (fingerprint / Face) helpers for the native app-lock feature
 * (T17BALMOND-30). Biometric unlock is a per-DEVICE preference — it's tied to
 * the biometrics enrolled on this specific device — so the enabled flag is
 * stored locally, not in the user's server-side settings. Native shell only;
 * browsers don't expose device biometrics here.
 */

const ENABLED_KEY = 'shiftopia.biometricEnabled';

/** Native shell only — the plugin has no web implementation we rely on. */
export function isBiometricSupportedPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function isBiometricEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setBiometricEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, 'true');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* ignore storage errors */
  }
}

/** Whether the device actually has usable enrolled biometrics. */
export async function checkBiometricAvailable(): Promise<boolean> {
  if (!isBiometricSupportedPlatform()) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable;
  } catch {
    return false;
  }
}

// A biometric dialog briefly backgrounds/foregrounds the app while it is on
// screen. isBiometricPromptActive() lets the app-lock gate ignore those flips so
// that a sensitive-page step-up prompt doesn't trigger a *second* app-lock prompt
// (double verification). It tracks ANY biometric dialog, from any gate, because
// they all go through authenticateBiometric().
let promptCount = 0;
let promptSettleUntil = 0;

/** True while a biometric dialog is on screen (or just closed and settling). */
export function isBiometricPromptActive(): boolean {
  return promptCount > 0 || Date.now() < promptSettleUntil;
}

/**
 * Prompt the device biometric. Resolves `true` on success, `false` on failure
 * or cancel. `allowDeviceCredential` lets the user fall back to their PIN/pattern.
 * On web it resolves `true` (nothing to gate).
 */
export async function authenticateBiometric(
  reason = 'Unlock Shiftopia',
): Promise<boolean> {
  if (!isBiometricSupportedPlatform()) return true;
  promptCount++;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Use password',
      allowDeviceCredential: true,
      androidTitle: 'Unlock Shiftopia',
      androidSubtitle: 'Authenticate to continue',
    });
    return true;
  } catch {
    return false;
  } finally {
    promptCount--;
    // Keep ignoring app-state flips briefly after the dialog closes (its resume
    // event fires just after).
    promptSettleUntil = Date.now() + 1500;
  }
}

// ── Step-up authentication for sensitive actions ─────────────────────────────
/**
 * Require a biometric (or device-credential) check before a sensitive action —
 * e.g. revealing pay, or a manager approving a shift. This is independent of the
 * app-lock toggle: sensitive data always re-verifies identity. On the web, or on
 * a device with no enrolled biometrics, it resolves `true` so a user is never
 * locked out of their own data.
 */
export async function requireBiometricStepUp(reason: string): Promise<boolean> {
  if (!isBiometricSupportedPlatform()) return true;
  const available = await checkBiometricAvailable();
  if (!available) return true;
  return authenticateBiometric(reason);
}
