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
 *   full              — ToggleGroup + date picker (RosterFunctionBar)
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
import { startOfMonth, isWithinInterval, startOfDay } from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { DatePicker } from '@/modules/core/ui/calendar';
import { startOfWeekAU } from '@/modules/core/lib/date/week';
import {
  computeRange,
  navigateDate,
  formatRangeLabel,
  type ViewType,
  type DateRange,
} from '@/modules/rosters/domain/view-range';

// The pure range utilities live in domain/view-range so the Publish plan can
// share them; re-exported here so existing imports keep working.
export { computeRange, navigateDate, formatRangeLabel };
export type { ViewType, DateRange };

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
   * Embed a date picker on the date label so users can jump to any date.
   * When false the label is plain text.  Default: false
   */
  showPicker?: boolean;
  /** Disable the Prev arrow when navigating further back would go before this date. */
  minDate?: Date;
  /** Disable the Next arrow when navigating further forward would go past this date. */
  maxDate?: Date;
  /**
   * compact (default) — pill buttons for view type, plain label (suits mobile-first pages)
   * full              — ToggleGroup + date picker (suits desktop manager bar)
   */
  variant?: 'compact' | 'full';
  /**
   * Which view types to offer. Defaults to all four.
   *
   * A page whose grid only makes sense at one zoom passes that one, and the
   * switcher disappears rather than rendering a single pill that cannot be
   * toggled — an affordance that does nothing reads as broken.
   */
  views?: readonly ViewType[];
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
  views,
  minDate,
  maxDate,
  variant = 'compact',
  className,
}) => {
  const range = useMemo(() => computeRange(date, viewType), [date, viewType]);
  const label = useMemo(() => formatRangeLabel(range, viewType), [range, viewType]);

  // Offered views, in VIEW_OPTIONS' order rather than the caller's, so two
  // pages that pass the same set always render the same switcher.
  const options = useMemo(
    () => (views ? VIEW_OPTIONS.filter((o) => views.includes(o.value)) : VIEW_OPTIONS),
    [views],
  );
  // One choice is not a choice. Hide the switcher rather than render a pill
  // that is permanently on and does nothing when pressed.
  const showSwitcher = options.length > 1;

  // Fire onChange with concurrent transition to avoid blocking heavy renders
  const fire = (newDate: Date) => {
    startTransition(() => {
      onChange(newDate, computeRange(newDate, viewType));
    });
  };

  // When picking from the calendar, snap to the correct period start
  const fireFromPicker = (picked: Date) => {
    let snapped = picked;
    if (viewType === 'week')  snapped = startOfWeekAU(picked);
    if (viewType === 'month') snapped = startOfMonth(picked);
    fire(snapped);
  };

  /**
   * Shade the days the current view already covers, so the popover shows *what
   * a pick means* rather than a single highlighted date. This is the one
   * behaviour worth keeping from the hand-rolled `CalendarRangePicker`; it now
   * rides on the shared engine as a modifier instead of a bespoke 42-cell grid.
   */
  const rangeModifiers = useMemo(
    () => ({
      inCurrentRange: (day: Date) =>
        isWithinInterval(startOfDay(day), { start: startOfDay(range.start), end: startOfDay(range.end) }),
    }),
    [range.start, range.end],
  );

  const isTodayActive = useMemo(() => {
    const today = new Date();
    return isWithinInterval(startOfDay(today), {
      start: startOfDay(range.start),
      end: startOfDay(range.end),
    });
  }, [range.start, range.end]);

  const picker = (
    <DatePicker
      value={date}
      onChange={fireFromPicker}
      label={`${VIEW_OPTIONS.find((v) => v.value === viewType)?.label ?? 'Date'} shown`}
      fromDate={minDate}
      toDate={maxDate}
      align="center"
      modifiers={rangeModifiers}
      modifiersClassNames={{
        inCurrentRange: 'bg-primary/15 text-foreground rounded-none aria-selected:bg-primary',
      }}
    >
      {/* Custom trigger: the navigator's prev / label / next cluster keeps its
          shape, so the label itself is the button. */}
      <Button
        type="button"
        variant="ghost"
        aria-label={`Change date. Currently showing ${label}`}
        className="h-8 gap-2 whitespace-nowrap px-2.5 text-xs font-bold text-slate-800 dark:text-foreground hover:text-slate-950 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 rounded-lg transition-all"
      >
        <CalendarIcon className="h-3.5 w-3.5 text-slate-700 dark:text-muted-foreground opacity-90" aria-hidden="true" />
        {label}
      </Button>
    </DatePicker>
  );

  const handlePrev  = () => fire(navigateDate(date, viewType, -1));
  const handleNext  = () => fire(navigateDate(date, viewType,  1));
  const handleToday = () => {
    fire(new Date());
    requestAnimationFrame(() => {
      setTimeout(() => {
        const todayEls = document.querySelectorAll('[data-today="true"]');
        if (todayEls.length === 0) return;
        todayEls.forEach((el) => {
          const scrollParent = el.closest('.overflow-auto') || el.closest('[data-scroll-container]');
          if (scrollParent) {
            const parentRect = scrollParent.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const currentScrollLeft = scrollParent.scrollLeft;
            const targetScrollLeft = currentScrollLeft + (elRect.left - parentRect.left) - (parentRect.width / 2) + (elRect.width / 2);
            scrollParent.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
          } else {
            el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }
        });
      }, 50);
    });
  };

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
      <div className={cn('flex items-center gap-3', className)}>
        {/* View type — ToggleGroup. The whole pill box goes, not just the
            control inside it, or a single-view page carries an empty one. */}
        {showSwitcher && (
        <div className="flex-shrink-0 flex items-center bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl p-1 h-10 shadow-sm">
          <ToggleGroup
            type="single"
            value={viewType}
            onValueChange={(v) => v && onViewTypeChange(v as ViewType)}
            className="flex items-center gap-0.5"
          >
            {options.map((v) => (
              <ToggleGroupItem
                key={v.value}
                value={v.value}
                className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all h-8 min-w-[36px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground text-slate-700 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground border-none shadow-none"
              >
                {v.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        )}

        {/* Date navigation cluster: Today + Stepper/Picker */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {showToday && (
            <div className="flex-shrink-0 flex items-center bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl p-1 h-10 shadow-sm">
              <button
                type="button"
                onClick={handleToday}
                aria-label="Snap to today"
                className={cn(
                  "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all h-8 min-w-[36px] border-none shadow-none active:scale-95 cursor-pointer",
                  isTodayActive
                    ? "bg-primary text-primary-foreground"
                    : "text-slate-700 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground hover:bg-slate-200/60 dark:hover:bg-muted/30"
                )}
              >
                Today
              </button>
            </div>
          )}

          <div className="flex-shrink-0 flex items-center gap-1 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-xl px-1.5 h-10 shadow-sm dark:shadow-none">
            <button
              onClick={handlePrev}
              disabled={prevDisabled}
              aria-label="Previous date period"
              className="h-8 w-8 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-all text-slate-700 dark:text-muted-foreground hover:text-slate-950 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            {picker}

            <button
              onClick={handleNext}
              disabled={nextDisabled}
              aria-label="Next date period"
              className="h-8 w-8 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-all text-slate-700 dark:text-muted-foreground hover:text-slate-950 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Compact variant (mobile-first pages) ───────────────────────────────────
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {/* View mode pills */}
      {showSwitcher && (
      <div className="flex rounded-lg bg-muted/50 p-0.5 gap-0.5 flex-shrink-0">
        {options.map((opt) => (
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
      )}

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
          picker
        ) : (
          <span className="text-xs font-bold text-foreground whitespace-nowrap min-w-[130px] text-center">
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
        <button
          type="button"
          onClick={handleToday}
          aria-label="Snap to today"
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-all h-7 flex-shrink-0 cursor-pointer',
            isTodayActive
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
          )}
        >
          Today
        </button>
      )}
    </div>
  );
};

export default UnifiedRosterNavigator;
