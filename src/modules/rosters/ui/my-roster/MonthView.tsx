import React, { useState, useEffect } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
} from 'date-fns';
import { getTodayInTimezone, isTodayInTimezone } from '@/modules/core/lib/date.utils';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { MobileShiftCard } from './MobileShiftCard';
import { Shift } from '@/modules/rosters';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface MonthViewProps {
  date: Date;
  getShiftsForDate: (date: Date, options?: { includeContinuations?: boolean }) => ShiftWithDetails[];
  pendingOfferCount: number;
  offerDates: Set<string>;
  onPrevious?: () => void;
  onNext?: () => void;
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
}

const SYDNEY_TZ = 'Australia/Sydney';

const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const formatTimeRange = (start: string, end: string): string => {
  return `${formatTime(start)}-${formatTime(end)}`;
};

const getGradientClass = (color: string): string => {
  const base = 'dept-card-glass-base';
  switch (color?.toLowerCase()) {
    case 'convention':
      return `${base} dept-card-glass-convention border-blue-400/30 shadow-blue-500/20`;
    case 'exhibition':
      return `${base} dept-card-glass-exhibition border-green-400/30 shadow-green-500/20`;
    case 'theatre':
      return `${base} dept-card-glass-theatre border-red-400/30 shadow-red-500/20`;
    default:
      return `${base} dept-card-glass-default border-slate-400/30 shadow-slate-500/20`;
  }
};

const MonthView: React.FC<MonthViewProps> = ({ 
  date, 
  getShiftsForDate, 
  offerDates, 
  onPrevious, 
  onNext,
  view,
  onViewChange
}) => {
  const isMobile = useIsMobile();
  const [selectedDay, setSelectedDay] = useState<Date>(date);
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  useEffect(() => {
    setSelectedDay(date);
  }, [date]);

  const allDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(date)),
    end:   endOfWeek(endOfMonth(date)),
  });

  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  allDays.forEach((day) => {
    if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);

  // ── MOBILE — Outlook-style compact grid + scrollable agenda ───────────────
  if (isMobile) {
    const agendaShifts = getShiftsForDate(selectedDay, { includeContinuations: false });
    const selectedDateStr = format(selectedDay, 'yyyy-MM-dd');
    const hasOffer = offerDates.has(selectedDateStr);

    return (
      <div className="h-full flex flex-col overflow-hidden bg-background/50">

        {/* Disconnected Calendar Card */}
        <div className="flex-shrink-0 p-3 pb-1">
          <div className={cn(
            "bg-card rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-border/40 overflow-hidden transition-all duration-500",
            "backdrop-blur-2xl ring-1 ring-white/10"
          )}>
            {/* Calendar Title & Navigation & View Switcher */}
            <div className="pt-3 pb-1 px-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
              <div className="flex items-center gap-1">
                <button 
                  onClick={onPrevious}
                  className="p-1.5 -ml-1 rounded-full hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-all shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                
                <h2 className="text-[13px] font-black tracking-tight text-foreground uppercase truncate max-w-[100px]">
                  {format(date, 'MMM, yyyy')}
                </h2>

                <button 
                  onClick={onNext}
                  className="p-1.5 -mr-1 rounded-full hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-all shrink-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Integrated View Switcher */}
              <div className="flex items-center bg-muted/40 dark:bg-muted/20 rounded-xl p-0.5 gap-0.5 shrink-0">
                {(['day', '3day', 'week', 'month'] as CalendarView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => onViewChange?.(v)}
                    className={cn(
                      'px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all',
                      view === v
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground/60 hover:text-foreground'
                    )}
                  >
                    {v === '3day' ? '3D' : v[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar Content */}
            <div className="px-2 pb-3">
              {/* Capsule Weekday Header */}
              <div className="grid grid-cols-7 mb-2 bg-muted/20 dark:bg-muted/10 rounded-xl py-1.5 px-0.5">
                {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d, idx) => (
                  <div key={idx} className="text-center text-[8px] font-black text-muted-foreground/50 uppercase tracking-[0.1em]">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day Grid */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {allDays.map((day) => {
                  const belongsToMonth = isSameMonth(day, date);
                  const isToday        = isTodayInTimezone(day, SYDNEY_TZ);
                  const isSelected     = isSameDay(day, selectedDay);
                  const dayShifts      = getShiftsForDate(day, { includeContinuations: false });

                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDay(day)}
                      disabled={!belongsToMonth}
                      className={cn(
                        'relative flex flex-col items-center justify-center py-0.5 transition-all duration-300',
                        !belongsToMonth && 'opacity-20 pointer-events-none'
                      )}
                    >
                      {/* Selection/Today Highlight */}
                      <div className={cn(
                        'absolute inset-0 m-auto w-[32px] h-[32px] rounded-full flex items-center justify-center transition-all duration-500',
                        isSelected 
                          ? 'bg-primary text-primary-foreground scale-105 shadow-sm shadow-primary/40 z-10' 
                          : isToday 
                            ? 'bg-primary/10 text-primary ring-1 ring-primary/20' 
                            : 'hover:bg-muted/40'
                      )}>
                        <span className="text-[10px] font-bold tracking-tight">
                          {format(day, 'd')}
                        </span>
                      </div>
                      
                      {/* Spacer */}
                      <div className="h-[32px] w-[32px]" />

                      {/* Shift density dots */}
                      <div className="flex gap-0.5 mt-0.5 h-0.5 justify-center z-20">
                        {dayShifts.slice(0, 3).map((s) => (
                          <div
                            key={s.shift.id}
                            className={cn(
                              'w-0.5 h-0.5 rounded-full',
                              isSelected ? 'bg-primary-foreground/70' : 'bg-primary/50'
                            )}
                          />
                        ))}
                      </div>

                      {/* Offer indicator dot */}
                      {offerDates.has(format(day, 'yyyy-MM-dd')) && (
                         <div className="absolute top-1 right-1/4 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse shadow-sm" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Agenda header */}
        <div className="flex-shrink-0 px-5 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
              {format(selectedDay, 'EEEE, d MMMM')}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[12px] text-foreground font-black">
                {agendaShifts.length} {agendaShifts.length === 1 ? 'Shift' : 'Shifts'}
              </span>
              {hasOffer && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">Offer pending</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable shift list */}
        <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
          {agendaShifts.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center text-center py-16 px-8"
            >
              <p className="text-xs font-black tracking-[0.2em] text-muted-foreground/30 uppercase">
                No shifts scheduled
              </p>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="flex flex-col gap-3 p-4">
                {agendaShifts.map((shiftData) => (
                  <motion.div
                    key={shiftData.shift.id}
                    {...listItemSpring}
                  >
                    <MobileShiftCard
                      shiftData={shiftData}
                      selectedDay={selectedDay}
                    />
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>

        <ShiftDetailsDialog
          isOpen={!!selectedShift}
          onClose={() => setSelectedShift(null)}
          shiftData={selectedShift?.data || null}
          shiftDate={selectedDay}
        />
      </div>
    );
  }

  // ── DESKTOP — traditional grid ─────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Day-of-week header */}
      <div className="flex-shrink-0 grid grid-cols-7 border-b border-border bg-muted/30">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-2.5 text-center text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/50 border-r border-border last:border-r-0"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — scrolls internally */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-7 min-h-full" style={{ gridAutoRows: 'minmax(120px, 1fr)' }}>
          {weeks.map((week, wi) =>
            week.map((day, di) => {
              const isCurrentMonth = isSameMonth(day, date);
              const isToday        = isTodayInTimezone(day, SYDNEY_TZ);
              const dayShifts      = getShiftsForDate(day, { includeContinuations: false });

              return (
                <div
                  key={`${wi}-${di}`}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    'p-2 border-r border-b border-border last:border-r-0 cursor-default',
                    isToday && 'bg-primary/5',
                    !isCurrentMonth && 'opacity-25'
                  )}
                >
                  {/* Date number */}
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={cn(
                        'text-xs font-black h-6 w-6 flex items-center justify-center rounded-lg transition-all',
                        isToday
                          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                          : 'text-foreground/70'
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    {dayShifts.length > 0 && isCurrentMonth && (
                      <span className="text-[9px] font-black text-primary/40 uppercase tracking-tight">
                        {dayShifts.length}×
                      </span>
                    )}
                  </div>

                  {/* Shift chips */}
                  <div className="space-y-1.5">
                    {dayShifts.slice(0, 3).map((shiftData) => {
                      const isContinuation = shiftData.shift.shift_date !== format(day, 'yyyy-MM-dd');
                      return (
                        <div
                          key={shiftData.shift.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedShift({ data: shiftData, date: day });
                          }}
                          className={cn(
                            'text-[10px] text-foreground px-2 py-1.5 rounded-lg cursor-pointer',
                            'hover:scale-[1.02] active:scale-[0.98] transition-transform',
                            'border border-border/30 shadow-sm truncate',
                            getGradientClass(shiftData.groupColor)
                          )}
                        >
                          <div className="font-black truncate leading-tight">
                            {formatTimeRange(shiftData.shift.start_time, shiftData.shift.end_time)}
                          </div>
                          <div className="text-[9px] opacity-60 truncate font-bold uppercase tracking-wider mt-0.5">
                            {shiftData.shift.roles?.name || 'Shift'}
                          </div>
                        </div>
                      );
                    })}

                    {dayShifts.length > 3 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedShift({ data: dayShifts[3], date: day }); }}
                        className="text-[9px] font-black text-primary/50 hover:text-primary transition-colors px-1 uppercase tracking-tight"
                      >
                        +{dayShifts.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ShiftDetailsDialog
        isOpen={!!selectedShift}
        onClose={() => setSelectedShift(null)}
        shiftData={selectedShift?.data || null}
        shiftDate={selectedShift?.date ?? getTodayInTimezone(SYDNEY_TZ)}
      />
    </div>
  );
};

export default MonthView;
