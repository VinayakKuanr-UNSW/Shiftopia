/**
 * Reserve List panel open/close state — mirrors useShiftFormModalStore's
 * pattern (a tiny zero-provider Zustand store) so any shift card can open the
 * same panel instance without prop-drilling. Mounted once in
 * RostersPlannerPage, same as ShiftWizardModal.
 */

import { create } from 'zustand';

interface ReserveListPanelState {
  isOpen: boolean;
  shiftId: string | null;
  open: (shiftId: string) => void;
  close: () => void;
}

export const useReserveListPanelStore = create<ReserveListPanelState>((set) => ({
  isOpen: false,
  shiftId: null,
  open: (shiftId) => set({ isOpen: true, shiftId }),
  close: () => set({ isOpen: false, shiftId: null }),
}));
