import React from 'react';
import { addDays, startOfWeek } from 'date-fns';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
import {
  navigateDate,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';
import { tabTransition } from '@/modules/core/ui/motion/presets';
import DayView from './DayView';
import ThreeDayView from './ThreeDayView';
import WeekView from './WeekView';
import MonthView from './MonthView';
import MobileRosterAgendaView from './MobileRosterAgendaView';
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
  onOffersClick: _onOffersClick,
}) => {
  const isMobile = useIsMobile();
  const mobileAgendaDays = React.useMemo(() => {
    if (view === 'day') return [selectedDate];
    if (view === '3day') return [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];
    if (view === 'week') {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return [];
  }, [selectedDate, view]);

  if (isMobile && view !== 'month') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <MobileRosterAgendaView
          days={mobileAgendaDays}
          getShiftsForDate={getShiftsForDate}
          includeContinuations={view === 'week' ? false : undefined}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
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
            <motion.div key="month" {...tabTransition} className="h-full flex flex-col min-h-0">
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
