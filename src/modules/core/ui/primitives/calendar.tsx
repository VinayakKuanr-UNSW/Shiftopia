import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayContentProps } from 'react-day-picker';
import { format as formatDate } from 'date-fns';

import { cn } from '@/modules/core/lib/utils';
import { buttonVariants } from '@/modules/core/ui/primitives/button';
import { getPublicHolidayName, isPublicHoliday } from '@/modules/core/lib/holidays';
import { WEEK_STARTS_ON } from '@/modules/core/lib/date/week';

/**
 * The one calendar rendering engine in this application.
 *
 * Everything that draws days in a month — pickers, range pickers, the
 * availability grid, the my-roster month view, the template preview — renders
 * through `react-day-picker` via this component. Nothing hand-rolls a 42-cell
 * grid any more, which is what kept Monday-start, NSW holiday marking and
 * keyboard navigation from being uniform.
 *
 * Two sizes:
 *   `popover` (default) — 40px day buttons; the classic dropdown picker.
 *   `surface`           — flexible full-height cells that stretch to their
 *                         container, for page-level month views that render
 *                         domain content inside each day. Compose
 *                         `core/ui/calendar/MonthGrid` rather than reaching for
 *                         this prop directly.
 *
 * ACCESSIBILITY. `react-day-picker` supplies the WAI-ARIA `grid` semantics
 * (`role="grid"` on the table, `aria-labelledby` pointing at the caption),
 * roving tabindex and arrow/Home/End/PageUp/PageDown navigation. In v8 a day's
 * accessible name is its *text content*, so the holiday name is added as an
 * `sr-only` span via `DayContent` — colour alone must not carry it (WCAG 1.4.1).
 *
 * Overriding `classNames` is safe. Overriding `components.Day` is not, unless
 * the replacement calls `useDayRender` and spreads the props it returns — see
 * `MonthGrid` for the supported pattern.
 */

export type CalendarSize = 'popover' | 'surface';

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  /** Day-cell scale. See the note above. Default `popover`. */
  size?: CalendarSize;
};

/** Day-cell metrics per size. Kept together so the two never drift. */
const SIZE_CLASSNAMES: Record<
  CalendarSize,
  { months: string; month: string; table: string; row: string; head_cell: string; cell: string; day: string }
> = {
  popover: {
    months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
    month: 'space-y-4',
    table: 'w-full border-collapse space-y-1',
    row: 'flex w-full mt-1',
    head_cell: 'text-muted-foreground rounded-lg w-10 h-10 font-medium text-[0.8rem] flex items-center justify-center',
    cell: 'h-10 w-10 rounded-lg',
    day: 'h-10 w-10 p-0 font-normal rounded-lg',
  },
  surface: {
    // Stretch to the host container so a month view can own the full page
    // height. `<table>`/`<tr>`/`<td>` accept flex just fine, which is how the
    // day columns stay aligned without a second grid definition.
    months: 'flex flex-col flex-1 min-h-0 w-full',
    month: 'flex flex-col flex-1 min-h-0 w-full',
    table: 'flex flex-col flex-1 min-h-0 w-full border-collapse',
    row: 'flex w-full flex-1 min-h-0',
    head_cell:
      'flex-1 basis-0 min-w-0 text-muted-foreground font-medium text-[0.7rem] uppercase tracking-wider flex items-center justify-center py-2',
    cell: 'flex-1 basis-0 min-w-0 min-h-0',
    day: 'w-full h-full p-0 font-normal items-start justify-start rounded-none',
  },
};

/**
 * Day contents: the date number, plus the holiday name for screen readers.
 *
 * Replaces the default so the amber holiday colour is not the only channel
 * carrying "this is a public holiday".
 */
function CalendarDayContent({ date, activeModifiers }: DayContentProps) {
  const holiday = activeModifiers.holiday ? getPublicHolidayName(date) : null;
  return (
    <>
      <span>{date.getDate()}</span>
      {holiday && <span className="sr-only">, {holiday}, public holiday</span>}
    </>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  weekStartsOn = WEEK_STARTS_ON, // Monday — app-wide convention (Mon–Sun)
  size = 'popover',
  modifiers,
  modifiersClassNames,
  components,
  formatters,
  ...props
}: CalendarProps) {
  const s = SIZE_CLASSNAMES[size];

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      className={cn(
        'pointer-events-auto',
        size === 'popover' ? 'p-4' : 'flex flex-col flex-1 min-h-0 w-full',
        className,
      )}
      {...props}
      classNames={{
        months: s.months,
        month: s.month,
        caption: 'flex justify-center pt-1 relative items-center mb-2',
        caption_label: 'text-sm font-semibold text-foreground',
        nav: 'space-x-1 flex items-center',
        nav_button: cn(
          buttonVariants({ variant: 'outline' }),
          'h-8 w-8 bg-transparent p-0 opacity-60 hover:opacity-100 hover:bg-accent transition-all duration-200 border-none',
          // Icon-only controls; the ring is the only focus signal they get.
          'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: s.table,
        head_row: 'flex w-full mb-1',
        head_cell: s.head_cell,
        row: s.row,
        cell: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 transition-all duration-200',
          s.cell,
          '[&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-range-start)]:rounded-l-lg',
          '[&:has([aria-selected].day-outside)]:bg-accent/30',
          '[&:has([aria-selected])]:bg-accent/20',
          'first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg',
        ),
        day: cn(
          buttonVariants({ variant: 'ghost' }),
          s.day,
          'aria-selected:opacity-100 transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          // Scale on hover/focus is decoration — skip it under reduced motion.
          size === 'popover' && 'motion-safe:hover:scale-105 motion-safe:focus:scale-105',
          // WCAG 2.4.7 — a ring the day background cannot swallow.
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:z-10',
        ),
        day_range_end: 'day-range-end rounded-r-lg',
        day_range_start: 'day-range-start rounded-l-lg',
        day_selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground shadow-md',
        day_today: 'bg-accent/50 text-accent-foreground font-semibold border border-accent',
        // Outside/disabled days still carry their date number, so they are
        // informational and must clear 4.5:1 (WCAG 1.4.3). The previous
        // `text-muted-foreground/40 opacity-50` computed to roughly 2.3:1.
        day_outside: 'day-outside text-muted-foreground aria-selected:bg-accent/30 aria-selected:text-muted-foreground',
        day_disabled: 'text-muted-foreground/60 cursor-not-allowed',
        day_range_middle: 'aria-selected:bg-accent/40 aria-selected:text-accent-foreground rounded-none',
        day_hidden: 'invisible',
        ...classNames,
      }}
      modifiers={{
        // AUS (NSW) public holidays — marked in amber. Single source of truth
        // in `core/lib/holidays`; see the note there about the two rival
        // implementations this replaced.
        holiday: (date: Date) => isPublicHoliday(date),
        ...modifiers,
      }}
      modifiersClassNames={{
        holiday: 'text-amber-600 dark:text-amber-400 font-bold aria-selected:text-primary-foreground',
        ...modifiersClassNames,
      }}
      formatters={{
        // Mon/Tue/Wed rather than react-day-picker's default Mo/Tu/We — matches
        // what every grid in this app showed before the consolidation. The `th`
        // still carries the full weekday name as its `aria-label`.
        formatWeekdayName: (weekday, options) => formatDate(weekday, 'EEE', options),
        formatCaption: (month, options) => formatDate(month, 'MMMM yyyy', options),
        ...formatters,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" aria-hidden="true" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" aria-hidden="true" />,
        DayContent: CalendarDayContent,
        ...components,
      }}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
