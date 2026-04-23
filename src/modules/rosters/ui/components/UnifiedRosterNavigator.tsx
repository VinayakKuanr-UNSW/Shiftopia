/**
 * UnifiedRosterNavigator
 *
 * Centralises day/week/month navigation logic across Roster, MyRoster and Attendance.
 *
 * Exported utilities (pure, no React dependency):
 *   computeRange      — derive DateRange from anchor + viewType
 *   navigateDate      — move anchor by one unit in a direction
 *   formatRangeLabel  — human-readable range label
 *
 * Two visual variants:
 *   compact (default) — pill buttons + text label (MyRoster, Attendance)
 *   full              — ToggleGroup + CalendarRangePicker (RosterFunctionBar)
 *
 * Navigation rules:
 *   Day   → ± 1 day
 *   3-Day → ± 3 days
 *   Week  → ± 7 days  (week start = Monday)
 *   Month → ± 1 month (anchor date preserved; range snaps to full month)
 *
 * Calendar picker snapping:
 *   Week  → snaps picked date to the Monday of the selected week
 *   Month → snaps to 1st of the selected month
 *   Day / 3-Day → no snap
 */

import React, { startTransition, useMemo } from 'react';
import {
  format,
  addDays, subDays,
  addMonths, subMonths,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { CalendarRangePicker } from './CalendarRangePicker';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewType = 'day' | '3day' | 'week' | 'month';

export interface DateRange {
  start: Date;
  end: Date;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

/**
 * Compute the inclusive date range for an anchor date + view type.
 * Week starts on Monday. Month range = full calendar month.
 */
export function computeRange(date: Date, viewType: ViewType): DateRange {
  switch (viewType) {
    case 'day':
      return { start: date, end: date };
    case '3day':
      return { start: date, end: addDays(date, 2) };
    case 'week':
      return {
        start: startOfWeek(date, { weekStartsOn: 1 }),
        end: endOfWeek(date, { weekStartsOn: 1 }),
      };
    case 'month':
      return { start: startOfMonth(date), end: endOfMonth(date) };
  }
}

/**
 * Move an anchor date by one period in the given direction.
 * dir = 1 → forward, dir = -1 → backward.
 */
export function navigateDate(date: Date, viewType: ViewType, dir: -1 | 1): Date {
  switch (viewType) {
    case 'day':   return dir === 1 ? addDays(date, 1)    : subDays(date, 1);
    case '3day':  return dir === 1 ? addDays(date, 3)    : subDays(date, 3);
    case 'week':  return dir === 1 ? addDays(date, 7)    : subDays(date, 7);
    case 'month': return dir === 1 ? addMonths(date, 1)  : subMonths(date, 1);
  }
}

/**
 * Human-readable range label.
 *
 *   day   → Mon, 21 Apr
 *   3day  → 21 Apr – 23 Apr
 *   week  → 21 – 27 Apr  (or  28 Apr – 4 May  across month boundary)
 *   month → April 2026
 */
export function formatRangeLabel(range: DateRange, viewType: ViewType): string {
  const { start, end } = range;
  switch (viewType) {
    case 'day':
      return format(start, 'EEE, d MMM');
    case '3day':
      return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
    case 'week':
      return start.getMonth() === end.getMonth()
        ? `${format(start, 'd')} – ${format(end, 'd MMM')}`
        : `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
    case 'month':
      return format(start, 'MMMM yyyy');
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface UnifiedRosterNavigatorProps {
  date: Date;
  viewType: ViewType;
  /**
   * Fired whenever the anchor date changes (prev/next arrows, picker, today button).
   * Receives the new anchor date AND the computed range for that date+viewType.
   */
  onChange: (date: Date, range: DateRange) => void;
  onViewTypeChange: (view: ViewType) => void;
  /** Show a "Today" button that resets navigation to today. Default: false */
  showToday?: boolean;
  /**
   * Embed CalendarRangePicker on the date label so users can jump to any date.
   * When false the label is plain text.  Default: false
   */
  showPicker?: boolean;
  /** Disable the Prev arrow when navigating further back would go before this date. */
  minDate?: Date;
  /** Disable the Next arrow when navigating further forward would go past this date. */
  maxDate?: Date;
  /**
   * compact (default) — pill buttons for view type, plain label (suits mobile-first pages)
   * full              — ToggleGroup + CalendarRangePicker (suits desktop manager bar)
   */
  variant?: 'compact' | 'full';
  className?: string;
}

const VIEW_OPTIONS: Array<{ value: ViewType; label: string; short: string }> = [
  { value: 'day',   label: 'Day',   short: 'D'  },
  { value: '3day',  label: '3D',    short: '3D' },
  { value: 'week',  label: 'Week',  short: 'W'  },
  { value: 'month', label: 'Month', short: 'M'  },
];

export const UnifiedRosterNavigator: React.FC<UnifiedRosterNavigatorProps> = ({
  date,
  viewType,
  onChange,
  onViewTypeChange,
  showToday = false,
  showPicker = false,
  minDate,
  maxDate,
  variant = 'compact',
  className,
}) => {
  const range = useMemo(() => computeRange(date, viewType), [date, viewType]);
  const label = useMemo(() => formatRangeLabel(range, viewType), [range, viewType]);

  // Fire onChange with concurrent transition to avoid blocking heavy renders
  const fire = (newDate: Date) => {
    startTransition(() => {
      onChange(newDate, computeRange(newDate, viewType));
    });
  };

  // When picking from the calendar, snap to the correct period start
  const fireFromPicker = (picked: Date) => {
    let snapped = picked;
    if (viewType === 'week')  snapped = startOfWeek(picked, { weekStartsOn: 1 });
    if (viewType === 'month') snapped = startOfMonth(picked);
    fire(snapped);
  };

  const handlePrev  = () => fire(navigateDate(date, viewType, -1));
  const handleNext  = () => fire(navigateDate(date, viewType,  1));
  const handleToday = () => fire(new Date());

  // Disable arrows at bounds
  const prevDisabled = useMemo(() => {
    if (!minDate) return false;
    return computeRange(navigateDate(date, viewType, -1), viewType).end < minDate;
  }, [date, viewType, minDate]);

  const nextDisabled = useMemo(() => {
    if (!maxDate) return false;
    return computeRange(navigateDate(date, viewType, 1), viewType).start > maxDate;
  }, [date, viewType, maxDate]);

  // ── Full variant (desktop manager bar) ─────────────────────────────────────
  if (variant === 'full') {
    return (
      <div className={cn('flex items-center gap-4', className)}>
        {/* View type — ToggleGroup */}
        <div className="flex-shrink-0 flex items-center bg-slate-100/50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-xl p-1 h-10 shadow-sm">
          <ToggleGroup
            type="single"
            value={viewType}
            onValueChange={(v) => v && onViewTypeChange(v as ViewType)}
            className="flex items-center gap-0.5"
          >
            {VIEW_OPTIONS.map((v) => (
              <ToggleGroupItem
                key={v.value}
                value={v.value}
                className="px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-md transition-all h-8 min-w-[36px] data-[state=on]:bg-blue-600 data-[state=on]:text-white text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60 border-none shadow-none"
              >
                {v.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Date navigation */}
        <div className="flex-shrink-0 flex items-center gap-0.5 bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-1.5 h-10 shadow-sm dark:shadow-none">
          <button
            onClick={handlePrev}
            disabled={prevDisabled}
            className="h-6 w-6 flex items-center justify-center rounded-md transition-all text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <CalendarRangePicker
            selectedDate={date}
            viewType={viewType}
            minDate={minDate}
            maxDate={maxDate}
            onRangeSelect={fireFromPicker}
            displayLabel={label}
          />

          <button
            onClick={handleNext}
            disabled={nextDisabled}
            className="h-6 w-6 flex items-center justify-center rounded-md transition-all text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {showToday && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="h-8 px-3 text-xs font-bold rounded-lg"
          >
            Today
          </Button>
        )}
      </div>
    );
  }

  // ── Compact variant (mobile-first pages) ───────────────────────────────────
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {/* View mode pills */}
      <div className="flex rounded-lg bg-muted/50 p-0.5 gap-0.5 flex-shrink-0">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onViewTypeChange(opt.value)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-black transition-all',
              viewType === opt.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="sm:hidden">{opt.short}</span>
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrev}
          disabled={prevDisabled}
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {showPicker ? (
          <CalendarRangePicker
            selectedDate={date}
            viewType={viewType}
            minDate={minDate}
            maxDate={maxDate}
            onRangeSelect={fireFromPicker}
            displayLabel={label}
          />
        ) : (
          <span className="text-xs font-bold text-foreground font-mono whitespace-nowrap min-w-[130px] text-center">
            {label}
          </span>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleNext}
          disabled={nextDisabled}
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {showToday && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleToday}
          className="h-7 px-2 text-xs font-bold rounded-lg flex-shrink-0 hidden sm:flex"
        >
          Today
        </Button>
      )}
    </div>
  );
};

export default UnifiedRosterNavigator;
