/**
 * DnD Utilities — Single Source of Truth for Roster DnD Logic
 */
import { ShiftDisplay } from '../domain/queries/getGroupsModeGrid.query';

/**
 * Determines if a shift can be dragged.
 * Rules:
 * 1. DnD Mode must be active.
 * 2. Shift must be in 'Draft' status.
 * 3. Shift must NOT be cancelled.
 */
export const canDragShift = (
  shift: { lifecycle_status: string; is_cancelled?: boolean } | ShiftDisplay,
  isDnDModeActive: boolean
): boolean => {
  if (!isDnDModeActive) return false;

  // Handle both raw shift object and ShiftDisplay wrapper
  const status = 'lifecycle_status' in shift ? shift.lifecycle_status : (shift as ShiftDisplay).status;
  const isCancelled = 'is_cancelled' in shift ? shift.is_cancelled : (shift as ShiftDisplay).isCancelled;

  return status === 'Draft' && !isCancelled;
};

/**
 * Determines if a shift can be dropped onto a target.
 */
export const canDropOnTarget = (
  isDnDModeActive: boolean,
  shift: { lifecycle_status: string; is_cancelled?: boolean } | ShiftDisplay,
  targetContext?: { isPast?: boolean; isLocked?: boolean }
): boolean => {
  if (!isDnDModeActive) return false;

  // Re-verify shift status (safety)
  const status = 'lifecycle_status' in shift ? shift.lifecycle_status : (shift as ShiftDisplay).status;
  const isCancelled = 'is_cancelled' in shift ? shift.is_cancelled : (shift as ShiftDisplay).isCancelled;
  
  if (status !== 'Draft' || isCancelled) return false;

  // Verify target
  if (targetContext?.isPast) return false;
  if (targetContext?.isLocked) return false;

  return true;
};
