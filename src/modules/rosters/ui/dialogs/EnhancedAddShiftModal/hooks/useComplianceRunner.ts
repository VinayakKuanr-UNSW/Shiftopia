import { useState, useCallback } from 'react';
import {
    getRegisteredRules,
    runRule,
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult
} from '@/modules/compliance';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';

interface UseComplianceRunnerProps {
    buildComplianceInput: () => ComplianceCheckInput;
    hardValidation: HardValidationResult;
    setComplianceResults: (results: Record<string, ComplianceResult | null>) => void;
    needsRerun: boolean;
    setNeedsRerun: (needs: boolean) => void;
    setHasRun: (hasRun: boolean) => void;
}

/** Net minutes between two HH:MM times (handles overnight). */
function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

export function useComplianceRunner({
    buildComplianceInput,
    hardValidation,
    setComplianceResults,
    needsRerun,
    setNeedsRerun,
    setHasRun
}: UseComplianceRunnerProps) {
    const [isRunning, setIsRunning] = useState(false);
    const rules = getRegisteredRules();

    const runChecks = useCallback(async () => {
        setIsRunning(true);
        // Small delay to allow UI to update if needed
        await new Promise(resolve => setTimeout(resolve, 10));

        try {
            const input = buildComplianceInput();
            const newResults: Record<string, ComplianceResult | null> = {};

            // ── 1. Client-side rules (fast, uses local data) ──────────────────
            rules.forEach(rule => {
                newResults[rule.id] = runRule(rule.id, input);
            });

            // ── 2. Server-side authoritative checks (when employee assigned) ──
            // The client-side NO_OVERLAP rule relies on employeeExistingShifts
            // from a direct table query that is subject to RLS. The server-side
            // check_shift_overlap RPC is SECURITY DEFINER and sees ALL shifts for
            // the employee regardless of department scope. Always prefer the
            // server result to prevent a false PASS on the overlap check.
            if (input.employee_id && input.employee_id !== 'preview') {
                try {
                    const serverResult = await validateCompliance({
                        employeeId: input.employee_id,
                        shiftDate: input.candidate_shift.shift_date,
                        startTime: input.candidate_shift.start_time,
                        endTime: input.candidate_shift.end_time,
                        netLengthMinutes: calcNetMinutes(input.candidate_shift),
                        excludeShiftId: input.exclude_shift_id,
                    });

                    if (serverResult.checksPerformed.includes('overlap')) {
                        const hasOverlap = serverResult.violations.some(v =>
                            v.toLowerCase().includes('overlap')
                        );
                        newResults['NO_OVERLAP'] = {
                            rule_id: 'NO_OVERLAP',
                            rule_name: 'No Overlapping Shifts',
                            status: hasOverlap ? 'fail' : 'pass',
                            summary: hasOverlap
                                ? 'Employee already has a shift at this time'
                                : 'No overlapping shifts found',
                            details: hasOverlap
                                ? (serverResult.violations.find(v => v.toLowerCase().includes('overlap'))
                                    ?? 'Shift overlap detected in database')
                                : 'No overlapping shifts found.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                            blocking: true,
                        };
                    }
                } catch {
                    // Server unavailable — keep client-side result as best-effort
                }
            }

            setComplianceResults(newResults);
            setHasRun(true);
            setNeedsRerun(false);
        } catch (error) {
            console.error('[useComplianceRunner] Error running checks:', error);
        } finally {
            setIsRunning(false);
        }
    }, [buildComplianceInput, rules, setComplianceResults, setHasRun, setNeedsRerun]);

    return {
        runChecks,
        isRunning
    };
}
