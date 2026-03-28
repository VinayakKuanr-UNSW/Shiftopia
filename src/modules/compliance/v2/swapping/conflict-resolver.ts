/**
 * Two-Way Swap Engine — Inter-Swap Conflict Resolver
 *
 * Handles the case where the SAME SHIFT appears in more than one swap request.
 *
 * Why this happens:
 *   An employee or manager may submit multiple swap requests for the same
 *   shift (e.g., employee A bids to swap shift_X with employee B AND with
 *   employee C). Only ONE can proceed — once shift_X changes hands the
 *   others become structurally invalid.
 *
 * Detection:
 *   Build a Map<shift_id, SwapRequest[]>.
 *   Any shift_id that appears in 2+ swaps triggers a conflict.
 *   Both the "given" side (shift_x_id / shift_y_id) and the "received"
 *   side are indexed — once a shift is committed to one swap it is
 *   unavailable for any other.
 *
 * Resolution (priority-based):
 *   1. Among conflicting swaps, keep the one with the highest priority.
 *   2. Tiebreaker: APPROVED status > REQUESTED; then swap_id lexicographic.
 *   3. All other conflicting swaps are rejected with a descriptive reason.
 *
 * This is an O(n) pass over the swap list using a Map — well within
 * the 100+ swap performance target.
 */

import type {
    SwapRequest,
    ConflictResolutionResult,
    InterSwapConflict,
} from './types';
import type { ShiftId } from '../types';

// =============================================================================
// RESOLUTION
// =============================================================================

function swapScore(swap: SwapRequest): number {
    // Higher = wins conflict. APPROVED beats REQUESTED.
    const status_bonus = swap.status === 'APPROVED' ? 10_000 : 0;
    return swap.priority + status_bonus;
}

export function resolveInterSwapConflicts(
    swaps: SwapRequest[],
): ConflictResolutionResult {
    // Map each shift_id → the best (winning) swap that references it
    const shift_to_winner = new Map<ShiftId, SwapRequest>();

    // First pass: determine winner for each shift
    for (const swap of swaps) {
        for (const sid of [swap.shift_x_id, swap.shift_y_id]) {
            const current_winner = shift_to_winner.get(sid);
            if (!current_winner) {
                shift_to_winner.set(sid, swap);
            } else {
                const current_score = swapScore(current_winner);
                const new_score     = swapScore(swap);

                if (
                    new_score > current_score ||
                    (new_score === current_score && swap.swap_id < current_winner.swap_id)
                ) {
                    shift_to_winner.set(sid, swap);
                }
            }
        }
    }

    // Second pass: determine which swaps are clean
    // A swap is clean only if it is the winner for BOTH of its shifts.
    const clean:      SwapRequest[]        = [];
    const conflicted: InterSwapConflict[]  = [];

    for (const swap of swaps) {
        const winner_x = shift_to_winner.get(swap.shift_x_id);
        const winner_y = shift_to_winner.get(swap.shift_y_id);

        const lost_x = winner_x && winner_x.swap_id !== swap.swap_id;
        const lost_y = winner_y && winner_y.swap_id !== swap.swap_id;

        if (!lost_x && !lost_y) {
            clean.push(swap);
        } else {
            const winning_swap_id = (lost_x ? winner_x : winner_y)!.swap_id;
            const shift_desc = [
                lost_x ? `shift ${swap.shift_x_id}` : null,
                lost_y ? `shift ${swap.shift_y_id}` : null,
            ].filter(Boolean).join(' and ');

            conflicted.push({
                rejected_swap_id: swap.swap_id,
                winner_swap_id:   winning_swap_id,
                reason:
                    `Swap ${swap.swap_id} conflicts with higher-priority swap ${winning_swap_id}: `
                    + `${shift_desc} is already committed to another swap.`,
            });
        }
    }

    return { clean, conflicted };
}
