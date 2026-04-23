/**
 * Availability Page - Layout Router
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AvailabilityDesktopLayout } from '../layout/AvailabilityDesktopLayout';
import { AvailabilityTabletLayout } from '../layout/AvailabilityTabletLayout';
import { AvailabilityMobileLayout } from '../layout/AvailabilityMobileLayout';
import { pageVariants } from '@/modules/core/ui/motion/presets';

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

export const AvailabilityPage: React.FC = () => {
  const breakpoint = useBreakpoint();

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="w-full min-h-screen bg-background"
    >
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
