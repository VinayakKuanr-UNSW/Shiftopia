/**
 * My Broadcasts Page - Layout Router (Employee View)
 *
 * RESPONSIBILITIES:
 * - Detect breakpoint (desktop/tablet/mobile)
 * - Render correct layout component
 *
 * All state management is handled by MyBroadcastsScreen.
 * This component only handles responsive layout switching.
 */

import React, { useState, useEffect } from 'react';
import { MyBroadcastsDesktopLayout } from '../../layout/MyBroadcastsDesktopLayout';
import { MyBroadcastsTabletLayout } from '../../layout/MyBroadcastsTabletLayout';
import { MyBroadcastsMobileLayout } from '../../layout/MyBroadcastsMobileLayout';
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

export const MyBroadcastsPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  return (
    <div>
      <ScopeFilterBanner
        mode="personal"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        className="m-4 md:m-6"
      />
      {breakpoint === 'desktop' ? (
        <MyBroadcastsDesktopLayout />
      ) : breakpoint === 'tablet' ? (
        <MyBroadcastsTabletLayout />
      ) : (
        <MyBroadcastsMobileLayout />
      )}
    </div>
  );
};

export default MyBroadcastsPage;
