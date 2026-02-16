/**
 * Compliance API - Audit Logging
 * 
 * Functions for logging compliance checks to the database.
 */

import { supabase } from '@/platform/realtime/client';
import {
    ComplianceCheckInput,
    ComplianceCheckResult,
    ComplianceAuditEntry
} from '../types';

/**
 * Log a compliance check to the audit table
 */
export async function logComplianceCheck(
    input: ComplianceCheckInput,
    result: ComplianceCheckResult,
    shiftId?: string
): Promise<string | null> {
    try {
        const { data, error } = await supabase.rpc('log_compliance_check', {
            p_employee_id: input.employee_id,
            p_action_type: input.action_type,
            p_shift_id: shiftId || null,
            p_candidate_shift: input.candidate_shift,
            p_results: result.results,
            p_passed: result.passed
        });

        if (error) {
            console.error('[Compliance] Failed to log check:', error);
            return null;
        }

        return data as string;
    } catch (err) {
        console.error('[Compliance] Exception logging check:', err);
        return null;
    }
}

/**
 * Get compliance check history for an employee
 */
export async function getComplianceHistory(
    employeeId: string,
    limit = 50
): Promise<ComplianceAuditEntry[]> {
    const { data, error } = await supabase
        .from('compliance_checks')
        .select('*')
        .eq('employee_id', employeeId)
        .order('performed_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[Compliance] Failed to fetch history:', error);
        return [];
    }

    return (data || []).map(row => ({
        id: row.id,
        employee_id: row.employee_id,
        action_type: row.action_type,
        shift_id: row.shift_id,
        candidate_shift: row.candidate_shift,
        results: row.results,
        passed: row.passed,
        performed_at: row.performed_at,
        performed_by: row.performed_by
    }));
}

/**
 * Get recent failed compliance checks (for admin dashboard)
 */
export async function getRecentFailedChecks(limit = 20): Promise<ComplianceAuditEntry[]> {
    const { data, error } = await supabase
        .from('compliance_checks')
        .select('*')
        .eq('passed', false)
        .order('performed_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[Compliance] Failed to fetch failed checks:', error);
        return [];
    }

    return (data || []).map(row => ({
        id: row.id,
        employee_id: row.employee_id,
        action_type: row.action_type,
        shift_id: row.shift_id,
        candidate_shift: row.candidate_shift,
        results: row.results,
        passed: row.passed,
        performed_at: row.performed_at,
        performed_by: row.performed_by
    }));
}
