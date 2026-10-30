import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { useEbaRates } from '@/modules/payroll/state/useEbaRates';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
    useContractWizardForm,
    computeMixedPermanentConflict,
    evaluateWizardTerms,
    type WizardPayContext,
} from '../../hooks/useContractWizardForm';
import { concurrentWith, validateContractHours, type ExistingContract } from '../../../domain/contractHoursCeiling';
import {
    allowedPayBases,
    defaultPayBasis,
    eaTopAnnualRate,
    SECURITY_ANNUALISED_LEVELS,
    type RoleBand,
} from '../../../domain/contractPayTerms';
import { WizardStepHeader } from './WizardStepHeader';
import { Step1EmploymentType } from './steps/Step1EmploymentType';
import { Step2Hierarchy } from './steps/Step2Hierarchy';
import { Step3EmploymentTerms } from './steps/Step3EmploymentTerms';
import { Step4AwardSchedules } from './steps/Step4AwardSchedules';

/**
 * The contract wizard: add a contract, or edit one, in four steps. Renders no
 * dialog of its own, so it fits the Users page's edit panel (Contract tab).
 */
interface ContractWizardProps {
    employeeId: string;
    employeeName: string;
    /** All of the person's contracts: the 38-hour and Full-Time rules weigh every one. */
    existingContracts?: any[];
    /** Shown and ready: loads reference data, and the contract (or a fresh form) each time it becomes active. */
    active: boolean;
    /** A saved contract to edit; absent to add one. */
    contract?: Record<string, any> | null;
    /** Saved. */
    onDone: () => void;
    /** Cancelled from the first step. */
    onCancel: () => void;
    /** The heading elements, e.g. a dialog's Title and Description; plain h3 / p by default. */
    TitleTag?: React.ElementType;
    DescriptionTag?: React.ElementType;
}

const STEP_LABELS: [string, string, string, string] = ['Type', 'Position', 'Terms', 'Schedules'];

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const ContractWizard: React.FC<ContractWizardProps> = ({
    employeeId, employeeName, existingContracts = [], active, contract, onDone, onCancel,
    TitleTag = 'h3', DescriptionTag = 'p',
}) => {
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const isEditing = !!contract;

    const {
        organizations, departments, subDepartments, roles, remLevels,
        isLoading: isLoadingRefs, loadReferenceData,
    } = useReferenceData(active);

    const { formData, isSubmitting, updateField, reset, submit, hoursRule, loadContract } =
        useContractWizardForm(employeeId, onDone);

    // Opening starts a fresh add, or loads the contract being edited.
    useEffect(() => {
        if (!active) return;
        loadReferenceData();
        setStep(1);
        if (contract) loadContract(contract);
        else reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, contract?.id]);

    // The person's OTHER contracts that run alongside this one's dates: the one
    // being edited must not count against itself, and one that ends before this
    // starts doesn't count at all (the database's test).
    const ceilingContracts: ExistingContract[] = useMemo(() => concurrentWith(
        (existingContracts ?? []).filter((c: any) => c.id !== contract?.id).map((c: any) => ({
            id: c.id,
            employment_status: c.employment_status ?? null,
            contracted_weekly_hours: c.contracted_weekly_hours ?? null,
            status: c.status ?? null,
            role_id: c.role_id ?? null,
            start_date: c.start_date ?? null,
            end_date: c.end_date ?? null,
        })),
        formData.start_date,
        formData.end_date,
    ), [existingContracts, contract?.id, formData.start_date, formData.end_date]);

    // ── Pay ──────────────────────────────────────────────────────────────────
    // The EA's top rate on today's Sydney date (the contract starts today) feeds
    // the cl 2.2 salary cautions only — no rate is shown here (money is shown
    // in Gross Pay alone). The role contributes its band and whether it is a
    // Security role (Schedule 3 — the same name test the cost engine uses).
    const { schedule: ebaSchedule } = useEbaRates(active);
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
    const step1Valid = !!formData.employment_status;
    const step2Valid = !!formData.role_id && !!formData.start_date
        && !(formData.end_date && formData.end_date < formData.start_date);
    const step3Valid = !!formData.employment_status
        && terms.pay.errors.length === 0
        && terms.engagement.errors.length === 0
        && !isCeilingExceeded
        && !mixedPermanentConflict
        && (hoursRule?.valid ?? true);

    // Shown from the terms step on, for the types that carry contracted hours.
    const showHoursBadge = step >= 3 && !!hoursRule;
    const isHoursBadgeBad = showHoursBadge && (!hoursRule!.valid || isCeilingExceeded);

    const canGoNext = step === 1 ? step1Valid : step === 2 ? step2Valid : step === 3 ? step3Valid : true;
    const canSubmit = step1Valid && step2Valid && step3Valid;

    const handleSubmit = async () => {
        await submit(ceilingContracts, payContext);
    };

    return (
        <div className="flex flex-1 min-h-0 flex-col bg-background text-foreground">
                {/* ── Header ───────────────────────────────────────────────── */}
                <div className="px-6 pt-6 pb-4 flex-shrink-0 border-b border-border">
                    <div>
                        <div className="flex items-start justify-between gap-4">
                            <div className="text-left min-w-0">
                                <TitleTag className="text-[15px] font-semibold tracking-tight text-foreground">
                                    {isEditing ? 'Edit contract' : 'Add contract'}
                                </TitleTag>
                                <DescriptionTag className="text-muted-foreground text-[13px] mt-0.5 truncate">
                                    {employeeName} · step {step} of 4
                                </DescriptionTag>
                            </div>

                            {showHoursBadge && (
                                <div className={cn(
                                    "hidden md:flex flex-col text-right px-3 py-1.5 rounded-lg border",
                                    isHoursBadgeBad
                                        ? "border-destructive/40 text-destructive"
                                        : "border-border text-muted-foreground"
                                )}>
                                    <span className="text-[11px] font-medium">
                                        {hoursRule!.label} · {hoursRule!.clause}
                                    </span>
                                    <span className="text-[11px] font-semibold tabular-nums text-foreground">
                                        {fmtHours(hoursRule!.value)}h{hoursRule!.cadence} · {hoursRule!.limitText}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-4">
                        <WizardStepHeader currentStep={step} labels={STEP_LABELS} />
                    </div>
                </div>

                {/* ── Scrollable Body ──────────────────────────────────────── */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 space-y-8 overscroll-contain">
                    {step === 1 && (
                        <Step1EmploymentType
                            value={formData.employment_status}
                            onSelect={(type) => {
                                updateField('employment_status', type);
                                applyDefaultPayBasis(type, role);
                            }}
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
                            access_level={formData.access_level}
                            onAccessChange={(level) => updateField('access_level', level)}
                            start_date={formData.start_date}
                            end_date={formData.end_date}
                            savedStartDate={contract?.start_date ?? undefined}
                            onDatesChange={(patch) => {
                                if (patch.start_date !== undefined) updateField('start_date', patch.start_date);
                                if (patch.end_date !== undefined) updateField('end_date', patch.end_date);
                            }}
                        />
                    )}
                    {step === 3 && (
                        <Step3EmploymentTerms
                            employment_status={formData.employment_status}
                            contracted_weekly_hours={formData.contracted_weekly_hours}
                            annual_guaranteed_hours={formData.annual_guaranteed_hours}
                            remuneration_level={formData.remuneration_level}
                            remLevels={remLevels}
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

                {/* ── Footer ───────────────────────────────────────────────── */}
                <div className="px-6 py-4 border-t border-border flex-shrink-0">
                    <div className="flex flex-row items-center justify-between gap-3 w-full">
                        <Button
                            variant="ghost"
                            onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3 | 4) : onCancel())}
                            className="min-h-11"
                        >
                            {step > 1 ? <><ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back</> : 'Cancel'}
                        </Button>

                        <div className="flex items-center gap-2">
                            {/* Editing: save from any step once the contract is valid. */}
                            {isEditing && step < 4 && (
                                <Button
                                    variant="outline"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || isLoadingRefs || !canSubmit}
                                    className="min-h-11 border-border bg-background hover:bg-muted/60"
                                >
                                    Save changes
                                </Button>
                            )}
                            {step < 4 ? (
                                <Button
                                    onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                                    disabled={!canGoNext || isLoadingRefs}
                                    className="min-h-11 px-6"
                                >
                                    Next <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || isLoadingRefs || !canSubmit}
                                    className="min-h-11 px-6"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                                            Saving…
                                        </>
                                    ) : isEditing ? 'Save changes' : 'Add contract'}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
        </div>
    );
};

