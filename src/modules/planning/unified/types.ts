/**
 * Unified Planning Request System — Core Types
 *
 * Single source of truth for all types used across the unified planning
 * request system. Covers bids, swaps, compliance snapshots, and every
 * service function's parameter and return shapes.
 */

import type { V8Status } from '@/modules/compliance/v8/types';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';

// Re-export for consumers who import from this module

// =============================================================================
// ENUMERATIONS
// =============================================================================

/**
 * Lifecycle states for a PlanningRequest.
 * There is no EVALUATING state — compliance is always run synchronously
 * within selectOffer() and the result stored atomically.
 */
type PlanningRequestStatus =
  | 'OPEN'            // Accepting offers
  | 'MANAGER_PENDING' // Offer selected, awaiting manager decision
  | 'APPROVED'        // Manager approved; shift ownership transferred
  | 'REJECTED'        // Manager rejected
  | 'BLOCKED'         // Compliance blocked; no viable offer
  | 'CANCELLED'       // Initiator cancelled before decision
  | 'EXPIRED';        // System-expired after shift start time passed

type PlanningRequestType = 'BID' | 'SWAP';

type OfferStatus =
  | 'SUBMITTED'  // Waiting for selection
  | 'SELECTED'   // Chosen by initiator; awaiting manager
  | 'REJECTED'   // Either compliance-blocked or manager-rejected
  | 'WITHDRAWN'; // Withdrawn by the offerer

// =============================================================================
// DATABASE ROW TYPES  (snake_case, mirrors table columns exactly)
// =============================================================================

export interface PlanningRequest {
  id: string;
  type: PlanningRequestType;
  status: PlanningRequestStatus;
  shift_id: string;
  initiated_by: string;
  target_employee_id: string | null;
  reason: string | null;
  compliance_snapshot: PlanningComplianceSnapshot | null;
  compliance_evaluated_at: string | null;
  manager_id: string | null;
  manager_notes: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningOffer {
  id: string;
  request_id: string;
  offered_by: string;
  offered_shift_id: string | null;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// COMPLIANCE SNAPSHOTS
// =============================================================================

/**
 * Compliance snapshot stored when a BID offer is selected.
 * Extends V8OrchestratorResult with two timestamp fields used for
 * optimistic locking during approval.
 */
interface BidComplianceSnapshot extends V8OrchestratorResult {
  /** ISO timestamp of shifts.updated_at captured just before compliance run */
  shift_updated_at: string;
  /** ISO timestamp of when runV8Orchestrator() was called */
  evaluated_at: string;
}

/**
 * Compliance snapshot stored when a SWAP offer is selected.
 * Holds per-party results and both shift timestamps for optimistic
 * locking during manager approval.
 */
interface SwapComplianceSnapshot {
  combined_status: V8Status;
  party_a: V8OrchestratorResult;
  party_b: V8OrchestratorResult;
  /** shifts.updated_at for the requester's shift (shift_id on the request) */
  shift_updated_at: string;
  /** shifts.updated_at for the offerer's shift (offered_shift_id on the offer) */
  target_shift_updated_at: string;
  /** ISO timestamp of when runV8Orchestrator() was called for both parties */
  evaluated_at: string;
}

type PlanningComplianceSnapshot = BidComplianceSnapshot | SwapComplianceSnapshot;










// =============================================================================
// TYPE GUARDS
// =============================================================================



