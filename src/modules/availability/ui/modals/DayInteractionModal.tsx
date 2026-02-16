import React, { useState, useEffect } from 'react';
import { format, isBefore, startOfDay } from 'date-fns';
import { Plus, Minus, Clock, Trash2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { useToast } from '@/modules/core/hooks/use-toast';
import { DayAvailability, TimeSlot } from '../../model/availability.types';
import { translateDatabaseError } from '../../utils/validation.utils';


interface DayInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  existingAvailability?: DayAvailability;
  onSave: (data: {
    startDate: Date;
    endDate: Date;
    timeSlots: Array<{
      startTime: string;
      endTime: string;
      status?: string;
    }>;
    notes?: string;
  }) => Promise<boolean>;
  onDelete: (date: Date) => Promise<boolean>;
  isLocked?: boolean;
}

interface TimeSlotForm {
  id: string;
  startTime: string;
  endTime: string;
  status: 'Available' | 'Unavailable';
}

// Helper function to generate a unique ID
const generateId = () => Math.random().toString(36).substring(2, 11);

// Helper function to validate time format (HH:MM)
const isValidTime = (time: string): boolean => {
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
};

// Helper function to convert time string to minutes for comparison
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};


export function DayInteractionModal({
  isOpen,
  onClose,
  selectedDate,
  existingAvailability,
  onSave,
  onDelete,
  isLocked = false
}: DayInteractionModalProps) {
  const [timeSlots, setTimeSlots] = useState<TimeSlotForm[]>([]);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  // Initialize form data when modal opens or existing availability changes
  useEffect(() => {
    if (isOpen && selectedDate) {
      console.log('Modal opened for date:', format(selectedDate, 'yyyy-MM-dd'));
      console.log('Existing availability:', existingAvailability);

      if (existingAvailability?.timeSlots && existingAvailability.timeSlots.length > 0) {
        // Load existing time slots ONLY if they exist
        const formattedSlots: TimeSlotForm[] = existingAvailability.timeSlots.map(slot => {
          // Normalize status to match Select dropdown options
          // Handle any status value and map to Available or Unavailable
          let normalizedStatus: 'Available' | 'Unavailable' = 'Available';
          if (slot.status) {
            const statusLower = slot.status.toLowerCase();
            if (statusLower.includes('unavailable')) {
              normalizedStatus = 'Unavailable';
            }
          }

          return {
            id: slot.id || generateId(),
            startTime: slot.startTime,
            endTime: slot.endTime,
            status: normalizedStatus
          };
        });
        console.log('Loading existing time slots:', formattedSlots);
        setTimeSlots(formattedSlots);
        setNotes(existingAvailability.notes || '');

      } else {
        // Start with EMPTY time slots - no pre-filling
        console.log('No existing time slots, starting empty');
        setTimeSlots([]);
        setNotes('');
      }
    }
  }, [isOpen, selectedDate, existingAvailability]);

  const addTimeSlot = () => {
    const newSlot: TimeSlotForm = {
      id: generateId(),
      startTime: '09:00',
      endTime: '17:00',
      status: 'Available'
    };
    console.log('Adding new time slot:', newSlot);
    setTimeSlots(prev => [...prev, newSlot]);
  };

  const removeTimeSlot = (id: string) => {
    console.log('Removing time slot:', id);
    setTimeSlots(prev => prev.filter(slot => slot.id !== id));
  };

  const updateTimeSlot = (id: string, field: keyof TimeSlotForm, value: string) => {
    console.log('Updating time slot:', id, field, value);
    setTimeSlots(prev => prev.map(slot =>
      slot.id === id ? { ...slot, [field]: value } : slot
    ));
  };

  // Quick action: Mark fully available
  const markFullyAvailable = () => {
    const fullDaySlot: TimeSlotForm = {
      id: generateId(),
      startTime: '00:00',
      endTime: '23:59',
      status: 'Available'
    };
    console.log('Marking fully available:', fullDaySlot);
    setTimeSlots([fullDaySlot]);
  };

  // Quick action: Mark fully unavailable
  const markFullyUnavailable = () => {
    const fullDaySlot: TimeSlotForm = {
      id: generateId(),
      startTime: '00:00',
      endTime: '23:59',
      status: 'Unavailable'
    };
    console.log('Marking fully unavailable:', fullDaySlot);
    setTimeSlots([fullDaySlot]);
  };

  // Quick action: Clear all
  const clearAllTimeSlots = () => {
    console.log('Clearing all time slots');
    setTimeSlots([]);
    setNotes('');
  };

  const validateTimeSlots = (): string[] => {
    const errors: string[] = [];

    timeSlots.forEach((slot, index) => {
      // Validate time format
      if (!isValidTime(slot.startTime)) {
        errors.push(`Time slot ${index + 1}: Invalid start time format (use HH:MM)`);
      }
      if (!isValidTime(slot.endTime)) {
        errors.push(`Time slot ${index + 1}: Invalid end time format (use HH:MM)`);
      }

      // Validate start time is before end time
      if (isValidTime(slot.startTime) && isValidTime(slot.endTime)) {
        const startMinutes = timeToMinutes(slot.startTime);
        const endMinutes = timeToMinutes(slot.endTime);

        if (startMinutes >= endMinutes) {
          errors.push(`Time slot ${index + 1}: Start time must be before end time`);
        }
      }
    });

    // Check for overlapping time slots
    for (let i = 0; i < timeSlots.length; i++) {
      for (let j = i + 1; j < timeSlots.length; j++) {
        const slot1Start = timeToMinutes(timeSlots[i].startTime);
        const slot1End = timeToMinutes(timeSlots[i].endTime);
        const slot2Start = timeToMinutes(timeSlots[j].startTime);
        const slot2End = timeToMinutes(timeSlots[j].endTime);

        // Check if slots overlap: slot1 starts before slot2 ends AND slot1 ends after slot2 starts
        const overlaps = slot1Start < slot2End && slot1End > slot2Start;

        if (overlaps) {
          errors.push(`Time slots ${i + 1} and ${j + 1} overlap! Please adjust the times.`);
        }
      }
    }

    return errors;
  };


  const handleSave = async () => {
    if (!selectedDate) return;

    console.log('Saving availability with time slots:', timeSlots);

    // If no time slots, we're clearing the availability
    if (timeSlots.length === 0) {
      console.log('No time slots, clearing availability');
      // If there was existing availability, delete it completely
      if (existingAvailability?.timeSlots && existingAvailability.timeSlots.length > 0) {
        setIsDeleting(true);
        try {
          const success = await onDelete(selectedDate);
          if (success) {
            console.log('Successfully cleared availability');
            onClose();
          }
        } catch (error) {
          console.error('Error clearing availability:', error);
        } finally {
          setIsDeleting(false);
        }
        return;
      } else {
        // No existing data and no new data, just close
        console.log('No existing data, just closing');
        onClose();
        return;
      }
    }

    const errors = validateTimeSlots();
    if (errors.length > 0) {
      toast({
        title: 'Validation Error',
        description: errors.join(', '),
        variant: 'destructive'
      });
      return;
    }

    setIsSaving(true);
    try {
      const success = await onSave({
        startDate: selectedDate,
        endDate: selectedDate,
        timeSlots: timeSlots.map(slot => ({
          startTime: slot.startTime,
          endTime: slot.endTime,
          status: slot.status
        })),
        notes: notes.trim() || undefined
      });

      if (success) {
        console.log('Successfully saved availability');
        onClose();
      }
    } catch (error) {
      console.error('Error saving availability:', error);
      const userMessage = translateDatabaseError(error);
      toast({
        title: 'Save Failed',
        description: userMessage,
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }

  };

  const handleDelete = async () => {
    if (!selectedDate) return;

    console.log('Deleting availability for:', format(selectedDate, 'yyyy-MM-dd'));
    setIsDeleting(true);
    try {
      const success = await onDelete(selectedDate);
      if (success) {
        console.log('Successfully deleted availability');
        onClose();
      }
    } catch (error) {
      console.error('Error deleting availability:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!selectedDate) return null;

  const hasExistingData = existingAvailability?.timeSlots && existingAvailability.timeSlots.length > 0;
  const isPastDate = isBefore(startOfDay(selectedDate), startOfDay(new Date()));

  // Show warning for past dates
  if (isPastDate) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-5 w-5" />
              Cannot Edit Past Date
            </DialogTitle>
            <DialogDescription>
              You cannot set or modify availability for past dates.
            </DialogDescription>
          </DialogHeader>
          <div className="text-center py-4">
            <p className="text-muted-foreground">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')} is in the past.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose} variant="outline">Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Availability for {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </DialogTitle>
          <DialogDescription>
            Set your availability time slots for this day
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <Button
              onClick={markFullyAvailable}
              variant="outline"
              size="sm"
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
              disabled={isLocked}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Mark Fully Available
            </Button>
            <Button
              onClick={markFullyUnavailable}
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={isLocked}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Mark Fully Unavailable
            </Button>
            <Button
              onClick={clearAllTimeSlots}
              variant="outline"
              size="sm"
              className="text-gray-600 hover:text-gray-700"
              disabled={isLocked}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          </div>

          {/* Time Slots Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Time Slots</Label>
            </div>

            {timeSlots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No time slots set</p>
                <p className="text-sm">Use quick actions above or add a custom time slot below</p>
                <Button
                  onClick={addTimeSlot}
                  variant="outline"
                  className="mt-2"
                  disabled={isLocked}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Time Slot
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {timeSlots.map((slot, index) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50 dark:bg-gray-800"
                  >
                    <Badge variant="outline" className="min-w-[60px] justify-center">
                      #{index + 1}
                    </Badge>

                    {/* Start Time Input */}
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">Start</Label>
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => updateTimeSlot(slot.id, 'startTime', e.target.value)}
                        className="mt-1"
                        disabled={isLocked}
                        step="60"
                      />
                    </div>

                    {/* End Time Input */}
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">End</Label>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => updateTimeSlot(slot.id, 'endTime', e.target.value)}
                        className="mt-1"
                        disabled={isLocked}
                        step="60"
                      />
                    </div>

                    {/* Status Select */}
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <Select
                        value={slot.status}
                        onValueChange={(value: 'Available' | 'Unavailable') =>
                          updateTimeSlot(slot.id, 'status', value)
                        }
                        disabled={isLocked}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Available">Available</SelectItem>
                          <SelectItem value="Unavailable">Unavailable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Remove Button */}
                    <Button
                      onClick={() => removeTimeSlot(slot.id)}
                      variant="outline"
                      size="icon"
                      className="text-red-600 hover:text-red-700 mt-5"
                      disabled={isLocked}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {/* Add Time Slot Button */}
                <Button
                  onClick={addTimeSlot}
                  variant="outline"
                  className="w-full"
                  disabled={isLocked}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Another Time Slot
                </Button>
              </div>
            )}
          </div>

          {/* Notes Section */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about your availability..."
              className="w-full px-3 py-2 border border-input rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              rows={3}
              disabled={isLocked}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between pt-4">
            <div className="flex gap-2">
              {hasExistingData && (
                <Button
                  onClick={handleDelete}
                  variant="destructive"
                  disabled={isDeleting || isLocked}
                >
                  {isDeleting ? 'Deleting...' : 'Delete Availability'}
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={onClose} variant="outline">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || isLocked || isDeleting}
              >
                {isSaving || isDeleting ? 'Saving...' : 'Save Availability'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
