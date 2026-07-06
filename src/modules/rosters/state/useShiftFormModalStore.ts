/**
 * Shift Form Modal Store — Zustand v5
 *
 * Global open/close state for the Add/Edit Shift wizard, rendered as a centered
 * overlay ON TOP of the roster grid (see ShiftWizardModal). A tiny zero-provider
 * store so every launcher — useShiftFormNav consumers (GroupModeView,
 * EventsModeView, RolesModeView, RosterModals) and DrillDownPanel — opens the same
 * in-place modal without prop-drilling or route navigation.
 *
 * NOTE: the modal host is mounted once in RostersPlannerPage; all shift-form
 * launchers live under that page, so a single mount covers every entry point.
 */

import { create } from 'zustand';
import type { ShiftContext } from '../ui/dialogs/EnhancedAddShiftModal/types';

export interface OpenShiftFormOptions {
    context: ShiftContext | null;
    editMode?: boolean;
    existingShift?: any;
    isTemplateMode?: boolean;
}

interface ShiftFormModalState {
    isOpen: boolean;
    opts: OpenShiftFormOptions | null;
    openShiftForm: (opts: OpenShiftFormOptions) => void;
    close: () => void;
}

export const useShiftFormModalStore = create<ShiftFormModalState>((set) => ({
    isOpen: false,
    opts: null,
    openShiftForm: (opts) => set({ isOpen: true, opts }),
    close: () => set({ isOpen: false, opts: null }),
}));
