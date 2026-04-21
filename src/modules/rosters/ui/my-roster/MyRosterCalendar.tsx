import React from 'react';
import { Mail } from 'lucide-react';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
import {
  UnifiedRosterNavigator,
  navigateDate,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';
import { tabTransition } from '@/modules/core/ui/motion/presets';
import DayView from './DayView';
import ThreeDayView from './ThreeDayView';
import WeekView from './WeekView';
import MonthView from './MonthView';
import { Shift } from '@/modules/rosters';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface MyRosterCalendarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  getShiftsForDate: (date: Date, options?: { includeContinuations?: boolean }) => ShiftWithDetails[];
  shifts: Shift[];
  pendingOfferCount: number;
  offerDates: Set<string>;
  onOffersClick: () => void;
}


const MyRosterCalendar: React.FC<MyRosterCalendarProps> = ({
  view,
  onViewChange,
  selectedDate,
  onDateChange,
  getShiftsForDate,
  shifts: _shifts,
  pendingOfferCount,
  offerDates,
  onOffersClick,
}) => {
  const isMobile = useIsMobile();

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Unified toolbar ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 md:px-4 py-2 border-b border-border bg-card/70 backdrop-blur-xl">

        {/* Navigation (hidden on mobile month — MonthView owns its own header) */}
        {!(isMobile && view === 'month') && (
          <UnifiedRosterNavigator
            date={selectedDate}
            viewType={view}
            onChange={(d) => onDateChange(d)}
            onViewTypeChange={onViewChange}
            showToday
            showPicker
            className="flex-1 min-w-0"
          />
        )}

        {/* Spacer for mobile month view */}
        {isMobile && view === 'month' && <div className="flex-1" />}

        {/* Offers button — desktop only (mobile uses FAB) */}
        <button
          onClick={onOffersClick}
          className={cn(
            'hidden md:flex items-center gap-2 h-8 pl-3 pr-3.5 rounded-lg text-xs font-bold flex-shrink-0',
            'border border-border bg-card hover:bg-muted/60 transition-colors relative',
            pendingOfferCount > 0 && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
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

      {/* ── Calendar view ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'day' && (
            <motion.div key="day" {...tabTransition} className="h-full">
              <DayView
                date={selectedDate}
                shifts={getShiftsForDate(selectedDate)}
              />
            </motion.div>
          )}
          {view === '3day' && (
            <motion.div key="3day" {...tabTransition} className="h-full">
              <ThreeDayView
                startDate={selectedDate}
                getShiftsForDate={getShiftsForDate}
              />
            </motion.div>
          )}
          {view === 'week' && (
            <motion.div key="week" {...tabTransition} className="h-full">
              <WeekView date={selectedDate} getShiftsForDate={getShiftsForDate} />
            </motion.div>
          )}
          {view === 'month' && (
            <motion.div key="month" {...tabTransition} className="h-full">
              <MonthView
                date={selectedDate}
                getShiftsForDate={getShiftsForDate}
                pendingOfferCount={pendingOfferCount}
                offerDates={offerDates}
                onPrevious={() => onDateChange(navigateDate(selectedDate, 'month', -1))}
                onNext={() => onDateChange(navigateDate(selectedDate, 'month', 1))}
                view={view}
                onViewChange={onViewChange}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MyRosterCalendar;
