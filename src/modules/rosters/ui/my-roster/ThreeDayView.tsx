import React, { useState } from 'react';
import { addDays } from 'date-fns';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { Shift } from '@/modules/rosters';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { cn } from '@/modules/core/lib/utils';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface ThreeDayViewProps {
  startDate: Date;
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

const ThreeDayView: React.FC<ThreeDayViewProps> = ({
  startDate,
  getShiftsForDate,
}) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  const days = [startDate, addDays(startDate, 1), addDays(startDate, 2)];

  // Convert time string to pixel position
  const timeToPixels = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return (h + m / 60) * HOUR_HEIGHT;
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <TimeGrid
        days={days}
        renderShifts={(day) =>
          getShiftsForDate(day).map((shiftData) => {
            const { shift, groupColor } = shiftData;
            const top = timeToPixels(shift.start_time);
            const bottom = timeToPixels(shift.end_time);
            const height = Math.max(bottom - top, 44);

            return (
              <div
                key={shift.id}
                className="absolute left-1 right-1"
                style={{ top, height }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${shift.roles?.name || 'Shift'}`}
                  onClick={() => setSelectedShift({ data: shiftData, date: day })}
                  onKeyDown={(e) =>
                    e.key === 'Enter' &&
                    setSelectedShift({ data: shiftData, date: day })
                  }
                  className={cn(
                    'h-full rounded-lg p-2 cursor-pointer',
                    'border border-white/20 shadow-lg',
                    'hover:scale-[1.01] active:scale-[0.99] transition-transform',
                    'focus:outline-none focus:ring-2 focus:ring-white/30',
                    shift.assignment_outcome === 'offered' && 'opacity-60 border-dashed border-2',
                    getGradientClass(groupColor)
                  )}
                >
                  <div className="flex flex-col h-full justify-between text-white">
                    <div>
                      <div className="font-semibold text-xs truncate">
                        {shift.roles?.name || 'No Role'}
                      </div>
                      <div className="text-[10px] opacity-80 truncate">
                        {shiftData.subGroupName}
                      </div>
                    </div>
                    <div className="text-[10px] opacity-90">
                      {formatTime(shift.start_time)} –{' '}
                      {formatTime(shift.end_time)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        }
      />

      <ShiftDetailsDialog
        isOpen={!!selectedShift}
        onClose={() => setSelectedShift(null)}
        shiftData={selectedShift?.data || null}
        shiftDate={selectedShift?.date || new Date()}
      />
    </div>
  );
};

export default ThreeDayView;
