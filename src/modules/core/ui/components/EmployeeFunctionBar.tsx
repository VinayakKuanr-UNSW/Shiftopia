import React from 'react';
import { ChevronLeft, ChevronRight, Calendar, ArrowUpDown, Filter, Layers } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { touch } from '@/modules/core/ui/typography';
import { DatePicker } from '@/modules/core/ui/calendar';
import {
  ResponsiveMenu,
  ResponsiveMenuOption,
  ResponsiveMenuGroup,
} from './ResponsiveMenu';
import {
  DEFAULT_ROW_SORT,
  ROW_SORT_LABELS,
  SORT_DIRECTION_LABELS,
  type RowSort,
  type RowSortBy,
  type SortDirection,
} from '@/modules/core/lib/row-sorting';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';

/**
 * The function bar for every employee-facing page.
 *
 * Global Scope is Row 2 of `GoldStandardHeader` and is unchanged; this is
 * Row 3, and it is the same two lines everywhere:
 *
 *   Day · 3D · Week · Month      ‹  12 – 18 Aug  ›
 *   Sort                Filter               Group By
 *
 * Every page had been improvising this. My Roster had a bespoke navigator with
 * its own button sizes, My Attendance and Timesheets folded their view range
 * into a filter drawer, Bids and Swaps had neither, and four of them carried a
 * Refresh button — a control that exists because the page does not trust its
 * own cache, asks the person to compensate, and (with react-query revalidating
 * on mount and focus) mostly re-fetches data that was already fresh. Those are
 * gone.
 *
 * Every section is optional: a page without a date range omits the first line,
 * a page with nothing to sort omits that menu. What it must not do is render
 * its own competing version.
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

  /** ── Line 1: range picker ── */
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  /** Human-readable span, e.g. "12 – 18 Aug". */
  rangeLabel?: string;
  onPrevious?: () => void;
  onNext?: () => void;

  /** ── Line 2: Sort ── */
  sort?: RowSort;
  onSortChange?: (sort: RowSort) => void;
  sortOptions?: RowSortBy[];

  /** ── Line 2: Filter ── free-form body, since every page filters different things */
  filterContent?: React.ReactNode | ((close: () => void) => React.ReactNode);
  activeFilterCount?: number;

  /** ── Line 2: Group By ── */
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
  selectedDate,
  onDateChange,
  rangeLabel,
  onPrevious,
  onNext,
  sort,
  onSortChange,
  sortOptions,
  filterContent,
  activeFilterCount = 0,
  groupBy,
  onGroupByChange,
  groupByOptions,
  trailing,
  className,
}) => {
  const showRange = !!view && !!onViewChange;
  const showPicker = !!rangeLabel && (!!onPrevious || !!onNext || !!onDateChange);
  const showSort = !!sort && !!onSortChange;
  const showGroupBy = !!groupBy && !!onGroupByChange && !!groupByOptions?.length;
  const showFilter = !!filterContent;

  const activeGroupLabel =
    groupByOptions?.find((o) => o.value === groupBy)?.label ?? 'None';

  const sortFields = sortOptions?.length ? sortOptions : (['date'] as RowSortBy[]);
  const sortValue = sort
    ? `${ROW_SORT_LABELS[sort.by]}, ${SORT_DIRECTION_LABELS[sort.by][sort.direction].toLowerCase()}`
    : undefined;

  // "Applied" means the control is doing something other than the default —
  // otherwise all three would sit permanently lit and the highlight would carry
  // no information at all.
  const sortApplied =
    !!sort && (sort.by !== DEFAULT_ROW_SORT.by || sort.direction !== DEFAULT_ROW_SORT.direction);
  const groupApplied = !!groupBy && groupBy !== 'none';

  const menuCount = [showSort, showFilter, showGroupBy].filter(Boolean).length;
  const menuGridCls =
    menuCount === 3 ? 'grid-cols-3' : menuCount === 2 ? 'grid-cols-2' : 'grid-cols-1';

  const navButtonCls =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border ' +
    'bg-background/60 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95';

  return (
    // One row on desktop, two on a phone. Desktop has the width to hold the
    // range controls and the three menus on a single line; a 390px viewport
    // does not, and wrapping them into one flow puts a menu wherever the
    // previous control happened to end. `gap-1.5` between the two mobile rows
    // is enough to read them apart without looking like two separate bars.
    <div className={cn('mt-2 flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center md:gap-2', className)}>
      {/* ── Line 1: view range + range picker ─────────────────────────────── */}
      {(showRange || showPicker) && (
        <div className="flex items-center gap-1.5 md:shrink-0">
          {showRange && (
            <div
              role="radiogroup"
              aria-label="View range"
              className="flex h-11 shrink-0 items-center gap-0.5 rounded-xl border border-border bg-background/60 p-0.5"
            >
              {RANGE_OPTIONS.map((opt) => {
                const isActive = view === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    // The visible text is an abbreviation on small screens, so
                    // the accessible name always spells the range out.
                    aria-label={`${opt.label} view`}
                    onClick={() => onViewChange!(opt.id)}
                    className={cn(
                      'h-10 min-w-10 rounded-[10px] px-2.5 text-xs font-semibold uppercase tracking-wide transition-colors active:scale-95',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <span aria-hidden="true" className="sm:hidden">{opt.short}</span>
                    <span aria-hidden="true" className="hidden sm:inline">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {showPicker && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none" role="group" aria-label="Date range">
              {onPrevious && (
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label={`Previous ${view ?? 'period'}`}
                  className={navButtonCls}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
              )}

              {onDateChange && selectedDate ? (
                <DatePicker value={selectedDate} onChange={onDateChange} label="Date shown" align="center">
                  <button
                    type="button"
                    aria-label={`Change date — showing ${rangeLabel}`}
                    className={cn(
                      touch.targetY,
                      'flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-3 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-muted/50 md:w-auto md:min-w-[9rem]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <Calendar className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
                    <span className="truncate">{rangeLabel}</span>
                  </button>
                </DatePicker>
              ) : (
                <span
                  className="flex-1 truncate px-1 text-center text-xs font-semibold tabular-nums text-foreground"
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
                  className={navButtonCls}
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Line 2: Sort · Filter · Group By ──────────────────────────────── */}
      {(showSort || showFilter || showGroupBy || trailing) && (
        <div className="flex w-full items-center gap-1.5 md:w-auto md:flex-1 md:gap-2">
          {menuCount > 0 && (
            // Equal thirds on a phone so the row spans the card; natural widths
            // on desktop, where they share the line with the range controls.
            <div className={cn('grid min-w-0 flex-1 items-center gap-1.5 md:flex md:flex-none md:gap-2', menuGridCls)}>
              {showSort && (
              <ResponsiveMenu
                title="Sort"
                value={sortValue}
                active={sortApplied}
                icon={<ArrowUpDown className="h-4 w-4" />}
                description="Choose what to order this list by, and in which direction."
              >
                {(close) => (
                  <div className="flex flex-col gap-2">
                    <ResponsiveMenuGroup label="Sort by">
                      {sortFields.map((field) => (
                        <ResponsiveMenuOption
                          key={field}
                          label={ROW_SORT_LABELS[field]}
                          selected={sort!.by === field}
                          onSelect={() => onSortChange!({ ...sort!, by: field })}
                        />
                      ))}
                    </ResponsiveMenuGroup>
                    <ResponsiveMenuGroup label="Direction">
                      {(['asc', 'desc'] as SortDirection[]).map((dir) => (
                        <ResponsiveMenuOption
                          key={dir}
                          label={SORT_DIRECTION_LABELS[sort!.by][dir]}
                          selected={sort!.direction === dir}
                          onSelect={() => {
                            onSortChange!({ ...sort!, direction: dir });
                            close();
                          }}
                        />
                      ))}
                    </ResponsiveMenuGroup>
                  </div>
                )}
              </ResponsiveMenu>
            )}

            {showFilter && (
              <ResponsiveMenu
                title="Filter"
                icon={<Filter className="h-4 w-4" />}
                activeCount={activeFilterCount}
                description="Narrow this list down."
                contentClassName="w-72"
              >
                {filterContent}
              </ResponsiveMenu>
            )}

            {showGroupBy && (
              <ResponsiveMenu
                title="Group By"
                value={activeGroupLabel}
                active={groupApplied}
                icon={<Layers className="h-4 w-4" />}
                description="Bucket this list under headings."
              >
                {(close) => (
                  <div className="flex flex-col gap-0.5" role="group" aria-label="Group by">
                    {groupByOptions!.map((opt) => (
                      <ResponsiveMenuOption
                        key={opt.value}
                        label={opt.label}
                        selected={groupBy === opt.value}
                        onSelect={() => {
                          onGroupByChange!(opt.value);
                          close();
                        }}
                      />
                    ))}
                  </div>
                )}
              </ResponsiveMenu>
              )}
            </div>
          )}

          {trailing}
        </div>
      )}
    </div>
  );
};

export default EmployeeFunctionBar;
