import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AvailabilityDesktopLayout } from '../layout/AvailabilityDesktopLayout';
import { AvailabilityTabletLayout } from '../layout/AvailabilityTabletLayout';
import { AvailabilityMobileLayout } from '../layout/AvailabilityMobileLayout';
import { pageVariants } from '@/modules/core/ui/motion/presets';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { CalendarDays } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

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
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');
  const { isDark } = useTheme();

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6">
      {/* ── Unified Header Block (Rows 1-2) ────────────────────────────── */}
      <div className="flex-shrink-0 mb-6">
        <div className={cn(
          "rounded-[32px] p-4 lg:p-6 transition-all border",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <PersonalPageHeader
            title="My Availabilities"
            Icon={CalendarDays}
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
          />
        </div>
      </div>

      {/* ── Main Content Area (Glassmorphic Container) ─────────────────── */}
      <motion.div
        variants={pageVariants}
        initial="hidden"
        animate="show"
        className={cn(
          "flex-1 min-h-0 overflow-hidden rounded-[32px] border transition-all",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}
      >
        {breakpoint === 'desktop' ? (
          <AvailabilityDesktopLayout />
        ) : breakpoint === 'tablet' ? (
          <AvailabilityTabletLayout />
        ) : (
          <AvailabilityMobileLayout />
        )}
      </motion.div>
    </div>
  );
};

export default AvailabilityPage;
