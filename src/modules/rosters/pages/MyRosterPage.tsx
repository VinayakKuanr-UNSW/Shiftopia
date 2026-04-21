import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import MyRosterCalendar from '@/modules/rosters/ui/my-roster/MyRosterCalendar';
import { MyOffersModal } from '@/modules/rosters/ui/my-roster/MyOffersModal';
import { useRosterView, useMyRoster } from '@/modules/rosters';
import { usePendingOfferCount, useMyOffers } from '@/modules/rosters/state/useRosterShifts';
import { CalendarDays, Info, Loader2, Mail } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

const MyRosterPage: React.FC = () => {
  const { user } = useAuth();
  const { view, setView, selectedDate, setSelectedDate } = useRosterView();
  useOrgSelection(); // keeps context subscription without unused destructure
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  const { shifts, isLoading, error, getShiftsForDate } = useMyRoster(view, selectedDate, scope);

  const [showOffersModal, setShowOffersModal] = useState(false);

  const { data: offersData = [] } = useMyOffers(user?.id || null);
  const offerDates = React.useMemo(() => {
    return new Set(offersData.map(o => o.shift.shift_date));
  }, [offersData]);

  const { data: pendingOfferCount = 0 } = usePendingOfferCount(user?.id || null);

  const handleOfferResponded = () => {};

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center p-8 rounded-3xl bg-card border border-border shadow-sm"
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CalendarDays className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Authentication Required</h2>
          <p className="text-muted-foreground">Please log in to view your personal roster.</p>
        </motion.div>
      </div>
    );
  }

  return (
    // h-full fills the noPadding main area (overflow-hidden in AppLayout)
    <div className="h-full flex flex-col overflow-hidden bg-background">

      {/* ── Unified Header ── */}
      <div className="px-4 pt-6">
        <PersonalPageHeader
          title="My Roster"
          Icon={CalendarDays}
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
        />
      </div>

      {/* Calendar area — fills all remaining vertical space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-9 w-9 animate-spin text-primary/60" />
            <span className="text-sm text-muted-foreground font-medium tracking-wide">
              Loading your roster…
            </span>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <Info className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Could not load roster</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Failed to fetch shifts. Try refreshing the page.
              </p>
            </div>
          </div>
        ) : (
          <MyRosterCalendar
            view={view}
            onViewChange={setView}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            getShiftsForDate={getShiftsForDate}
            shifts={shifts || []}
            pendingOfferCount={pendingOfferCount}
            offerDates={offerDates}
            onOffersClick={() => setShowOffersModal(true)}
          />
        )}
      </div>

      {/* Mobile sticky FAB — offers access below the calendar */}
      <AnimatePresence>
        <motion.div
          key="offers-fab"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          className="md:hidden fixed bottom-24 right-5 z-40"
        >
          <button
            onClick={() => setShowOffersModal(true)}
            className={cn(
              "relative h-14 w-14 rounded-full flex items-center justify-center",
              "bg-amber-500 hover:bg-amber-400 active:scale-95 transition-all",
              "shadow-2xl shadow-amber-500/40",
              pendingOfferCount > 0 && "animate-[pulse_2s_ease-in-out_infinite]"
            )}
          >
            <Mail size={22} className="text-black" />
            {pendingOfferCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-black text-amber-400 font-black text-[10px] flex items-center justify-center rounded-full border-2 border-amber-500 px-1">
                {pendingOfferCount}
              </span>
            )}
          </button>
        </motion.div>
      </AnimatePresence>

      <MyOffersModal
        isOpen={showOffersModal}
        onClose={() => setShowOffersModal(false)}
        onOfferResponded={handleOfferResponded}
      />
    </div>
  );
};

export default MyRosterPage;
