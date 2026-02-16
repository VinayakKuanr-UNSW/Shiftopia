/**
 * Calendar Pane Component
 *
 * LEFT PANE in the 3-pane layout
 *
 * RESPONSIBILITIES:
 * - Display availability slots in a calendar grid
 * - Show time pills for each day
 * - Apply day color rules (GREEN/RED/GREY/YELLOW)
 * - Handle month navigation
 *
 * MUST NOT:
 * - Open modals or forms
 * - Trigger any editing actions
 * - Read from availability_rules
 * - Perform date math or recurrence expansion
 *
 * This component is STRICTLY READ-ONLY
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
import { cn } from '@/modules/core/lib/utils';
import { AvailabilitySlot } from '../../model/availability.types';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';

// ============================================================================
// TYPES
// ============================================================================

export interface CalendarPaneProps {
  slots: AvailabilitySlot[];
  currentMonth: Date;
  isLoading: boolean;
}

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
 * Determine day status based on slots
 * GREEN: Full day covered
 * RED: Explicitly unavailable (no slots but rules exist - handled at display)
 * GREY: Unset (no slots, no rules)
 * YELLOW: Partial coverage
 */
const determineDayStatus = (slots: AvailabilitySlot[]): DayStatus => {
  if (slots.length === 0) {
    return 'unset';
  }

  if (isFullDayCovered(slots)) {
    return 'available';
  }

  return 'partial';
};

/**
 * Get background color class for day status
 */
const getStatusBackgroundClass = (status: DayStatus): string => {
  switch (status) {
    case 'available':
      return 'bg-green-100 border-green-300 dark:bg-green-900/30 dark:border-green-700';
    case 'unavailable':
      return 'bg-red-100 border-red-300 dark:bg-red-900/30 dark:border-red-700';
    case 'partial':
      return 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700';
    case 'unset':
    default:
      return 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700';
  }
};

/**
 * Format time for display (remove seconds)
 */
const formatTimeForDisplay = (time: string): string => {
  return time.substring(0, 5); // HH:mm
};

// ============================================================================
// COMPONENT
// ============================================================================

export function CalendarPane({
  slots,
  currentMonth,
  isLoading,
}: CalendarPaneProps) {
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

  // Get calendar grid days (includes padding for week alignment)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  if (isLoading) {
    return (
      <div className="p-4 h-full">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4">
      {/* Month Header */}
      <h2 className="text-lg font-semibold mb-4 text-center">
        {format(currentMonth, 'MMMM yyyy')}
      </h2>

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
          const dateStr = format(date, 'yyyy-MM-dd');
          const daySlots = slotsByDate.get(dateStr) || [];
          const status = determineDayStatus(daySlots);
          const isCurrentMonth = isSameMonth(date, currentMonth);
          const isTodayDate = isToday(date);

          return (
            <div
              key={dateStr}
              className={cn(
                'relative border rounded-md p-1.5 min-h-[80px] flex flex-col',
                getStatusBackgroundClass(status),
                !isCurrentMonth && 'opacity-40',
                isTodayDate && 'ring-2 ring-blue-500 ring-offset-1'
              )}
            >
              {/* Date Number */}
              <div
                className={cn(
                  'text-xs font-medium mb-1',
                  isTodayDate
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-700 dark:text-gray-300'
                )}
              >
                {format(date, 'd')}
              </div>

              {/* Time Pills */}
              <div className="flex-1 overflow-hidden space-y-0.5">
                {daySlots.slice(0, 3).map((slot, index) => (
                  <div
                    key={slot.id || index}
                    className="text-[10px] px-1 py-0.5 rounded bg-white/60 dark:bg-black/20 truncate"
                    title={`${formatTimeForDisplay(slot.start_time)} - ${formatTimeForDisplay(slot.end_time)}`}
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
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-4 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-400 border border-green-500" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-400 border border-yellow-500" />
          <span>Partial</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-gray-300 border border-gray-400" />
          <span>Unset</span>
        </div>
      </div>
    </div>
  );
}

export default CalendarPane;
