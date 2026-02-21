/**
 * Broadcasts Manager Page - Layout Router
 *
 * RESPONSIBILITIES:
 * - Detect breakpoint (desktop/tablet/mobile)
 * - Render correct layout component
 *
 * All state management is handled by BroadcastsManagerScreen.
 * This component only handles responsive layout switching.
 */

import React, { useState, useEffect } from 'react';
import { BroadcastsManagerDesktopLayout } from '../../layout/BroadcastsManagerDesktopLayout';
import { BroadcastsManagerTabletLayout } from '../../layout/BroadcastsManagerTabletLayout';
import { BroadcastsManagerMobileLayout } from '../../layout/BroadcastsManagerMobileLayout';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

// ============================================================================
// BREAKPOINT DETECTION
// ============================================================================

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setBreakpoint('mobile');
      } else if (width < 1024) {
        setBreakpoint('tablet');
      } else {
        setBreakpoint('desktop');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return breakpoint;
}

// ============================================================================
// PAGE COMPONENT
// ============================================================================

export const BroadcastsManagerPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

  return (
    <div>
      <ScopeFilterBanner
        mode="managerial"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        multiSelect={true}
        className="m-4 md:m-6"
      />
      {breakpoint === 'desktop' ? (
        <BroadcastsManagerDesktopLayout scope={scope} />
      ) : breakpoint === 'tablet' ? (
        <BroadcastsManagerTabletLayout scope={scope} />
      ) : (
        <BroadcastsManagerMobileLayout scope={scope} />
      )}
    </div>
  );
};

export default BroadcastsManagerPage;
