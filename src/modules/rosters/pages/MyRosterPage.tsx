import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import MyRosterCalendar from '@/modules/rosters/ui/my-roster/MyRosterCalendar';
import { MyOffersModal } from '@/modules/rosters/ui/my-roster/MyOffersModal';
import { useMyRoster } from '@/modules/rosters';
import { usePendingOfferCount, useMyOffers } from '@/modules/rosters/state/useRosterShifts';
import { CalendarDays, Info, Loader2, Mail } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { motion, AnimatePresence } from 'framer-motion';

import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { EmployeeFunctionBar } from '@/modules/core/ui/components/EmployeeFunctionBar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { format, startOfMonth, startOfDay, isWithinInterval } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { DatePicker } from '@/modules/core/ui/calendar';
import { 
  computeRange, 
  navigateDate, 
  formatRangeLabel, 
  ViewType 
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';

const MyRosterPage: React.FC = () => {
  const { user } = useAuth();
  // Personal roster owns its own view state (decoupled from the manager planner's
  // shared store) so it always opens on the current week (Mon–Sun) preset.
  const [view, setView] = useState<ViewType>('week');
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
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

  const rangeLabel = React.useMemo(
    () => formatRangeLabel(computeRange(selectedDate, view), view),
    [selectedDate, view],
  );

  // The picker closes itself; this only snaps the pick to the view's period.
  const handleDateSelect = React.useCallback((date: Date) => {
    if (view === 'week') return setSelectedDate(startOfWeekAU(date));
    if (view === 'month') return setSelectedDate(startOfMonth(date));
    setSelectedDate(date);
  }, [view]);

  const { isDark } = useTheme();

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
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
      <GoldStandardHeader
        title="My Roster"
        Icon={CalendarDays}
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        functionBar={
          <EmployeeFunctionBar
            view={view}
            onViewChange={(v) => setView(v as ViewType)}
            selectedDate={selectedDate}
            onDateChange={handleDateSelect}
            rangeLabel={rangeLabel}
            onPrevious={() => setSelectedDate(navigateDate(selectedDate, view, -1))}
            onNext={() => setSelectedDate(navigateDate(selectedDate, view, 1))}
            trailing={
              <button
                onClick={() => setShowOffersModal(true)}
                aria-label={
                  pendingOfferCount > 0
                    ? `Shift offers — ${pendingOfferCount} pending`
                    : 'Shift offers'
                }
                className={cn(
                  text.label,
                  touch.targetY,
                  'hidden md:inline-flex items-center gap-2 rounded-xl border px-3 uppercase transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  pendingOfferCount > 0
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'border-border bg-background/70 text-foreground hover:bg-muted/60',
                )}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                <span>Offers</span>
                {pendingOfferCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-none text-black tabular-nums">
                    {pendingOfferCount}
                  </span>
                )}
              </button>
            }
          />
        }
      />

      {/* ── BODY (Calendar) ── */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
        <div className={cn(
            "h-full rounded-[32px] overflow-hidden transition-all border",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
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
      </div>

      {/* Mobile sticky FAB — offers access floating above the bottom navigation bar */}
      <AnimatePresence>
        <motion.div
          key="offers-fab"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          className="md:hidden fixed bottom-[var(--mobile-floating-action-bottom,calc(var(--mobile-bottom-nav-clearance,96px)+1.5rem))] right-[calc(env(safe-area-inset-right,0px)+1.25rem)] z-50"
        >
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              setShowOffersModal(true);
            }}
            aria-label={
              pendingOfferCount > 0
                ? `Shift offers — ${pendingOfferCount} pending`
                : 'Shift offers'
            }
            className={cn(
              "relative h-14 w-14 rounded-full flex items-center justify-center",
              "bg-amber-500 hover:bg-amber-400 active:scale-95 transition-colors",
              // A plain elevation shadow. This was `shadow-2xl shadow-amber-500/40`
              // plus a 2s infinite pulse whenever anything was pending — a
              // permanently throbbing halo in the corner of the roster, and a
              // WCAG 2.2.2 problem since nothing stopped it.
              "shadow-lg shadow-black/25",
            )}
          >
            <Mail size={24} className="text-black" aria-hidden="true" />
            {pendingOfferCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 bg-black text-amber-400 text-[11px] font-bold tabular-nums flex items-center justify-center rounded-full border-2 border-amber-500 px-1.5">
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
