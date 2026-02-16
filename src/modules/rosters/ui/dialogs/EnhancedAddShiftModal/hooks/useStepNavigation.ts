import { useState, useMemo } from 'react';
import { TOTAL_STEPS } from '../constants';
import { HardValidationResult, ComplianceResult } from '@/modules/compliance';

interface UseStepNavigationProps {
    isTemplateMode: boolean;
    tabCompletion: {
        schedule: boolean;
        role: boolean;
        requirements: boolean;
        notes: boolean;
        system: boolean;
        audit: boolean;
    };
    isNetLengthValid: boolean;
    watchRoleId: string;
    complianceHasRun: boolean;
    hardValidation: HardValidationResult;
    complianceResults: Record<string, ComplianceResult | null>;
}

export function useStepNavigation({
    isTemplateMode,
    tabCompletion,
    isNetLengthValid,
    watchRoleId,
    complianceHasRun,
    hardValidation,
    complianceResults,
}: UseStepNavigationProps) {
    const [currentStep, setCurrentStep] = useState<number>(1);
    const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

    // Step validation - determines if user can proceed to next step
    const hasBlockingComplianceFailures = useMemo(() => {
        if (!hardValidation.passed) return true;
        return Object.values(complianceResults).some(r => r?.status === 'fail' && r?.blocking);
    }, [hardValidation.passed, complianceResults]);

    const isStepValid = (step: number): boolean => {
        let isValid = false;
        switch (step) {
            case 1: // Schedule
                isValid = tabCompletion.schedule && isNetLengthValid;
                break;
            case 2: // Role
                isValid = !!watchRoleId;
                break;
            case 3: // Requirements
                isValid = true; // Optional
                break;
            case 4: // Notes
                isValid = true; // Optional
                break;
            case 5: // Compliance
                if (isTemplateMode) {
                    isValid = true;
                } else {
                    // Detailed logging for step 5 failure
                    if (!complianceHasRun) console.debug('[useStepNavigation] Step 5 Invalid: Compliance has not run');
                    if (hasBlockingComplianceFailures) console.debug('[useStepNavigation] Step 5 Invalid: Blocking failures present', hardValidation, complianceResults);

                    isValid = complianceHasRun && !hasBlockingComplianceFailures;
                }
                break;
            case 6: // Review Logs
                isValid = true;
                break;
            default:
                isValid = false;
        }
        // console.debug(`[useStepNavigation] Step ${step} valid?`, isValid);
        return isValid;
    };

    const handleNextStep = () => {
        if (currentStep < TOTAL_STEPS && isStepValid(currentStep)) {
            setCompletedSteps(prev => new Set([...prev, currentStep]));
            setCurrentStep(s => s + 1);
        }
    };

    const handlePrevStep = () => {
        if (currentStep > 1) {
            setCurrentStep(s => s - 1);
        }
    };

    const handleStepClick = (step: number) => {
        if (completedSteps.has(step) || step < currentStep) {
            setCurrentStep(step);
        }
    };

    return {
        currentStep,
        completedSteps,
        setCurrentStep,
        setCompletedSteps,
        handleNextStep,
        handlePrevStep,
        handleStepClick,
        isStepValid,
        hasBlockingComplianceFailures
    };
}
