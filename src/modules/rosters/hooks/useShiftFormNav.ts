import { useShiftFormModalStore, type OpenShiftFormOptions } from '../state/useShiftFormModalStore';

// Re-exported for back-compat — callers historically imported this type from here.
export type { OpenShiftFormOptions };

/**
 * Open the Add/Edit Shift wizard as a centered modal pop-up ON TOP of the roster
 * grid (ShiftWizardModal, mounted once in RostersPlannerPage).
 *
 * Returns the global store's `openShiftForm` action — same `(opts) => void`
 * signature the launchers already use, so no call site changes. The modal is a
 * CUSTOM overlay (not a Radix Dialog), so the form's nested Select/Popover
 * dropdowns keep working without the pointer-events/inert conflict that pushed
 * this form onto a dedicated page in the first place.
 */
export function useShiftFormNav() {
    return useShiftFormModalStore((s) => s.openShiftForm);
}
