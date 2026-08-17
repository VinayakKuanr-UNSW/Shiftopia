import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/modules/core/hooks/useOnlineStatus';

/**
 * Top banner shown whenever the browser is offline (R2 / ALM-16). Makes the
 * offline state obvious so the user understands they are viewing cached data
 * and that writes are temporarily unavailable.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white shadow-md sm:text-sm"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>
        You&rsquo;re offline — showing saved data. Changes can&rsquo;t be saved until you reconnect.
      </span>
    </div>
  );
}

export default OfflineBanner;
