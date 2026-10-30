import React, { useState } from 'react';
import { addDays } from 'date-fns';
import { startOfWeekAU } from '@/modules/core/lib/date/week';
import TimeGrid, { HOUR_HEIGHT } from '@/modules/rosters/ui/components/TimeGrid';
import { ShiftWithDetails } from '@/modules/rosters';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import { format, parseISO } from 'date-fns';
import { calculateShiftLayout } from '../../utils/shift-layout.utils';
import MyRosterShift from './MyRosterShift';

interface WeekViewProps {
  date: Date;
  getShiftsForDate: (date: Date, options?: { includeContinuations?: boolean }) => ShiftWithDetails[];
}

// Helper to format time for display

// Get gradient class based on color

const WeekView: React.FC<WeekViewProps> = ({ date, getShiftsForDate }) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  // Stable across renders so the memoised chips are not invalidated every time
  // this view re-renders (e.g. when a dialog opens).
  const handleSelect = React.useCallback((data: ShiftWithDetails, dateKey: string) => {
    setSelectedShift({ data, date: parseISO(dateKey) });
  }, []);

  // Start week on Monday (app-wide Mon–Sun convention)
  const start = startOfWeekAU(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));


  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
        <div className="min-w-[560px] flex-1 min-h-0 flex flex-col">
          <TimeGrid
            days={days}
            renderShifts={(day) =>
              getShiftsForDate(day, { includeContinuations: false }).map((shiftData) => {
                const { shift } = shiftData;
                const dateStr = format(day, 'yyyy-MM-dd');
                const { top, height } = calculateShiftLayout(shift, dateStr, HOUR_HEIGHT, 32);

                return (
                  <div
                    key={shift.id}
                    className="absolute left-0.5 right-0.5 overflow-hidden"
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

export default WeekView;
