
import React from 'react';
import { format } from 'date-fns';
import { Clock, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { useAvailability } from '../../state/useAvailability';
import { AvailabilityStatus, TimeSlot } from '../../model/availability.types';
import { cn } from '@/modules/core/lib/utils';
import { itemVariants } from '@/modules/core/ui/motion/presets';

interface DayAvailabilityViewProps {
  date: Date;
  onEdit: () => void;
}

export function DayAvailabilityView({ date, onEdit }: DayAvailabilityViewProps) {
  const { getDayAvailability } = useAvailability();
  
  // Mocks for legacy compatibility
  const getDayStatusColor = (status: string) => 'bg-gray-400';
  const setAvailability = (data: any) => console.log('Mock setAvailability', data);

  const availability = getDayAvailability(date) as any;

  // Add these functions since they don't exist in the hook anymore
  const setFullDayAvailable = () => {
    setAvailability({
      startDate: date,
      endDate: date,
      timeSlots: [
        { startTime: '09:00', endTime: '17:00', status: 'Available' }
      ],
      status: 'Available'
    });
  };

  const setFullDayUnavailable = () => {
    setAvailability({
      startDate: date,
      endDate: date,
      timeSlots: [
        { startTime: '00:00', endTime: '23:59', status: 'Unavailable' }
      ],
      status: 'Unavailable'
    });
  };

  const renderTimeSlots = (availability: any) => {
    if (!availability.timeSlots || availability.timeSlots.length === 0) {
      return (
        <div className="py-3 px-4 text-muted-foreground text-sm">
          No time slots defined for this day.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {availability.timeSlots.map((slot: any, index: number) => (
          <div key={slot.id || index} className="flex items-center py-2 px-4 bg-muted/30 rounded-md">
            <div 
              className={cn(
                "w-3 h-3 rounded-full mr-2",
                slot.status === 'Available' ? 'bg-green-500' :
                slot.status === 'Partial' ? 'bg-yellow-400' : 'bg-red-500'
              )}
            />
            <Clock className="h-3 w-3 text-muted-foreground mr-2" />
            <span className="text-sm">{slot.startTime} - {slot.endTime}</span>
            <span className="text-xs ml-auto">{slot.status}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderEmptyState = () => (
    <div className="py-6 flex flex-col items-center justify-center text-center">
      <Clock className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
      <h3 className="text-lg font-medium mb-1">No Availability Set</h3>
      <p className="text-sm text-muted-foreground mb-4">
        You haven't set your availability for this date yet.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={setFullDayAvailable}>
          Set Available
        </Button>
        <Button size="sm" variant="outline" onClick={setFullDayUnavailable}>
          Set Unavailable
        </Button>
      </div>
    </div>
  );

  return (
    <motion.div variants={itemVariants} initial="hidden" animate="show">
    <Card className="border border-border bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-black tracking-tight text-foreground">
            {format(date, 'EEEE, MMMM d, yyyy')}
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
        {availability && (
          <div className="flex items-center text-sm mt-1">
            <div 
              className={cn(
                "w-3 h-3 rounded-full mr-2",
                getDayStatusColor(availability.status as AvailabilityStatus)
              )}
            />
            <span>
              Overall Status: <span className="font-medium">{availability.status}</span>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {availability ? renderTimeSlots(availability) : renderEmptyState()}
        
        {availability?.notes && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-start">
              <Info className="h-4 w-4 text-muted-foreground mr-2 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium mb-1">Notes:</div>
                <p className="text-muted-foreground">{availability.notes}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </motion.div>
  );
}
