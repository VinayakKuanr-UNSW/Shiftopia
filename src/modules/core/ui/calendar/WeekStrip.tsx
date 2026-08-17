import * as React from 'react';
import { format } from 'date-fns';

import { cn } from '@/modules/core/lib/utils';
import { isSydneyToday } from '@/modules/core/lib/date.utils';
import { getPublicHolidayName, isPublicHoliday } from '@/modules/core/lib/holidays';
import { getWeekDays } from '@/modules/core/lib/date/week';

/**
 * WeekStrip — the shared Mon–Sun day axis.
 *
 * A week *view* in this app is an hour-by-hour timeline, not a month grid, so it
 * is not a `react-day-picker` surface. What it does share with every other
 * calendar is the day axis: which seven days, in which order, which one is
 * today, which are public holidays. That header was previously re-derived in
 * each timeline component, including two that started the week on Sunday.
 *
 * `days` is optional: pass an anchor date and the Monday-based week is derived.
 */
export interface WeekStripProps {
  /** Anchor date — the Mon–Sun week containing it is rendered. */
  date?: Date;
  /** Explicit day columns. Overrides `date`; use for 3-day or custom spans. */
  days?: Date[];

  /** Fired when a day header is activated. Makes each column a button. */
  onSelectDay?: (date: Date) => void;
  /** The currently highlighted day, if the strip drives a selection. */
  selected?: Date;

  /** Leading spacer, to line the strip up with a timeline's gutter column. */
  leadingGutterWidth?: number;

  /** Extra content under the date number, per column. */
  renderMeta?: (date: Date) => React.ReactNode;

  className?: string;
  columnClassName?: string;
  /** Accessible name for the strip. */
  'aria-label'?: string;
}

export function WeekStrip({
  date,
  days: daysProp,
  onSelectDay,
  selected,
  leadingGutterWidth,
  renderMeta,
  className,
  columnClassName,
  'aria-label': ariaLabel,
}: WeekStripProps) {
  const days = React.useMemo(
    () => daysProp ?? getWeekDays(date ?? new Date()),
    [daysProp, date],
  );

  return (
    <div className={cn('flex h-full', className)} role="row" aria-label={ariaLabel}>
      {leadingGutterWidth !== undefined && (
        <div
          className="flex-shrink-0 border-r border-border"
          style={{ width: leadingGutterWidth }}
          role="presentation"
        />
      )}

      {days.map((day) => {
        const isToday = isSydneyToday(day);
        const holidayName = isPublicHoliday(day) ? getPublicHolidayName(day) : null;
        const isSelected = selected ? format(selected, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd') : false;

        const body = (
          <>
            <span
              className={cn(
                'text-xs font-medium uppercase',
                holidayName ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
              )}
            >
              {format(day, 'EEE')}
            </span>
            <span
              className={cn(
                'mt-0.5 text-lg font-bold',
                isToday ? 'text-primary' : holidayName ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
              )}
            >
              {format(day, 'd')}
            </span>
            {isToday && (
              <span className="mt-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">
                Today
              </span>
            )}
            {renderMeta?.(day)}
          </>
        );

        // The holiday name rides in the accessible name rather than a native
        // `title`, which never appears on keyboard focus or touch.
        const label = [
          format(day, 'EEEE d MMMM'),
          holidayName ? `${holidayName}, public holiday` : null,
          isToday ? 'today' : null,
        ]
          .filter(Boolean)
          .join(', ');

        const shared = cn(
          'flex flex-1 flex-col items-center justify-center border-r border-border last:border-r-0',
          isToday && 'bg-primary/10',
          isSelected && 'bg-accent',
          columnClassName,
        );

        return onSelectDay ? (
          <button
            key={day.toISOString()}
            type="button"
            aria-label={label}
            aria-pressed={isSelected}
            onClick={() => onSelectDay(day)}
            className={cn(
              shared,
              'transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            )}
          >
            {body}
          </button>
        ) : (
          <div key={day.toISOString()} className={shared} role="columnheader" aria-label={label}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
WeekStrip.displayName = 'WeekStrip';
