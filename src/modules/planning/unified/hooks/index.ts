/**
 * Unified Planning Hooks — Barrel Export
 *
 * All hooks for the unified planning request system are exported from this
 * single entry point.  Internal implementation details are not re-exported.
 *
 * Data-fetching hooks:
 *   usePlanningRequest        — single request + its offers (real-time aware)
 *   usePlanningRequests       — paginated list with dynamic filters
 *   useBulkPlanningCompliance — advisory compliance for BID / SWAP UI
 *
 * Mutation hooks (all return { execute, isLoading, error, reset }):
 *   useCreatePlanningRequest
 *   useSubmitOffer
 *   useWithdrawOffer
 *   useSelectOffer
 *   useCancelRequest
 *   useReopenRequest
 *   useApproveRequest
 *   useRejectRequest
 *
 * Types re-exported for convenience:
 *   UsePlanningRequestsFilters
 *   PlanningComplianceAdvisory
 */

// Data-fetching hooks
export { usePlanningRequest }        from './usePlanningRequest';
export type { UsePlanningRequestResult } from './usePlanningRequest';

export { usePlanningRequests, planningRequestKeys } from './usePlanningRequests';
export type {
  UsePlanningRequestsFilters,
  UsePlanningRequestsResult,
} from './usePlanningRequests';

export { useBulkPlanningCompliance } from './useBulkPlanningCompliance';
export type {
  PlanningComplianceAdvisory,
  UseBulkPlanningComplianceParams,
  UseBulkPlanningComplianceResult,
} from './useBulkPlanningCompliance';

// Mutation hooks
export {
  useCreatePlanningRequest,
  useSubmitOffer,
  useWithdrawOffer,
  useSelectOffer,
  useCancelRequest,
  useReopenRequest,
  useApproveRequest,
  useRejectRequest,
} from './usePlanningActions';
