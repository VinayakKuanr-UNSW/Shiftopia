import React from 'react';
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { GraduationCap, BookOpen, Accessibility, ShieldCheck } from 'lucide-react';
import type { ContractWizardFormState } from '../../../hooks/useContractWizardForm';

const SWS_MIN_WEEKLY_PAY = 90;

const EXPAND_TRANSITION: Transition = {
    height: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
    opacity: { duration: 0.22, ease: 'easeOut' },
};

/**
 * Collapsible body for a schedule card. Only `height` and `opacity` are
 * animated on the outer element; all spacing (margin/padding/border) lives on
 * the inner element so it is clipped smoothly instead of snapping in/out —
 * framer-motion cannot interpolate spacing that sits on the height-animated node.
 */
const ExpandPanel: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
    <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={EXPAND_TRANSITION}
        className="overflow-hidden"
        style={{ willChange: 'height, opacity' }}
    >
        <div className="pt-5">
            <div className={cn('pt-5 border-t space-y-4 text-left', className)}>
                {children}
            </div>
        </div>
    </motion.div>
);

export interface Step4AwardSchedulesProps {
    formData: Pick<ContractWizardFormState,
        'is_apprentice' | 'apprentice_type' | 'apprentice_year' | 'has_completed_year_12' |
        'is_trainee' | 'trainee_category' | 'trainee_level' |
        'is_sws' | 'sws_capacity_percentage'>;
    updateField: <K extends keyof ContractWizardFormState>(field: K, value: ContractWizardFormState[K]) => void;
    /** Schedules 4–6 adjust EA wages; a salaried contract is outside the EA. */
    isSalaried?: boolean;
}

/**
 * Step 4 — direct port of AddContractDialog.tsx's Apprentice/Trainee/SWS
 * 3-card toggle block. Same mutual-exclusivity logic, same fields rendered.
 */
export const Step4AwardSchedules: React.FC<Step4AwardSchedulesProps> = ({ formData, updateField, isSalaried }) => {
    if (isSalaried) {
        return (
            <div className="max-w-xl mx-auto w-full p-6 rounded-2xl border border-border bg-muted/20 text-center space-y-1">
                <p className="text-sm font-semibold text-foreground">No award schedules for a salaried contract</p>
                <p className="text-xs text-muted-foreground">
                    Apprentice, trainee and supported-wage rates (Schedules 4–6) adjust EA wages.
                    This contract is outside the EA (cl 2.2), so none of them apply.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto w-full space-y-4">
            <div className="text-center border-b border-border pb-3">
                <span className="text-[10px] font-black tracking-[0.25em] uppercase text-muted-foreground inline-flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 rounded-full border border-border">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" /> Award Schedules & Special Conditions (Optional)
                </span>
            </div>

            <div className="flex flex-col gap-4 w-full">
                {/* 1. Apprentice Mode Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-300 shadow-sm w-full",
                    formData.is_apprentice
                        ? "bg-indigo-500/10 border-indigo-500/40 shadow-indigo-500/10 ring-1 ring-indigo-500/20"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_apprentice', !formData.is_apprentice)}
                        >
                            <div className="flex items-center gap-3.5">
                                <div className={cn(
                                    "p-3 rounded-2xl transition-all",
                                    formData.is_apprentice ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/30" : "bg-muted text-muted-foreground"
                                )}>
                                    <GraduationCap className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-bold text-foreground">Apprentice Mode</h4>
                                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 border border-indigo-500/30">
                                            Schedule 4
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Schedule 4 Wage Alignment · Fair Work apprentice wage progression matrix
                                    </p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-12 h-6 rounded-full relative transition-all duration-300 shrink-0",
                                formData.is_apprentice ? "bg-indigo-500 shadow-md shadow-indigo-500/30" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_apprentice ? 26 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence initial={false}>
                            {formData.is_apprentice && (
                                <ExpandPanel className="border-indigo-500/20">
                                    <div className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Apprentice Type</span>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                            {[
                                                { id: 'standard', name: 'Standard', desc: 'Under 21 at start' },
                                                { id: 'adult', name: 'Adult (21+)', desc: '21 years or older' },
                                                { id: 'school_based', name: 'School-based', desc: 'Secondary student' }
                                            ].map((t) => (
                                                <button
                                                    key={t.id}
                                                    type="button"
                                                    onClick={() => updateField('apprentice_type', t.id as any)}
                                                    className={cn(
                                                        "flex flex-col items-start px-3.5 py-2.5 rounded-xl text-left border transition-all",
                                                        formData.apprentice_type === t.id
                                                            ? "bg-indigo-500/25 border-indigo-500/60 text-indigo-700 dark:text-indigo-200 ring-1 ring-indigo-500/30"
                                                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <span className="text-xs font-bold text-foreground">{t.name}</span>
                                                    <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Training Year</span>
                                        <div className="grid grid-cols-4 gap-2">
                                            {[1, 2, 3, 4].map(year => (
                                                <button
                                                    key={year}
                                                    type="button"
                                                    onClick={() => updateField('apprentice_year', year)}
                                                    className={cn(
                                                        "h-9 rounded-xl text-xs font-bold border transition-all",
                                                        formData.apprentice_year === year
                                                            ? "bg-indigo-500 text-white border-indigo-400 shadow-md"
                                                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    Year {year}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2.5 pt-1">
                                        <input
                                            id="wizard-apprentice-year12"
                                            type="checkbox"
                                            checked={!!formData.has_completed_year_12}
                                            onChange={() => updateField('has_completed_year_12', !formData.has_completed_year_12)}
                                            className="h-4 w-4 rounded border-border accent-indigo-500"
                                        />
                                        <label htmlFor="wizard-apprentice-year12" className="text-xs text-foreground cursor-pointer select-none">
                                            Completed Year 12 (affects standard apprentice wage progression)
                                        </label>
                                    </div>
                                </ExpandPanel>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* 2. Trainee Mode Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-300 shadow-sm w-full",
                    formData.is_trainee
                        ? "bg-purple-500/10 border-purple-500/40 shadow-purple-500/10 ring-1 ring-purple-500/20"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_trainee', !formData.is_trainee)}
                        >
                            <div className="flex items-center gap-3.5">
                                <div className={cn(
                                    "p-3 rounded-2xl transition-all",
                                    formData.is_trainee ? "bg-purple-500/20 text-purple-600 dark:text-purple-300 ring-1 ring-purple-500/30" : "bg-muted text-muted-foreground"
                                )}>
                                    <BookOpen className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-bold text-foreground">Trainee Mode</h4>
                                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                                            Schedule 5
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Schedule 5 Wage Matrix · National Training Wage traineeship alignment
                                    </p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-12 h-6 rounded-full relative transition-all duration-300 shrink-0",
                                formData.is_trainee ? "bg-purple-500 shadow-md shadow-purple-500/30" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_trainee ? 26 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence initial={false}>
                            {formData.is_trainee && (
                                <ExpandPanel className="border-purple-500/20">
                                    <div className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Category</span>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            {[
                                                { id: 'junior', name: 'Junior', desc: 'Under 21 years of age' },
                                                { id: 'adult', name: 'Adult', desc: '21 years or older' },
                                            ].map((cat) => (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    onClick={() => updateField('trainee_category', cat.id as any)}
                                                    className={cn(
                                                        "flex flex-col items-start px-3.5 py-2.5 rounded-xl text-left border transition-all",
                                                        formData.trainee_category === cat.id
                                                            ? "bg-purple-500/25 border-purple-500/60 text-purple-700 dark:text-purple-200 ring-1 ring-purple-500/30"
                                                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <span className="text-xs font-bold text-foreground">{cat.name}</span>
                                                    <span className="text-[10px] text-muted-foreground">{cat.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Wage Level</span>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            {[
                                                { id: 'A', name: 'Skill Level A', desc: 'Certificate III qualifications' },
                                                { id: 'B', name: 'Skill Level B', desc: 'Certificate II qualifications' },
                                            ].map((lvl) => (
                                                <button
                                                    key={lvl.id}
                                                    type="button"
                                                    onClick={() => updateField('trainee_level', lvl.id as any)}
                                                    className={cn(
                                                        "flex flex-col items-start px-3.5 py-2.5 rounded-xl text-left border transition-all",
                                                        formData.trainee_level === lvl.id
                                                            ? "bg-purple-500/25 border-purple-500/60 text-purple-700 dark:text-purple-200 ring-1 ring-purple-500/30"
                                                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <span className="text-xs font-bold text-foreground">{lvl.name}</span>
                                                    <span className="text-[10px] text-muted-foreground">{lvl.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </ExpandPanel>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* 3. Supported Wage System (SWS) Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-300 shadow-sm w-full",
                    formData.is_sws
                        ? "bg-emerald-500/10 border-emerald-500/40 shadow-emerald-500/10 ring-1 ring-emerald-500/20"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_sws', !formData.is_sws)}
                        >
                            <div className="flex items-center gap-3.5">
                                <div className={cn(
                                    "p-3 rounded-2xl transition-all",
                                    formData.is_sws ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/30" : "bg-muted text-muted-foreground"
                                )}>
                                    <Accessibility className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-bold text-foreground">Supported Wage (SWS)</h4>
                                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                            Schedule 6
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Schedule 6 Compliance · Assessed productive capacity percentage
                                    </p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-12 h-6 rounded-full relative transition-all duration-300 shrink-0",
                                formData.is_sws ? "bg-emerald-500 shadow-md shadow-emerald-500/30" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_sws ? 26 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence initial={false}>
                            {formData.is_sws && (
                                <ExpandPanel className="border-emerald-500/20">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Assessed Capacity</span>
                                            <span className="text-xs font-black text-emerald-400 font-mono bg-emerald-500/20 px-3 py-1 rounded-lg border border-emerald-500/30">{formData.sws_capacity_percentage}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={10}
                                            max={90}
                                            step={10}
                                            value={formData.sws_capacity_percentage}
                                            onChange={(e) => updateField('sws_capacity_percentage', parseInt(e.target.value))}
                                            className="w-full accent-emerald-500 cursor-pointer h-2 bg-muted rounded-lg"
                                        />
                                        <div className="flex justify-between text-[10px] font-mono text-muted-foreground px-1">
                                            <span>10%</span>
                                            <span>30%</span>
                                            <span>50%</span>
                                            <span>70%</span>
                                            <span>90%</span>
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-200/90 leading-relaxed">
                                        Schedule 6: Absolute minimum payable rate is ${SWS_MIN_WEEKLY_PAY}/week baseline regardless of capacity.
                                    </div>
                                </ExpandPanel>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Step4AwardSchedules;
