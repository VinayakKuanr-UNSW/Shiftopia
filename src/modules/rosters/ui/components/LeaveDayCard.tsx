/**
 * A day the employee is on approved leave — the People mode day cell on the
 * Rosters page (moved from the Office page's grid, 2026-10-04).
 *
 * NOT A SHIFT CARD, and deliberately does not look like one. `SharedShiftCard`
 * is the vocabulary for "here is work" — times, breaks, net hours, pay. A leave
 * day has none of those and borrowing the shift card for it would invite the
 * reader to look for figures that do not exist. What matters is the leave TYPE
 * and that the day is closed to rostering.
 *
 * WHY THERE IS NEVER A SHIFT UNDERNEATH IT. Approving leave clears the
 * person's shifts on those days, at approval time — full-time shifts are
 * deleted, part-time and casual ones unassigned (D7, `approveLeaveRequest`).
 * So an approved leave day has no shift of theirs to show. If one ever appears
 * alongside, that is a conflict the approval path failed to clear, and the cell
 * says so rather than quietly hiding one of the two.
 */
import React from 'react';
import { CalendarOff, TriangleAlert } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { LEAVE_TYPE_LABELS } from '@/modules/leave/model/leave.types';
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { RawLeaveDay } from '@/modules/office/domain/types';

export interface LeaveDayCardProps {
    leave: RawLeaveDay;
    /**
     * True when a shift still exists on this day.
     *
     * Should be impossible — approval clears them — so it is rendered as the
     * anomaly it is rather than being silently preferred either way.
     */
    hasConflictingShift?: boolean;
}

export const LeaveDayCard: React.FC<LeaveDayCardProps> = ({ leave, hasConflictingShift }) => {
    const label = LEAVE_TYPE_LABELS[leave.leaveType] ?? leave.leaveType;

    return (
        <div
            className={cn(
                'h-full w-full rounded-xl p-3 flex flex-col gap-1.5',
                'border border-dashed',
                hasConflictingShift
                    ? 'border-red-500/50 bg-red-500/5'
                    : 'border-violet-400/40 bg-violet-400/5',
            )}
        >
            <div className="flex items-center gap-1.5">
                <CalendarOff
                    className={cn('h-3.5 w-3.5 shrink-0',
                        hasConflictingShift ? 'text-red-400' : 'text-violet-300')}
                    aria-hidden="true"
                />
                <span className={cn(
                    text.overlineBare,
                    hasConflictingShift ? 'text-red-400' : 'text-violet-300',
                )}>
                    On leave
                </span>
            </div>

            <div className={cn(text.body, 'font-semibold leading-tight')}>{label}</div>

            {/*
             * `credit` is how the day is treated against contracted ordinary
             * hours — the same classification the cycle ledger uses. Worth
             * stating here because it is the difference between a leave day that
             * discharges the contract and one that leaves a deficit.
             */}
            <div className={text.subtle}>
                {leave.credit === 'CREDITS'
                    ? 'Counts toward contracted hours'
                    : leave.credit === 'ELECTION'
                        // cl 55.1 / 58.2 let the employee elect to draw annual
                        // leave or be absent unpaid. Until that election is
                        // recorded, whether the day discharges the contract is
                        // genuinely unknown — so it says so rather than guessing.
                        ? 'Hours credit depends on an unrecorded election'
                        : 'Does not count toward contracted hours'}
            </div>

            {hasConflictingShift && (
                /*
                 * Its OWN provider, not an inherited one. Radix throws outright
                 * — "`Tooltip` must be used within `TooltipProvider`" — so a
                 * cell rendered anywhere without an ancestor provider would take
                 * the whole grid down with it, and the error boundary on this
                 * route is at the ROUTE. `SharedShiftCard` wraps its own for the
                 * same reason.
                 */
                <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="mt-auto inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-red-400 cursor-help">
                            <TriangleAlert className="h-2.5 w-2.5" />
                            Shift still rostered
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                        This day has approved leave AND a rostered shift. Approving leave
                        is supposed to clear the shifts it collides with, so this one was
                        written afterwards or the clearing failed. Remove the shift, or the
                        employee will be marked No-Show.
                    </TooltipContent>
                </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
};

export default LeaveDayCard;
