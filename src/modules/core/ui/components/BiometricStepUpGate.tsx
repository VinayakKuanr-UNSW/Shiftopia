import { useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck, Fingerprint } from 'lucide-react';
import { requireBiometricStepUp } from '@/platform/biometric/biometric';

/**
 * Step-up authentication gate for sensitive content (e.g. pay / timesheets).
 * Reveals its children only after a biometric / device-credential check on the
 * native app. This is INDEPENDENT of the app-lock toggle — sensitive data always
 * re-verifies identity at the moment it's viewed. On the web, or on a device with
 * no enrolled biometrics, it renders children directly so a user is never locked
 * out of their own data (T17BALMOND-30).
 */
export function BiometricStepUpGate({
  reason,
  label = 'This information',
  children,
}: {
  reason: string;
  label?: string;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  const verify = async () => {
    setChecking(true);
    const ok = await requireBiometricStepUp(reason);
    setUnlocked(ok);
    setChecking(false);
  };

  useEffect(() => {
    void verify();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/15">
        <ShieldCheck className="h-8 w-8 text-indigo-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{label} is protected</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify your identity to view this content.
        </p>
      </div>
      <button
        type="button"
        onClick={verify}
        disabled={checking}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        <Fingerprint className="h-4 w-4" />
        {checking ? 'Verifying…' : 'Verify to continue'}
      </button>
    </div>
  );
}

export default BiometricStepUpGate;
