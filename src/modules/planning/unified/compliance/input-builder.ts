/**
 * Unified Planning — Compliance Input Builder
 *
 * Constructs ComplianceInputV2 objects for the compliance engine.
 * This module contains ONLY input construction — no rule evaluation,
 * no DB calls, no side effects. It is a pure data-transformation layer.
 *
 * Architecture:
 *   buildBidInput()   — builds input for a single employee bidding on a shift
 *   buildSwapInputs() — builds inputs for BOTH swap parties simultaneously
 *   deriveStage()     — maps shift lifecycle state to the engine's Stage type
 *   resolveCandidateShiftId() — extracts the correct shift ID per request type
 */

import type {
  ComplianceInputV2,
  ShiftV2,
  OperationType,
  Stage,
  EmployeeContextV2,
} from '@/modules/compliance/v2/types';

import type { PlanningRequest, PlanningOffer } from '../types';

// =============================================================================
// STAGE DERIVATION
// =============================================================================

/**
 * Maps a shift's lifecycle/published state to the compliance engine's Stage type.
 *
 * Stage semantics:
 *   DRAFT   — shift is unpublished; softer severity thresholds apply
 *   LIVE    — shift is assigned and published; strictest enforcement
 *   PUBLISH — shift is published but not yet assigned (intermediate state)
 *
 * This controls the severity normalization matrix inside the engine.
 */
export function deriveStage(shift: {
  lifecycle_status?: string | null;
  is_published?: boolean | null;
}): Stage {
  const lifecycle = shift.lifecycle_status?.toLowerCase() ?? '';

  // Explicitly unpublished drafts get DRAFT stage
  if (lifecycle === 'draft' || lifecycle === 'unpublished' || shift.is_published === false) {
    return 'DRAFT';
  }

  // Assigned and published shifts are LIVE — highest enforcement
  if (lifecycle === 'assigned' || lifecycle === 'live' || lifecycle === 'confirmed') {
    return 'LIVE';
  }

  // Published but not yet assigned (open shifts for bidding)
  return 'PUBLISH';
}

// =============================================================================
// BID INPUT BUILDER
// =============================================================================

/**
 * Build the ComplianceInputV2 for a single employee bidding on an open shift.
 *
 * The candidate shift is the open shift being bid on (request.shift_id).
 * The bidder's existing shifts are passed as-is — no shifts are removed
 * for BID operations (the employee is gaining a shift, not swapping one).
 *
 * operation_type: 'BID'
 * mode:           'SIMULATED' (we test the hypothetical post-bid schedule)
 */
export function buildBidInput(params: {
  employeeId: string;
  employeeContext: EmployeeContextV2;
  existingShifts: ShiftV2[];
  candidateShift: ShiftV2;
  stage: Stage;
}): ComplianceInputV2 {
  const { employeeId, employeeContext, existingShifts, candidateShift, stage } = params;

  return {
    employee_id: employeeId,
    employee_context: employeeContext,
    existing_shifts: existingShifts,
    candidate_changes: {
      add_shifts: [candidateShift],
      remove_shifts: [],
    },
    mode: 'SIMULATED',
    operation_type: 'BID',
    stage,
    evaluation_reference_date: candidateShift.shift_date,
  };
}

// =============================================================================
// SWAP INPUT BUILDER
// =============================================================================

/**
 * Build ComplianceInputV2 objects for BOTH parties in a swap.
 *
 * Party A (initiator / requester):
 *   - Gains partyBShift (the shift being offered by the other party)
 *   - Loses partyAShift (their own shift that goes to party B)
 *
 * Party B (the offerer / respondent):
 *   - Gains partyAShift (what party A is trading away)
 *   - Loses partyBShift (their own shift that goes to party A)
 *
 * Both inputs are evaluated independently in the engine. The results are
 * then combined with combineSwapResults() to derive the joint status.
 *
 * operation_type: 'SWAP' for both parties
 * mode:           'SIMULATED'
 */
export function buildSwapInputs(params: {
  partyAEmployeeId: string;
  partyAContext: EmployeeContextV2;
  partyAExistingShifts: ShiftV2[];
  partyAShift: ShiftV2;       // The shift party A is giving up
  partyBEmployeeId: string;
  partyBContext: EmployeeContextV2;
  partyBExistingShifts: ShiftV2[];
  partyBShift: ShiftV2;       // The shift party B is giving up
  stage: Stage;
}): { inputA: ComplianceInputV2; inputB: ComplianceInputV2 } {
  const {
    partyAEmployeeId, partyAContext, partyAExistingShifts, partyAShift,
    partyBEmployeeId, partyBContext, partyBExistingShifts, partyBShift,
    stage,
  } = params;

  // Party A: removes their own shift, gains party B's shift
  const inputA: ComplianceInputV2 = {
    employee_id: partyAEmployeeId,
    employee_context: partyAContext,
    existing_shifts: partyAExistingShifts,
    candidate_changes: {
      add_shifts: [partyBShift],
      remove_shifts: [partyAShift.shift_id],
    },
    mode: 'SIMULATED',
    operation_type: 'SWAP',
    stage,
    evaluation_reference_date: partyBShift.shift_date,
  };

  // Party B: removes their own shift, gains party A's shift
  const inputB: ComplianceInputV2 = {
    employee_id: partyBEmployeeId,
    employee_context: partyBContext,
    existing_shifts: partyBExistingShifts,
    candidate_changes: {
      add_shifts: [partyAShift],
      remove_shifts: [partyBShift.shift_id],
    },
    mode: 'SIMULATED',
    operation_type: 'SWAP',
    stage,
    evaluation_reference_date: partyAShift.shift_date,
  };

  return { inputA, inputB };
}

// =============================================================================
// CANDIDATE SHIFT ID RESOLUTION
// =============================================================================

/**
 * Determine which shift ID is the "candidate" (the shift being added to
 * the evaluating employee's schedule) based on request type.
 *
 * BID:  candidateShiftId = request.shift_id
 *       (the open shift the bidder wants to acquire)
 *
 * SWAP: candidateShiftId = offer.offered_shift_id
 *       (the shift the offerer is proposing to trade away — which the
 *        initiator will gain — or the initiator's shift for party B's check)
 *
 * The service layer calls this to decide which shift to fetch and pass
 * to the input builders.
 */
export function resolveCandidateShiftId(
  request: PlanningRequest,
  offer: PlanningOffer,
): string {
  if (request.type === 'BID') {
    return request.shift_id;
  }

  // SWAP: the candidate for the initiator is what the offerer proposes
  if (!offer.offered_shift_id) {
    throw new Error(
      `SWAP offer ${offer.id} is missing offered_shift_id. ` +
      'All SWAP offers must reference a shift to trade.',
    );
  }

  return offer.offered_shift_id;
}
