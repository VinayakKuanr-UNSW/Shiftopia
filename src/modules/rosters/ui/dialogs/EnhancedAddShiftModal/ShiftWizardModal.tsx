/**
 * ShiftWizardModal — centered Add/Edit Shift wizard, ON TOP of the roster grid.
 *
 * Delegate host that mounts EnhancedAddShiftModal driven by the global Zustand
 * store (useShiftFormModalStore / useShiftFormNav).
 */

import React from 'react';
import { EnhancedAddShiftModal } from './index';
import { useShiftFormModalStore } from '../../../state/useShiftFormModalStore';

export const ShiftWizardModal: React.FC = () => {
    const isOpen = useShiftFormModalStore((s) => s.isOpen);
    const opts = useShiftFormModalStore((s) => s.opts);
    const close = useShiftFormModalStore((s) => s.close);

    if (!isOpen || !opts) return null;
    return (
        <EnhancedAddShiftModal
            key={opts.existingShift?.id ?? 'new'}
            isOpen={isOpen}
            onClose={close}
            context={opts.context}
            editMode={opts.editMode}
            existingShift={opts.existingShift}
            isTemplateMode={opts.isTemplateMode}
        />
    );
};

export default ShiftWizardModal;

