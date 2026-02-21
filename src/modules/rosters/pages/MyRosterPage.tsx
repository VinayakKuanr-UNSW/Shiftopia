import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import MyRosterCalendar from '@/modules/rosters/ui/my-roster/MyRosterCalendar';
import { MyOffersModal } from '@/modules/rosters/ui/my-roster/MyOffersModal';
import { useRosterView, CalendarView, useMyRoster } from '@/modules/rosters';
import { usePendingOfferCount } from '@/modules/rosters/state/useRosterShifts';
import { CalendarDays, Info, Calendar, LayoutGrid, Columns, Grid3X3, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion } from 'framer-motion';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

const MyRosterPage: React.FC = () => {
  const { user } = useAuth();
  const { view, setView, selectedDate, setSelectedDate } = useRosterView();
  const { organizationId, departmentId } = useOrgSelection();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  // Fetch real shifts for the logged-in employee, filtering by the multi-select scope
  const { shifts, isLoading, error, getShiftsForDate } = useMyRoster(view, selectedDate, scope);

  // My Offers state
  const [showOffersModal, setShowOffersModal] = useState(false);

  // React Query: offer count auto-refetches on interval and after invalidation
  const { data: pendingOfferCount = 0 } = usePendingOfferCount(user?.id || null);

  console.log('[MyRosterPage] Debug:', {
    userId: user?.id,
    pendingOfferCount,
    organizationId,
    departmentId
  });

  // No-op: React Query auto-invalidates via mutation hooks when offers are responded to
  const handleOfferResponded = () => {
    // Cache invalidation happens automatically in useAcceptOffer/useDeclineOffer hooks
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-transparent">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl"
        >
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <CalendarDays className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Authentication Required</h2>
          <p className="text-blue-200/60">Please log in to view your personal roster.</p>
        </motion.div>
      </div>
    );
  }

  const viewOptions: Array<{ value: CalendarView; label: string; icon: React.ReactNode }> = [
    { value: 'day', label: 'Day', icon: <Calendar className="h-4 w-4" /> },
    { value: '3day', label: '3-Day', icon: <Columns className="h-4 w-4" /> },
    { value: 'week', label: 'Week', icon: <Grid3X3 className="h-4 w-4" /> },
    { value: 'month', label: 'Month', icon: <LayoutGrid className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] overflow-hidden bg-transparent p-4 md:p-6 space-y-6">

      {/* Scope Filter */}
      <ScopeFilterBanner
        mode="personal"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        className="flex-shrink-0"
      />

      {/* Controls Row */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex-shrink-0"
      >
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">

          <div className="flex flex-wrap items-center gap-4 w-full xl:w-auto">
            {/* View Toggle - Segmented Control */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center bg-[#1a2744]/40 backdrop-blur-md rounded-xl p-1 border border-white/10"
            >
              {viewOptions.map((option, index) => (
                <motion.button
                  key={option.value}
                  onClick={() => setView(option.value)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 * index }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300',
                    view === option.value
                      ? 'bg-primary text-white shadow-glow'
                      : 'text-blue-200/60 hover:text-white hover:bg-white/5'
                  )}
                >
                  {React.cloneElement(option.icon as React.ReactElement, {
                    className: cn("h-4 w-4 transition-colors", view === option.value ? "text-white" : "text-current opacity-70")
                  })}
                  <span className="hidden sm:inline">{option.label}</span>
                </motion.button>
              ))}
            </motion.div>

            {/* My Offers Button - Only show when organization is selected */}
            {organizationId && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 }}
              >
                <Button
                  variant="outline"
                  className={cn(
                    "relative gap-2 h-11 px-5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 bg-amber-950/20 backdrop-blur-md transition-all shadow-[0_0_15px_rgba(245,158,11,0.1)]",
                    pendingOfferCount > 0 && "animate-pulse border-amber-500/60"
                  )}
                  onClick={() => setShowOffersModal(true)}
                >
                  <Mail className="h-4 w-4" />
                  Shift Offers
                  {pendingOfferCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-amber-500 text-black font-bold text-xs flex items-center justify-center rounded-full shadow-lg border border-amber-400">
                      {pendingOfferCount}
                    </span>
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Calendar Container - Full width */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex-grow overflow-hidden bg-[#1a2744]/30 backdrop-blur-2xl rounded-3xl border border-white/5 shadow-2xl relative"
      >
        {/* Background decorative glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <span className="text-blue-200/60 font-medium">Synchronizing roster...</span>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <Info className="h-8 w-8 text-red-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Synchronization Error</h3>
              <p className="text-red-300/80 mt-1">Failed to load shifts. Please try refreshing.</p>
            </div>
          </div>
        ) : (
          <div className="h-full w-full relative z-10">
            <MyRosterCalendar
              view={view}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              getShiftsForDate={getShiftsForDate}
              shifts={shifts || []}
            />
          </div>
        )}
      </motion.div>

      {/* Info Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex-shrink-0 bg-primary/5 border border-primary/10 rounded-2xl p-4 flex items-start backdrop-blur-md"
      >
        <div className="p-2 rounded-lg bg-primary/10 text-primary mr-3 mt-0.5 shrink-0">
          <Info size={18} />
        </div>
        <div>
          <h3 className="text-white font-medium mb-1 text-sm">Roster Status</h3>
          <p className="text-blue-200/60 text-sm leading-relaxed">
            {shifts && shifts.length > 0
              ? `You have ${shifts.length} shift(s) scheduled for this period. Select a shift to view details, swap, or offer it to others.`
              : 'No shifts assigned to you in this viewing period. Contact your manager if you believe this is an error.'}
          </p>
        </div>
      </motion.div>

      {/* My Offers Modal */}
      <MyOffersModal
        isOpen={showOffersModal}
        onClose={() => setShowOffersModal(false)}
        onOfferResponded={handleOfferResponded}
      // Offers are global for the user
      />
    </div>
  );
};

export default MyRosterPage;
