
import React, { useState } from 'react';
import { format, isBefore, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { CalendarDays, Clock, Zap, AlertTriangle } from 'lucide-react';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { AvailabilityStatus } from '../../model/availability.types';

interface TimeSlot {
  startTime: string;
  endTime: string;
  status: AvailabilityStatus;
}

interface BatchApplyModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (data: {
    startDate: Date;
    endDate: Date;
    timeSlots: TimeSlot[];
    notes?: string;
  }) => void;
  availabilityPresets: Array<{
    id: string;
    name: string;
    timeSlots: Array<{ startTime: string; endTime: string }>;
  }>;
}

  onApply,
  availabilityPresets,
}: BatchApplyModalProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = availabilityPresets.find(p => p.id === presetId);
    if (preset) {
      // Determine status based on preset ID
      // "fully-unavailable" or presets with "unavailable" in the name → Unavailable
      // Everything else → Available
      const isUnavailable = presetId.toLowerCase().includes('unavailable');
      const status: AvailabilityStatus = isUnavailable ? 'Unavailable' : 'Available';

      console.log('BatchApplyModal: Selecting preset:', presetId, 'with status:', status);

      setTimeSlots(preset.timeSlots.map(slot => ({
        ...slot,
        status
      })));
    }
  };


  const addCustomTimeSlot = () => {
    setTimeSlots([...timeSlots, {
      startTime: '09:00',
      endTime: '17:00',
      status: 'Available'
    }]);
  };

  const updateTimeSlot = (index: number, field: keyof TimeSlot, value: string) => {
    setTimeSlots(slots => slots.map((slot, i) =>
      i === index ? { ...slot, [field]: value } : slot
    ));
  };

  const removeTimeSlot = (index: number) => {
    setTimeSlots(slots => slots.filter((_, i) => i !== index));
  };

  const handleApply = () => {
    if (!dateRange?.from || !dateRange?.to || timeSlots.length === 0) return;

    onApply({
      startDate: dateRange.from,
      endDate: dateRange.to,
      timeSlots,
      notes: notes.trim() || undefined
    });

    // Reset form
    setDateRange(undefined);
    setTimeSlots([]);
    setNotes('');
    setSelectedPreset('');
    onClose();
  };

  const isValid = !!(dateRange?.from && dateRange?.to && timeSlots.length > 0);

  // Check if any past dates are selected
  const today = startOfDay(new Date());
  const hasPastDates = dateRange?.from && isBefore(startOfDay(dateRange.from), today);

  return (
    <ResponsiveDialog open={open} onOpenChange={onClose} dialogClassName="sm:max-w-2xl" drawerClassName="h-[85dvh]">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Batch Apply Availability
        </ResponsiveDialog.Title>
        <ResponsiveDialog.Description>
          Apply availability to multiple days at once
        </ResponsiveDialog.Description>
      </ResponsiveDialog.Header>

      <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">
        <div className="space-y-4">

          {/* Date Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Select Date Range
            </Label>
            <div className="border rounded-lg p-3 flex justify-center">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                className="rounded-md"
                disabled={(date) => isBefore(startOfDay(date), today)}
              />
            </div>
            {hasPastDates && (
              <div className="flex items-center gap-2 text-yellow-600 text-sm mt-2">
                <AlertTriangle className="h-4 w-4" />
                <span>Cannot select past dates. Please select future dates only.</span>
              </div>
            )}
          </div>

          {/* Time Configuration */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Configure Time Slots
            </Label>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'preset' | 'custom')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="preset">Use Preset</TabsTrigger>
                <TabsTrigger value="custom">Custom Times</TabsTrigger>
              </TabsList>

              <TabsContent value="preset" className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {availabilityPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant={selectedPreset === preset.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePresetSelect(preset.id)}
                      className="h-auto p-3 text-left"
                    >
                      <div>
                        <div className="font-medium">{preset.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {preset.timeSlots.map(slot => `${slot.startTime}-${slot.endTime}`).join(', ')}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="custom" className="space-y-3">
                <div className="space-y-2">
                  {timeSlots.map((slot, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 border rounded-lg">
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => updateTimeSlot(index, 'startTime', e.target.value)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => updateTimeSlot(index, 'endTime', e.target.value)}
                        className="w-24"
                      />
                      <select
                        value={slot.status}
                        onChange={(e) => updateTimeSlot(index, 'status', e.target.value)}
                        className="px-2 py-1 border rounded text-sm"
                      >
                        <option value="Available">Available</option>
                        <option value="Unavailable">Unavailable</option>
                        <option value="Partial">Partial</option>
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTimeSlot(index)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCustomTimeSlot}
                    className="w-full"
                  >
                    Add Time Slot
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="batch-notes" className="text-sm font-medium">Notes (Optional)</Label>
            <Textarea
              id="batch-notes"
              placeholder="Add notes for all selected dates..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </ResponsiveDialog.Body>

      <ResponsiveDialog.Footer>
        <Button type="button" variant="outline" onClick={onClose} className="min-h-[44px]">
          Cancel
        </Button>
        <Button onClick={handleApply} disabled={!isValid} className="min-h-[44px]">
          {isValid && dateRange?.from && dateRange.to
            ? `Apply to ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
            : 'Apply to Range'
          }
        </Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
