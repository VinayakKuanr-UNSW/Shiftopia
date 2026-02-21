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
  switch (color) {
    case 'blue': return 'bg-gradient-to-br from-blue-600 to-blue-800';
    case 'green': return 'bg-gradient-to-br from-green-600 to-green-800';
    case 'red': return 'bg-gradient-to-br from-red-600 to-red-800';
    case 'purple': return 'bg-gradient-to-br from-purple-600 to-purple-800';
    default: return 'bg-gradient-to-br from-slate-600 to-slate-800';
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
                    'min-h-[90px] p-1 border-r border-b border-border last:border-r-0',
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

                  {/* Shifts */}
                  <div className="space-y-0.5">
                    {shifts.slice(0, 3).map((shiftData) => (
                      <div
                        key={shiftData.shift.id}
                        onClick={() =>
                          setSelectedShift({ data: shiftData, date: day })
                        }
                        className={cn(
                          'text-[9px] text-white px-1 py-0.5 rounded cursor-pointer',
                          'hover:opacity-80 transition-opacity truncate',
                          getGradientClass(shiftData.groupColor)
                        )}
                      >
                        {formatTime(shiftData.shift.start_time)}{' '}
                        {shiftData.shift.roles?.name || 'Shift'}
                      </div>
                    ))}

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
  );
};

export default MonthView;
