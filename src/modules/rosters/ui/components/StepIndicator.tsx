/**
 * StepIndicator Component
 * 
 * Displays a horizontal progress indicator for the step-based shift flow.
 * Shows step numbers, current progress, and step names.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Check, Clock, Briefcase, FileText, Pencil, Shield, ClipboardList } from 'lucide-react';

export interface Step {
    id: number;
    name: string;
    icon: React.ReactNode;
}

export const SHIFT_STEPS: Step[] = [
    { id: 1, name: 'Schedule', icon: <Clock className="h-4 w-4" /> },
    { id: 2, name: 'Role', icon: <Briefcase className="h-4 w-4" /> },
    { id: 3, name: 'Requirements', icon: <FileText className="h-4 w-4" /> },
    { id: 4, name: 'Notes', icon: <Pencil className="h-4 w-4" /> },
    { id: 5, name: 'Compliance', icon: <Shield className="h-4 w-4" /> },
    { id: 6, name: 'Review Logs', icon: <ClipboardList className="h-4 w-4" /> },
];

interface StepIndicatorProps {
    currentStep: number;
    completedSteps: Set<number>;
    onStepClick?: (step: number) => void;
    disabled?: boolean;
}

export function StepIndicator({
    currentStep,
    completedSteps,
    onStepClick,
    disabled = false
}: StepIndicatorProps) {
    return (
        <div className="w-full">
            {/* Step circles with connecting lines */}
            <div className="flex items-center justify-between relative">
                {/* Background line */}
                <div className="absolute top-4 left-0 right-0 h-0.5 bg-white/10" />

                {/* Progress line */}
                <div
                    className="absolute top-4 left-0 h-0.5 bg-emerald-500 transition-all duration-300"
                    style={{
                        width: `${((currentStep - 1) / (SHIFT_STEPS.length - 1)) * 100}%`
                    }}
                />

                {SHIFT_STEPS.map((step, idx) => {
                    const isCompleted = completedSteps.has(step.id);
                    const isCurrent = currentStep === step.id;
                    const isPast = step.id < currentStep;
                    const canClick = !disabled && (isPast || isCurrent);

                    return (
                        <div
                            key={step.id}
                            className="flex flex-col items-center relative z-10"
                        >
                            {/* Step circle */}
                            <button
                                type="button"
                                onClick={() => canClick && onStepClick?.(step.id)}
                                disabled={!canClick}
                                className={cn(
                                    "h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200",
                                    "border-2 text-sm font-medium",
                                    isCurrent && "bg-emerald-500 border-emerald-500 text-white scale-110 shadow-lg shadow-emerald-500/30",
                                    isCompleted && !isCurrent && "bg-emerald-500/20 border-emerald-500 text-emerald-400",
                                    !isCurrent && !isCompleted && "bg-slate-800 border-white/20 text-white/40",
                                    canClick && !isCurrent && "hover:border-emerald-400 hover:text-emerald-400 cursor-pointer",
                                    !canClick && "cursor-not-allowed"
                                )}
                            >
                                {isCompleted && !isCurrent ? (
                                    <Check className="h-4 w-4" />
                                ) : (
                                    step.id
                                )}
                            </button>

                            {/* Step name */}
                            <span className={cn(
                                "mt-2 text-[10px] font-medium tracking-wide uppercase",
                                isCurrent && "text-emerald-400",
                                isCompleted && !isCurrent && "text-emerald-400/70",
                                !isCurrent && !isCompleted && "text-white/40"
                            )}>
                                {step.name}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default StepIndicator;
