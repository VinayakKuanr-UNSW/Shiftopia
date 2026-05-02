import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supervisorFeedbackQueries } from '../api/supervisorFeedback.queries';
import type {
    CreateFeedbackInput,
    FeedbackBucketKey,
    SupervisorFeedbackRow,
} from '../api/supervisorFeedback.dto';
import {
    computeFeedbackMultiplier,
    type FeedbackMultiplierConfig,
    type FeedbackMultiplierResult,
} from '../domain/feedbackMultiplier';

/**
 * Demand Engine L5 — TanStack Query hooks for supervisor feedback.
 *
 * Three hooks:
 *   - useEventFeedback(eventId)     — feedback rows for one event
 *   - useFeedbackMultiplier(bucket) — multiplier for one (function, level) bucket
 *   - useSubmitFeedback()           — mutation to insert a row
 */

export const supervisorFeedbackKeys = {
    all: ['supervisor_feedback'] as const,
    byEvent: (eventId: string) => ['supervisor_feedback', 'byEvent', eventId] as const,
    byBucket: (functionCode: string, level: number, ruleVersion?: number, limit?: number) =>
        [
            'supervisor_feedback',
            'byBucket',
            functionCode,
            level,
            ruleVersion ?? null,
            limit ?? null,
        ] as const,
} as const;

export function useEventFeedback(eventId: string | null | undefined) {
    return useQuery<SupervisorFeedbackRow[], Error>({
        queryKey: eventId ? supervisorFeedbackKeys.byEvent(eventId) : ['supervisor_feedback', 'byEvent', 'null'],
        queryFn: () => supervisorFeedbackQueries.listForEvent(eventId!),
        enabled: !!eventId,
        staleTime: 30_000,
    });
}

export interface UseFeedbackMultiplierOptions extends FeedbackBucketKey {
    /** Trailing window size (default 10). */
    limit?: number;
    /** Restrict to a specific rule generation. */
    ruleVersion?: number;
    /** Override accumulator coefficients (rare; for tuning UIs). */
    config?: FeedbackMultiplierConfig;
    /** Disable the query (e.g., when bucket isn't selected yet). */
    enabled?: boolean;
}

/**
 * Reads the trailing feedback window for a bucket and runs the accumulator.
 * Returns multiplier + provenance (which rows contributed, with weights).
 */
export function useFeedbackMultiplier(opts: UseFeedbackMultiplierOptions) {
    return useQuery<FeedbackMultiplierResult, Error>({
        queryKey: supervisorFeedbackKeys.byBucket(
            opts.function_code,
            opts.level,
            opts.ruleVersion,
            opts.limit,
        ),
        queryFn: async () => {
            const rows = await supervisorFeedbackQueries.listForBucket({
                function_code: opts.function_code,
                level: opts.level,
                limit: opts.limit ?? 10,
                ruleVersion: opts.ruleVersion,
            });
            return computeFeedbackMultiplier(rows, opts.config);
        },
        enabled: opts.enabled ?? true,
        staleTime: 60_000,
    });
}

export function useSubmitFeedback() {
    const queryClient = useQueryClient();

    return useMutation<SupervisorFeedbackRow, Error, CreateFeedbackInput>({
        mutationFn: (input) => supervisorFeedbackQueries.create(input),
        onSuccess: (row) => {
            // Invalidate the event view and the bucket the row contributes to.
            if (row.event_id) {
                queryClient.invalidateQueries({
                    queryKey: supervisorFeedbackKeys.byEvent(row.event_id),
                });
            }
            queryClient.invalidateQueries({
                queryKey: ['supervisor_feedback', 'byBucket', row.function_code, row.level],
            });
        },
    });
}
