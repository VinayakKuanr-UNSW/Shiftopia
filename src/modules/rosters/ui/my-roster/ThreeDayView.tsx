import React, { useState } from 'react';
import { addDays } from 'date-fns';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { ShiftWithDetails } from '@/modules/rosters';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { format, parseISO } from 'date-fns';
import { calculateShiftLayout } from '../../utils/shift-layout.utils';
import MyRosterShift from './MyRosterShift';

interface ThreeDayViewProps {
  startDate: Date;
  getShiftsForDate: (date: Date, options?: { includeContinuations?: boolean }) => ShiftWithDetails[];
}

// Helper to format time for display

// Get gradient class based on color

const ThreeDayView: React.FC<ThreeDayViewProps> = ({
  startDate,
  getShiftsForDate,
}) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  // Stable identity so the memoised chips survive this view's re-renders.
  // `dateKey` is the CLICKED day, which for an overnight continuation is the day
  // after `shift.shift_date` — this view asks for continuations.
  const handleSelect = React.useCallback((data: ShiftWithDetails, dateKey: string) => {
    setSelectedShift({ data, date: parseISO(dateKey) });
  }, []);

  const days = [startDate, addDays(startDate, 1), addDays(startDate, 2)];


  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
        <div className="min-w-[420px] flex-1 min-h-0 flex flex-col">
      <TimeGrid
        days={days}
          renderShifts={(day) =>
          getShiftsForDate(day).map((shiftData) => {
            const { shift } = shiftData;
            const dateStr = format(day, 'yyyy-MM-dd');
            const { top, height } = calculateShiftLayout(shift, dateStr, HOUR_HEIGHT, 44);

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

export default ThreeDayView;
