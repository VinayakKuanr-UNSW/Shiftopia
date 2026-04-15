/**
 * Configure Pane Component
 *
 * RIGHT PANE in the 3-pane layout
 *
 * RESPONSIBILITIES:
 * - Render form for creating/editing availability rules
 * - Show form fields: start date, start time, end time
 * - Show repeat section with toggle, type selector, day picker, end date
 * - Validate input before submission
 * - Call onSubmit with form payload
 *
 * MUST NOT:
 * - Make direct API calls
 * - Show slots or calendar data
 * - Handle edit state management (parent handles via useAvailabilityEditing)
 */

import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, Clock, Repeat, AlertCircle, Save, X } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Switch } from '@/modules/core/ui/primitives/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { cn } from '@/modules/core/lib/utils';
import {
  AvailabilityFormPayload,
  AvailabilityRule,
  RepeatType,
} from '../../model/availability.types';
import { validateAvailabilityForm } from '../../utils/validation.utils';

// ============================================================================
// TYPES
// ============================================================================

export interface ConfigurePaneProps {
  mode: 'create' | 'edit' | null;
  ruleBeingEdited: AvailabilityRule | null;
  isSubmitting: boolean;
  onSubmit: (payload: AvailabilityFormPayload) => Promise<void>;
  onCancel: () => void;
}

interface FormState {
  startDate: string;       // yyyy-MM-dd
  startTime: string;       // HH:mm
  endTime: string;         // HH:mm
  repeatEnabled: boolean;
  repeatType: RepeatType;
  repeatDays: number[];    // 0=Sun, 6=Sat
  repeatEndDate: string;   // yyyy-MM-dd
}

// ============================================================================
// CONSTANTS
// ============================================================================

const WEEKDAYS = [
  { value: 0, label: 'Sun', short: 'S' },
  { value: 1, label: 'Mon', short: 'M' },
  { value: 2, label: 'Tue', short: 'T' },
  { value: 3, label: 'Wed', short: 'W' },
  { value: 4, label: 'Thu', short: 'T' },
  { value: 5, label: 'Fri', short: 'F' },
  { value: 6, label: 'Sat', short: 'S' },
];

const DEFAULT_FORM_STATE: FormState = {
  startDate: format(new Date(), 'yyyy-MM-dd'),
  startTime: '09:00',
  endTime: '17:00',
  repeatEnabled: false,
  repeatType: 'none',
  repeatDays: [],
  repeatEndDate: '',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize form state from an existing rule (edit mode)
 */
const initializeFromRule = (rule: AvailabilityRule): FormState => {
  return {
    startDate: rule.start_date,
    startTime: rule.start_time.substring(0, 5), // HH:mm
    endTime: rule.end_time.substring(0, 5),     // HH:mm
    repeatEnabled: rule.repeat_type !== 'none',
    repeatType: rule.repeat_type,
    repeatDays: rule.repeat_days || [],
    repeatEndDate: rule.repeat_end_date || '',
  };
};

/**
 * Convert form state to submission payload
 */
const formStateToPayload = (state: FormState): AvailabilityFormPayload => {
  return {
    start_date: new Date(state.startDate),
    end_date: new Date(state.startDate), // Single day rule
    start_time: state.startTime,
    end_time: state.endTime,
    repeat_type: state.repeatEnabled ? state.repeatType : 'none',
    repeat_days: state.repeatEnabled && (state.repeatType === 'weekly' || state.repeatType === 'fortnightly')
      ? state.repeatDays
      : undefined,
    repeat_end_date: state.repeatEnabled && state.repeatEndDate
      ? new Date(state.repeatEndDate)
      : undefined,
  };
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ConfigurePane({
  mode,
  ruleBeingEdited,
  isSubmitting,
  onSubmit,
  onCancel,
}: ConfigurePaneProps) {
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [errors, setErrors] = useState<string[]>([]);

  // Reset form when mode changes or rule changes
  useEffect(() => {
    if (mode === 'edit' && ruleBeingEdited) {
      setFormState(initializeFromRule(ruleBeingEdited));
    } else if (mode === 'create') {
      setFormState(DEFAULT_FORM_STATE);
    }
    setErrors([]);
  }, [mode, ruleBeingEdited]);

  // Handle repeat toggle
  const handleRepeatToggle = (enabled: boolean) => {
    setFormState((prev) => ({
      ...prev,
      repeatEnabled: enabled,
      repeatType: enabled ? 'daily' : 'none',
      repeatDays: [],
      repeatEndDate: enabled ? prev.repeatEndDate : '',
    }));
  };

  // Handle repeat type change
  const handleRepeatTypeChange = (type: string) => {
    setFormState((prev) => ({
      ...prev,
      repeatType: type as RepeatType,
      repeatDays: (type === 'weekly' || type === 'fortnightly') ? prev.repeatDays : [],
    }));
  };

  // Handle day toggle
  const handleDayToggle = (day: number) => {
    setFormState((prev) => ({
      ...prev,
      repeatDays: prev.repeatDays.includes(day)
        ? prev.repeatDays.filter((d) => d !== day)
        : [...prev.repeatDays, day].sort((a, b) => a - b),
    }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);

    const payload = formStateToPayload(formState);
    const validation = validateAvailabilityForm(payload);

    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    try {
      await onSubmit(payload);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Failed to save']);
    }
  };

  // Determine if form is active (in create or edit mode)
  const isFormActive = mode !== null;
  const isDisabled = !isFormActive;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b flex-shrink-0">
        <h2 className="text-lg font-semibold">
          {mode === 'edit' ? 'Edit Availability' : 'Configure Availability'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'edit'
            ? 'Update your availability rule'
            : mode === 'create'
            ? 'Create a new availability rule'
            : 'Select "Add Availability" or edit an existing rule'}
        </p>
      </div>

      {/* Form */}
      <ScrollArea className="flex-1">
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Error Messages */}
          {errors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive rounded-md p-3 space-y-1">
              {errors.map((error, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 text-sm text-destructive"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              ))}
            </div>
          )}

          {/* Inactive State */}
          {!isFormActive && (
            <div className="py-12 text-center text-muted-foreground">
              <Calendar className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No rule selected for editing.</p>
              <p className="text-sm mt-1">
                Click "Add Availability" to create a new rule.
              </p>
            </div>
          )}


          {isFormActive && (
            <>
              {/* Start Date */}
              <div className="space-y-2">
                <Label htmlFor="start-date" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Start Date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={formState.startDate}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                  disabled={isDisabled}
                  className="w-full"
                />
              </div>

              {/* Time Range */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Time Range
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="start-time" className="text-xs text-muted-foreground">
                      Start
                    </Label>
                    <Input
                      id="start-time"
                      type="time"
                      value={formState.startTime}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          startTime: e.target.value,
                        }))
                      }
                      disabled={isDisabled}
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-time" className="text-xs text-muted-foreground">
                      End
                    </Label>
                    <Input
                      id="end-time"
                      type="time"
                      value={formState.endTime}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          endTime: e.target.value,
                        }))
                      }
                      disabled={isDisabled}
                    />
                  </div>
                </div>
              </div>

              {/* Repeat Section */}
              <div className="space-y-4 pt-2 border-t">
                {/* Repeat Toggle */}
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="repeat-toggle"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Repeat className="h-4 w-4" />
                    Repeat
                  </Label>
                  <Switch
                    id="repeat-toggle"
                    checked={formState.repeatEnabled}
                    onCheckedChange={handleRepeatToggle}
                    disabled={isDisabled}
                  />
                </div>

                {/* Repeat Options (shown when enabled) */}
                {formState.repeatEnabled && (
                  <div className="space-y-4 pl-6 border-l-2 border-muted">
                    {/* Repeat Type */}
                    <div className="space-y-2">
                      <Label htmlFor="repeat-type">Frequency</Label>
                      <Select
                        value={formState.repeatType}
                        onValueChange={handleRepeatTypeChange}
                        disabled={isDisabled}
                      >
                        <SelectTrigger id="repeat-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="fortnightly">Fortnightly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Day Picker (for weekly/fortnightly) */}
                    {(formState.repeatType === 'weekly' ||
                      formState.repeatType === 'fortnightly') && (
                      <div className="space-y-2">
                        <Label>Repeat on</Label>
                        <div className="flex gap-1">
                          {WEEKDAYS.map((day) => (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => handleDayToggle(day.value)}
                              disabled={isDisabled}
                              className={cn(
                                'w-9 h-9 rounded-full text-sm font-medium transition-colors',
                                'border-2 focus:outline-none focus:ring-2 focus:ring-offset-1',
                                formState.repeatDays.includes(day.value)
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background border-muted hover:border-muted-foreground/50'
                              )}
                              title={day.label}
                            >
                              {day.short}
                            </button>
                          ))}
                        </div>
                        {formState.repeatDays.length === 0 && (
                          <p className="text-xs text-destructive">
                            Select at least one day
                          </p>
                        )}
                      </div>
                    )}

                    {/* Repeat End Date */}
                    <div className="space-y-2">
                      <Label htmlFor="repeat-end-date">Repeat until</Label>
                      <Input
                        id="repeat-end-date"
                        type="date"
                        value={formState.repeatEndDate}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            repeatEndDate: e.target.value,
                          }))
                        }
                        min={formState.startDate}
                        disabled={isDisabled}
                      />
                      {!formState.repeatEndDate && (
                        <p className="text-xs text-destructive">
                          End date is required for repeating rules
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </form>
      </ScrollArea>

      {isFormActive && (
        <div className="p-4 border-t flex-shrink-0 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1"
          >
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting
              ? 'Saving...'
              : mode === 'edit'
              ? 'Update Rule'
              : 'Create Rule'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default ConfigurePane;
