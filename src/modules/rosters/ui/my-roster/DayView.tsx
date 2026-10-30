import React, { useState } from 'react';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { ShiftWithDetails } from '@/modules/rosters';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { format } from 'date-fns';
import { calculateShiftLayout } from '../../utils/shift-layout.utils';
import MyRosterShift from './MyRosterShift';

interface DayViewProps {
  date: Date;
  shifts: ShiftWithDetails[];
}

// Helper to format time for display

// Get gradient class based on color

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
