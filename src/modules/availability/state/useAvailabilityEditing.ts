/**
 * Availability Editing State Hook
 *
 * RESPONSIBILITIES:
 * - Edit state machine (create vs edit mode)
 * - Track currently edited rule
 * - Manage startEdit, cancelEdit, submitEdit operations
 * - Implement edit = delete + recreate pattern
 *
 * MUST NOT:
 * - Fetch or cache data (that's useAvailability's job)
 * - Show toasts directly (return results for caller to handle)
 * - Handle UI transitions
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AvailabilityRule,
  AvailabilityFormPayload,
} from '../model/availability.types';
import {
  createAvailabilityFromForm,
  editAvailabilityRule,
  resolveProfileId,
} from '../api/availability.service';
import { validateAvailabilityForm } from '../utils/validation.utils';

// ============================================================================
// TYPES
// ============================================================================

export type EditMode = 'create' | 'edit' | null;

export interface EditState {
  mode: EditMode;
  ruleBeingEdited: AvailabilityRule | null;
  isSubmitting: boolean;
}

export interface UseAvailabilityEditingResult {
  // Current edit state
  editState: EditState;

  // Actions
  startCreate: () => void;
  startEdit: (rule: AvailabilityRule) => void;
  cancelEdit: () => void;
  submitEdit: (
    profileId: string,
    payload: AvailabilityFormPayload
  ) => Promise<{ success: boolean; errors?: string[] }>;

  // Validation
  validateForm: (payload: AvailabilityFormPayload) => {
    valid: boolean;
    errors: string[];
  };
}

// ============================================================================
// HOOK
// ============================================================================

export function useAvailabilityEditing(): UseAvailabilityEditingResult {
  const queryClient = useQueryClient();
  const [editState, setEditState] = useState<EditState>({
    mode: null,
    ruleBeingEdited: null,
    isSubmitting: false,
  });

  /**
   * Start creating a new rule
   */
  const startCreate = useCallback(() => {
    setEditState({
      mode: 'create',
      ruleBeingEdited: null,
      isSubmitting: false,
    });
  }, []);

  /**
   * Start editing an existing rule
   */
  const startEdit = useCallback((rule: AvailabilityRule) => {
    setEditState({
      mode: 'edit',
      ruleBeingEdited: rule,
      isSubmitting: false,
    });
  }, []);

  /**
   * Cancel editing (returns to null state)
   */
  const cancelEdit = useCallback(() => {
    setEditState({
      mode: null,
      ruleBeingEdited: null,
      isSubmitting: false,
    });
  }, []);

  /**
   * Submit the form (create or edit)
   * IMPORTANT: Edit flow is delete + create, never partial update
   */
  const submitEdit = useCallback(
    async (
      profileId: string,
      payload: AvailabilityFormPayload
    ): Promise<{ success: boolean; errors?: string[] }> => {
      // Validate before submission
      const validation = validateAvailabilityForm(payload);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      // Set submitting state
      setEditState((prev) => ({ ...prev, isSubmitting: true }));

      try {
        // Resolve profile ID
        const resolvedProfileId = await resolveProfileId(profileId);

        if (editState.mode === 'create') {
          // CREATE: Simple create operation
          await createAvailabilityFromForm(resolvedProfileId, payload);
        } else if (editState.mode === 'edit' && editState.ruleBeingEdited) {
          // EDIT: Delete old rule → Create new rule
          await editAvailabilityRule(
            editState.ruleBeingEdited.id,
            resolvedProfileId,
            payload
          );
        } else {
          throw new Error('Invalid edit state');
        }

        // Success - reset state
        setEditState({
          mode: null,
          ruleBeingEdited: null,
          isSubmitting: false,
        });

        // FORCE REFETCH: Invalidate both rules and slots to ensure UI reflects changes immediately
        // Uses wildcard invalidation on 'availability' key to catch all profile/date/type variations
        queryClient.invalidateQueries({ queryKey: ['availability'] });

        return { success: true };
      } catch (error) {
        // Reset submitting state but keep edit mode open
        setEditState((prev) => ({ ...prev, isSubmitting: false }));

        return {
          success: false,
          errors: [
            error instanceof Error
              ? error.message
              : 'Failed to save availability',
          ],
        };
      }
    },
    [editState.mode, editState.ruleBeingEdited]
  );

  /**
   * Validate form without submitting
   * Useful for real-time validation in forms
   */
  const validateForm = useCallback(
    (payload: AvailabilityFormPayload) => {
      return validateAvailabilityForm(payload);
    },
    []
  );

  return {
    editState,
    startCreate,
    startEdit,
    cancelEdit,
    submitEdit,
    validateForm,
  };
}
