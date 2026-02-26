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

    /**
     * New 3-step validation:
     *  Step 1 (Schedule & Details): Schedule + Role + (optional requirements/notes)
     *  Step 2 (Assignment & Compliance): Compliance must pass
     *  Step 3 (Review Logs): Always valid
     */
    const isStepValid = (step: number): boolean => {
        let isValid = false;
        switch (step) {
            case 1: // Schedule & Details (merged old steps 1-4)
                isValid = tabCompletion.schedule && isNetLengthValid && !!watchRoleId;
                break;
            case 2: // Assignment & Compliance (merged old steps 2 employee + 5 compliance)
                if (isTemplateMode) {
                    isValid = true;
                } else {
                    isValid = complianceHasRun && !hasBlockingComplianceFailures;
                }
                break;
            case 3: // Review Logs
                isValid = true;
                break;
            default:
                isValid = false;
        }
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
