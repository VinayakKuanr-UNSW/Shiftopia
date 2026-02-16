import { useState, useCallback, useEffect } from 'react';
import {
    getRegisteredRules,
    runRule,
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult
} from '@/modules/compliance';

interface UseComplianceRunnerProps {
    buildComplianceInput: () => ComplianceCheckInput;
    hardValidation: HardValidationResult;
    setComplianceResults: (results: Record<string, ComplianceResult | null>) => void;
    needsRerun: boolean;
    setNeedsRerun: (needs: boolean) => void;
    setHasRun: (hasRun: boolean) => void;
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
        // Small delay to allow UI to update if needed, and to not block main thread immediately
        await new Promise(resolve => setTimeout(resolve, 10));

        try {
            const input = buildComplianceInput();
            const newResults: Record<string, ComplianceResult | null> = {};

            rules.forEach(rule => {
                newResults[rule.id] = runRule(rule.id, input);
            });

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
