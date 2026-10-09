import React from 'react';
import { cn } from '@/modules/core/lib/utils';

export interface WizardStepHeaderProps {
    currentStep: 1 | 2 | 3 | 4;
    labels: [string, string, string, string];
}

/**
 * 4-pill progress strip. Reuses the section-label pill chrome from
 * AddContractDialog.tsx's "Hierarchy Selection" / "Award Schedules" labels.
 */
export const WizardStepHeader: React.FC<WizardStepHeaderProps> = ({ currentStep, labels }) => {
    return (
        <div className="flex items-center justify-center gap-2 flex-wrap">
            {labels.map((label, idx) => {
                const step = (idx + 1) as 1 | 2 | 3 | 4;
                const isActive = step === currentStep;
                const isDone = step < currentStep;
                return (
                    <React.Fragment key={label}>
                        <span
                            className={cn(
                                "text-[10px] font-black tracking-[0.25em] uppercase px-3.5 py-1 rounded-full border transition-all duration-300",
                                isActive
                                    ? "text-primary bg-primary/10 border-primary/20"
                                    : isDone
                                        ? "text-primary/70 bg-primary/5 border-primary/10"
                                        : "text-muted-foreground bg-muted/40 border-border",
                            )}
                        >
                            {step}. {label}
                        </span>
                        {idx < labels.length - 1 && (
                            <span
                                className={cn(
                                    "h-0.5 w-6 rounded-full transition-all duration-500",
                                    isDone
                                        ? "bg-gradient-to-r from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                                        : "bg-border",
                                )}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default WizardStepHeader;
