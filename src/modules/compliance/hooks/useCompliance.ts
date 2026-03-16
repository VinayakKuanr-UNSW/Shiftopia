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

interface UseComplianceOptions {
    debounceMs?: number;   // Debounce delay in ms (default: 300)
}

interface UseComplianceReturn {
    result: ComplianceCheckResult | null;
    loading: boolean;
    error: Error | null;
    check: (input: ComplianceCheckInput) => Promise<ComplianceCheckResult>;
    reset: () => void;
}


export function useCompliance(options: UseComplianceOptions = {}): UseComplianceReturn {
    const { debounceMs = 300 } = options;

    const [result, setResult] = useState<ComplianceCheckResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // For debouncing
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


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
    }, [debounceMs]);

    const reset = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        setResult(null);
        setError(null);
        setLoading(false);
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
    shiftId?: string;
}): ComplianceCheckInput {
    return {
        employee_id: params.employeeId,
        action_type: params.actionType,
        candidate_shift: params.candidateShift,
        existing_shifts: params.existingShifts,
        shift_id: params.shiftId
    };
}

/**
 * Immediate check without debounce (for form submission)
 */
export function checkComplianceNow(input: ComplianceCheckInput): ComplianceCheckResult {
    return checkCompliance(input);
}

export default useCompliance;
