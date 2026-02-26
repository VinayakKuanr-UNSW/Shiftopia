/**
 * StepIndicator — WCAG 2.1 AA compliant step progress component.
 *
 * Redesigned for 3-step flow:
 *   1. Schedule & Details
 *   2. Assignment & Compliance
 *   3. Review Logs
 */

import React, { useEffect, useRef } from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Check, LayoutGrid, Users, ClipboardList } from 'lucide-react';

export interface Step {
    id: number;
    name: string;
    icon: React.ReactNode;
}

export const SHIFT_STEPS: Step[] = [
    { id: 1, name: 'Schedule & Details', icon: <LayoutGrid className="h-4 w-4" aria-hidden /> },
    { id: 2, name: 'Assignment', icon: <Users className="h-4 w-4" aria-hidden /> },
    { id: 3, name: 'Review Logs', icon: <ClipboardList className="h-4 w-4" aria-hidden /> },
];

export interface StepIndicatorProps {
    currentStep: number;
    completedSteps: Set<number>;
    onStepClick?: (step: number) => void;
    disabled?: boolean;
    editMode?: boolean;
}

export function StepIndicator({
    currentStep,
    completedSteps,
    onStepClick,
    disabled = false,
    editMode = false,
}: StepIndicatorProps) {
    const steps = SHIFT_STEPS.map(step => ({
        ...step,
        name: step.id === 3 && !editMode ? 'Review Details' : step.name,
    }));

    const totalSteps = steps.length;

    // ── Live region: announce step change to screen readers ─────────────────
    const announceRef = useRef<HTMLDivElement>(null);
    const prevStep = useRef<number>(currentStep);

    useEffect(() => {
        if (prevStep.current === currentStep) return;
        prevStep.current = currentStep;

        const step = steps.find(s => s.id === currentStep);
        const label = step ? `Step ${currentStep} of ${totalSteps}: ${step.name}` : '';
        if (announceRef.current) {
            announceRef.current.textContent = '';
            requestAnimationFrame(() => {
                if (announceRef.current) announceRef.current.textContent = label;
            });
        }
    }, [currentStep, steps, totalSteps]);

    return (
        <nav aria-label="Shift form steps" className="w-full">
            {/* Screen-reader live region — visually hidden */}
            <div
                ref={announceRef}
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            />

            {/* Progress bar — semantic % for AT */}
            <div
                role="progressbar"
                aria-valuenow={currentStep}
                aria-valuemin={1}
                aria-valuemax={totalSteps}
                aria-label={`Step ${currentStep} of ${totalSteps}`}
                className="sr-only"
            />

            {/* Visual step circles with connecting lines */}
            <ol
                className="flex items-center justify-between relative list-none p-0 m-0"
                aria-label="Step list"
            >
                {/* Background rail */}
                <div className="absolute top-4 left-0 right-0 h-0.5 bg-white/10" aria-hidden />

                {/* Filled progress rail */}
                <div
                    className="absolute top-4 left-0 h-0.5 bg-emerald-500 transition-all duration-300"
                    style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
                    aria-hidden
                />

                {steps.map(step => {
                    const isCompleted = completedSteps.has(step.id);
                    const isCurrent = currentStep === step.id;
                    const isPast = step.id < currentStep;
                    const canClick = !disabled && (isPast || isCurrent);

                    const stateLabel = isCurrent
                        ? 'current'
                        : isCompleted
                            ? 'completed'
                            : 'not started';

                    return (
                        <li key={step.id} className="flex flex-col items-center relative z-10">
                            <button
                                type="button"
                                onClick={() => canClick && onStepClick?.(step.id)}
                                disabled={!canClick}
                                aria-current={isCurrent ? 'step' : undefined}
                                aria-disabled={!canClick}
                                aria-label={`Step ${step.id}: ${step.name} — ${stateLabel}`}
                                className={cn(
                                    'h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200',
                                    'border-2 text-sm font-medium',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f172a]',
                                    isCurrent && 'bg-emerald-500 border-emerald-500 text-white scale-110 shadow-lg shadow-emerald-500/30',
                                    isCompleted && !isCurrent && 'bg-emerald-500/20 border-emerald-500 text-emerald-400',
                                    !isCurrent && !isCompleted && 'bg-slate-800 border-white/20 text-white/40',
                                    canClick && !isCurrent && 'hover:border-emerald-400 hover:text-emerald-400 cursor-pointer',
                                    !canClick && 'cursor-not-allowed',
                                )}
                            >
                                {isCompleted && !isCurrent ? (
                                    <Check className="h-4 w-4" aria-hidden />
                                ) : (
                                    <span aria-hidden>{step.id}</span>
                                )}
                            </button>

                            <span
                                aria-hidden
                                className={cn(
                                    'mt-2 text-[10px] font-medium tracking-wide uppercase',
                                    isCurrent && 'text-emerald-400',
                                    isCompleted && !isCurrent && 'text-emerald-400/70',
                                    !isCurrent && !isCompleted && 'text-white/40',
                                )}
                            >
                                {step.name}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
