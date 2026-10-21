/**
 * Build the toolbar Publish plan for the period on screen.
 *
 * Three rules, each a fix for something that went wrong:
 *  - The PERIOD is the one the dialog names (`computeRange`), never the grid's
 *    viewing window. Month view shows ±3 buffer days for continuity; those are
 *    for viewing only and are not published.
 *  - The read is STRICT (`getShiftsForDateRangeStrict`) and uncached: a failed
 *    or truncated read throws, so a write is never planned from part of the
 *    roster.
 *  - Shifts this manager may not publish where they sit are reported, not sent;
 *    one of them in the batch makes the server refuse all of it.
 */
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import type { ShiftFilters } from '@/modules/rosters/api/queryKeys';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { planPublishRoster, type PublishRosterPlan } from '@/modules/rosters/domain/bulk-action-engine';
import { computeRangeKeys, type ViewType } from '@/modules/rosters/domain/view-range';
import { loadLeaveDays } from '@/modules/office/api/office.loaders';
import { indexApprovedLeaveDays } from '@/modules/rosters/hooks/useApprovedLeaveDays';

export interface LoadPublishPlanInput {
    organizationId: string | null;
    selectedDate: Date;
    viewType: ViewType;
    filters?: ShiftFilters;
    /** May this manager publish this shift where it sits? Omitted ⇒ everywhere. */
    canPublishShift?: (shift: Shift) => boolean;
}

export interface LoadPublishPlanDeps {
    fetchShifts: typeof shiftsQueries.getShiftsForDateRangeStrict;
    loadLeave: typeof loadLeaveDays;
}

const defaultDeps: LoadPublishPlanDeps = {
    fetchShifts: (...args) => shiftsQueries.getShiftsForDateRangeStrict(...args),
    loadLeave: loadLeaveDays,
};

export const EMPTY_PUBLISH_PLAN: PublishRosterPlan = {
    assignedIds: [],
    unassignedIds: [],
    emergentAssignedIds: [],
    emergentUnassignedIds: [],
    deadIds: [],
    fullTimeIds: [],
    fullTimeUnassignedIds: [],
    onLeaveIds: [],
    pastIds: [],
    noPermissionIds: [],
    alreadyPublishedCount: 0,
};

export async function loadRosterPublishPlan(
    input: LoadPublishPlanInput,
    deps: LoadPublishPlanDeps = defaultDeps,
): Promise<PublishRosterPlan> {
    if (!input.organizationId) return EMPTY_PUBLISH_PLAN;

    const { startDate, endDate } = computeRangeKeys(input.selectedDate, input.viewType);
    const shifts = await deps.fetchShifts(input.organizationId, startDate, endDate, input.filters);

    // Approved leave for everyone assigned to a draft in the period, so the
    // dialog can say which shifts will be skipped for it (the database refuses them).
    const draftAssignees = [...new Set(shifts
        .filter(s => s.lifecycle_status === 'Draft' && s.assigned_employee_id)
        .map(s => s.assigned_employee_id as string))];
    let isOnApprovedLeave: ((employeeId: string, dateKey: string) => boolean) | undefined;
    if (draftAssignees.length > 0) {
        try {
            const leave = indexApprovedLeaveDays(await deps.loadLeave(draftAssignees, startDate, endDate));
            isOnApprovedLeave = (employeeId, dateKey) => Boolean(leave.get(employeeId)?.has(dateKey));
        } catch {
            // Unreadable leave only means the dialog cannot pre-announce those
            // skips; the database still refuses to publish onto approved leave.
        }
    }

    return planPublishRoster(shifts, isOnApprovedLeave, input.canPublishShift);
}
