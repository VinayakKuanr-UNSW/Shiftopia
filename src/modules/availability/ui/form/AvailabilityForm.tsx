/**
 * Availability Form Component
 *
 * RESPONSIBILITIES:
 * - Render form UI for creating/editing availability
 * - Use validateAvailabilityForm() from validation.utils.ts
 * - Support create/edit modes
 * - Collect form data and pass to parent
 *
 * MUST NOT:
 * - Direct API calls
 * - Slot math
 * - Edit state management (parent handles via useAvailabilityEditing)
 */

import React, { useState, useEffect } from 'react';
import { format, parseISO, parse, startOfDay } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { AlertCircle } from 'lucide-react';
import {
  AvailabilityFormPayload,
  AvailabilityRule,
  RepeatType,
} from '../../model/availability.types';
import { validateAvailabilityForm } from '../../utils/validation.utils';

interface AvailabilityFormProps {
  mode: 'create' | 'edit';
  existingRule?: AvailabilityRule;
  initialDate?: Date;
  onSubmit: (payload: AvailabilityFormPayload) => Promise<{ success: boolean; errors?: string[] }>;
  onCancel: () => void;
  open: boolean;
}

export function AvailabilityForm({
  mode,
  existingRule,
  initialDate,
  onSubmit,
  onCancel,
  open,
}: AvailabilityFormProps) {
  // Initialize form state from existing rule or defaults
  const [startDate, setStartDate] = useState<Date>(
    existingRule ? parseISO(existingRule.start_date) : initialDate || new Date()
  );

  const [startTime, setStartTime] = useState<string | null>(
    existingRule?.start_time ? existingRule.start_time.substring(0, 5) : null
  );
  const [endTime, setEndTime] = useState<string | null>(
    existingRule?.end_time ? existingRule.end_time.substring(0, 5) : null
  );
  const [reason, setReason] = useState<string>(existingRule?.reason || '');

  const [repeatType, setRepeatType] = useState<RepeatType>(existingRule?.repeat_type || 'none');
  const [repeatDays, setRepeatDays] = useState<number[]>(existingRule?.repeat_days || []);
  const [repeatEndDate, setRepeatEndDate] = useState<Date | undefined>(
    existingRule?.repeat_end_date ? parseISO(existingRule.repeat_end_date) : undefined
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Reset form when dialog opens/closes or mode changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && existingRule) {
        setStartDate(parseISO(existingRule.start_date));
        setStartTime(existingRule.start_time ? existingRule.start_time.substring(0, 5) : null);
        setEndTime(existingRule.end_time ? existingRule.end_time.substring(0, 5) : null);
        setReason(existingRule.reason || '');
        setRepeatType(existingRule.repeat_type);
        setRepeatDays(existingRule.repeat_days || []);
        setRepeatEndDate(existingRule.repeat_end_date ? parseISO(existingRule.repeat_end_date) : undefined);
      } else if (mode === 'create') {
        // Reset to defaults for create mode
        const initial = initialDate || new Date();
        setStartDate(initial);
        setStartTime(null);
        setEndTime(null);
        setReason('');
        setRepeatType('none');
        setRepeatDays([]);
        setRepeatEndDate(undefined);
      }
      setErrors([]);
    }
  }, [open, mode, existingRule, initialDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);

    // Build payload
    const payload: AvailabilityFormPayload = {
      start_date: startDate,
      end_date: repeatEndDate || startDate, // repeat_end_date fallback to start_date for 'none'
      start_time: startTime,
      end_time: endTime,
      repeat_type: repeatType,
      repeat_days: repeatType === 'weekly' || repeatType === 'fortnightly' ? repeatDays : undefined,
      repeat_end_date: repeatEndDate,
      reason: reason || undefined,
    };

    // Validate using validation.utils.ts
    const validation = validateAvailabilityForm(payload);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    // Submit
    setIsSubmitting(true);
    const result = await onSubmit(payload);
    setIsSubmitting(false);

    if (!result.success && result.errors) {
      setErrors(result.errors);
    }
    // If successful, parent will close the dialog
  };

  const toggleRepeatDay = (day: number) => {
    setRepeatDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const weekDays = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create Availability' : 'Edit Availability'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Set your availability for a date or date range.'
              : 'Update your existing availability rule.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive rounded-md p-3 space-y-1">
              {errors.map((error, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              ))}
            </div>
          )}

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={format(startDate, 'yyyy-MM-dd')}
                onChange={(e) => setStartDate(startOfDay(parse(e.target.value, 'yyyy-MM-dd', new Date())))}
              />
            </div>
            {repeatType !== 'none' && (
              <div className="space-y-2">
                <Label htmlFor="repeat-end-date">Repeat Until</Label>
                <Input
                  id="repeat-end-date"
                  type="date"
                  value={repeatEndDate ? format(repeatEndDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => setRepeatEndDate(startOfDay(parse(e.target.value, 'yyyy-MM-dd', new Date())))}
                />
              </div>
            )}
          </div>

          {/* Time Range (Optional) */}
          <div className="space-y-2">
            <Label>Time Range (Optional - leave blank for full day)</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                placeholder="Start time"
                value={startTime || ''}
                onChange={(e) => setStartTime(e.target.value || null)}
              />
              <Input
                type="time"
                placeholder="End time"
                value={endTime || ''}
                onChange={(e) => setEndTime(e.target.value || null)}
              />
            </div>
          </div>



          {/* Repeat Type */}
          <div className="space-y-2">
            <Label htmlFor="repeat-type">Repeat</Label>
            <Select
              value={repeatType}
              onValueChange={(value) => setRepeatType(value as RepeatType)}
            >
              <SelectTrigger id="repeat-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Does not repeat</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="fortnightly">Fortnightly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Weekly Repeat Days */}
          {(repeatType === 'weekly' || repeatType === 'fortnightly') && (
            <div className="space-y-2">
              <Label>Repeat on</Label>
              <div className="flex gap-2">
                {weekDays.map((day) => (
                  <div key={day.value} className="flex items-center gap-1">
                    <Checkbox
                      id={`day-${day.value}`}
                      checked={repeatDays.includes(day.value)}
                      onCheckedChange={() => toggleRepeatDay(day.value)}
                    />
                    <Label
                      htmlFor={`day-${day.value}`}
                      className="text-xs cursor-pointer"
                    >
                      {day.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Doctor's appointment, vacation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={200}
            />
            <div className="text-xs text-muted-foreground text-right">
              {reason.length}/200
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Update'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
