import React, { useState } from 'react';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { Shift } from '@/modules/rosters';
import { getDepartmentColor } from '@/modules/core/lib/utils';
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

interface DayViewProps {
  date: Date;
  shifts: ShiftWithDetails[];
}

// Helper to format time for display
const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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

const DayView: React.FC<DayViewProps> = ({ date, shifts }) => {
  const [selectedShift, setSelectedShift] = useState<ShiftWithDetails | null>(null);


  return (
    <div className="h-full flex flex-col min-h-0">
      <TimeGrid
        days={[date]}
        renderShifts={() =>
          shifts.map((shiftData) => {
            const { shift, groupColor } = shiftData;
            const dateStr = format(date, 'yyyy-MM-dd');
            const { top, height } = calculateShiftLayout(shift, dateStr, HOUR_HEIGHT, 48);

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
                    'border shadow-lg',
                    'hover:scale-[1.01] active:scale-[0.99] transition-transform',
                    'focus:outline-none focus:ring-2 focus:ring-primary/30',
                    shift.lifecycle_status === 'Published' && shift.assignment_status === 'assigned' && !shift.assignment_outcome && 'opacity-60 border-dashed border-2',
                    getGradientClass(groupColor)
                  )}
                >
                  <div className="flex flex-col h-full justify-between text-foreground">
                    <div>
                      <div className="font-bold text-sm truncate">
                        {shift.roles?.name || 'No Role'}
                      </div>
                      <div className="text-xs opacity-70 truncate">
                        {shiftData.subGroupName || shift.sub_group_name || ''}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-xs opacity-80">
                        {formatTime(shift.start_time)}-{formatTime(shift.end_time)}
                      </div>
                      {shift.break_minutes > 0 && (
                        <div className="text-[10px] opacity-60">
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
