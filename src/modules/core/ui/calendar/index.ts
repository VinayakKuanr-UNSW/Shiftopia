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


export { DatePicker } from './DatePicker';
export {
  DateRangePicker,
} from './DateRangePicker';
export { MonthGrid, type MonthGridDayContext } from './MonthGrid';
export { WeekStrip } from './WeekStrip';

