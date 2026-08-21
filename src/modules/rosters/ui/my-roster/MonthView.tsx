import React, { useState, useEffect } from 'react';
import { format, isSameDay } from 'date-fns';
import { getTodayInTimezone } from '@/modules/core/lib/date.utils';
import { Calendar } from 'lucide-react';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { motion, AnimatePresence } from 'framer-motion';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import { MonthGrid, type MonthGridDayContext } from '@/modules/core/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Shift } from '@/modules/rosters';
import { MobileShiftCard } from './MobileShiftCard';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import MyRosterShift from './MyRosterShift';

/**
 * My Roster — month view.
 *
 * The grid comes from the shared `MonthGrid`; this file supplies only the shift
 * content. Two things changed in the migration beyond removing the hand-rolled
 * grid:
 *
 *  1. Desktop cells are now real buttons. Previously the cell was a
 *     `<div onClick>` and the only way to open a shift was clicking a chip, so
 *     a keyboard user could not reach any shift in the month. Enter or Space on
 *     a day now opens the same drawer mobile already had; the chips stay
 *     mouse-clickable and unchanged.
 *  2. Shift counts and the "no shifts" state are in each day's accessible name
 *     rather than being conveyed by chip colour alone.
 */

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

/** Group colour → shift-density dot. */
const DENSITY_DOT_COLOURS: Record<string, string> = {
  convention: '#60a5fa', // blue-400
  exhibition: '#4ade80', // green-400
  theatre: '#f87171',    // red-400
  cutaway: '#fbbf24',    // amber-400
};
const DENSITY_DOT_FALLBACK = '#94a3b8'; // slate-400

const MonthView: React.FC<MonthViewProps> = ({
  date,
  getShiftsForDate,
  offerDates,
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

  const openDay = React.useCallback(
    (day: Date) => {
      setSelectedDay(day);
      const dayShifts = getShiftsForDate(day, { includeContinuations: false });
      if (dayShifts.length === 1) {
        setSelectedShift({ data: dayShifts[0], date: day });
      } else if (dayShifts.length > 1) {
        setIsDrawerOpen(true);
      }
    },
    [getShiftsForDate],
  );

  /** Spoken summary of a cell — shift count, offer flag, holiday. */
  const dayLabel = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dayShifts = getShiftsForDate(ctx.date, { includeContinuations: false });
      const parts = [format(ctx.date, 'EEEE d MMMM yyyy')];
      if (ctx.holidayName) parts.push(`${ctx.holidayName}, public holiday`);
      parts.push(
        dayShifts.length === 0
          ? 'no shifts'
          : `${dayShifts.length} shift${dayShifts.length === 1 ? '' : 's'}`,
      );
      if (offerDates.has(format(ctx.date, 'yyyy-MM-dd'))) parts.push('offer pending');
      return parts.join(', ');
    },
    [getShiftsForDate, offerDates],
  );

  const agendaShifts = getShiftsForDate(selectedDay, { includeContinuations: false });
  const selectedDateStr = format(selectedDay, 'yyyy-MM-dd');
  const hasOffer = offerDates.has(selectedDateStr);

  // ── MOBILE — Outlook-style compact grid ───────────────────────────────────
  const renderMobileDay = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dayShifts = getShiftsForDate(ctx.date, { includeContinuations: false });
      const isSelected = isSameDay(ctx.date, selectedDay);
      const isToday = Boolean(ctx.modifiers.today);

      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center py-1">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300',
              isSelected
                ? 'z-10 bg-primary text-primary-foreground shadow-sm shadow-primary/40'
                : isToday
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                  : ctx.holidayName
                    ? 'text-amber-600 dark:text-amber-400'
                    : '',
            )}
          >
            <span className="text-xs font-bold tracking-tight">{ctx.date.getDate()}</span>
          </div>

          {/* Shift density dots, coloured by group */}
          <div className="z-20 mt-1 flex h-1.5 justify-center gap-1">
            {dayShifts.slice(0, 3).map((s) => (
              <div
                key={s.shift.id}
                className={cn('h-1.5 w-1.5 rounded-full', isSelected && 'ring-1 ring-white/50')}
                style={{
                  backgroundColor:
                    DENSITY_DOT_COLOURS[s.groupColor?.toLowerCase() ?? ''] ?? DENSITY_DOT_FALLBACK,
                }}
              />
            ))}
          </div>

          {offerDates.has(format(ctx.date, 'yyyy-MM-dd')) && (
            // Static. A pulsing dot on every offer day meant a month with a
            // few offers had several things blinking at once, and the marker is
            // already carried in the cell's accessible name.
            <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
          )}
        </div>
      );
    },
    [getShiftsForDate, offerDates, selectedDay],
  );

  // ── DESKTOP — date number + count, with chips layered over the cell ────────
  const renderDesktopDay = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dayShifts = getShiftsForDate(ctx.date, { includeContinuations: false });
      const isToday = Boolean(ctx.modifiers.today);

      return (
        <div className="flex h-full w-full flex-col p-2">
          <div className="mb-2 flex items-center justify-between">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold transition-colors',
                isToday
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                  : ctx.holidayName
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-foreground',
              )}
            >
              {ctx.date.getDate()}
            </span>
            {dayShifts.length > 0 && !ctx.isOutside && (
              <span className={cn(text.overlineBare, 'text-primary')}>
                {dayShifts.length}×
              </span>
            )}
          </div>
        </div>
      );
    },
    [getShiftsForDate],
  );

  /**
   * Shift chips.
   *
   * Rendered as a sibling of the day button rather than inside it — a `<button>`
   * cannot legally contain another. The wrapper is `pointer-events-none`, so the
   * day button stays clickable everywhere the chips do not cover.
   */
  const renderDesktopOverlay = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dayShifts = getShiftsForDate(ctx.date, { includeContinuations: false });
      if (dayShifts.length === 0) return null;

      return (
        <div className="pointer-events-none flex h-full flex-col gap-1.5 px-2 pb-2 pt-10">
          {dayShifts.slice(0, 3).map((shiftData) => (
            <div key={shiftData.shift.id} className="pointer-events-auto">
              <MyRosterShift
                shift={shiftData.shift}
                groupName={shiftData.groupName}
                groupColor={shiftData.groupColor}
                subGroupName={shiftData.subGroupName}
                compact
                onClick={() => setSelectedShift({ data: shiftData, date: ctx.date })}
              />
            </div>
          ))}
          {dayShifts.length > 3 && (
            <button
              type="button"
              // Not a tab stop: the day button is the keyboard entry point and
              // opens the drawer, which lists every shift including these.
              tabIndex={-1}
              onClick={() => openDay(ctx.date)}
              className={cn(
                text.overlineBare,
                touch.targetY,
                'pointer-events-auto flex w-full items-center px-1 text-left text-primary transition-colors hover:text-primary/80',
              )}
            >
              +{dayShifts.length - 3} more
            </button>
          )}
        </div>
      );
    },
    [getShiftsForDate, openDay],
  );

  const dayPopover = (
    <Dialog open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] sm:w-full p-0 overflow-hidden bg-card/95 backdrop-blur-2xl border border-border shadow-2xl rounded-[28px] max-h-[85vh] flex flex-col">
        <DialogHeader className="px-6 pb-2 pt-6">
          <div className="flex items-end justify-between border-b border-foreground/[0.03] pb-4">
            <div>
              <DialogTitle asChild>
                <h2 className={cn(text.display, 'text-xl leading-none')}>
                  {format(selectedDay, 'EEEE, d MMMM')}
                </h2>
              </DialogTitle>
              <DialogDescription asChild>
                <p className={cn(text.overline, 'mt-2')}>
                  {agendaShifts.length} {agendaShifts.length === 1 ? 'Shift' : 'Shifts'} Scheduled
                </p>
              </DialogDescription>
            </div>
            {hasOffer && (
              <div className={cn(
                text.overlineBare,
                'mb-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-400',
              )}>
                Offer Pending
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="scrollbar-none flex-1 overflow-y-auto px-6 pb-6 pt-2">
          <AnimatePresence mode="popLayout">
            {agendaShifts.length > 0 ? (
              <div className="flex flex-col gap-2">
                {agendaShifts.map((shiftData) => (
                  <motion.div
                    key={shiftData.shift.id}
                    {...listItemSpring}
                  >
                    <MobileShiftCard
                      shiftData={shiftData}
                      selectedDay={selectedDay}
                      onClick={() => {
                        setIsDrawerOpen(false);
                        setSelectedShift({ data: shiftData, date: selectedDay });
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-12 text-center"
              >
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
                  <Calendar className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className={cn(text.overline, 'text-sm')}>
                  No shifts scheduled
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 flex-col px-3 py-3 min-h-0">
          <MonthGrid
            month={date}
            captionVariant="hidden"
            renderDay={renderMobileDay}
            dayLabel={dayLabel}
            onDayActivate={openDay}
            selected={selectedDay}
            minCellHeight="3.5rem"
            dayClassName="items-center justify-center"
            modifiersClassNames={{ outside: 'opacity-30', selected: 'bg-transparent' }}
            className="flex-1 h-full min-h-0"
          />
        </div>

        {dayPopover}

        <ShiftDetailsDialog
          isOpen={!!selectedShift}
          onClose={() => setSelectedShift(null)}
          shiftData={selectedShift?.data || null}
          shiftDate={selectedDay}
        />
      </div>
    );
  }

  // ── DESKTOP ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <MonthGrid
          month={date}
          captionVariant="hidden"
          renderDay={renderDesktopDay}
          renderOverlay={renderDesktopOverlay}
          dayLabel={dayLabel}
          onDayActivate={openDay}
          minCellHeight="7.5rem"
          dayClassName="border-b border-r border-border"
          modifiersClassNames={{ outside: 'opacity-40', today: 'bg-primary/5' }}
          className="min-h-full"
        />
      </div>

      {dayPopover}

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
