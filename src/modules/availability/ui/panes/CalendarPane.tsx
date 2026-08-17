/**
 * Calendar Pane Component
 *
 * LEFT PANE in the 3-pane layout
 *
 * RESPONSIBILITIES:
 * - Render three visual layers per calendar cell (priority order):
 *     1. LOCKED  (purple) — overlaps an assigned shift
 *     2. AVAILABLE (green) — covered by a declared availability slot
 *     3. PARTIAL (yellow) — some declared slots, not full day
 *     4. UNSET  (gray)  — no slot, no assignment
 * - Surface locked-cell detail (role, time, department)
 * - Display legend with all four states
 *
 * MUST NOT:
 * - Open modals or forms
 * - Trigger editing actions
 * - Read from availability_rules
 * - Perform date math or recurrence expansion
 *
 * RENDERING. The month grid comes from the shared `MonthGrid`
 * (`core/ui/calendar`), so this pane no longer generates its own 42-cell grid.
 * It contributes the four day states as `react-day-picker` modifiers and the
 * cell content; Monday-start weeks, NSW public holidays, keyboard navigation
 * and grid semantics come from the shared engine.
 */

import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { MonthGrid, type MonthGridDayContext } from '@/modules/core/ui/calendar';
import { AvailabilitySlot } from '../../model/availability.types';
import { AssignedShiftInterval } from '../../api/availability-view.api';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { itemVariants } from '@/modules/core/ui/motion/presets';

// ============================================================================
// TYPES
// ============================================================================

export interface CalendarPaneProps {
  slots: AvailabilitySlot[];
  /** Assigned shifts for this month — derive locked intervals from here */
  assignedShifts?: AssignedShiftInterval[];
  currentMonth: Date;
  isLoading: boolean;
}

/** Priority-ordered cell state */
type DayState = 'locked' | 'available' | 'partial' | 'unset';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse time string (HH:mm:ss or HH:mm) to minutes since midnight
 */
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Check if slots cover a full working day (09:00-17:00)
 * Configurable working hours can be passed
 */
const isFullDayCovered = (
  slots: AvailabilitySlot[],
  workdayStart = 9 * 60, // 09:00
  workdayEnd = 17 * 60   // 17:00
): boolean => {
  if (slots.length === 0) return false;

  // Sort slots by start time
  const sorted = [...slots].sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );

  // Check if coverage spans the working day
  let coveredUntil = workdayStart;

  for (const slot of sorted) {
    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);

    // Gap in coverage
    if (slotStart > coveredUntil) {
      return false;
    }

    coveredUntil = Math.max(coveredUntil, slotEnd);

    // Full coverage achieved
    if (coveredUntil >= workdayEnd) {
      return true;
    }
  }

  return coveredUntil >= workdayEnd;
};

/**
 * Determine cell state (priority: locked > available > partial > unset)
 */
const computeDayState = (
  slots: AvailabilitySlot[],
  dayAssigned: AssignedShiftInterval[]
): DayState => {
  if (dayAssigned.length > 0) return 'locked';
  if (slots.length === 0) return 'unset';
  if (isFullDayCovered(slots)) return 'available';
  return 'partial';
};

/** Format time for display (remove seconds) */
const formatTimeForDisplay = (time: string): string => time.substring(0, 5);

/**
 * Spoken summary of a cell.
 *
 * This is what a screen-reader user hears instead of the colour. It replaces
 * the old native `title`, which never appeared on keyboard focus or on touch —
 * so the locked-shift detail was previously mouse-only.
 */
const buildDayLabel = (
  ctx: MonthGridDayContext,
  state: DayState,
  daySlots: AvailabilitySlot[],
  dayAssigned: AssignedShiftInterval[],
): string => {
  const parts = [format(ctx.date, 'EEEE d MMMM yyyy')];
  if (ctx.holidayName) parts.push(`${ctx.holidayName}, public holiday`);

  switch (state) {
    case 'locked':
      parts.push(`blocked by ${dayAssigned.length} assigned shift${dayAssigned.length === 1 ? '' : 's'}`);
      for (const s of dayAssigned) {
        const role = s.role_name ?? 'Unknown role';
        const dept = s.department_name ? `, ${s.department_name}` : '';
        parts.push(`${role}${dept}, ${formatTimeForDisplay(s.start_time)} to ${formatTimeForDisplay(s.end_time)}`);
      }
      break;
    case 'available':
      parts.push('available all day');
      break;
    case 'partial':
      parts.push(`partially available, ${daySlots.length} slot${daySlots.length === 1 ? '' : 's'}`);
      for (const slot of daySlots) {
        parts.push(`${formatTimeForDisplay(slot.start_time)} to ${formatTimeForDisplay(slot.end_time)}`);
      }
      break;
    case 'unset':
      parts.push('no availability set');
      break;
  }

  return parts.join(', ');
};

/**
 * State colours, applied through `modifiersClassNames`.
 *
 * `locked` must win over the others; `react-day-picker` appends modifier
 * classes in object order, so the later key wins the cascade tie. The state
 * computation is already priority-ordered and emits exactly one state per day,
 * so this is belt-and-braces.
 */
const STATE_CLASSNAMES = {
  stateUnset: 'bg-muted/30 border-border',
  statePartial: 'bg-amber-50 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
  stateAvailable: 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700',
  stateLocked: 'bg-purple-50 border-purple-400 dark:bg-purple-900/40 dark:border-purple-600',
} as const;

// ============================================================================
// COMPONENT
// ============================================================================

export function CalendarPane({
  slots,
  assignedShifts = [],
  currentMonth,
  isLoading,
}: CalendarPaneProps) {
  // ── Pre-process slots by date ─────────────────────────────────────────────
  const slotsByDate = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    for (const slot of slots) {
      const key = slot.slot_date;
      map.set(key, [...(map.get(key) ?? []), slot]);
    }
    return map;
  }, [slots]);

  // ── Pre-process assigned shifts by date (locked intervals) ─────────────────
  const assignedByDate = useMemo(() => {
    const map = new Map<string, AssignedShiftInterval[]>();
    for (const s of assignedShifts) {
      map.set(s.shift_date, [...(map.get(s.shift_date) ?? []), s]);
    }
    return map;
  }, [assignedShifts]);

  const stateFor = React.useCallback(
    (date: Date): DayState => {
      const key = format(date, 'yyyy-MM-dd');
      return computeDayState(slotsByDate.get(key) ?? [], assignedByDate.get(key) ?? []);
    },
    [slotsByDate, assignedByDate],
  );

  // One modifier per state. The grid resolves them to the classes above.
  const dayModifiers = useMemo(
    () => ({
      stateUnset: (date: Date) => stateFor(date) === 'unset',
      statePartial: (date: Date) => stateFor(date) === 'partial',
      stateAvailable: (date: Date) => stateFor(date) === 'available',
      stateLocked: (date: Date) => stateFor(date) === 'locked',
    }),
    [stateFor],
  );

  const renderDay = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dateStr = format(ctx.date, 'yyyy-MM-dd');
      const daySlots = slotsByDate.get(dateStr) ?? [];
      const dayAssigned = assignedByDate.get(dateStr) ?? [];
      const state = computeDayState(daySlots, dayAssigned);
      const isLocked = state === 'locked';

      return (
        <div className="flex h-full w-full flex-col p-1.5">
          {/* Date number */}
          <div
            className={cn(
              'mb-1 text-xs font-medium',
              ctx.modifiers.today
                ? 'text-blue-700 dark:text-blue-300'
                : isLocked
                  ? 'text-purple-800 dark:text-purple-200'
                  : ctx.holidayName
                    ? 'font-semibold text-amber-600 dark:text-amber-400'
                    : 'text-foreground',
            )}
          >
            {ctx.date.getDate()}
          </div>

          {isLocked ? (
            /* LOCKED — assigned shift pills */
            <div className="flex-1 space-y-0.5 overflow-hidden">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-purple-800 dark:text-purple-300">
                Assigned
              </div>
              {dayAssigned.slice(0, 2).map((s) => (
                <div
                  key={s.id}
                  className="truncate rounded bg-purple-200/70 px-1 py-0.5 text-[10px] text-purple-900 dark:bg-purple-800/50 dark:text-purple-100"
                >
                  {formatTimeForDisplay(s.start_time)}–{formatTimeForDisplay(s.end_time)}
                  {s.role_name && <span className="ml-1 opacity-80">{s.role_name}</span>}
                </div>
              ))}
              {dayAssigned.length > 2 && (
                <div className="px-1 text-[10px] text-purple-700 dark:text-purple-300">
                  +{dayAssigned.length - 2} more
                </div>
              )}
            </div>
          ) : (
            /* AVAILABLE / PARTIAL — declared slot pills */
            <div className="flex-1 space-y-0.5 overflow-hidden">
              {daySlots.slice(0, 3).map((slot, index) => (
                <div
                  key={slot.id || index}
                  className="truncate rounded bg-background/70 px-1 py-0.5 text-[10px] text-foreground dark:bg-muted/30"
                >
                  {formatTimeForDisplay(slot.start_time)}-{formatTimeForDisplay(slot.end_time)}
                </div>
              ))}
              {daySlots.length > 3 && (
                <div className="px-1 text-[10px] text-muted-foreground">+{daySlots.length - 3} more</div>
              )}
            </div>
          )}
        </div>
      );
    },
    [slotsByDate, assignedByDate],
  );

  const dayLabel = React.useCallback(
    (ctx: MonthGridDayContext) => {
      const dateStr = format(ctx.date, 'yyyy-MM-dd');
      const daySlots = slotsByDate.get(dateStr) ?? [];
      const dayAssigned = assignedByDate.get(dateStr) ?? [];
      return buildDayLabel(ctx, computeDayState(daySlots, dayAssigned), daySlots, dayAssigned);
    },
    [slotsByDate, assignedByDate],
  );

  if (isLoading) {
    return (
      <div className="h-full p-4">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <motion.div
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial="hidden"
      animate="show"
      className="flex h-full flex-col p-4"
    >
      <MonthGrid
        month={currentMonth}
        // The month is driven by the pane's own header, not by the grid.
        captionVariant="hidden"
        renderDay={renderDay}
        dayLabel={dayLabel}
        dayModifiers={dayModifiers}
        modifiersClassNames={{
          ...STATE_CLASSNAMES,
          today: 'ring-2 ring-blue-500 ring-inset',
          outside: 'opacity-50',
        }}
        dayClassName="rounded-md border"
        minCellHeight="5rem"
        className="flex-1"
      />

      {/* Legend */}
      <motion.div
        variants={itemVariants}
        className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-foreground"
      >
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-emerald-400 border border-emerald-500" aria-hidden="true" />
          <span className="text-muted-foreground">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-amber-400 border border-amber-500" aria-hidden="true" />
          <span className="text-muted-foreground">Partial</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-purple-400 border border-purple-500" aria-hidden="true" />
          <span className="text-muted-foreground">Assigned</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-muted border border-border" aria-hidden="true" />
          <span className="text-muted-foreground">Unset</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default CalendarPane;
