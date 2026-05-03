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
    };
    isNetLengthValid: boolean;
    isMinLengthValid: boolean;
    watchV8RoleId: string;
    complianceHasRun: boolean;
    hardValidation: HardValidationResult;
    complianceResults: Record<string, ComplianceResult | null>;
    assignedEmployeeId?: string | null;
}

export function useStepNavigation({
    isTemplateMode,
    tabCompletion,
    isNetLengthValid,
    isMinLengthValid,
    watchV8RoleId,
    complianceHasRun,
    hardValidation,
    complianceResults,
    assignedEmployeeId,
}: UseStepNavigationProps) {
    const [currentStep, setCurrentStep] = useState<number>(1);
    const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

    // Step validation - determines if user can proceed to next step
    const hasBlockingComplianceFailures = useMemo(() => {
        if (!hardValidation.passed) return true;
        return Object.values(complianceResults).some(r => r?.status === 'fail' && r?.blocking);
    }, [hardValidation.passed, complianceResults]);

    /**
     * New 2-step validation:
     *  Step 1 (Schedule & Details): Schedule + Role + Length (net & min)
     *  Step 2 (Assignment & Compliance): Compliance must pass OR be Unassigned
     */
    const isStepValid = (step: number): boolean => {
        let isValid = false;
        switch (step) {
            case 1: // Schedule & Details
                // Relaxed: Role is required for Save, but let them go to Step 2 to see employees
                isValid = tabCompletion.schedule && isNetLengthValid && isMinLengthValid;
                break;
            case 2: // Assignment & Compliance
                if (isTemplateMode) {
                    isValid = true;
                } else {
                    const isUnassigned = !assignedEmployeeId;
                    isValid = isUnassigned ? true : (complianceHasRun && !hasBlockingComplianceFailures);
                }
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
