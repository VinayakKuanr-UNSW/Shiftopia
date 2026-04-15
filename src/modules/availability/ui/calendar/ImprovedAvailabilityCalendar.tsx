/**
 * Improved Availability Calendar Component
 *
 * A READ-ONLY calendar component that displays availability slots.
 *
 * RESPONSIBILITIES:
 * - Render slots as visual time pills
 * - Display calendar grid with day status colors
 * - Show month view
 *
 * MUST NOT:
 * - Open modals or forms
 * - Trigger editing actions
 * - Handle click interactions that mutate state
 * - Perform slot generation/expansion
 * - Read from availability_rules
 *
 * This component is STRICTLY READ-ONLY per the three-pane architecture.
 * All editing happens through the Configure pane.
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
import { motion } from 'framer-motion';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { AvailabilitySlot } from '../../model/availability.types';
import { itemVariants } from '@/modules/core/ui/motion/presets';

// ============================================================================
// TYPES
// ============================================================================

interface ImprovedAvailabilityCalendarProps {
  slots: AvailabilitySlot[];
  selectedMonth: Date;
  isLocked?: boolean;
}

type DayStatus = 'Available' | 'Unavailable' | 'Mixed' | 'Not set';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse time string to minutes since midnight
 */
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Check if a time slot covers the full day
 */
const isFullDay = (startTime: string, endTime: string): boolean => {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // Full day: starts at or before 00:05 and ends at or after 23:55 (or 00:00)
  const startsAtMidnight = startMinutes <= 5;
  const endsAtMidnight = endMinutes >= 1435 || endMinutes === 0;

  return startsAtMidnight && endsAtMidnight;
};

/**
 * Check if slots cover the standard working day (09:00-17:00)
 */
const coversWorkingDay = (slots: AvailabilitySlot[]): boolean => {
  if (slots.length === 0) return false;

  const workdayStart = 9 * 60;  // 09:00
  const workdayEnd = 17 * 60;   // 17:00

  // Sort slots by start time
  const sorted = [...slots].sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );

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
 * Determine overall day status based on slots
 */
const determineDayStatus = (slots: AvailabilitySlot[]): DayStatus => {
  if (!slots || slots.length === 0) {
    return 'Not set';
  }

  // Check if there's exactly one slot that covers the full day
  if (slots.length === 1) {
    const slot = slots[0];
    if (isFullDay(slot.start_time, slot.end_time)) {
      return 'Available';
    }
  }

  // Check if slots cover the working day
  if (coversWorkingDay(slots)) {
    return 'Available';
  }

  // Multiple slots or partial hours = Mixed
  return 'Mixed';
};

/**
 * Get status color
 */
const getStatusColor = (status: DayStatus): string => {
  switch (status) {
    case 'Available':
      return 'bg-green-100 border-green-300 dark:bg-green-900/30 dark:border-green-700';
    case 'Unavailable':
      return 'bg-red-100 border-red-300 dark:bg-red-900/30 dark:border-red-700';
    case 'Mixed':
      return 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700';
    case 'Not set':
    default:
      return 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700';
  }
};

/**
 * Get badge color for status
 */
const getStatusBadgeClass = (status: DayStatus): string => {
  switch (status) {
    case 'Available':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700';
    case 'Unavailable':
      return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700';
    case 'Mixed':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700';
    case 'Not set':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
};

/**
 * Format time for display (remove seconds if present)
 */
const formatTime = (time: string): string => {
  return time.substring(0, 5); // HH:mm
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ImprovedAvailabilityCalendar({
  slots,
  selectedMonth,
  isLocked = false,
}: ImprovedAvailabilityCalendarProps) {
  // Build slot lookup by date for efficient rendering
  const slotsByDate = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    for (const slot of slots) {
      const dateKey = slot.slot_date;
      const existing = map.get(dateKey) || [];
      map.set(dateKey, [...existing, slot]);
    }
    return map;
  }, [slots]);

  // Get calendar grid days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(selectedMonth);
    const monthEnd = endOfMonth(selectedMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [selectedMonth]);

  const getSlotsForDate = (date: Date): AvailabilitySlot[] => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return slotsByDate.get(dateStr) || [];
  };

  const getDayStatus = (date: Date): DayStatus => {
    const daySlots = getSlotsForDate(date);
    return determineDayStatus(daySlots);
  };

  return (
    <motion.div
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial="hidden"
      animate="show"
      className="p-6 flex flex-col h-full"
    >
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 mb-4 flex-shrink-0">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="h-8 flex items-center justify-center text-sm font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid - READ ONLY, no click handlers */}
      <div className="grid grid-cols-7 gap-1 flex-grow">
        {calendarDays.map((date) => {
          const daySlots = getSlotsForDate(date);
          const dayStatus = getDayStatus(date);
          const dayColor = getStatusColor(dayStatus);
          const isCurrentMonth = isSameMonth(date, selectedMonth);
          const isTodayDate = isToday(date);

          return (
            <div
              key={date.toISOString()}
              className={cn(
                'relative border rounded-lg p-2 flex flex-col min-h-[100px]',
                dayColor,
                isCurrentMonth ? 'opacity-100' : 'opacity-30',
                isTodayDate && 'ring-2 ring-blue-500'
              )}
            >
              {/* Date Number */}
              <div
                className={cn(
                  'text-sm font-medium mb-1',
                  isTodayDate
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-foreground'
                )}
              >
                {format(date, 'd')}
              </div>

              {/* Time Pills (Slots Preview) */}
              {daySlots.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground truncate flex-grow overflow-y-auto pr-1">
                  {daySlots.slice(0, 3).map((slot, i) => (
                    <div
                      key={slot.id || i}
                      className="truncate mb-0.5 bg-background/60 rounded px-1 py-0.5"
                    >
                      {formatTime(slot.start_time)}-{formatTime(slot.end_time)}
                    </div>
                  ))}
                  {daySlots.length > 3 && (
                    <div className="text-xs text-muted-foreground">
                      +{daySlots.length - 3} more
                    </div>
                  )}
                </div>
              )}

              {/* Status Badge */}
              <Badge
                variant="secondary"
                className={cn(
                  'text-xs text-center mt-auto w-full justify-center font-medium',
                  getStatusBadgeClass(dayStatus)
                )}
              >
                {dayStatus}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <motion.div variants={itemVariants} className="mt-6 flex items-center justify-center gap-4 text-sm flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-emerald-500 rounded border border-emerald-600" />
          <span className="text-muted-foreground">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-amber-500 rounded border border-amber-600" />
          <span className="text-muted-foreground">Mixed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-muted rounded border border-border" />
          <span className="text-muted-foreground">Not set</span>
        </div>
      </motion.div>

      {/* Read-only notice */}
      <motion.p variants={itemVariants} className="text-xs text-center text-muted-foreground mt-2">
        Calendar is read-only. Use the Configure panel to edit availability.
      </motion.p>
    </motion.div>
  );
}

export default ImprovedAvailabilityCalendar;
