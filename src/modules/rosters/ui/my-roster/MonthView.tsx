import React, { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
} from 'date-fns';
import { getSydneyToday, isSydneyToday } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { Shift } from '@/modules/rosters';
import type { RingColor } from '@/modules/rosters/domain/shift-ui';

function getShiftRingColor(shift: Shift): RingColor {
  if (shift.lifecycle_status === 'Completed') return 'purple';
  if (shift.lifecycle_status === 'InProgress') return 'emerald';
  // Late: Published, past start time, no actual_start
  if (shift.lifecycle_status === 'Published' && !shift.actual_start) {
    const start = shift.scheduled_start
      ? new Date(shift.scheduled_start).getTime()
      : new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
    if (Date.now() > start) return 'yellow';
  }
  const start = shift.scheduled_start
    ? new Date(shift.scheduled_start).getTime()
    : new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
  const ttsSec = Math.max(0, (start - Date.now()) / 1000);
  if (ttsSec < 4 * 3600)  return 'red';
  if (ttsSec < 24 * 3600) return 'orange';
  return 'blue';
}

const RING_CLASSES: Record<RingColor, string> = {
  purple:  'ring-2 ring-purple-500',
  emerald: 'ring-2 ring-emerald-500',
  yellow:  'ring-2 ring-yellow-500',
  red:     'ring-2 ring-red-500',
  orange:  'ring-2 ring-orange-400',
  blue:    'ring-1 ring-blue-400/50',
};

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface MonthViewProps {
  date: Date;
  getShiftsForDate: (date: Date) => ShiftWithDetails[];
}

// Helper to format time for display
const formatTime = (time: string): string => {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}:${m.toString().padStart(2, '0')} ${period}`;
};

// Get gradient class based on color
const getGradientClass = (color: string): string => {
  const base = 'dept-card-glass-base';
  switch (color?.toLowerCase()) {
    case 'convention':
      return `${base} dept-card-glass-convention border-blue-400/30 shadow-blue-500/20`;
    case 'exhibition':
      return `${base} dept-card-glass-exhibition border-green-400/30 shadow-green-500/20`;
    case 'theatre':
      return `${base} dept-card-glass-theatre border-red-400/30 shadow-red-500/20`;
    default:
      return `${base} dept-card-glass-default border-slate-400/30 shadow-slate-500/20`;
  }
};

const MonthView: React.FC<MonthViewProps> = ({ date, getShiftsForDate }) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);

  const allDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Group days into weeks
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  allDays.forEach((day) => {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return (
    <div className="h-full flex flex-col bg-card rounded-lg overflow-hidden border border-border">
      {/* Scroll wrapper for mobile — keeps 7-col layout intact, adds horizontal scroll on narrow screens */}
      <div className="overflow-x-auto -mx-2 px-2 md:mx-0 md:px-0 flex-1 flex flex-col min-h-0">
        <div className="min-w-[480px] flex-1 flex flex-col min-h-0">

      {/* Header */}
      <div className="flex-shrink-0 bg-muted border-b border-border">
        <div className="p-3 text-center">
          <h3 className="text-lg font-bold text-foreground">
            {format(date, 'MMMM yyyy')}
          </h3>
        </div>
        <div className="grid grid-cols-7 border-t border-border">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              className="p-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-r border-border last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-7 h-full">
          {weeks.map((week, weekIndex) =>
            week.map((day, dayIndex) => {
              const isCurrentMonth = isSameMonth(day, date);
              const isCurrentDay = isSydneyToday(day);
              const shifts = getShiftsForDate(day);

              return (
                <div
                  key={`${weekIndex}-${dayIndex}`}
                  className={cn(
                    'min-h-[70px] sm:min-h-[90px] p-1 border-r border-b border-border last:border-r-0',
                    isCurrentDay && 'bg-primary/10',
                    !isCurrentMonth && 'opacity-40 bg-muted'
                  )}
                >
                  {/* Date number */}
                  <div className="flex justify-end mb-1">
                    <span
                      className={cn(
                        'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full',
                        isCurrentDay
                          ? 'bg-primary text-primary-foreground'
                          : isCurrentMonth
                            ? 'text-foreground/70'
                            : 'text-muted-foreground/50'
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {shifts.slice(0, 3).map((shiftData) => {
                      const isContinuation = shiftData.shift.shift_date !== format(day, 'yyyy-MM-dd');
                      return (
                        <div
                          key={shiftData.shift.id}
                          onClick={() =>
                            setSelectedShift({ data: shiftData, date: day })
                          }
                          className={cn(
                            'text-[9px] text-white px-1 py-0.5 rounded cursor-pointer',
                            'hover:opacity-80 transition-opacity truncate',
                            shiftData.shift.lifecycle_status === 'Published' && shiftData.shift.assignment_status === 'assigned' && !shiftData.shift.assignment_outcome && 'opacity-60 border-dashed border',
                            getGradientClass(shiftData.groupColor),
                            RING_CLASSES[getShiftRingColor(shiftData.shift)]
                          )}
                        >
                          <span className="font-semibold block truncate">
                            {isContinuation ? `Ends ${formatTime(shiftData.shift.end_time)}` : formatTime(shiftData.shift.start_time)}
                          </span>
                          <span className="block truncate opacity-90">
                            {shiftData.shift.roles?.name || 'Shift'}
                          </span>
                        </div>
                      );
                    })}

                    {shifts.length > 3 && (
                      <div className="text-[9px] text-primary px-1 cursor-pointer hover:underline">
                        +{shifts.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ShiftDetailsDialog
        isOpen={!!selectedShift}
        onClose={() => setSelectedShift(null)}
        shiftData={selectedShift?.data || null}
        shiftDate={selectedShift?.date || getSydneyToday()}
      />

        </div>
      </div>
    </div>
  );
};

export default MonthView;
