import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { addMonths, subMonths } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Phone, Plus, RefreshCw } from 'lucide-react';
import { useAvailability } from '../state/useAvailability';
import { useAvailabilityEditing } from '../state/useAvailabilityEditing';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/modules/core/ui/primitives/button';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { useReserveListOptIn } from '@/modules/reserve-list/state/useReserveListOptIn';
import { format } from 'date-fns';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';
import { pageVariants } from '@/modules/core/ui/motion/presets';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useAuth } from '@/platform/auth/useAuth';
import { parseISO } from 'date-fns';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { useMyContractBasis } from '../state/useMyContractBasis';
import { ContractBasisBanner } from '../ui/header/ContractBasisBanner';
import { ExceptionsPanel } from '../ui/exceptions/ExceptionsPanel';

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
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { toast } = useToast();

  const [currentMonth, setCurrentMonth] = useState(new Date());

  // What an ABSENT declaration means for this person. Without it the page
  // shows a full-timer an empty calendar and implies they owe it an answer,
  // when in fact a declaration NARROWS what they can be rostered for.
  const { basis: contractBasis, loading: basisLoading } = useMyContractBasis(user?.id);

  const availabilityData = useAvailability({ month: currentMonth });
  const editingData = useAvailabilityEditing();
  const reserveListOptIn = useReserveListOptIn();

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));

  const handleReserveListToggle = async (checked: boolean) => {
    try {
      await reserveListOptIn.setOptIn(checked);
      toast({
        title: checked ? 'Reserve List: opted in' : 'Reserve List: opted out',
        description: checked
          ? 'You may now be contacted for emergency replacement shifts.'
          : 'You will no longer appear in emergency replacement searches.',
      });
    } catch {
      toast({
        title: 'Could not update Reserve List preference',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = async () => {
    await Promise.all([availabilityData.refreshRules(), availabilityData.refreshSlots()]);
    toast({
      title: 'Refreshed',
      description: 'Availability data has been refreshed.',
    });
  };

  const handleAddAvailability = () => {
    editingData.startCreate();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
      <GoldStandardHeader
        title="My Availabilities"
        Icon={CalendarDays}
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        functionBar={
          <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
            isDark ? "bg-[#111827]/60" : "bg-slate-100"
          )}>
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
              {/* Month Navigation */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className={cn(
                  "h-9 lg:h-11 px-4 lg:px-6 rounded-xl flex items-center justify-center min-w-[120px] md:min-w-[180px]",
                  isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
                )}>
                  <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.2em] text-foreground">
                    {format(currentMonth, 'MMMM yyyy')}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNextMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Add Availability Button */}
              <Button
                onClick={handleAddAvailability}
                className={cn(
                  "flex-shrink-0 gap-2 h-9 lg:h-11 px-3 lg:px-6 rounded-xl font-black uppercase text-[9px] lg:text-[10px] tracking-wider transition-all shadow-sm",
                  isDark 
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20" 
                    : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
                )}
              >
                <Plus className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                <span className="hidden sm:inline">Add Availability</span>
                <span className="sm:hidden text-[8px]">Add</span>
              </Button>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Refresh Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
                    isDark 
                        ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                        : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                )}
              >
                <RefreshCw className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              </Button>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Reserve List opt-in — OFF by default; controls whether this
                  employee can be found in a manager's emergency Reserve List
                  search (docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §8). */}
              <div
                className={cn(
                  "flex items-center gap-2 flex-shrink-0 h-9 lg:h-11 px-3 lg:px-4 rounded-xl transition-all",
                  isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
                )}
                title="When on, you may be contacted for emergency replacement shifts (starting within 4 hours)."
              >
                <Phone className={cn("h-3.5 w-3.5 lg:h-4 lg:w-4 flex-shrink-0", isDark ? "text-muted-foreground" : "text-slate-500")} />
                <span className="hidden sm:inline text-[9px] lg:text-[10px] font-black uppercase tracking-wider text-foreground whitespace-nowrap">
                  Reserve List
                </span>
                <Switch
                  checked={reserveListOptIn.optIn}
                  onCheckedChange={handleReserveListToggle}
                  disabled={reserveListOptIn.loading || reserveListOptIn.saving}
                  aria-label="Reserve List opt-in"
                />
              </div>
            </div>
          </div>
        }
      />

      {/* ── BODY ── */}
      <motion.div
        variants={pageVariants}
        initial="hidden"
        animate="show"
        className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col gap-3"
      >
        <ContractBasisBanner basis={contractBasis} loading={basisLoading} />

        {/* Where a permanent's agency actually lives: they cannot usefully
            declare availability, and leave is for absences that draw down a
            balance. Casuals keep the declaration editor as their primary tool,
            so the panel is only surfaced for OPT_OUT staff. */}
        {!basisLoading && contractBasis.availabilityMode === 'OPT_OUT' && user?.id && (
          <ExceptionsPanel profileId={user.id} />
        )}

        {/* AvailabilityScreen is `h-full`; with a sibling banner above it needs
            an explicit flex track or it overflows the column. */}
        <div className="flex-1 min-h-0">
          <AvailabilityScreen
            layout={breakpoint === 'desktop' ? 'desktop' : breakpoint === 'tablet' ? 'tablet' : 'mobile'}
            currentMonth={currentMonth}
            availabilityData={availabilityData}
            editingData={editingData}
          />
        </div>
      </motion.div>
    </div>
  );
};

export default AvailabilityPage;
