import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supervisorFeedbackQueries } from '../api/supervisorFeedback.queries';
import type {
    CreateFeedbackInput,
    SupervisorFeedbackRow,
} from '../api/supervisorFeedback.dto';

/**
 * Demand Engine L5 — TanStack Query hooks for supervisor feedback.
 *
 * Three hooks:
 *   - useEventFeedback(eventId)     — feedback rows for one event
 *   - useFeedbackMultiplier(bucket) — multiplier for one (function, level) bucket
 *   - useSubmitFeedback()           — mutation to insert a row
 */

const supervisorFeedbackKeys = {
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
