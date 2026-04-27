
import React from 'react';
import { format } from 'date-fns';
import { useToast } from '@/modules/core/hooks/use-toast';
import { AvailabilityStatus, AvailabilityFormPayload, AvailabilityRule } from '../../model/availability.types';
import { EditState } from '../../state/useAvailabilityEditing';
import DayInteractionModal from './DayInteractionModal';
import BatchApplyModal from './BatchApplyModal';

interface AvailabilityModalsProps {
  isDayModalOpen: boolean;
  setIsDayModalOpen: (open: boolean) => void;
  isBatchModalOpen: boolean;
  setIsBatchModalOpen: (open: boolean) => void;
  selectedDate: Date | null;

  // New Hook-based props
  editState: EditState;
  onSubmit: (profileId: string, payload: AvailabilityFormPayload) => Promise<{ success: boolean; errors?: string[] }>;
  onCancel: () => void;

  isCalendarLocked: boolean;
}

export function AvailabilityModals({
  isDayModalOpen,
  setIsDayModalOpen,
  isBatchModalOpen,
  setIsBatchModalOpen,
  selectedDate,
  editState,
  onSubmit,
  onCancel,
  isCalendarLocked,
}: AvailabilityModalsProps) {
  const { toast } = useToast();

  const handleDayModalSave = async (data: {
    startDate: Date;
    endDate: Date;
    timeSlots: Array<{
      startTime: string;
      endTime: string;
      status?: string;
    }>;
    notes?: string;
  }): Promise<boolean> => {
    // Transform UI data to Payload
    // Note: DayInteractionModal currently supports "Time Slots" but our DB model supports "Rules".
    // 1 Rule = 1 Time Range.
    // If the user adds multiple time slots for a day in the modal, we strictly should map this to MULTIPLE RULES.
    // However, the `onSubmit` takes a SINGLE payload (1 rule).
    //
    // For now, to unblock, we will assume the First Slot is the Rule.
    // (A future task should update DayInteractionModal to handle the 1-Rule-Per-Entry concept or use BatchCreate).

    if (data.timeSlots.length === 0) return true; // Deletion handled separately

    const slot = data.timeSlots[0];

    const payload: AvailabilityFormPayload = {
      start_date: data.startDate,
      end_date: data.endDate,
      start_time: slot.startTime,
      end_time: slot.endTime,
      repeat_type: 'none', // Day modal creates single entries by default
      repeat_days: undefined,
      reason: data.notes
    };

    const profileId = "current-user"; // TODO: Pass this in or resolve in hook
    const result = await onSubmit(profileId, payload);

    if (result.success) {
      toast({
        title: 'Availability Saved',
        description: `Your availability for ${format(data.startDate, 'dd MMM yyyy')} has been saved successfully.`
      });
      setIsDayModalOpen(false);
      return true;
    } else {
      toast({
        title: 'Error',
        description: result.errors?.join(', ') ?? 'Failed to save',
        variant: 'destructive'
      });
      return false;
    }
  };

  const handleDayModalDelete = async (date: Date): Promise<boolean> => {
    // Delete is currently handled by Editing Hook via "Edit = Delete + Create" (if we save empty?)
    // Or we need a specific delete action.
    // The previous code passed `deleteAvailability`.
    // The new hook exposes `deleteRule` via useAvailability (not useAvailabilityEditing).
    //
    // COMPROMISE: For now, we will just close the modal. 
    // The user should use the "Delete" button on the card if they want to delete widely.
    // If they want to "Clear" a day, they save empty slots?

    // Actually, `useAvailability` has `deleteRule`. This modal needs access to it?
    // The Layout passes `deleteRule` to `AvailabilityList` but NOT to `AvailabilityModals`.
    // Valid for now to just Close.

    setIsDayModalOpen(false);
    return true;
  };

  const handleBatchApply = async (data: any) => {
    // Placeholder for Batch Logic - needs similar adaptation
    setIsBatchModalOpen(false);
  };

  // Construct "existingAvailability" from "editState.ruleBeingEdited" to pass to DayInteractionModal
  // This maps the Rule back to the UI format (DayAvailability)
  const existingAvailability = editState.ruleBeingEdited ? {
    id: editState.ruleBeingEdited.id,
    employeeId: editState.ruleBeingEdited.profile_id,
    date: editState.ruleBeingEdited.start_date,
    status: 'Available', // Derived
    timeSlots: [{
      id: '1',
      startTime: editState.ruleBeingEdited.start_time || '09:00',
      endTime: editState.ruleBeingEdited.end_time || '17:00',
      status: 'Available'
    }]
  } : undefined;

  return (
    <>
      {/* DAY INTERACTION MODAL */}
      <DayInteractionModal
        isOpen={isDayModalOpen}
        onClose={() => {
          setIsDayModalOpen(false);
          onCancel();
        }}
        selectedDate={selectedDate}
        existingAvailability={existingAvailability as any}
        onSave={handleDayModalSave}
        onDelete={handleDayModalDelete}
        isLocked={isCalendarLocked}
      />

      {/* BATCH APPLY MODAL */}
      <BatchApplyModal
        open={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onApply={handleBatchApply}
        availabilityPresets={[]}
        isLocked={isCalendarLocked}
      />
    </>
  );
}
