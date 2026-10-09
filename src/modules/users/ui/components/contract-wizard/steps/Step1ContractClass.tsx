import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { CalendarClock, Zap, Check } from 'lucide-react';
import type { ContractClass } from '../../../hooks/useContractWizardForm';

export interface Step1ContractClassProps {
    contractClass: ContractClass | null;
    onSelect: (value: ContractClass) => void;
}

const CLASSES: Array<{
    id: ContractClass;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    accent: string;
}> = [
    {
        id: 1,
        icon: <CalendarClock className="w-5 h-5" />,
        title: 'Class 1 — Permanent / Fixed Hours',
        subtitle: 'Full-Time, Part-Time, or Flexible Part-Time. Mandatory contracted hours.',
        accent: 'indigo',
    },
    {
        id: 2,
        icon: <Zap className="w-5 h-5" />,
        title: 'Class 2 — Casual / Flexible',
        subtitle: 'No fixed hours. Engaged by the hour, priced straight off Remuneration Level.',
        accent: 'emerald',
    },
];

/** Step 1 — pick the broad contract class, styled after the award-schedule cards. */
export const Step1ContractClass: React.FC<Step1ContractClassProps> = ({ contractClass, onSelect }) => {
    return (
        <div className="max-w-3xl mx-auto w-full">
            <div className="text-center mb-5">
                <span className="text-[10px] font-black tracking-[0.25em] uppercase text-primary bg-primary/10 px-3.5 py-1 rounded-full border border-primary/20">
                    Contract Class
                </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {CLASSES.map((c) => {
                    const isSelected = contractClass === c.id;
                    const isIndigo = c.accent === 'indigo';
                    return (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => onSelect(c.id)}
                            className={cn(
                                "text-left p-5 rounded-2xl border transition-all duration-300 shadow-sm",
                                isSelected
                                    ? isIndigo
                                        ? "bg-indigo-500/10 border-indigo-500/40 shadow-indigo-500/10"
                                        : "bg-emerald-500/10 border-emerald-500/40 shadow-emerald-500/10"
                                    : "bg-card border-border hover:border-border/80",
                            )}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <div className={cn(
                                        "p-2.5 rounded-xl transition-all shrink-0",
                                        isSelected
                                            ? isIndigo
                                                ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300"
                                                : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
                                            : "bg-muted text-muted-foreground",
                                    )}>
                                        {c.icon}
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-foreground">{c.title}</h4>
                                        <p className="text-xs text-muted-foreground mt-1">{c.subtitle}</p>
                                    </div>
                                </div>
                                <div className={cn(
                                    "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                    isSelected
                                        ? isIndigo
                                            ? "bg-indigo-500 border-indigo-500 text-white"
                                            : "bg-emerald-500 border-emerald-500 text-white"
                                        : "border-muted-foreground/40",
                                )}>
                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default Step1ContractClass;
