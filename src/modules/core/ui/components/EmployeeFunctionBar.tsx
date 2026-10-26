import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Filter } from 'lucide-react';
import { startOfDay, isWithinInterval } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { ToolbarRow, ToolbarIconButton, toolbar } from '@/modules/core/ui/components/Toolbar';
import { DatePicker } from '@/modules/core/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { computeRange } from '@/modules/rosters/domain/view-range';
import { SortSelector } from './SortSelector';
import { GroupBySelector } from './GroupBySelector';
import {
  type RowSort,
  type RowSortBy,
} from '@/modules/core/lib/row-sorting';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';

/**
 * The function bar for every employee-facing page.
 *
 * Global Scope is Row 2 of `GoldStandardHeader` and is unchanged; this is
 * Row 3, providing unified view ranges, Today jumping, date navigation, and
 * standard icon triggers for Sort, Filter, and Group By matching the
 * Global Scope dropdown UI/UX.
 */

export type EmployeeViewRange = 'day' | '3day' | 'week' | 'month';

const RANGE_OPTIONS: { id: EmployeeViewRange; short: string; label: string }[] = [
  { id: 'day', short: 'D', label: 'Day' },
  { id: '3day', short: '3D', label: '3-Day' },
  { id: 'week', short: 'W', label: 'Week' },
  { id: 'month', short: 'M', label: 'Month' },
];

export interface EmployeeFunctionBarProps {
  /** ── Line 1: view range ── */
  view?: EmployeeViewRange;
  onViewChange?: (view: EmployeeViewRange) => void;

  /** ── Line 1: Today ── */
  showToday?: boolean;
  onToday?: () => void;

  /** ── Line 1: range picker ── */
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  /** Human-readable span, e.g. "12 – 18 Aug". */
  rangeLabel?: string;
  onPrevious?: () => void;
  onNext?: () => void;

  /** ── Line 2 / Actions: Sort ── */
  sort?: RowSort;
  onSortChange?: (sort: RowSort) => void;
  sortOptions?: RowSortBy[];

  /** ── Line 2 / Actions: Filter ── */
  filters?: React.ReactNode;
  filterContent?: React.ReactNode | ((close: () => void) => React.ReactNode);
  activeFilterCount?: number;

  /** ── Line 2 / Actions: Group By ── */
  groupBy?: RowGroupBy;
  onGroupByChange?: (value: RowGroupBy) => void;
  groupByOptions?: { value: RowGroupBy; label: string }[];

  /** Extra controls appended to line 2 (status tabs, export, …). */
  trailing?: React.ReactNode;
  className?: string;
}

export const EmployeeFunctionBar: React.FC<EmployeeFunctionBarProps> = ({
  view,
  onViewChange,
  showToday,
  onToday,
  selectedDate,
  onDateChange,
  rangeLabel,
  onPrevious,
  onNext,
  sort,
  onSortChange,
  sortOptions,
  filters,
  filterContent,
  activeFilterCount = 0,
  groupBy,
  onGroupByChange,
  groupByOptions,
  trailing,
  className,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);

  const showRange = !!view && !!onViewChange;
  const showPicker = !!rangeLabel && (!!onPrevious || !!onNext || !!onDateChange);
  const shouldShowToday = showToday ?? (!!selectedDate && (!!onDateChange || !!onToday));

  const showSort = !!sort && !!onSortChange;
  const showGroupBy = !!groupBy && !!onGroupByChange && !!groupByOptions?.length;
  const showFilter = !!filterContent;

  const sortFields = sortOptions?.length ? sortOptions : (['date'] as RowSortBy[]);

  const isTodayActive = React.useMemo(() => {
    if (!selectedDate || !view) return false;
    const today = new Date();
    const r = computeRange(selectedDate, view);
    return isWithinInterval(startOfDay(today), {
      start: startOfDay(r.start),
      end: startOfDay(r.end),
    });
  }, [selectedDate, view]);

  const handleToday = React.useCallback(() => {
    if (onToday) {
      onToday();
    } else if (onDateChange) {
      onDateChange(new Date());
    }
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
  }, [onToday, onDateChange]);

  return (
    <ToolbarRow
      compactOnMobile
      className={className}
      // ── Line 1: view range + Today + range picker ───────────────────────────────
      modes={(showRange || shouldShowToday || showPicker) ? (
        <div className="flex w-full items-center gap-1.5 md:w-auto md:shrink-0">
          {showRange && (
            <div
              role="radiogroup"
              aria-label="View range"
              className={cn(toolbar.control, 'gap-0.5')}
            >
              {RANGE_OPTIONS.map((opt) => {
                const isActive = view === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={`${opt.label} view`}
                    onClick={() => onViewChange!(opt.id)}
                    className={cn(
                      toolbar.controlItem,
                      'active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive ? toolbar.modeOn : toolbar.modeOff,
                    )}
                  >
                    <span aria-hidden="true" className="sm:hidden">{opt.short}</span>
                    <span aria-hidden="true" className="hidden sm:inline">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {shouldShowToday && (
            <div className={toolbar.control}>
              <button
                type="button"
                onClick={handleToday}
                aria-label="Snap to today"
                className={cn(
                  toolbar.controlItem,
                  'active:scale-95 cursor-pointer',
                  isTodayActive ? toolbar.modeOn : toolbar.modeOff,
                )}
              >
                Today
              </button>
            </div>
          )}

          {showPicker && (
            <div className={cn(toolbar.stepper, 'min-w-0 flex-1 md:flex-none')} role="group" aria-label="Date range">
              {onPrevious && (
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label={`Previous ${view ?? 'period'}`}
                  className={toolbar.stepperButton}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
              )}

              {onDateChange && selectedDate ? (
                <DatePicker value={selectedDate} onChange={onDateChange} label="Date shown" align="center">
                  <button
                    type="button"
                    aria-label={`Change date — showing ${rangeLabel}`}
                    className={cn(toolbar.stepperLabel, 'min-w-0 flex-1 justify-center md:flex-none md:min-w-[9rem]')}
                  >
                    <Calendar className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
                    <span className="truncate">{rangeLabel}</span>
                  </button>
                </DatePicker>
              ) : (
                <span
                  className="flex-1 truncate px-1 text-center text-[11px] font-semibold tabular-nums text-foreground"
                  aria-label={`Showing ${rangeLabel}`}
                >
                  {rangeLabel}
                </span>
              )}

              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  aria-label={`Next ${view ?? 'period'}`}
                  className={toolbar.stepperButton}
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      ) : undefined}
      // ── Line 2: Sort · Filter · Group By (Icons with Global Scope UI/UX) ─
      actions={(showSort || showFilter || filters || showGroupBy || trailing) ? (
        <div className="flex w-full items-center justify-end gap-1.5 md:w-auto md:gap-2">
          {showSort && (
            <SortSelector
              value={sort!}
              onChange={onSortChange!}
              options={sortFields}
              triggerVariant="icon"
            />
          )}

          {filters ? (
            filters
          ) : showFilter ? (
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <ToolbarIconButton
                  icon={<Filter />}
                  tooltip={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : 'Filters'}
                  variant="amber"
                  isActive={filterOpen || activeFilterCount > 0}
                  badge={activeFilterCount}
                  badgeClassName="bg-orange-500 text-white"
                />
              </PopoverTrigger>
              <PopoverContent
                className="w-[300px] sm:w-[340px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                sideOffset={10}
                align="end"
              >
                <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                  <div className="p-4 max-h-[60vh] overflow-y-auto">
                    {typeof filterContent === 'function' ? filterContent(() => setFilterOpen(false)) : filterContent}
                  </div>
                  <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close
                    </span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {showGroupBy && (
            <GroupBySelector
              value={groupBy!}
              onChange={onGroupByChange!}
              options={groupByOptions!}
              triggerVariant="icon"
            />
          )}

          {trailing}
        </div>
      ) : undefined}
    />
  );
};

export default EmployeeFunctionBar;
