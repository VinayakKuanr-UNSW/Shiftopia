/**
 * usePlanningActions
 *
 * One hook per mutating operation in the unified planning request system.
 * Every hook exposes a consistent shape:
 *
 *   { execute, isLoading, error, reset }
 *
 * `execute` is async and re-throws on error so the caller can handle display.
 * `reset`   clears the error state (useful for retrying after a failure).
 *
 * All business logic lives in the service layer (planningRequestService).
 * These hooks are purely orchestration — they call the service, manage loading
 * state, and re-throw errors.  No rule logic appears here.
 *
 * Hooks provided:
 *   useCreatePlanningRequest
 *   useSubmitOffer
 *   useWithdrawOffer
 *   useSelectOffer
 *   useCancelRequest
 *   useReopenRequest
 *   useApproveRequest
 *   useRejectRequest
 */

import { useState, useCallback } from 'react';
import { planningRequestService } from '@/modules/planning/unified';
import type {
  PlanningRequest,
  PlanningOffer,
  SelectOfferResult,
  CreateRequestParams,
  SubmitOfferParams,
  SelectOfferParams,
  CancelRequestParams,
  ReopenRequestParams,
  ApproveRequestParams,
  RejectRequestParams,
} from '../types';

// =============================================================================
// SHARED SHAPE
// =============================================================================

interface ActionHook<TParams, TResult> {
  execute: (params: TParams) => Promise<TResult>;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

// =============================================================================
// FACTORY  (keeps each hook DRY — only the service call differs)
// =============================================================================

function useAction<TParams, TResult>(
  serviceFn: (params: TParams) => Promise<TResult>,
): ActionHook<TParams, TResult> {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: TParams): Promise<TResult> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await serviceFn(params);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceFn],
  );

  const reset = useCallback((): void => {
    setError(null);
  }, []);

  return { execute, isLoading, error, reset };
}

// =============================================================================
// INDIVIDUAL HOOKS
// =============================================================================

/**
 * Open a new BID or SWAP planning request.
 *
 * Validates the shift is IDLE and not time-locked before inserting.
 * Updates shifts.workflow_status to OPEN_FOR_BIDS / OPEN_FOR_TRADE.
 */
export function useCreatePlanningRequest(): ActionHook<
  CreateRequestParams,
  PlanningRequest
> {
  return useAction<CreateRequestParams, PlanningRequest>(
    (params) => planningRequestService.createPlanningRequest(params),
  );
}

/**
 * Submit an offer on an OPEN planning request.
 *
 * For SWAP requests, `offered_shift_id` is required and must be owned
 * by the `offered_by` employee.
 */
export function useSubmitOffer(): ActionHook<SubmitOfferParams, PlanningOffer> {
  return useAction<SubmitOfferParams, PlanningOffer>(
    (params) => planningRequestService.submitOffer(params),
  );
}

/**
 * Withdraw a SUBMITTED offer.
 *
 * Only the offer owner can withdraw; only SUBMITTED offers are withdrawable.
 */
export function useWithdrawOffer(): ActionHook<
  { offerId: string; employeeId: string },
  void
> {
  return useAction<{ offerId: string; employeeId: string }, void>(
    (params) =>
      planningRequestService.withdrawOffer({
        offerId: params.offerId,
        employeeId: params.employeeId,
      }),
  );
}

/**
 * Select an offer as the winner and run compliance evaluation.
 *
 * The most significant action — compliance runs here. The result determines
 * whether the request advances to MANAGER_PENDING or is marked BLOCKED.
 */
export function useSelectOffer(): ActionHook<
  SelectOfferParams,
  SelectOfferResult
> {
  return useAction<SelectOfferParams, SelectOfferResult>(
    (params) => planningRequestService.selectOffer(params),
  );
}

/**
 * Cancel a planning request.
 *
 * Allowed from OPEN or MANAGER_PENDING.
 * Caller must be the request initiator.
 */
export function useCancelRequest(): ActionHook<
  CancelRequestParams,
  { cancelled_from: 'OPEN' | 'MANAGER_PENDING' }
> {
  return useAction<
    CancelRequestParams,
    { cancelled_from: 'OPEN' | 'MANAGER_PENDING' }
  >(
    (params) => planningRequestService.cancelRequest(params),
  );
}

/**
 * Reopen a BLOCKED, REJECTED, or EXPIRED planning request.
 *
 * Clears the compliance snapshot and restores all offers to SUBMITTED
 * so the initiator can re-evaluate the pool.
 */
export function useReopenRequest(): ActionHook<
  ReopenRequestParams,
  PlanningRequest
> {
  return useAction<ReopenRequestParams, PlanningRequest>(
    (params) => planningRequestService.reopenRequest(params),
  );
}

/**
 * Manager approves a MANAGER_PENDING request.
 *
 * Triggers a stale-compliance check (re-runs if snapshot > 15 min old)
 * then calls the atomic `sm_finalize_planning_request` RPC.
 *
 * Throws 'COMPLIANCE_NOW_BLOCKING' if a fresh re-check reveals new
 * violations, and 'SHIFT_MUTATED' if the shift was modified since the
 * compliance snapshot was taken.
 */
export function useApproveRequest(): ActionHook<
  ApproveRequestParams,
  PlanningRequest
> {
  return useAction<ApproveRequestParams, PlanningRequest>(
    (params) => planningRequestService.approveRequest(params),
  );
}

/**
 * Manager rejects a MANAGER_PENDING request.
 *
 * Marks the selected offer as REJECTED, resets the shift to IDLE,
 * and records manager_id, manager_notes, and decided_at on the request.
 */
export function useRejectRequest(): ActionHook<
  RejectRequestParams,
  PlanningRequest
> {
  return useAction<RejectRequestParams, PlanningRequest>(
    (params) => planningRequestService.rejectRequest(params),
  );
}
