import React, { useState } from 'react';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { Shift, ShiftWithDetails } from '@/modules/rosters';
import { getDepartmentColor } from '@/modules/core/lib/utils';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { calculateShiftLayout } from '../../utils/shift-layout.utils';
import MyRosterShift from './MyRosterShift';

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

  // Stable identity: the memoised chips must not be invalidated every time this
  // view re-renders. The day is fixed for this view, so `dateKey` is unused.
  const handleSelect = React.useCallback((data: ShiftWithDetails) => {
    setSelectedShift(data);
  }, []);


  return (
    <div className="h-full flex flex-col min-h-0">
      <TimeGrid
        days={[date]}
        renderShifts={() =>
          shifts.map((shiftData) => {
            const { shift } = shiftData;
            const dateStr = format(date, 'yyyy-MM-dd');
            const { top, height } = calculateShiftLayout(shift, dateStr, HOUR_HEIGHT, 48);

            return (
              <div
                key={shift.id}
                className="absolute left-1 right-1 overflow-hidden"
                style={{ top, height }}
              >
                <MyRosterShift
                  data={shiftData}
                  dateKey={dateStr}
                  height={height}
                  onSelect={handleSelect}
                />
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
