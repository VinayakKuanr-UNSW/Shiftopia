import * as React from 'react';
import {
  type ClassNames,
  type DayProps,
  type Matcher,
  type ModifiersClassNames,
  useDayRender,
} from 'react-day-picker';

import { cn } from '@/modules/core/lib/utils';
import { getPublicHolidayName } from '@/modules/core/lib/holidays';
import { Calendar } from '@/modules/core/ui/primitives/calendar';

/**
 * MonthGrid — the shared month *view*.
 *
 * The difference from `Calendar` is what goes in a cell: a picker shows a date
 * number, a month view shows domain content (shift chips, availability state, a
 * template-preview swatch). Before this component every such view hand-rolled
 * its own month grid, which is how the app ended up with Sunday-start weeks in
 * three places, phantom seventh rows, `<div onClick>` cells with no keyboard
 * path, and three rival public-holiday sources.
 *
 * It is the *same* `react-day-picker` engine underneath, so every MonthGrid
 * gets, for free and identically:
 *   - Monday-start weeks and correct padding (28/35/42 cells, not always 42)
 *   - `role="grid"` semantics with the month caption as the accessible name
 *   - roving tabindex + arrow / Home / End / PageUp / PageDown navigation
 *   - NSW public-holiday marking, announced as well as coloured
 *   - disabled/outside-day handling
 *
 * ── Interaction model ───────────────────────────────────────────────────────
 * Each day is a real `<button role="gridcell">` carrying the cell's accessible
 * name, so Enter and Space open the day. `renderDay` content therefore sits
 * *inside a button* and must be presentational — a button cannot legally
 * contain another focusable element.
 *
 * When a surface genuinely needs several interactive targets per cell (roster
 * chips that each open a different shift) use `renderOverlay`. Overlay content
 * is a sibling of the day button inside the same cell, so it stays clickable by
 * mouse while the day button remains the single keyboard entry point — Enter on
 * the cell should open a day detail listing the same items. The DOM stays valid
 * and keyboard users gain a path where previously there was none, without
 * changing what a mouse does. Overlay children need `pointer-events-auto`; the
 * wrapper disables pointer events so it doesn't blanket the day button.
 */

export interface MonthGridDayContext {
  /** The date this cell renders. */
  date: Date;
  /** The month currently displayed — compare to detect leading/trailing days. */
  displayMonth: Date;
  /** True for the leading/trailing days borrowed from the adjacent months. */
  isOutside: boolean;
  /** Active `react-day-picker` modifiers, including anything from `dayModifiers`. */
  modifiers: Record<string, boolean>;
  /** NSW public holiday name, or null. */
  holidayName: string | null;
}

export interface MonthGridProps {
  /** The month to display. */
  month: Date;
  /** Fired when the user pages to another month via the built-in navigation. */
  onMonthChange?: (month: Date) => void;

  /**
   * Cell content. Presentational only — see the interaction note above.
   * Falls back to the plain date number when omitted or when it returns null.
   */
  renderDay?: (ctx: MonthGridDayContext) => React.ReactNode;

  /**
   * Extra interactive content layered over the cell alongside the day button.
   * Use only when a cell needs more than one target. Children must set
   * `pointer-events-auto` on themselves.
   */
  renderOverlay?: (ctx: MonthGridDayContext) => React.ReactNode;

  /**
   * Accessible name for each day button. Should summarise the cell's content,
   * because `renderDay` output may be visual only — e.g.
   * `"Tuesday 14 April, 3 shifts, unavailable"`.
   * Defaults to the full date plus the holiday name.
   */
  dayLabel?: (ctx: MonthGridDayContext) => string;

  /** Invoked when a day is activated by click, Enter or Space. */
  onDayActivate?: (date: Date, ctx: MonthGridDayContext) => void;

  /** Per-day feature flags, e.g. `{ locked: (d) => ..., partial: [...] }`. */
  dayModifiers?: Record<string, Matcher | Matcher[]>;
  /** Classes for `dayModifiers` and the built-in modifiers. */
  modifiersClassNames?: ModifiersClassNames;

  /** Days rendered in the "selected" state. */
  selected?: Matcher | Matcher[];
  /** Days that cannot be activated. */
  disabled?: Matcher | Matcher[];

  /** Render leading/trailing days from the adjacent months. Default true. */
  showOutsideDays?: boolean;
  /** Always render six week rows, so the grid height doesn't jump month to month. */
  fixedWeeks?: boolean;

  /**
   * `default` — the built-in month caption and prev/next buttons.
   * `hidden`  — caption kept in the DOM but visually hidden and navigation
   *             suppressed, for surfaces that already have their own month
   *             navigation. The caption still supplies the grid's accessible
   *             name, so it must not be removed outright.
   */
  captionVariant?: 'default' | 'hidden';

  /** Minimum height of a day cell. Default `5rem`. */
  minCellHeight?: string;
  /** Class applied to every day cell button. */
  dayClassName?: string;
  className?: string;
  classNames?: ClassNames;
}

interface MonthGridConfig {
  renderDay?: MonthGridProps['renderDay'];
  renderOverlay?: MonthGridProps['renderOverlay'];
  dayLabel?: MonthGridProps['dayLabel'];
  dayClassName?: string;
  minCellHeight: string;
}

const MonthGridContext = React.createContext<MonthGridConfig | null>(null);

const FULL_DATE = new Intl.DateTimeFormat('en-AU', { dateStyle: 'full' });

function defaultDayLabel(ctx: MonthGridDayContext): string {
  const parts = [FULL_DATE.format(ctx.date)];
  if (ctx.holidayName) parts.push(`${ctx.holidayName}, public holiday`);
  return parts.join(', ');
}

function buildDayContext(date: Date, displayMonth: Date, activeModifiers: Record<string, boolean>): MonthGridDayContext {
  return {
    date,
    displayMonth,
    isOutside: Boolean(activeModifiers.outside),
    modifiers: activeModifiers,
    holidayName: activeModifiers.holiday ? getPublicHolidayName(date) : null,
  };
}

/**
 * Day renderer.
 *
 * `useDayRender` is `react-day-picker`'s supported extension point: it returns
 * the props that make the button participate in the grid's roving tabindex and
 * keyboard model. Spreading `buttonProps` is what keeps arrow-key navigation
 * working — hand-rolling the button silently drops it, which is exactly the
 * failure mode the replaced grids had.
 */
function MonthGridDay({ date, displayMonth }: DayProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const render = useDayRender(date, displayMonth, buttonRef);
  const cfg = React.useContext(MonthGridContext);

  if (render.isHidden) return <div role="gridcell" aria-hidden="true" />;

  const activeModifiers = render.activeModifiers as unknown as Record<string, boolean>;
  const dayCtx = buildDayContext(date, displayMonth, activeModifiers);

  const minCellHeight = cfg?.minCellHeight ?? '5rem';
  const label = (cfg?.dayLabel ?? defaultDayLabel)(dayCtx);
  const content = cfg?.renderDay?.(dayCtx);
  const overlay = cfg?.renderOverlay?.(dayCtx);

  // `children` in buttonProps is react-day-picker's own DayContent element;
  // MonthGrid supplies its own, so drop it rather than shadowing it.
  const { children: _rdpChildren, className, style, ...buttonProps } = render.buttonProps;

  const button = (
    <button
      {...buttonProps}
      ref={buttonRef}
      type="button"
      aria-label={label}
      className={cn(className, cfg?.dayClassName)}
      style={{ minHeight: minCellHeight, ...style }}
    >
      {content ?? <span>{date.getDate()}</span>}
    </button>
  );

  if (!overlay) return button;

  return (
    // `presentation` keeps the row → gridcell ownership chain intact: an
    // unlabelled div between `role="row"` and `role="gridcell"` severs it and
    // screen readers drop the cells from the table model.
    <div role="presentation" className="relative h-full w-full">
      {button}
      {/* Sibling of the button, never a child — nesting interactive content
          inside a <button> is invalid HTML and breaks click handling. */}
      <div className="pointer-events-none absolute inset-0">{overlay}</div>
    </div>
  );
}

export function MonthGrid({
  month,
  onMonthChange,
  renderDay,
  renderOverlay,
  dayLabel,
  onDayActivate,
  dayModifiers,
  modifiersClassNames,
  selected,
  disabled,
  showOutsideDays = true,
  fixedWeeks,
  captionVariant = 'default',
  minCellHeight = '5rem',
  dayClassName,
  className,
  classNames,
}: MonthGridProps) {
  const cfg = React.useMemo<MonthGridConfig>(
    () => ({ renderDay, renderOverlay, dayLabel, dayClassName, minCellHeight }),
    [renderDay, renderOverlay, dayLabel, dayClassName, minCellHeight],
  );

  const modifiers = React.useMemo(() => {
    const merged: Record<string, Matcher | Matcher[]> = { ...dayModifiers };
    // Expressed as a modifier rather than `mode="single"` so the grid stays a
    // *view*: MonthGrid never owns selection state, the feature does.
    if (selected) merged.selected = selected;
    return merged;
  }, [dayModifiers, selected]);

  /**
   * `useDayRender` only treats a day as a focusable button when the picker has
   * `onDayClick` or a selection mode. MonthGrid always wants a focusable cell —
   * that is the entire point of routing these views through here — so
   * `onDayClick` is always supplied, even when the caller passes no handler.
   */
  const handleDayClick = React.useCallback(
    (date: Date, activeModifiers: Record<string, unknown>) => {
      onDayActivate?.(date, buildDayContext(date, month, activeModifiers as Record<string, boolean>));
    },
    [onDayActivate, month],
  );

  return (
    <MonthGridContext.Provider value={cfg}>
      <Calendar
        size="surface"
        month={month}
        onMonthChange={onMonthChange}
        onDayClick={handleDayClick}
        showOutsideDays={showOutsideDays}
        fixedWeeks={fixedWeeks}
        disabled={disabled}
        modifiers={modifiers}
        modifiersClassNames={modifiersClassNames}
        className={cn('w-full h-full flex-1 min-h-0', className)}
        classNames={{
          // Day cells own their padding, borders and state colours here; the
          // ghost-button preset from the picker size would wash them out.
          day: cn(
            'w-full h-full p-0 font-normal flex flex-col items-stretch justify-start rounded-none text-left align-top text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:z-10',
          ),
          ...(captionVariant === 'hidden' ? { caption: 'sr-only', nav: 'hidden' } : null),
          ...classNames,
        }}
        components={{ Day: MonthGridDay }}
      />
    </MonthGridContext.Provider>
  );
}
MonthGrid.displayName = 'MonthGrid';
