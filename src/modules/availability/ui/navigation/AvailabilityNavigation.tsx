
import React from 'react';
import { format } from 'date-fns';
import { Button } from '@/modules/core/ui/primitives/button';
import { ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react';

interface AvailabilityNavigationProps {
  selectedMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  isCalendarLocked: boolean;
  onToggleLock: () => void;
  isManager: boolean;
}

export function AvailabilityNavigation({
  selectedMonth,
  onPrevMonth,
  onNextMonth,
  isCalendarLocked,
  onToggleLock,
  isManager
}: AvailabilityNavigationProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center">
        <Button variant="outline" size="icon" onClick={onPrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="w-36 text-center font-medium">
          {format(selectedMonth, 'MMMM yyyy')}
        </div>
        <Button variant="outline" size="icon" onClick={onNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isManager && (
        <Button 
          variant="outline" 
          className="flex items-center gap-2" 
          onClick={onToggleLock} 
          size="sm"
        >
          {isCalendarLocked ? (
            <>
              <Unlock className="h-4 w-4" />
              Unlock Calendar
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Lock Calendar
            </>
          )}
        </Button>
      )}
    </div>
  );
}
