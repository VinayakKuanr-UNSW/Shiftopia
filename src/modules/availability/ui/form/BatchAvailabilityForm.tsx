
import React, { useState } from 'react';
import { format } from 'date-fns';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { GlobalStyleSelect } from '@/modules/core/ui/components/GlobalStyleSelect';
import { Calendar } from '@/modules/core/ui/calendar';
import { PlusCircle, Trash2, CalendarIcon } from 'lucide-react';
import { TimeSlot } from '../../model/availability.types';
import { cn } from '@/modules/core/lib/utils';

interface BatchAvailabilityFormProps {
  onSubmit: (data: { 
    startDate: Date; 
    endDate: Date; 
    timeSlots: Omit<TimeSlot, 'id'>[]; 
    notes?: string 
  }) => Promise<void>;
  onCancel: () => void;
}

export function BatchAvailabilityForm({ onSubmit, onCancel }: BatchAvailabilityFormProps) {
  const [dateRange, setDateRange] = useState<{
    from: Date;
    to?: Date;
  }>({
    from: new Date(),
    to: undefined,
  });
  
  const [timeSlots, setTimeSlots] = useState<Omit<TimeSlot, 'id'>[]>([
    { startTime: '09:00', endTime: '17:00', status: 'Available' }
  ]);
  
  const [notes, setNotes] = useState('');

  const addTimeSlot = () => {
    setTimeSlots([...timeSlots, { startTime: '09:00', endTime: '17:00', status: 'Available' }]);
  };

  const removeTimeSlot = (index: number) => {
    setTimeSlots(timeSlots.filter((_, i) => i !== index));
  };

  const updateTimeSlot = (index: number, field: keyof Omit<TimeSlot, 'id'>, value: string) => {
    const newTimeSlots = [...timeSlots];
    newTimeSlots[index] = { ...newTimeSlots[index], [field]: value };
    setTimeSlots(newTimeSlots);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!dateRange.from || !dateRange.to) {
      return; // Validation will be handled by the parent component
    }
    
    await onSubmit({
      startDate: dateRange.from,
      endDate: dateRange.to,
      timeSlots,
      notes: notes.trim() ? notes : undefined
    });
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Batch Availability</DialogTitle>
          <DialogDescription>
            Apply availability settings to multiple days at once
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Date Range</h3>
            <div className="flex items-center justify-center pt-2">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange.from}
                selected={dateRange}
                onSelect={(range) => {
                  if (range) {
                    setDateRange({
                      from: range.from || new Date(),
                      to: range.to
                    });
                  }
                }}
                numberOfMonths={1}
                className={cn("p-3 pointer-events-auto")}
              />
            </div>
            
            <div className="text-sm text-center text-muted-foreground">
              {dateRange.from && dateRange.to ? (
                <>
                  Selected range: <span className="font-medium">{format(dateRange.from, 'dd MMM')} - {format(dateRange.to, 'dd MMM yyyy')}</span>
                </>
              ) : (
                'Please select a date range'
              )}
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Time Slots</h3>
            
            {timeSlots.map((slot, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <GlobalStyleSelect
                    label="Start Time"
                    value={slot.startTime}
                    onChange={(value) => updateTimeSlot(index, 'startTime', value)}
                    options={Array.from({ length: 24 }).map((_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      return { id: `${hour}:00`, name: `${hour}:00` };
                    })}
                    showSearch={false}
                    compact
                  />
                  <GlobalStyleSelect
                    label="End Time"
                    value={slot.endTime}
                    onChange={(value) => updateTimeSlot(index, 'endTime', value)}
                    options={Array.from({ length: 24 }).map((_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      return { id: `${hour}:00`, name: `${hour}:00` };
                    })}
                    showSearch={false}
                    compact
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <GlobalStyleSelect
                      label="Status"
                      value={slot.status || 'Available'}
                      onChange={(value) => updateTimeSlot(index, 'status', value)}
                      options={[
                        { id: 'Available', name: 'Available' },
                        { id: 'Unavailable', name: 'Unavailable' },
                        { id: 'Partial', name: 'Partial' },
                      ]}
                      showSearch={false}
                      compact
                    />
                  </div>
                  
                  {timeSlots.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 rounded-xl shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => removeTimeSlot(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTimeSlot}
              className="w-full"
            >
              <PlusCircle className="h-4 w-4 mr-2" />
              Add Time Slot
            </Button>
          </div>
          
          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes (optional)
            </label>
            <Textarea
              id="notes"
              placeholder="Add any notes about your availability"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!dateRange.from || !dateRange.to}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
