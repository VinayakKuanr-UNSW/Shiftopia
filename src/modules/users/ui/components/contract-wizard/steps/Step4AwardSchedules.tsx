import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { GraduationCap, BookOpen, Accessibility, ShieldCheck } from 'lucide-react';
import type { ContractWizardFormState } from '../../../hooks/useContractWizardForm';

const SWS_MIN_WEEKLY_PAY = 90;

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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. Apprentice Mode Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                    formData.is_apprentice
                        ? "bg-indigo-500/10 border-indigo-500/40 shadow-indigo-500/10"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_apprentice', !formData.is_apprentice)}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2.5 rounded-xl transition-all",
                                    formData.is_apprentice ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300" : "bg-muted text-muted-foreground"
                                )}>
                                    <GraduationCap className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <h4 className="text-sm font-bold text-foreground">Apprentice Mode</h4>
                                    <p className="text-[10px] text-muted-foreground">Schedule 4 Wage Alignment</p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-11 h-6 rounded-full relative transition-all duration-300",
                                formData.is_apprentice ? "bg-indigo-500" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_apprentice ? 22 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence>
                            {formData.is_apprentice && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-4 pt-4 border-t border-indigo-500/20 space-y-4 overflow-hidden text-left"
                                >
                                    <div className="space-y-1.5">
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Apprentice Type</span>
                                        <div className="grid grid-cols-3 gap-1.5">
                                            {[
                                                { id: 'standard', name: 'Standard' },
                                                { id: 'adult', name: 'Adult (21+)' },
                                                { id: 'school_based', name: 'School' }
                                            ].map((t) => (
                                                <button
                                                    key={t.id}
                                                    type="button"
                                                    onClick={() => updateField('apprentice_type', t.id as any)}
                                                    className={cn(
                                                        "px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all truncate",
                                                        formData.apprentice_type === t.id
                                                            ? "bg-indigo-500/25 border-indigo-500/60 text-indigo-700 dark:text-indigo-200"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    {t.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Training Year</span>
                                        <div className="grid grid-cols-4 gap-1">
                                            {[1, 2, 3, 4].map(year => (
                                                <button
                                                    key={year}
                                                    type="button"
                                                    onClick={() => updateField('apprentice_year', year)}
                                                    className={cn(
                                                        "h-7 rounded-lg text-[11px] font-bold border transition-all",
                                                        formData.apprentice_year === year
                                                            ? "bg-indigo-500 text-white border-indigo-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    Yr {year}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 pt-1">
                                        <input
                                            id="wizard-apprentice-year12"
                                            type="checkbox"
                                            checked={!!formData.has_completed_year_12}
                                            onChange={() => updateField('has_completed_year_12', !formData.has_completed_year_12)}
                                            className="h-4 w-4 rounded border-border accent-indigo-500"
                                        />
                                        <label htmlFor="wizard-apprentice-year12" className="text-xs text-foreground cursor-pointer select-none">
                                            Completed Year 12
                                        </label>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* 2. Trainee Mode Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                    formData.is_trainee
                        ? "bg-purple-500/10 border-purple-500/40 shadow-purple-500/10"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_trainee', !formData.is_trainee)}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2.5 rounded-xl transition-all",
                                    formData.is_trainee ? "bg-purple-500/20 text-purple-600 dark:text-purple-300" : "bg-muted text-muted-foreground"
                                )}>
                                    <BookOpen className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <h4 className="text-sm font-bold text-foreground">Trainee Mode</h4>
                                    <p className="text-[10px] text-muted-foreground">Schedule 5 Wage Matrix</p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-11 h-6 rounded-full relative transition-all duration-300",
                                formData.is_trainee ? "bg-purple-500" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_trainee ? 22 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence>
                            {formData.is_trainee && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-4 pt-4 border-t border-purple-500/20 space-y-4 overflow-hidden text-left"
                                >
                                    <div className="space-y-1.5">
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Category</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['junior', 'adult'].map((cat) => (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => updateField('trainee_category', cat as any)}
                                                    className={cn(
                                                        "py-1.5 rounded-lg text-[10px] font-bold uppercase border transition-all",
                                                        formData.trainee_category === cat
                                                            ? "bg-purple-500/25 border-purple-500/60 text-purple-700 dark:text-purple-200"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    {cat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Wage Level</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['A', 'B'].map((lvl) => (
                                                <button
                                                    key={lvl}
                                                    type="button"
                                                    onClick={() => updateField('trainee_level', lvl as any)}
                                                    className={cn(
                                                        "py-1 rounded-lg text-[11px] font-bold border transition-all",
                                                        formData.trainee_level === lvl
                                                            ? "bg-purple-500 text-white border-purple-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    Level {lvl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* 3. Supported Wage System (SWS) Card */}
                <div className={cn(
                    "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                    formData.is_sws
                        ? "bg-emerald-500/10 border-emerald-500/40 shadow-emerald-500/10"
                        : "bg-card border-border hover:border-border/80"
                )}>
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => updateField('is_sws', !formData.is_sws)}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2.5 rounded-xl transition-all",
                                    formData.is_sws ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                                )}>
                                    <Accessibility className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <h4 className="text-sm font-bold text-foreground">Supported Wage (SWS)</h4>
                                    <p className="text-[10px] text-muted-foreground">Schedule 6 Compliance</p>
                                </div>
                            </div>

                            <div className={cn(
                                "w-11 h-6 rounded-full relative transition-all duration-300",
                                formData.is_sws ? "bg-emerald-500" : "bg-muted border border-border"
                            )}>
                                <motion.div
                                    animate={{ x: formData.is_sws ? 22 : 2 }}
                                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                />
                            </div>
                        </div>

                        <AnimatePresence>
                            {formData.is_sws && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-4 pt-4 border-t border-emerald-500/20 space-y-4 overflow-hidden text-left"
                                >
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Assessed Capacity</span>
                                            <span className="text-xs font-black text-emerald-500 font-mono">{formData.sws_capacity_percentage}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={10}
                                            max={90}
                                            step={10}
                                            value={formData.sws_capacity_percentage}
                                            onChange={(e) => updateField('sws_capacity_percentage', parseInt(e.target.value))}
                                            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-muted rounded-lg"
                                        />
                                    </div>

                                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                                        Schedule 6: Absolute minimum payable rate is ${SWS_MIN_WEEKLY_PAY}/week baseline regardless of capacity.
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Step4AwardSchedules;
