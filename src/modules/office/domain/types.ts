/**
 * Office — the leave-day shape the rosters read.
 *
 * The Office generator and its pure calculator are gone (repeating FT shifts
 * come from an Office template now). What remains is the per-day leave row that
 * People mode's leave overlay and the publish plan consume.
 */

/**
 * A day the employee is absent, already classified.
 *
 * `credit` mirrors `LeavePolicy.ordinaryHoursCredit`. 'ELECTION' is carried
 * through rather than collapsed — the EBA gives the Team Member the choice and
 * we do not record which they made.
 */
export interface RawLeaveDay {
    date: string;
    leaveType: string;
    credit: 'CREDITS' | 'BLOCKS' | 'ELECTION';
    /** Approved leave binds; pending does not. */
    status: 'approved' | 'pending';
}
