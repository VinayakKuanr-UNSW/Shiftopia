// src/modules/planning/ui/views/OpenBidsView/hooks/useTimeTicker.ts

import { useState, useEffect } from 'react';

/**
 * Hook that triggers a re-render at specified intervals
 * Useful for updating time-sensitive displays like countdowns
 */
export function useTimeTicker(intervalMs: number = 60000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [intervalMs]);

  return tick;
}
