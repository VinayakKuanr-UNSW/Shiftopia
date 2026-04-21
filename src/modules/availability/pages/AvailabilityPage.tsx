/**
 * Availability Page - Layout Router
 *
 * RESPONSIBILITIES:
 * - Detect breakpoint (desktop/tablet/mobile)
 * - Render correct layout component
 *
 * All state management is handled by AvailabilityScreen.
 * This component only handles responsive layout switching.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AvailabilityDesktopLayout } from '../layout/AvailabilityDesktopLayout';
import { AvailabilityTabletLayout } from '../layout/AvailabilityTabletLayout';
import { AvailabilityMobileLayout } from '../layout/AvailabilityMobileLayout';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { CalendarDays } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { pageVariants } from '@/modules/core/ui/motion/presets';

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

export const AvailabilityPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  // Scope filter banner + responsive layout
  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="w-full min-h-screen bg-background"
    >
      <div className="px-4 pt-6 pb-2">
        <PersonalPageHeader
          title="Availabilities"
          Icon={CalendarDays}
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
        />
      </div>
      {breakpoint === 'desktop' ? (
        <AvailabilityDesktopLayout />
      ) : breakpoint === 'tablet' ? (
        <AvailabilityTabletLayout />
      ) : (
        <AvailabilityMobileLayout />
      )}
    </motion.div>
  );
};

export default AvailabilityPage;
