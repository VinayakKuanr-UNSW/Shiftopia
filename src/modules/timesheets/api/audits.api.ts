import { TimesheetAuditEntry, TimesheetAuditAction, LegacyAuditEvent } from '../model/audit.types';

/**
 * Audit Log Store (Mock Data)
 */
let auditLogs: TimesheetAuditEntry[] = [];

/**
 * Audit Trail API
 * Append-only access to timesheet history.
 */
export const auditsApi = {
    /**
     * Log an action to the audit trail
     */
    logAction: async (entry: Omit<TimesheetAuditEntry, 'id'>): Promise<TimesheetAuditEntry> => {
        const newEntry: TimesheetAuditEntry = {
            ...entry,
            id: Math.random().toString(36).substr(2, 9),
        };

        auditLogs.push(newEntry);
        console.log(`[Audit] ${entry.action} on timesheet ${entry.timesheetId} by ${entry.performedBy}`);

        return Promise.resolve(newEntry);
    },

    /**
     * Get all audit entries for a specific timesheet
     */
    getAuditTrail: async (timesheetId: string): Promise<TimesheetAuditEntry[]> => {
        return Promise.resolve(auditLogs.filter(log => log.timesheetId === timesheetId));
    },

    /**
     * Legacy bridge for getting audit events
     */
    getLegacyAuditEvents: async (timesheetId: string | number): Promise<LegacyAuditEvent[]> => {
        // This would typically fetch from a legacy table or map the new audit logs
        return Promise.resolve([]);
    }
};
