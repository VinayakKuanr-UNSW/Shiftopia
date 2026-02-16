/**
 * useCompliance Hook
 * 
 * React hook for running compliance checks with:
 * - Automatic state management
 * - Debounced checks (prevents rapid re-checks)
 * - Idempotent logging (same input = no duplicate logs)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    ComplianceCheckInput,
    ComplianceCheckResult,
    ShiftTimeRange
} from '../types';
import { checkCompliance } from '../engine';
import { logComplianceCheck } from '../api/compliance.api';

interface UseComplianceOptions {
    autoLog?: boolean;     // Automatically log to database
    debounceMs?: number;   // Debounce delay in ms (default: 300)
}

interface UseComplianceReturn {
    result: ComplianceCheckResult | null;
    loading: boolean;
    error: Error | null;
    check: (input: ComplianceCheckInput) => Promise<ComplianceCheckResult>;
    reset: () => void;
}

/**
 * Hash an input for idempotency check
 */
function hashInput(input: ComplianceCheckInput): string {
    return JSON.stringify({
        e: input.employee_id,
        a: input.action_type,
        c: input.candidate_shift,
        x: input.existing_shifts_for_day.length
    });
}

export function useCompliance(options: UseComplianceOptions = {}): UseComplianceReturn {
    const { autoLog = false, debounceMs = 300 } = options;

    const [result, setResult] = useState<ComplianceCheckResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // For debouncing
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // For idempotency - track last logged input hash
    const lastLoggedHash = useRef<string | null>(null);

    // Cleanup debounce on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    const check = useCallback(async (input: ComplianceCheckInput): Promise<ComplianceCheckResult> => {
        // Clear any pending debounced check
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        return new Promise((resolve, reject) => {
            // Debounce the check
            debounceRef.current = setTimeout(async () => {
                setLoading(true);
                setError(null);

                try {
                    // Run compliance checks (synchronous, pure function)
                    const checkResult = checkCompliance(input);
                    setResult(checkResult);

                    // Optionally log to database (with idempotency)
                    if (autoLog) {
                        const inputHash = hashInput(input);

                        // Only log if input changed
                        if (inputHash !== lastLoggedHash.current) {
                            await logComplianceCheck(input, checkResult);
                            lastLoggedHash.current = inputHash;
                        }
                    }

                    resolve(checkResult);
                } catch (err) {
                    const e = err as Error;
                    setError(e);
                    reject(e);
                } finally {
                    setLoading(false);
                }
            }, debounceMs);
        });
    }, [autoLog, debounceMs]);

    const reset = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        setResult(null);
        setError(null);
        setLoading(false);
        lastLoggedHash.current = null;
    }, []);

    return {
        result,
        loading,
        error,
        check,
        reset
    };
}

/**
 * Helper to build ComplianceCheckInput from shift data
 */
export function buildComplianceInput(params: {
    employeeId: string;
    actionType: 'add' | 'assign' | 'swap' | 'bid';
    candidateShift: ShiftTimeRange;
    existingShifts: ShiftTimeRange[];
}): ComplianceCheckInput {
    return {
        employee_id: params.employeeId,
        action_type: params.actionType,
        candidate_shift: params.candidateShift,
        existing_shifts: params.existingShifts
    };
}

/**
 * Immediate check without debounce (for form submission)
 */
export function checkComplianceNow(input: ComplianceCheckInput): ComplianceCheckResult {
    return checkCompliance(input);
}

export default useCompliance;
