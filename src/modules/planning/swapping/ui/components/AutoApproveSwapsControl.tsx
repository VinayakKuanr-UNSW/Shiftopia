import React, { useMemo } from 'react';
import { AutoPilotControl, AutoPilotDecisionChip } from '@/modules/core/autopilot';
import { type SwapAutoDecision } from '../../api/swapPolicy.api';
import {
    createSwapAutoPilotAdapter,
    swapDecisionToAutoPilot,
    SWAP_AUTOPILOT_COPY,
} from '../../api/swapAutoPilot.api';

/**
 * Auto-Approve Swaps — now a thin wrapper over the shared AutoPilot control
 * (see `@/modules/core/autopilot`). Swaps, Timesheets and Bids all render the
 * same OFF/SHADOW/LIVE badge + policy popover + decision feed via a per-domain
 * adapter. This file preserves the original public API (`AutoApproveSwapsControl`
 * + `AutoDecisionChip`) so ManagerSwaps needs no changes.
 */

interface AutoApproveSwapsControlProps {
    organizationId?: string;
    /** auth user id — stamped as updated_by on the policy and as the revert actor */
    userId?: string | null;
    /** Called after a revert so the parent can refetch its request list. */
    onChanged?: () => void;
}

export const AutoApproveSwapsControl: React.FC<AutoApproveSwapsControlProps> = ({
    organizationId,
    userId,
    onChanged,
}) => {
    const adapter = useMemo(
        () => (organizationId ? createSwapAutoPilotAdapter({ organizationId, userId }) : null),
        [organizationId, userId],
    );
    if (!adapter) return null;
    return <AutoPilotControl adapter={adapter} onChanged={onChanged} />;
};

/** Per-request chip used by ManagerSwaps rows/cards — maps the raw swap decision. */
export const AutoDecisionChip: React.FC<{ decision: SwapAutoDecision }> = ({ decision }) => (
    <AutoPilotDecisionChip decision={swapDecisionToAutoPilot(decision)} copy={SWAP_AUTOPILOT_COPY} />
);
