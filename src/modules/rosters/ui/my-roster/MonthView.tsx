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
  Calendar,
} from 'lucide-react';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/modules/core/ui/primitives/drawer';
import { Shift } from '@/modules/rosters';
import { MobileShiftCard } from './MobileShiftCard';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import MyRosterShift from './MyRosterShift';

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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
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
        <div className="h-full flex flex-col overflow-hidden">
          {/* Calendar Content */}
          <div className="flex-1 px-3 py-4 flex flex-col">
                {/* Capsule Weekday Header */}
                <div className="grid grid-cols-7 mb-4 bg-muted/20 dark:bg-muted/10 rounded-xl py-2 px-0.5">
                  {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d, idx) => (
                    <div key={idx} className="text-center text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.1em]">
                      {d}
                    </div>
                  ))}
                </div>

              {/* Day Grid */}
              <div className="grid grid-cols-7 gap-y-2 flex-1 items-start">
                {allDays.map((day) => {
                  const belongsToMonth = isSameMonth(day, date);
                  const isToday        = isTodayInTimezone(day, SYDNEY_TZ);
                  const isSelected     = isSameDay(day, selectedDay);
                  const dayShifts      = getShiftsForDate(day, { includeContinuations: false });

                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => {
                        setSelectedDay(day);
                        setIsDrawerOpen(true);
                      }}
                      disabled={!belongsToMonth}
                      className={cn(
                        'relative flex flex-col items-center justify-center py-1 transition-all duration-300',
                        !belongsToMonth && 'opacity-20 pointer-events-none'
                      )}
                    >
                      {/* Selection/Today Highlight */}
                      <div className={cn(
                        'absolute inset-0 m-auto w-[36px] h-[36px] rounded-full flex items-center justify-center transition-all duration-500',
                        isSelected 
                          ? 'bg-primary text-primary-foreground scale-105 shadow-sm shadow-primary/40 z-10' 
                          : isToday 
                            ? 'bg-primary/10 text-primary ring-1 ring-primary/20' 
                            : 'hover:bg-muted/40'
                      )}>
                        <span className="text-[12px] font-bold tracking-tight">
                          {format(day, 'd')}
                        </span>
                      </div>
                      
                      {/* Spacer */}
                      <div className="h-[36px] w-[36px]" />

                      {/* Shift density dots - Colored by type */}
                      <div className="flex gap-1 mt-1 h-1.5 justify-center z-20">
                        {dayShifts.slice(0, 3).map((s) => {
                          const type = s.groupColor?.toLowerCase();
                          return (
                            <div
                              key={s.shift.id}
                              className={cn(
                                'w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(0,0,0,0.2)]',
                                isSelected ? 'ring-1 ring-white/50' : ''
                              )}
                              style={{ 
                                backgroundColor: 
                                  type === 'convention' ? '#60a5fa' : // blue-400
                                  type === 'exhibition' ? '#4ade80' : // green-400
                                  type === 'theatre' ? '#f87171' :    // red-400
                                  '#94a3b8'                           // slate-400
                              }}
                            />
                          );
                        })}
                      </div>

                      {/* Offer indicator dot */}
                      {offerDates.has(format(day, 'yyyy-MM-dd')) && (
                         <div className="absolute top-0 right-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse shadow-sm" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

        {/* Bottom Drawer for Shifts */}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerContent className="max-h-[85vh] backdrop-blur-3xl bg-white/60 dark:bg-zinc-950/95 border-t border-white/10 rounded-t-[32px]">
            <div className="sr-only">
              <DrawerDescription>View all shifts for {format(selectedDay, 'PPPP')}</DrawerDescription>
            </div>

            {/* Premium Integrated Header */}
            <div className="px-6 pt-8 pb-4">
              <div className="flex items-end justify-between border-b border-foreground/[0.03] pb-4">
                <div>
                  <h2 className="text-[20px] font-black tracking-tight leading-none uppercase font-mono">
                    {format(selectedDay, 'EEEE, d MMMM')}
                  </h2>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mt-2">
                    {agendaShifts.length} {agendaShifts.length === 1 ? 'Shift' : 'Shifts'} Scheduled
                  </p>
                </div>
                {hasOffer && (
                  <div className="bg-amber-500/10 text-amber-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border border-amber-500/20 mb-1">
                    Offer Pending
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-0 py-0 scrollbar-none">
              <AnimatePresence mode="popLayout">
                {agendaShifts.length > 0 ? (
                  <div className="flex flex-col">
                    {agendaShifts.map((shiftData, idx) => (
                      <motion.div
                        key={shiftData.shift.id}
                        {...listItemSpring}
                        className={cn(
                          "border-b border-foreground/[0.03] last:border-b-0",
                          idx === 0 && "pt-2",
                          "pb-2"
                        )}
                      >
                        <MobileShiftCard
                          shiftData={shiftData}
                          selectedDay={selectedDay}
                          onClick={() => setSelectedShift({ data: shiftData, date: selectedDay })}
                        />
                      </motion.div>
                    ))}
                    {/* Bottom spacer for safety */}
                    <div className="h-12" />
                  </div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center py-20 text-center"
                  >
                    <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                      <Calendar className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm font-black uppercase tracking-widest text-muted-foreground/30">
                      No shifts scheduled
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </DrawerContent>
        </Drawer>


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
                        <MyRosterShift
                          key={shiftData.shift.id}
                          shift={shiftData.shift}
                          groupName={shiftData.groupName}
                          groupColor={shiftData.groupColor}
                          subGroupName={shiftData.subGroupName}
                          compact={true}
                          onClick={() => setSelectedShift({ data: shiftData, date: day })}
                        />
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
