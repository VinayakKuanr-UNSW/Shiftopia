import React, { useState } from 'react';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { Shift } from '@/modules/rosters';
import { getDepartmentColor } from '@/modules/core/lib/utils';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { cn } from '@/modules/core/lib/utils';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface DayViewProps {
  date: Date;
  shifts: ShiftWithDetails[];
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
    case 'blue':
      return 'bg-gradient-to-br from-blue-600 to-blue-800';
    case 'green':
      return 'bg-gradient-to-br from-green-600 to-green-800';
    case 'red':
      return 'bg-gradient-to-br from-red-600 to-red-800';
    case 'purple':
      return 'bg-gradient-to-br from-purple-600 to-purple-800';
    case 'orange':
      return 'bg-gradient-to-br from-orange-600 to-orange-800';
    case 'teal':
      return 'bg-gradient-to-br from-teal-600 to-teal-800';
    default:
      return 'bg-gradient-to-br from-slate-600 to-slate-800';
  }
};

const DayView: React.FC<DayViewProps> = ({ date, shifts }) => {
  const [selectedShift, setSelectedShift] = useState<ShiftWithDetails | null>(null);

  // Convert time string to pixel position
  const timeToPixels = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return (h + m / 60) * HOUR_HEIGHT;
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <TimeGrid
        days={[date]}
        renderShifts={() =>
          shifts.map((shiftData) => {
            const { shift, groupColor } = shiftData;
            const top = timeToPixels(shift.start_time);
            const bottom = timeToPixels(shift.end_time);
            const height = Math.max(bottom - top, 48);

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
                  onClick={() => setSelectedShift(shiftData)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && setSelectedShift(shiftData)
                  }
                  className={cn(
                    'h-full rounded-lg p-3 cursor-pointer',
                    'border border-white/20 shadow-lg',
                    'hover:scale-[1.01] active:scale-[0.99] transition-transform',
                    'focus:outline-none focus:ring-2 focus:ring-white/30',
                    shift.assignment_outcome === 'offered' && 'opacity-60 border-dashed border-2',
                    getGradientClass(groupColor)
                  )}
                >
                  <div className="flex flex-col h-full justify-between text-white">
                    <div>
                      <div className="font-bold text-sm truncate">
                        {shift.roles?.name || 'No Role'}
                      </div>
                      <div className="text-xs opacity-80 truncate">
                        {shiftData.subGroupName || shift.sub_group_name || ''}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-xs opacity-90">
                        {formatTime(shift.start_time)} –{' '}
                        {formatTime(shift.end_time)}
                      </div>
                      {shift.break_minutes > 0 && (
                        <div className="text-[10px] opacity-70">
                          ☕ {shift.break_minutes} min break
                        </div>
                      )}
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
        shiftData={selectedShift}
        shiftDate={date}
      />
    </div>
  );
};

export default DayView;
