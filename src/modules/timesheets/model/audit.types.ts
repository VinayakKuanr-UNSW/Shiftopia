/**
 * Audit Action Types for Timesheet lifecycle
 */
export type TimesheetAuditAction =
    | "CREATED"
    | "EDITED"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "LOCKED"

/**
 * Legacy Audit Status (from src/api/models/types.ts)
 */
export type LegacyAuditStatus =
    | 'created_draft'
    | 'assigned'
    | 'accepted'
    | 'in_progress'
    | 'completed'
    | 'approved_timesheet';

/**
 * Legacy Audit Event (from src/api/models/types.ts)
 */
export interface LegacyAuditEvent {
    id: string;
    status: LegacyAuditStatus;
    at: string;
    notes?: string;
}

/**
 * Immutable Audit Record
 */
export interface TimesheetAuditEntry {
    id: string
    timesheetId: string
    action: TimesheetAuditAction | LegacyAuditStatus
    performedBy: string // Employee ID
    performedAt: string // ISO Date
    reason?: string
    diff?: Record<string, unknown> // Store before/after for critical fields
    metadata?: {
        ipAddress?: string
        userAgent?: string
        version: number
    }
}
