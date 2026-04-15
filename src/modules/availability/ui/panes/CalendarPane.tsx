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
 * - Show tooltips on locked cells (role, time, department)
 * - Display legend with all four states
 *
 * MUST NOT:
 * - Open modals or forms
 * - Trigger editing actions
 * - Read from availability_rules
 * - Perform date math or recurrence expansion
 */

import React, { useMemo } from 'react';
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isToday,
  isSameMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
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

// backward-compat alias (unused internally after refactor, kept for type safety)
type DayStatus = 'available' | 'unavailable' | 'partial' | 'unset';

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

/**
 * Get background/border color classes per cell state
 */
const getStateClasses = (state: DayState): string => {
  switch (state) {
    case 'locked':
      return 'bg-purple-50 border-purple-300 dark:bg-purple-900/40 dark:border-purple-600';
    case 'available':
      return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700';
    case 'partial':
      return 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-700';
    case 'unset':
    default:
      return 'bg-muted/30 border-border';
  }
};

/** Format time for display (remove seconds) */
const formatTimeForDisplay = (time: string): string => time.substring(0, 5);

/**
 * Build hover tooltip text for locked cells.
 * Shows "Blocked due to assigned shift" then each shift's role, time, dept.
 */
const buildLockTooltip = (shifts: AssignedShiftInterval[]): string =>
  [
    'Blocked due to assigned shift',
    ...shifts.map(s => {
      const role = s.role_name ?? 'Unknown role';
      const dept = s.department_name ? ` · ${s.department_name}` : '';
      return `  ${role}${dept}  ${formatTimeForDisplay(s.start_time)}–${formatTimeForDisplay(s.end_time)}`;
    }),
  ].join('\n');

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

  // ── Calendar grid (padded to week boundaries) ──────────────────────────────
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd   = endOfMonth(currentMonth);
    const gridStart  = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  if (isLoading) {
    return (
      <div className="p-4 h-full">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <motion.div
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial="hidden"
      animate="show"
      className="flex flex-col h-full p-4"
    >

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="h-8 flex items-center justify-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {calendarDays.map((date) => {
          const dateStr      = format(date, 'yyyy-MM-dd');
          const daySlots     = slotsByDate.get(dateStr) ?? [];
          const dayAssigned  = assignedByDate.get(dateStr) ?? [];
          const state        = computeDayState(daySlots, dayAssigned);
          const isCurrentMonth = isSameMonth(date, currentMonth);
          const isTodayDate  = isToday(date);
          const isLocked     = state === 'locked';

          return (
            <div
              key={dateStr}
              className={cn(
                'relative border rounded-md p-1.5 min-h-[80px] flex flex-col',
                getStateClasses(state),
                !isCurrentMonth && 'opacity-40',
                isTodayDate && 'ring-2 ring-blue-500 ring-offset-1'
              )}
              title={isLocked ? buildLockTooltip(dayAssigned) : undefined}
            >
              {/* Date Number */}
              <div
                className={cn(
                  'text-xs font-medium mb-1',
                  isTodayDate
                    ? 'text-blue-600 dark:text-blue-400'
                    : isLocked
                    ? 'text-purple-700 dark:text-purple-200'
                    : 'text-foreground'
                )}
              >
                {format(date, 'd')}
              </div>

              {/* LOCKED state — show assigned shift pills */}
              {isLocked ? (
                <div className="flex-1 overflow-hidden space-y-0.5">
                  <div className="flex items-center gap-0.5 text-purple-700 dark:text-purple-300">
                    <Lock className="h-2.5 w-2.5 flex-shrink-0" />
                    <span className="text-[9px] font-semibold uppercase tracking-wide">
                      Locked
                    </span>
                  </div>
                  {dayAssigned.slice(0, 2).map((s) => (
                    <div
                      key={s.id}
                      className="text-[9px] px-1 py-0.5 rounded bg-purple-200/70 dark:bg-purple-800/50 truncate text-purple-900 dark:text-purple-100"
                    >
                      {formatTimeForDisplay(s.start_time)}–{formatTimeForDisplay(s.end_time)}
                      {s.role_name && (
                        <span className="ml-1 opacity-75">{s.role_name}</span>
                      )}
                    </div>
                  ))}
                  {dayAssigned.length > 2 && (
                    <div className="text-[9px] text-purple-600 dark:text-purple-400 px-1">
                      +{dayAssigned.length - 2} more
                    </div>
                  )}
                </div>
              ) : (
                /* AVAILABLE / PARTIAL — show declared slot time pills */
                <div className="flex-1 overflow-hidden space-y-0.5">
                  {daySlots.slice(0, 3).map((slot, index) => (
                    <div
                      key={slot.id || index}
                      className="text-[10px] px-1 py-0.5 rounded bg-background/70 dark:bg-muted/30 truncate text-foreground"
                      title={`${formatTimeForDisplay(slot.start_time)} – ${formatTimeForDisplay(slot.end_time)}`}
                    >
                      {formatTimeForDisplay(slot.start_time)}-{formatTimeForDisplay(slot.end_time)}
                    </div>
                  ))}
                  {daySlots.length > 3 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      +{daySlots.length - 3} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <motion.div variants={itemVariants} className="mt-4 flex items-center justify-center gap-4 text-xs flex-wrap text-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-emerald-400 border border-emerald-500" />
          <span className="text-muted-foreground">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-400 border border-amber-500" />
          <span className="text-muted-foreground">Partial</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-purple-400 border border-purple-500" />
          <Lock className="h-2.5 w-2.5 text-purple-600 dark:text-purple-400" />
          <span className="text-muted-foreground">Locked (assigned)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted border border-border" />
          <span className="text-muted-foreground">Unset</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default CalendarPane;
