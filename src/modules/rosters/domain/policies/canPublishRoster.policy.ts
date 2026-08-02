/**
 * Can Publish Roster Policy
 * Domain layer - determines if a roster can be published
 */

import { supabase } from '@/platform/supabase/client';

export interface CanPublishRosterInput {
    rosterId: string;
    rosterStatus: 'draft' | 'published';
}

export interface CanPublishRosterOutput {
    canPublish: boolean;
    reason?: string;
    validationErrors?: string[];
    /** cl 38.1 — set when publishing inside the 7-day notice window. Advisory only: never blocks. */
    noticeWarning?: string;
}

/** cl 38.1 — rosters should be published at least this many days before they start. */
const ROSTER_NOTICE_DAYS = 7;

/**
 * cl 38.1: "A copy of the roster will be provided to Team Members a minimum
 * of seven (7) days in advance of the roster commencement date." Audit
 * H-4: this had zero notice-period logic anywhere. Advisory (never
 * blocking) because the clause itself contemplates emergencies, and a hard
 * block here would stop legitimate last-minute operational rostering — the
 * same WARNING-not-BLOCKING posture the V8 compliance rules use for
 * procedural (as opposed to hard numeric-cap) requirements.
 */
export function checkRosterPublishNotice(
    rosterStartDate: string,
    publishDate: Date = new Date(),
): string | undefined {
    const start = new Date(rosterStartDate + 'T00:00:00');
    if (Number.isNaN(start.getTime())) return undefined;
    const daysNotice = Math.floor((start.getTime() - publishDate.getTime()) / 86_400_000);
    if (daysNotice < ROSTER_NOTICE_DAYS) {
        return daysNotice < 0
            ? `This roster starts in the past relative to the publish date — cl 38.1 requires ${ROSTER_NOTICE_DAYS} days' notice.`
            : `Only ${daysNotice} day${daysNotice === 1 ? '' : 's'}' notice before this roster starts — cl 38.1 requires ${ROSTER_NOTICE_DAYS} days. Publishing is still allowed (e.g. for a genuine operational need), but confirm this is intentional.`;
    }
    return undefined;
}

/**
 * Check if a roster can be published
 *
 * Rules:
 * - Already published rosters cannot be republished
 * - Roster must have at least one shift
 * - All shifts must have required fields filled
 */
export async function canPublishRoster(
    input: CanPublishRosterInput
): Promise<CanPublishRosterOutput> {
    const { rosterId, rosterStatus } = input;

    // Rule 1: Already published
    if (rosterStatus === 'published') {
        return {
            canPublish: false,
            reason: 'This roster is already published.',
        };
    }

    // Get roster details
    const { data: rosterRaw, error: rosterError } = await supabase
        .from('rosters')
        .select('department_id, sub_department_id, start_date')
        .eq('id', rosterId)
        .single();

    const roster = rosterRaw as any;
    if (rosterError || !roster) {
        return {
            canPublish: false,
            reason: 'Could not find roster.',
        };
    }

    // Get shifts for this roster
    const { data: shifts, error: shiftsError } = await supabase
        .from('shifts')
        .select('id, start_time, end_time, role_id, is_draft')
        .eq('department_id', roster.department_id)
        .eq('sub_department_id', roster.sub_department_id)
        .eq('shift_date', roster.start_date)
        .eq('is_draft', true);

    if (shiftsError) {
        return {
            canPublish: false,
            reason: 'Could not validate shifts.',
        };
    }

    // Rule 2: Must have shifts
    if (!shifts || shifts.length === 0) {
        return {
            canPublish: false,
            reason: 'Roster has no draft shifts to publish.',
        };
    }

    // Rule 3: Validate each shift
    const validationErrors: string[] = [];

    shifts.forEach((shift, index) => {
        if (!shift.start_time || !shift.end_time) {
            validationErrors.push(`Shift ${index + 1}: Missing start or end time`);
        }
    });

    if (validationErrors.length > 0) {
        return {
            canPublish: false,
            reason: 'Some shifts have validation errors.',
            validationErrors,
        };
    }

    return {
        canPublish: true,
        noticeWarning: checkRosterPublishNotice(roster.start_date),
    };
}
