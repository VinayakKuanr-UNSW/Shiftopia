/**
 * RosterModals — Centralised modal state owner for RostersPlannerPage.
 *
 * Holds all modal open/close state internally and exposes an imperative handle
 * so the parent page can trigger modals without lifting state. This removes 9
 * useState hooks and ~200 lines of modal JSX from RostersPlannerPage.
 *
 * Usage:
 *   const modalsRef = useRef<RosterModalsHandle>(null);
 *   modalsRef.current?.openAddShift(context);
 */

import React, { useState, forwardRef, useImperativeHandle } from 'react';

import {
    EnhancedAddShiftModal,
    ShiftContext,
} from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import {
    BulkAssignmentPanel,
    BulkAssignmentEmployee,
} from '@/modules/rosters/ui/dialogs/BulkAssignmentPanel';
import { AutoSchedulerPanel } from '@/modules/scheduling/ui/AutoSchedulerPanel';

// =============================================================================
// TYPES
// =============================================================================

interface AutoSchedulerShift {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    role_id: string | null;
    unpaid_break_minutes: number;
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | null;
}

interface RosterModalsProps {
    /** Shift IDs currently selected (forwarded to BulkAssignmentPanel). */
    selectedV8ShiftIds: string[];
    /** Employee list for BulkAssignmentPanel. */
    employees: BulkAssignmentEmployee[];
    /** Unassigned shifts for AutoSchedulerPanel. */
    autoSchedulerShifts: AutoSchedulerShift[];
    /** Employee summary for AutoSchedulerPanel. */
    autoSchedulerEmployees: Array<{ id: string; name: string; contract_type?: 'FT' | 'PT' | 'CASUAL' | null }>;
    /** Called when a shift is created or saved successfully. */
    onShiftSaved: () => void;
    /** Called after bulk assignment completes (clears selection). */
    onAssignComplete: () => void;
    /** Called after auto-scheduler finishes. */
    onAutoScheduleComplete: () => void;
}

/** Imperative handle — parent calls these to open modals. */
export interface RosterModalsHandle {
    openAddShift: (context: ShiftContext) => void;
    openEditShift: (shift: any, context: ShiftContext) => void;

    openBulkAssign: () => void;
    openAutoScheduler: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const RosterModals = forwardRef<RosterModalsHandle, RosterModalsProps>((
    {
        selectedV8ShiftIds,
        employees,
        autoSchedulerShifts,
        autoSchedulerEmployees,
        onShiftSaved,
        onAssignComplete,
        onAutoScheduleComplete,
    },
    ref,
) => {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addContext, setAddContext] = useState<ShiftContext | null>(null);

    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editShift, setEditShift] = useState<any>(null);
    const [editContext, setEditContext] = useState<ShiftContext | null>(null);


    const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
    const [isAutoSchedulerOpen, setIsAutoSchedulerOpen] = useState(false);

    useImperativeHandle(ref, () => ({
        openAddShift: (context) => {
            setAddContext(context);
            setIsAddOpen(true);
        },
        openEditShift: (shift, context) => {
            setEditShift(shift);
            setEditContext(context);
            setIsEditOpen(true);
        },

        openBulkAssign: () => setIsBulkAssignOpen(true),
        openAutoScheduler: () => setIsAutoSchedulerOpen(true),
    }));

    return (
        <>


            {/* Add Shift Modal */}
            <EnhancedAddShiftModal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onSuccess={onShiftSaved}
                context={addContext}
            />

            {/* Edit Shift Modal */}
            <EnhancedAddShiftModal
                isOpen={isEditOpen}
                onClose={() => setIsEditOpen(false)}
                onSuccess={onShiftSaved}
                context={editContext}
                editMode={true}
                existingShift={editShift}
            />

            {/* Auto-Scheduler Panel */}
            <AutoSchedulerPanel
                open={isAutoSchedulerOpen}
                onClose={() => setIsAutoSchedulerOpen(false)}
                shifts={autoSchedulerShifts}
                employees={autoSchedulerEmployees}
                onComplete={onAutoScheduleComplete}
            />

            {/* Bulk Assignment Panel */}
            <BulkAssignmentPanel
                open={isBulkAssignOpen}
                onClose={() => setIsBulkAssignOpen(false)}
                selectedV8ShiftIds={selectedV8ShiftIds}
                employees={employees}
                onAssignComplete={onAssignComplete}
            />
        </>
    );
});

RosterModals.displayName = 'RosterModals';
