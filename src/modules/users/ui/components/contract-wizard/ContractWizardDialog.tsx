import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Plus, Loader2, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { useEbaRates } from '@/modules/payroll/state/useEbaRates';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
    useContractWizardForm,
    computeMixedPermanentConflict,
    evaluateWizardTerms,
    type ContractClass,
    type WizardPayContext,
} from '../../hooks/useContractWizardForm';
import { validateContractHours, type ExistingContract } from '../../../domain/contractHoursCeiling';
import {
    allowedPayBases,
    defaultPayBasis,
    eaTopAnnualRate,
    SECURITY_ANNUALISED_LEVELS,
    type RoleBand,
} from '../../../domain/contractPayTerms';
import { WizardStepHeader } from './WizardStepHeader';
import { Step1ContractClass } from './steps/Step1ContractClass';
import { Step2Hierarchy } from './steps/Step2Hierarchy';
import { Step3EmploymentTerms } from './steps/Step3EmploymentTerms';
import { Step4AwardSchedules } from './steps/Step4AwardSchedules';

export interface ContractWizardDialogProps {
    employeeId: string;
    employeeName: string;
    existingContracts?: any[];
    trigger?: React.ReactNode;
    onSuccess?: () => void;
}

const STEP_LABELS: [string, string, string, string] = ['Class', 'Hierarchy', 'Terms', 'Schedules'];

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const ContractWizardDialog: React.FC<ContractWizardDialogProps> = ({
    employeeId, employeeName, existingContracts = [], trigger, onSuccess,
}) => {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

    const {
        organizations, departments, subDepartments, roles, remLevels,
        isLoading: isLoadingRefs, loadReferenceData,
    } = useReferenceData(open);

    const { formData, isSubmitting, updateField, reset, submit, hoursRule } =
        useContractWizardForm(employeeId, () => {
            setOpen(false);
            setStep(1);
            if (onSuccess) onSuccess();
        });

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            loadReferenceData();
        } else {
            reset();
            setStep(1);
        }
    };

    const ceilingContracts: ExistingContract[] = useMemo(() =>
        (existingContracts ?? []).map((c: any) => ({
            id: c.id,
            employment_status: c.employment_status ?? null,
            contracted_weekly_hours: c.contracted_weekly_hours ?? null,
            status: c.status ?? null,
            role_id: c.role_id ?? null,
        })),
        [existingContracts],
    );

    // ── Pay ──────────────────────────────────────────────────────────────────
    // The EA's top rate on today's Sydney date (the contract starts today) feeds
    // the cl 2.2 salary cautions only — no rate is shown here (money is shown
    // in Gross Pay alone). The role contributes its band and whether it is a
    // Security role (Schedule 3 — the same name test the cost engine uses).
    const { schedule: ebaSchedule } = useEbaRates(open);
    const onDate = todayISO();

    const role = useMemo(
        () => roles.find((r: any) => r.id === formData.role_id) ?? null,
        [roles, formData.role_id],
    );
    const isSecurityRole = isSecurityRoleName(role?.name);
    const payContext: WizardPayContext = useMemo(() => {
        const band: RoleBand | null = role
            ? { eba_level_min: role.eba_level_min ?? null, eba_level_max: role.eba_level_max ?? null }
            : null;
        return { band, isSecurityRole, eaTopAnnualRate: eaTopAnnualRate(ebaSchedule, onDate) };
    }, [role, isSecurityRole, ebaSchedule, onDate]);

    const terms = useMemo(
        () => evaluateWizardTerms(formData, ceilingContracts, payContext),
        [formData, ceilingContracts, payContext],
    );
    const allowedBases = allowedPayBases(formData.employment_status, isSecurityRole);

    /** The role's default pay basis for this employment type (a casual is always on a level). */
    const applyDefaultPayBasis = (status: string, forRole: any) => {
        if (!status) return;
        updateField('pay_basis', defaultPayBasis(
            status,
            isSecurityRoleName(forRole?.name),
            forRole?.typically_salaried === true,
        ));
    };

    const weeklyEquivalent = formData.employment_status === 'Casual' || !formData.employment_status
        ? 0
        : formData.contracted_weekly_hours > 0
            ? formData.contracted_weekly_hours
            : formData.annual_guaranteed_hours / 52;

    const ceilingValidation = useMemo(
        () => validateContractHours(weeklyEquivalent, formData.employment_status || 'Casual', ceilingContracts),
        [weeklyEquivalent, formData.employment_status, ceilingContracts],
    );
    const isCeilingExceeded = !ceilingValidation.valid;

    const mixedPermanentConflict = useMemo(
        () => computeMixedPermanentConflict(formData.employment_status, ceilingContracts),
        [formData.employment_status, ceilingContracts],
    );

    // Per-step "can advance" gating.
    const step1Valid = formData.contractClass !== null;
    const step2Valid = !!formData.role_id;
    const step3Valid = !!formData.employment_status
        && terms.pay.errors.length === 0
        && terms.engagement.errors.length === 0
        && !isCeilingExceeded
        && !mixedPermanentConflict
        && (hoursRule?.valid ?? true);

    // Shown only once a Class 1 sub-class is chosen — before that there are no
    // contracted hours to describe, and Class 2 never has any.
    const showHoursBadge = step >= 3 && formData.contractClass === 1 && !!hoursRule;
    const isHoursBadgeBad = showHoursBadge && (!hoursRule!.valid || isCeilingExceeded);

    const canGoNext = step === 1 ? step1Valid : step === 2 ? step2Valid : step === 3 ? step3Valid : true;
    const canSubmit = step1Valid && step2Valid && step3Valid;

    const handleSubmit = async () => {
        await submit(ceilingContracts, payContext);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto rounded-xl transition-all duration-300 bg-primary/10 hover:bg-primary/20 border-primary/30 text-primary font-bold shadow-md shadow-primary/10"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Contract
                    </Button>
                )}
            </DialogTrigger>

            <DialogContent className="w-[96vw] max-w-3xl h-[88vh] max-h-[88vh] flex flex-col gap-0 bg-background dark:bg-[#0b0e14]/98 border border-border text-foreground shadow-2xl backdrop-blur-3xl rounded-[2.5rem] overflow-hidden p-0">
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-primary/5 pointer-events-none" />

                {/* ── Top Header ────────────────────────────────────────────── */}
                <div className="p-6 sm:p-8 pb-5 flex-shrink-0 border-b border-border bg-muted/20 dark:bg-white/[0.02]">
                    <DialogHeader className="mb-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3.5">
                                <div className="p-2.5 rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-inner">
                                    <Sparkles className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
                                        Add Contract
                                        <span className="text-xs font-semibold px-3 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                                            {employeeName}
                                        </span>
                                    </DialogTitle>
                                    <DialogDescription className="text-muted-foreground text-xs sm:text-sm mt-0.5">
                                        Step {step} of 4 — configure this engagement.
                                    </DialogDescription>
                                </div>
                            </div>

                            {showHoursBadge && (
                                <div className={cn(
                                    "hidden lg:flex items-center gap-3 px-4 py-2 rounded-2xl border backdrop-blur-md transition-all",
                                    isHoursBadgeBad
                                        ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300"
                                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                                )}>
                                    <div className="flex flex-col text-right">
                                        <span className="text-[9px] font-black uppercase tracking-wider opacity-70">
                                            {hoursRule!.label} · {hoursRule!.clause}
                                        </span>
                                        <span className="text-xs font-bold font-mono">
                                            {fmtHours(hoursRule!.value)}h{hoursRule!.cadence} · {hoursRule!.limitText}
                                        </span>
                                    </div>
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full",
                                        isHoursBadgeBad ? "bg-rose-500 animate-pulse" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                                    )} />
                                </div>
                            )}
                        </div>
                    </DialogHeader>

                    <div className="mt-5">
                        <WizardStepHeader currentStep={step} labels={STEP_LABELS} />
                    </div>
                </div>

                {/* ── Scrollable Body ──────────────────────────────────────── */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 sm:p-8 space-y-8 scrollbar-thin scrollbar-thumb-muted-foreground/30 overscroll-contain">
                    {step === 1 && (
                        <Step1ContractClass
                            contractClass={formData.contractClass}
                            onSelect={(value: ContractClass) => updateField('contractClass', value)}
                        />
                    )}
                    {step === 2 && (
                        <Step2Hierarchy
                            organizations={organizations}
                            departments={departments}
                            subDepartments={subDepartments}
                            roles={roles}
                            organization_id={formData.organization_id}
                            department_id={formData.department_id}
                            sub_department_id={formData.sub_department_id}
                            role_id={formData.role_id}
                            onOrgChange={(val) => updateField('organization_id', val)}
                            onDeptChange={(val) => updateField('department_id', val)}
                            onSubDeptChange={(val) => updateField('sub_department_id', val)}
                            onRoleChange={(val) => {
                                updateField('role_id', val);
                                applyDefaultPayBasis(formData.employment_status, roles.find((r: any) => r.id === val));
                            }}
                        />
                    )}
                    {step === 3 && (
                        <Step3EmploymentTerms
                            contractClass={formData.contractClass}
                            employment_status={formData.employment_status}
                            contracted_weekly_hours={formData.contracted_weekly_hours}
                            annual_guaranteed_hours={formData.annual_guaranteed_hours}
                            remuneration_level={formData.remuneration_level}
                            remLevels={remLevels}
                            onEmploymentStatusChange={(status) => {
                                updateField('employment_status', status);
                                applyDefaultPayBasis(status, role);
                            }}
                            onHoursChange={(patch) => {
                                if (patch.contracted_weekly_hours !== undefined) updateField('contracted_weekly_hours', patch.contracted_weekly_hours);
                                if (patch.annual_guaranteed_hours !== undefined) updateField('annual_guaranteed_hours', patch.annual_guaranteed_hours);
                            }}
                            onLevelChange={(level) => updateField('remuneration_level', level)}
                            hoursRule={hoursRule}
                            existingWeeklyHours={ceilingValidation.existingHours}
                            isCeilingExceeded={isCeilingExceeded}
                            ceilingProposedTotal={ceilingValidation.proposedTotal}
                            mixedPermanentConflict={mixedPermanentConflict}
                            pay_basis={formData.pay_basis}
                            allowedPayBases={allowedBases}
                            onPayBasisChange={(basis) => updateField('pay_basis', basis)}
                            band={payContext.band}
                            allowedLevels={formData.pay_basis === 'eba_security_annualised' ? SECURITY_ANNUALISED_LEVELS : undefined}
                            levelOutsideBand={terms.pay.levelOutsideBand}
                            level_note={formData.level_note}
                            onLevelNoteChange={(note) => updateField('level_note', note)}
                            annual_salary={formData.annual_salary}
                            onAnnualSalaryChange={(amount) => updateField('annual_salary', amount)}
                            eba_exclusion_reason={formData.eba_exclusion_reason}
                            onExclusionReasonChange={(reason) => updateField('eba_exclusion_reason', reason)}
                            payErrors={terms.pay.errors}
                            payWarnings={terms.pay.warnings}
                            isMultiHire={terms.engagement.kind === 'multi_hire'}
                            multi_hire_request_ref={formData.multi_hire_request_ref}
                            onMultiHireRefChange={(ref) => updateField('multi_hire_request_ref', ref)}
                        />
                    )}
                    {step === 4 && (
                        <Step4AwardSchedules
                            formData={formData}
                            updateField={updateField}
                            isSalaried={formData.pay_basis === 'salary'}
                        />
                    )}
                </div>

                {/* ── Fixed Sticky Footer ──────────────────────────────────── */}
                <div className="p-6 px-8 bg-muted/20 dark:bg-white/[0.02] border-t border-border flex-shrink-0">
                    <DialogFooter className="flex-row items-center justify-between gap-4 w-full">
                        <div>
                            {step > 1 ? (
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                                    className="rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                                >
                                    <ChevronLeft className="w-4 h-4 mr-1" /> Back
                                </Button>
                            ) : (
                                <Button
                                    variant="ghost"
                                    onClick={() => setOpen(false)}
                                    className="rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            {step < 4 ? (
                                <Button
                                    onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                                    disabled={!canGoNext || isLoadingRefs}
                                    className="rounded-xl px-8 h-11 font-bold shadow-md bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/30"
                                >
                                    Next <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || isLoadingRefs || !canSubmit}
                                    className={cn(
                                        "rounded-xl px-8 h-11 transition-all duration-300 font-bold shadow-md",
                                        canSubmit
                                            ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/30 active:scale-95 cursor-pointer"
                                            : "bg-muted text-muted-foreground cursor-not-allowed"
                                    )}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Saving…
                                        </>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            <Plus className="w-4 h-4" />
                                            Add Contract
                                        </span>
                                    )}
                                </Button>
                            )}
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ContractWizardDialog;
