import React, { useState, useMemo, FC, MouseEvent } from 'react';
import {
  format,
  isSameMonth,
  isToday,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  getDay,
} from 'date-fns';
import { AlertTriangle, Trash2, Lock } from 'lucide-react';

import { Button } from '@/modules/core/ui/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAvailability } from '../../state/useAvailability';
import { AvailabilityStatus } from '../../model/availability.types';

}

export const AvailabilityCalendar: FC<AvailabilityCalendarProps> = ({
  onSelectDate,
  selectedMonth,
}) => {
  const {
    startOfMonth,
    endOfMonth,
    getDayStatusColor,
    getDayAvailability,
    deleteAvailability,
  } = useAvailability();

  const { toast } = useToast();

  const [showTimeSlotsDialog, setShowTimeSlotsDialog] = useState(false);
  const [selectedTimeSlotsDate, setSelectedTimeSlotsDate] =
    useState<Date | null>(null);

  // Build the array of days to display in the calendar
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth);
    const end = endOfWeek(endOfMonth);
    return eachDayOfInterval({ start, end });
  }, [startOfMonth, endOfMonth]);

  // Group them into weeks
  const calendarWeeks = useMemo(() => {
    const weeks: Date[][] = [];
    let week: Date[] = [];

    for (const day of calendarDays) {
      week.push(day);
      // Sunday=0...Saturday=6
      if (getDay(day) === 6) {
        weeks.push([...week]);
        week = [];
      }
    }
    if (week.length > 0) {
      weeks.push(week);
    }
    return weeks;
  }, [calendarDays]);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const handleDeleteAvailability = async (date: Date, event: MouseEvent) => {
    event.stopPropagation();

    const success = await deleteAvailability(date);
    if (success) {
      toast({
        title: 'Availability Deleted',
        description: `Availability for ${format(
          date,
          'MMMM dd, yyyy'
        )} has been removed.`,
      });
    }
  };

  const showAllTimeSlots = (date: Date, event: MouseEvent) => {
    event.stopPropagation();
    setSelectedTimeSlotsDate(date);
    setShowTimeSlotsDialog(true);
  };

  /** A small colored circle for each slot status */
  const getStatusIndicator = (status: AvailabilityStatus) => {
    switch (status) {
      case 'Available':
        return <div className="h-3 w-3 rounded-full bg-green-500" />;
      case 'Unavailable':
        return <div className="h-3 w-3 rounded-full bg-red-500" />;
      case 'Partial':
        return <div className="h-3 w-3 rounded-full bg-yellow-500" />;
      default:
        return <div className="h-3 w-3 rounded-full bg-gray-300" />;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-auto p-4 md:p-6">
      <div className="bg-card border border-border rounded-lg overflow-hidden h-full">
        {/* Weekday header row */}
        <div className="grid grid-cols-7 bg-muted">
          {weekdays.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-sm font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar body */}
        <div className="grid grid-cols-7 divide-x divide-y divide-border h-full">
          {calendarWeeks.map((week, wIndex) => (
            <React.Fragment key={wIndex}>
              {week.map((day) => {
                const availability = getDayAvailability(day);
                const isCurrentMonth = isSameMonth(day, selectedMonth);
                const isTodayDate = isToday(day);

                return (
                  <div
                    key={day.toISOString()}
                    onClick={() => {
                      onSelectDate(day);
                    }}
                    className={cn(
                      'h-32 md:h-40 p-1 transition-colors relative group cursor-pointer hover:bg-muted/50',
                      !isCurrentMonth && 'opacity-40'
                    )}
                  >
                    <div className="flex flex-col h-full">
                      {/* Day number & optional lock icon */}
                      <div className="flex justify-between items-start">
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded-full',
                            isTodayDate
                              ? 'bg-blue-500 text-white'
                              : isCurrentMonth
                              ? 'text-foreground dark:text-white/80'
                              : 'text-foreground/40 dark:text-white/40'
                          )}
                        >
                          {format(day, 'd')}
                        </span>

                        </span>
                      </div>

                      {/* Show availability if any */}
                      {availability && (
                        <div className="w-full grow mt-1 space-y-1">
                          <div
                            className={cn(
                              'w-full rounded-md p-2 flex items-center justify-between text-white text-xs font-medium',
                              getDayStatusColor(
                                availability.status as AvailabilityStatus
                              )
                            )}
                          >
                            <span>{availability.status}</span>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) =>
                                handleDeleteAvailability(day, e)
                              }
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>

                          {/* If multiple time slots */}
                          {availability.timeSlots && (
                            <div className="flex flex-wrap gap-1">
                              {availability.timeSlots
                                .slice(0, 2)
                                .map((slot, i) => (
                                  <Badge
                                    key={i}
                                    variant="outline"
                                    className="text-[0.65rem] py-0 h-4 flex items-center gap-1"
                                  >
                                    {getStatusIndicator(
                                      slot.status as AvailabilityStatus
                                    )}
                                    {slot.startTime.substring(0, 5)}-
                                    {slot.endTime.substring(0, 5)}
                                  </Badge>
                                ))}

                              {availability.timeSlots.length > 2 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-4 px-1 text-[0.65rem] text-muted-foreground"
                                  onClick={(e) => showAllTimeSlots(day, e)}
                                >
                                  +{availability.timeSlots.length - 2} more
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Dialog: show all time slots */}
      {showTimeSlotsDialog && selectedTimeSlotsDate && (
        <Dialog
          open={showTimeSlotsDialog}
          onOpenChange={setShowTimeSlotsDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Availability for {format(selectedTimeSlotsDate, 'MMMM d, yyyy')}
              </DialogTitle>
              <DialogDescription>
                All time slots for this date
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              {getDayAvailability(selectedTimeSlotsDate)?.timeSlots.map(
                (slot, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-md',
                      slot.status === 'Available'
                        ? 'bg-green-500/20 border border-green-500/30'
                        : slot.status === 'Unavailable'
                        ? 'bg-red-500/20 border border-red-500/30'
                        : 'bg-yellow-500/20 border border-yellow-500/30'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIndicator(slot.status as AvailabilityStatus)}
                      <span className="font-medium">
                        {slot.startTime} - {slot.endTime}
                      </span>
                    </div>
                    <Badge>{slot.status}</Badge>
                  </div>
                )
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
