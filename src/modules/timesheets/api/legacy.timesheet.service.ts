
import { Timesheet, AuditEvent, timesheetReadApi, timesheetWriteApi, auditsApi } from '../index';

export const timesheetService = {
    /* ----------------------------- READERS ------------------------- */

    getAllTimesheets: async (): Promise<Timesheet[]> =>
        timesheetReadApi.getAllTimesheets(),

    getTimesheetsByDateRange: async (
        startDate: string,
        endDate: string,
    ): Promise<Timesheet[]> =>
        timesheetReadApi.getTimesheetsByDateRange(startDate, endDate),

    getTimesheetByDate: async (date: string): Promise<Timesheet | null> =>
        timesheetReadApi.getTimesheetByDate(date),

    /* ----------------------------- WRITERS ------------------------- */

    updateTimesheet: async (
        date: string,
        updates: Partial<Timesheet>,
    ): Promise<Timesheet | null> => {
        // Legacy updateTimesheet just overwrote fields. 
        // In the new world, we should discourage this, but for the bridge, we use a generic internal method if available, 
        // or map it to a specific status update if that's what's happening.
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts) return null;

        // If it's a status update, use the proper write API
        if (updates.status) {
            return timesheetWriteApi.updateTimesheetStatus(ts.id, updates.status as any, 'system-bridge');
        }

        // Otherwise, direct update for non-status fields (with warning)
        console.warn('Direct timesheet update via bridge. Audit safety compromised.');
        const store = timesheetReadApi._getInternalStore();
        const idx = store.findIndex(t => t.id === ts.id);
        const updated = { ...store[idx], ...updates, updatedAt: new Date().toISOString() };
        store[idx] = updated;
        timesheetReadApi._setInternalStore(store);
        return updated;
    },

    /* --------------------- SHIFT‑LEVEL OPERATIONS ------------------ */

    updateShiftStatus: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        status: any,
    ): Promise<Timesheet | null> =>
        timesheetWriteApi.updateShiftStatus(date, groupId, subGroupId, shiftId, status),

    clockInShift: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        actualStartTime: string,
    ): Promise<Timesheet | null> => {
        // Map to specific logic in write API if available, or stay in bridge for now
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts || ts.status === 'LOCKED') return null;

        const store = timesheetReadApi._getInternalStore();
        const idx = store.findIndex(t => t.id === ts.id);
        const copy = JSON.parse(JSON.stringify(ts));
        const shift = copy.groups.find((g: any) => g.id === groupId)
            ?.subGroups.find((sg: any) => sg.id === subGroupId)
            ?.shifts.find((s: any) => s.id === shiftId);

        if (!shift || (shift.status !== 'Assigned' && shift.status !== 'Swapped')) return null;

        shift.actualStartTime = actualStartTime;
        shift.status = 'in-progress';
        copy.updatedAt = new Date().toISOString();
        store[idx] = copy;
        timesheetReadApi._setInternalStore(store);
        return copy;
    },

    clockOutShift: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        actualEndTime: string,
    ): Promise<Timesheet | null> => {
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts || ts.status === 'LOCKED') return null;

        const store = timesheetReadApi._getInternalStore();
        const idx = store.findIndex(t => t.id === ts.id);
        const copy = JSON.parse(JSON.stringify(ts));
        const shift = copy.groups.find((g: any) => g.id === groupId)
            ?.subGroups.find((sg: any) => sg.id === subGroupId)
            ?.shifts.find((s: any) => s.id === shiftId);

        if (!shift?.actualStartTime) return null;

        shift.actualEndTime = actualEndTime;
        shift.status = 'Completed';
        copy.updatedAt = new Date().toISOString();
        store[idx] = copy;
        timesheetReadApi._setInternalStore(store);
        return copy;
    },

    swapShift: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        newEmployeeId: string,
    ): Promise<Timesheet | null> => {
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts || ts.status === 'LOCKED') return null;

        const store = timesheetReadApi._getInternalStore();
        const idx = store.findIndex(t => t.id === ts.id);
        const copy = JSON.parse(JSON.stringify(ts));
        const shift = copy.groups.find((g: any) => g.id === groupId)
            ?.subGroups.find((sg: any) => sg.id === subGroupId)
            ?.shifts.find((s: any) => s.id === shiftId);

        if (!shift) return null;

        shift.employeeId = newEmployeeId;
        shift.status = 'Swapped';
        shift.actualStartTime = undefined;
        shift.actualEndTime = undefined;
        copy.updatedAt = new Date().toISOString();
        store[idx] = copy;
        timesheetReadApi._setInternalStore(store);
        return copy;
    },

    cancelShift: async (
        date: string,
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        reason?: string,
    ): Promise<Timesheet | null> => {
        const ts = await timesheetReadApi.getTimesheetByDate(date);
        if (!ts || ts.status === 'LOCKED') return null;

        const store = timesheetReadApi._getInternalStore();
        const idx = store.findIndex(t => t.id === ts.id);
        const copy = JSON.parse(JSON.stringify(ts));
        const shift = copy.groups.find((g: any) => g.id === groupId)
            ?.subGroups.find((sg: any) => sg.id === subGroupId)
            ?.shifts.find((s: any) => s.id === shiftId);

        if (!shift) return null;

        shift.status = 'Cancelled';
        shift.notes = reason;
        copy.updatedAt = new Date().toISOString();
        store[idx] = copy;
        timesheetReadApi._setInternalStore(store);
        return copy;
    },

    /* ----------------------------- AUDIT --------------------------- */

    getTimesheetAuditEvents: async (
        timesheetId: number,
    ): Promise<AuditEvent[]> =>
        auditsApi.getLegacyAuditEvents(timesheetId),
};
