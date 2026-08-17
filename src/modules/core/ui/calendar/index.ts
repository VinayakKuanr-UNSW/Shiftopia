/**
 * The shared calendar system.
 *
 * One rendering engine (`react-day-picker`) behind every calendar surface in
 * the application. Feature modules compose these; they must not hand-roll month
 * grids, and must not call `date-fns`' `startOfWeek`/`endOfWeek` directly — see
 * `core/lib/date/week` for the Monday-start helpers.
 *
 *   Calendar        the raw grid primitive (popover + surface sizes)
 *   DatePicker      pick one day
 *   DateRangePicker pick a span
 *   MonthGrid       a month *view* with domain content in each cell
 *   WeekStrip       a Mon–Sun day axis for timeline/agenda views
 */

export { Calendar, type CalendarProps, type CalendarSize } from '@/modules/core/ui/primitives/calendar';

export { DatePicker, type DatePickerProps } from './DatePicker';
export {
  DateRangePicker,
  type DateRangePickerProps,
  type DateRangePreset,
  type DateRange,
} from './DateRangePicker';
export { MonthGrid, type MonthGridProps, type MonthGridDayContext } from './MonthGrid';
export { WeekStrip, type WeekStripProps } from './WeekStrip';

export {
  AU_WEEK_OPTIONS,
  WEEK_STARTS_ON,
  WEEKDAY_LABELS,
  endOfWeekAU,
  getMonthGridDays,
  getMonthGridWeeks,
  getWeekDays,
  getWeekdayIndexAU,
  isWeekend,
  startOfWeekAU,
} from '@/modules/core/lib/date/week';
