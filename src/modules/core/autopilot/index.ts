/**
 * AutoPilot — the shared "auto-decision" feature behind Swap Requests
 * (auto-approve), Open Bids (auto-assign) and Timesheets (auto-verify).
 *
 * A domain provides an {@link AutoPilotAdapter}; the generic control renders the
 * OFF / SHADOW / LIVE badge, policy popover and decision feed identically.
 */
export { AutoPilotControl } from './AutoPilotControl';
export { AutoPilotDecisionChip } from './AutoPilotDecisionChip';
export { useAutoPilot } from './useAutoPilot';
export {
    emptyPolicy,
    isDecisionRevertable,
    policyMode,
    type AutoPilotAdapter,
    type AutoPilotCopy,
    type AutoPilotDecision,
    type AutoPilotDecisionKind,
    type AutoPilotFieldType,
    type AutoPilotMode,
    type AutoPilotPolicy,
    type AutoPilotPolicyField,
} from './types';
