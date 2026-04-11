import React, { useState } from 'react';
import { startOfWeek, addDays } from 'date-fns';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { Shift } from '@/modules/rosters';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { calculateShiftLayout } from '../../utils/shift-layout.utils';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface WeekViewProps {
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

const WeekView: React.FC<WeekViewProps> = ({ date, getShiftsForDate }) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  // Start week on Sunday (weekStartsOn: 0) to match header
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));


  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="overflow-x-auto -mx-2 px-2 md:mx-0 md:px-0 flex-1 min-h-0 flex flex-col">
        <div className="min-w-[560px] flex-1 min-h-0 flex flex-col">
          <TimeGrid
            days={days}
            renderShifts={(day) =>
              getShiftsForDate(day).map((shiftData) => {
                const { shift, groupColor } = shiftData;
                const dateStr = format(day, 'yyyy-MM-dd');
                const { top, height } = calculateShiftLayout(shift, dateStr, HOUR_HEIGHT, 32);

                return (
                  <div
                    key={shift.id}
                    className="absolute left-0.5 right-0.5"
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
                        'h-full rounded-md p-1.5 cursor-pointer overflow-hidden',
                        'border border-white/20 shadow-md',
                        'hover:scale-[1.02] active:scale-[0.98] transition-transform',
                        'focus:outline-none focus:ring-2 focus:ring-white/30',
                        shift.lifecycle_status === 'Published' && shift.assignment_status === 'assigned' && !shift.assignment_outcome && 'opacity-60 border-dashed border-2',
                        getGradientClass(groupColor)
                      )}
                    >
                      <div className="text-white text-[10px] font-semibold truncate leading-tight">
                        {shift.roles?.name || 'Shift'}
                      </div>
                      <div className="text-[9px] text-white/80 truncate">
                        {formatTime(shift.start_time)}
                      </div>
                    </div>
                  </div>
                );
              })
            }
          />
        </div>
      </div>

      <ShiftDetailsDialog
        isOpen={!!selectedShift}
        onClose={() => setSelectedShift(null)}
        shiftData={selectedShift?.data || null}
        shiftDate={selectedShift?.date || new Date()}
      />
    </div>
  );
};

export default WeekView;
