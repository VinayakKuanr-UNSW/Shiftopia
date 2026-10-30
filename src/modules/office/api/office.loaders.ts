/**
 * Office — reading leave.
 *
 * READ-ONLY. The generator's loaders (eligibility, existing shifts, public
 * holidays) went with the Office generator; leave is what the rosters still
 * read here — People mode's leave overlay and the publish plan.
 *
 * PostgREST caution: one bad column name 400s the WHOLE select, and
 * react-query's `= []` default then renders it as an empty state — a silent
 * "nobody has any leave" rather than a visible error. Every select here lists
 * columns explicitly, never interpolates, and never carries a comment inside
 * the literal.
 */

import { supabase } from '@/platform/supabase/client';
import { LEAVE_POLICIES, resolveOrdinaryHoursCredit } from '@/modules/leave/domain/leave-policy';
import type { LeaveElectionMode, LeaveTypeCode } from '@/modules/leave/model/leave.types';
import type { RawLeaveDay } from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
   Leave
   ──────────────────────────────────────────────────────────────────────────── */

/** Expand a request's inclusive date range into per-day rows. */
function expandDates(startISO: string, endISO: string): string[] {
    const out: string[] = [];
    const start = new Date(`${startISO}T00:00:00Z`);
    const end = new Date(`${endISO}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

/**
 * Approved and pending leave, already classified against the policy table.
 *
 * `resolveOrdinaryHoursCredit` is what turns cl 55.1 / cl 58.2's election into
 * an answer — or leaves it 'ELECTION' when the election was never recorded.
 * Pending leave is returned too; `indexApprovedLeaveDays` keeps approved only.
 */
export async function loadLeaveDays(
    employeeIds: readonly string[],
    fromDate: string,
    toDate: string,
): Promise<Map<string, RawLeaveDay[]>> {
    const out = new Map<string, RawLeaveDay[]>();
    if (employeeIds.length === 0) return out;

    // `election_mode` arrives with migration 20260828100000. A database that
    // has not taken it yet would 400 the ENTIRE select on that one name, and
    // react-query's `= []` default would render that as "nobody has any leave"
    // -- which silently removes every leave credit and over-rosters the whole
    // team. So the column is requested, and its absence is retried around
    // rather than allowed to fail open. Mirrors the same guard in
    // `compliance/employee-context.ts` for the work-cycle columns.
    const BASE_COLUMNS =
        'id, employee_id, leave_type, start_date, end_date, status, requested_hours';

    let rows: Array<Record<string, unknown>>;
    const withElection = await supabase
        .from('leave_requests')
        .select(`${BASE_COLUMNS}, election_mode`)
        .in('employee_id', employeeIds as string[])
        .in('status', ['approved', 'pending'])
        .lte('start_date', `${toDate}T23:59:59Z`)
        .gte('end_date', `${fromDate}T00:00:00Z`);

    if (withElection.error) {
        const fallback = await supabase
            .from('leave_requests')
            .select(BASE_COLUMNS)
            .in('employee_id', employeeIds as string[])
            .in('status', ['approved', 'pending'])
            .lte('start_date', `${toDate}T23:59:59Z`)
            .gte('end_date', `${fromDate}T00:00:00Z`);
        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as unknown as Array<Record<string, unknown>>;
    } else {
        rows = (withElection.data ?? []) as unknown as Array<Record<string, unknown>>;
    }

    for (const row of rows) {
        const employeeId = String(row.employee_id);
        const leaveType = String(row.leave_type) as LeaveTypeCode;
        const policy = LEAVE_POLICIES[leaveType];

        // An unknown leave type is a data problem, not a licence to guess. It
        // blocks the day (the person is absent) and credits nothing.
        const credit = policy
            ? resolveOrdinaryHoursCredit(policy, row.election_mode as LeaveElectionMode | null)
            : 'BLOCKS';

        const start = String(row.start_date ?? '').slice(0, 10);
        const end = String(row.end_date ?? '').slice(0, 10);

        for (const date of expandDates(start, end)) {
            if (date < fromDate || date > toDate) continue;
            const day: RawLeaveDay = {
                date,
                leaveType,
                credit,
                status: String(row.status) === 'approved' ? 'approved' : 'pending',
            };
            const bucket = out.get(employeeId);
            if (bucket) bucket.push(day);
            else out.set(employeeId, [day]);
        }
    }

    for (const bucket of out.values()) {
        bucket.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
    return out;
}
