/**
 * Unified Planning Request System — Public API
 *
 * Everything a consumer needs is exported from this single entry point.
 * Internal implementation details (input-builder, snapshot-builder, etc.)
 * are intentionally not re-exported — consumers interact only through
 * planningRequestService and the shared types below.
 */

export { planningRequestService } from './service/planning-request.service';

export type {
  PlanningRequest,
  PlanningOffer,
  PlanningRequestStatus,
  PlanningRequestType,
  OfferStatus,
  ShiftWorkflowStatus,
  BidComplianceSnapshot,
  SwapComplianceSnapshot,
  PlanningComplianceSnapshot,
  SelectOfferResult,
  BlockingHit,
  CreateRequestParams,
  SubmitOfferParams,
  SelectOfferParams,
  CancelRequestParams,
  ReopenRequestParams,
  ApproveRequestParams,
  RejectRequestParams,
} from './types';

export { isSwapSnapshot, isBidSnapshot, isStudentVisaEnforced } from './types';
