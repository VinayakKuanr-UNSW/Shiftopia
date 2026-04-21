import { Timesheet, TimesheetStatus } from '../model/timesheet.types';
import { timesheetReadApi } from './timesheets.read.api';


/**
 * Valid Status Transitions
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
    'DRAFT': ['SUBMITTED'],
    'SUBMITTED': ['APPROVED', 'REJECTED', 'DRAFT'],
    'APPROVED': ['LOCKED', 'REJECTED'],
    'REJECTED': ['DRAFT'],
    'LOCKED': [], // Terminal state for payroll safety
};

/**
 * Write-only Timesheet API
 * Enforces state machine and record integrity.
 */
export const timesheetWriteApi = {
    updateTimesheetStatus: async (
        id: string | number,
        newStatus: TimesheetStatus,
        performedBy: string,
        reason?: string
    ): Promise<Timesheet | null> => {
        const timesheets = timesheetReadApi._getInternalStore();
        const idx = timesheets.findIndex(t => t.id === id);
        if (idx === -1) return null;

        const currentTs = timesheets[idx];
        const currentStatus = (currentTs.status as string).toUpperCase();

        // Validate transition
        if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
            throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}`);
        }

        const updated: Timesheet = {
            ...currentTs,
            status: newStatus,
            version: (currentTs.version || 1) + 1,
            updatedAt: new Date().toISOString(),
        } as any;

        timesheets[idx] = updated;
        timesheetReadApi._setInternalStore(timesheets);



        return updated;
    },

    updateShiftStatus: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        status: any
    ): Promise<Timesheet | null> => {
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts) return null;

        // Check if locked
        if (ts.status === 'LOCKED') {
            throw new Error('Cannot update shifts on a locked timesheet');
        }

        const timesheets = timesheetReadApi._getInternalStore();
        const idx = timesheets.findIndex(t => t.id === ts.id);
        const copy = JSON.parse(JSON.stringify(ts));

        const group = copy.groups.find((g: any) => g.id === groupId);
        const sub = group?.subGroups.find((sg: any) => sg.id === subGroupId);
        const shift = sub?.shifts.find((s: any) => s.id === shiftId);
        if (!shift) return null;

        shift.status = status;
        copy.updatedAt = new Date().toISOString();

        timesheets[idx] = copy;
        timesheetReadApi._setInternalStore(timesheets);
        return copy;
    },

    // Other shift-level operations (clock-in, clock-out, swap, cancel) 
    // would be implemented here similarly, with LOCK checks.
};
