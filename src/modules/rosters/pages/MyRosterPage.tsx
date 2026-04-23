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
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, RefreshCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Calendar as CalendarPrimitive } from '@/modules/core/ui/primitives/calendar';
import { 
  computeRange, 
  navigateDate, 
  formatRangeLabel, 
  ViewType 
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';

/**
 * Disconnected Navigation Component for MyRoster
 */
const MyRosterNavigator: React.FC<{
    view: ViewType;
    onViewChange: (v: ViewType) => void;
    selectedDate: Date;
    onDateChange: (d: Date) => void;
}> = ({ view, onViewChange, selectedDate, onDateChange }) => {
    const { isDark } = useTheme();
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    const range = computeRange(selectedDate, view);
    const label = formatRangeLabel(range, view);

    const handlePrev = () => onDateChange(navigateDate(selectedDate, view, -1));
    const handleNext = () => onDateChange(navigateDate(selectedDate, view, 1));
    const handleToday = () => onDateChange(new Date());

    const handleDateSelect = (date: Date | undefined) => {
        if (date) {
            let snapped = date;
            if (view === 'week') snapped = startOfWeek(date, { weekStartsOn: 1 });
            if (view === 'month') snapped = startOfMonth(date);
            onDateChange(snapped);
            setIsPickerOpen(false);
        }
    };

    const buttonBaseCls = cn(
        "flex items-center gap-2 h-10 lg:h-11 px-2.5 lg:px-4 rounded-xl transition-all font-black tabular-nums text-[10px]",
        isDark 
            ? "bg-[#111827]/60 text-white hover:bg-[#252d40]" 
            : "bg-white text-slate-900 border border-slate-200/50 shadow-sm hover:bg-slate-50"
    );

    const toggleBaseCls = cn(
        "px-3 h-8 lg:h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
        isDark ? "text-white/40 hover:text-white" : "text-slate-900/40 hover:text-slate-900"
    );

    const VIEW_OPTIONS: { value: ViewType; label: string; short: string }[] = [
        { value: 'day', label: 'Day', short: 'D' },
        { value: '3day', label: '3D', short: '3D' },
        { value: 'week', label: 'Week', short: 'W' },
        { value: 'month', label: 'Month', short: 'M' },
    ];

    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* View Toggle */}
            <div className={cn(
                "flex items-center gap-1 p-1 rounded-xl",
                isDark ? "bg-[#111827]/60" : "bg-slate-100"
            )}>
                {VIEW_OPTIONS.map((opt) => (
                    <button
                        key={opt.value}
                        onClick={() => onViewChange(opt.value)}
                        className={cn(
                            toggleBaseCls,
                            view === opt.value && (isDark ? "bg-[#1c2333] text-white shadow-sm" : "bg-white text-slate-900 shadow-sm")
                        )}
                    >
                        <span className="sm:hidden">{opt.short}</span>
                        <span className="hidden sm:inline">{opt.label}</span>
                    </button>
                ))}
            </div>

            <div className="h-6 w-px bg-border/10 mx-1" />

            {/* Navigation Controls */}
            <div className="flex items-center gap-1.5">
                <button onClick={handlePrev} className={cn(buttonBaseCls, "px-2 lg:px-2")}>
                    <ChevronLeft className="w-4 h-4" />
                </button>

                <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                    <PopoverTrigger asChild>
                        <button className={buttonBaseCls}>
                            <Calendar className="w-3.5 h-3.5 opacity-50" />
                            <span className="tracking-tight">{label}</span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <CalendarPrimitive
                            mode="single"
                            selected={selectedDate}
                            onSelect={handleDateSelect}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>

                <button onClick={handleNext} className={cn(buttonBaseCls, "px-2 lg:px-2")}>
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            <div className="h-6 w-px bg-border/10 mx-1" />

            {/* Today Button */}
            <button onClick={handleToday} className={cn(buttonBaseCls, "uppercase tracking-wider")}>
                <RefreshCcw className="w-3.5 h-3.5 opacity-50" />
                <span>Today</span>
            </button>
        </div>
    );
};

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
    // h-full fills the noPadding main area (overflow-hidden in AppLayout)
    <div className="h-full flex flex-col overflow-hidden">
      
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
        <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Row 1: Identity & Clock */}
          <PersonalPageHeader
            title="My Roster"
            Icon={CalendarDays}
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            className="mb-4 lg:mb-6"
          />

          {/* Row 3: Roster Function Bar (Standardized Row) */}
          <div className="flex flex-row items-center gap-2 w-full transition-all overflow-hidden mt-1">
              {/* Scrollable Container for all tools */}
              <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
                  <div className="flex-shrink-0">
                      <MyRosterNavigator
                          view={view}
                          onViewChange={setView}
                          selectedDate={selectedDate}
                          onDateChange={setSelectedDate}
                      />
                  </div>

                  <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

                  {/* Offers Button (Desktop Only) */}
                  <button
                    onClick={() => setShowOffersModal(true)}
                    className={cn(
                      'hidden md:flex items-center gap-2 h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black transition-all flex-shrink-0 uppercase tracking-wider shadow-sm',
                      isDark 
                        ? "bg-[#111827]/60 text-white/70 hover:text-white" 
                        : "bg-slate-100 text-slate-700 border border-slate-200/50 hover:bg-slate-200",
                      pendingOfferCount > 0 && (isDark ? 'text-amber-400 border border-amber-500/30' : 'text-amber-600 border border-amber-500/30'),
                    )}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>Offers</span>
                    {pendingOfferCount > 0 && (
                      <span className="min-w-[18px] h-4.5 bg-amber-500 text-black font-black text-[10px] flex items-center justify-center rounded-full px-1 leading-none">
                        {pendingOfferCount}
                      </span>
                    )}
                  </button>
              </div>
          </div>
        </div>
      </div>

      {/* ── Main Content Area (Calendar View) ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
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
