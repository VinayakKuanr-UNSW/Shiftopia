import { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
    validateContractHours,
    type ExistingContract,
} from '../../domain/contractHoursCeiling';
import {
    evaluateEngagement,
    evaluatePayTerms,
    formatBand,
    SECURITY_ANNUALISED_LEVELS,
    type EbaExclusionReason,
    type EngagementEvaluation,
    type PayBasis,
    type PayEvaluation,
    type RoleBand,
} from '../../domain/contractPayTerms';
import { FLEXIBLE_PT_ANNUAL_HOURS_MIN, FLEXIBLE_PT_ANNUAL_HOURS_MAX } from './useContractForm';

/** Step 1 — Contract Class. Class 2 (Casual) has no fixed hours. */
export type ContractClass = 1 | 2;

export interface ContractWizardFormState {
    contractClass: ContractClass | null;
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    employment_status: string;
    contracted_weekly_hours: number;
    annual_guaranteed_hours: number;
    /** How the contract is paid. A casual is always 'eba_level'. */
    pay_basis: PayBasis;
    /** EA level; unused (and written as NULL) for a salaried contract. */
    remuneration_level: number | '';
    /** Salaried only. 0 = not entered. */
    annual_salary: number;
    /** Salaried only: why the contract is outside the EA (cl 2.2). */
    eba_exclusion_reason: EbaExclusionReason | '';
    /** Why the level sits outside the role's EA band. Saved to the contract's notes. */
    level_note: string;
    /** Request to Multi-Hire form reference (cl 13.1(d)). */
    multi_hire_request_ref: string;
    is_apprentice: boolean;
    apprentice_type: 'standard' | 'adult' | 'school_based';
    apprentice_year: number;
    has_completed_year_12: boolean;
    is_trainee: boolean;
    trainee_category: 'junior' | 'adult' | 'school_based';
    trainee_level: 'A' | 'B';
    trainee_exit_year: number;
    trainee_years_out: number;
    trainee_aqf_level: number;
    trainee_year: number;
    is_training_on_job: boolean;
    prefers_sba_loading: boolean;
    is_sws: boolean;
    sws_capacity_percentage: number;
    is_sws_trial: boolean;
    sws_trial_start_date: string;
}

const INITIAL_STATE: ContractWizardFormState = {
    contractClass: null,
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_id: '',
    employment_status: '',
    contracted_weekly_hours: 0,
    annual_guaranteed_hours: 0,
    pay_basis: 'eba_level',
    remuneration_level: '',
    annual_salary: 0,
    eba_exclusion_reason: '',
    level_note: '',
    multi_hire_request_ref: '',
    is_apprentice: false,
    apprentice_type: 'standard',
    apprentice_year: 1,
    has_completed_year_12: false,
    is_trainee: false,
    trainee_category: 'junior',
    trainee_level: 'A',
    trainee_exit_year: 12,
    trainee_years_out: 0,
    trainee_aqf_level: 3,
    trainee_year: 1,
    is_training_on_job: false,
    prefers_sba_loading: false,
    is_sws: false,
    sws_capacity_percentage: 50,
    is_sws_trial: false,
    sws_trial_start_date: '',
};

/**
 * Fields that change with the pay basis. Salaried: no level, no EA wage
 * schemes (Sch 4–6). Otherwise: no salary terms. Annualised Security keeps a
 * level only if it is one of Levels 3–6 (Sch 2 §2).
 */
function onPayBasis(state: ContractWizardFormState, basis: PayBasis): Partial<ContractWizardFormState> {
    if (basis === 'salary') {
        return {
            pay_basis: basis,
            remuneration_level: '',
            level_note: '',
            is_apprentice: false,
            is_trainee: false,
            is_sws: false,
        };
    }
    const keepLevel = basis === 'eba_level'
        || (state.remuneration_level !== '' && SECURITY_ANNUALISED_LEVELS.includes(state.remuneration_level));
    return {
        pay_basis: basis,
        annual_salary: 0,
        eba_exclusion_reason: '',
        ...(keepLevel ? {} : { remuneration_level: '' as const }),
    };
}

/** Hours a status implies when first set — mirrors useContractForm's defaultTermsFor. */
const defaultHoursFor = (status: string) => {
    if (status === 'Full-Time') return { contracted_weekly_hours: 38, annual_guaranteed_hours: 0 };
    if (status === 'Part-Time') return { contracted_weekly_hours: 20, annual_guaranteed_hours: 0 };
    if (status === 'Flexible Part-Time') return { contracted_weekly_hours: 0, annual_guaranteed_hours: 624 };
    return { contracted_weekly_hours: 0, annual_guaranteed_hours: 0 };
};

/** cl 12.2(b) — Full-Time is employed for an average of 38 ordinary hours a week. */
export const FULL_TIME_WEEKLY_HOURS = 38;

export interface HoursRule {
    valid: boolean;
    label: string;
    clause: string;
    cadence: '/week' | '/year';
    value: number;
    limitText: string;
    message: string;
}

/**
 * The contracted-hours rule for one Class 1 sub-class, straight from the EBA:
 *   Full-Time          — 38 h/week, fixed            (cl 12.2(b))
 *   Part-Time          — more than 0, less than 38 h/week (cl 12.3(b))
 *   Flexible Part-Time — 624–1,976 h/year            (cl 12.4(a), 35.3(a))
 * Null for Casual or an unchosen type: neither carries contracted hours.
 */
export function evaluateHoursRule(status: string, weekly: number, annual: number): HoursRule | null {
    if (status === 'Full-Time') {
        return {
            valid: weekly === FULL_TIME_WEEKLY_HOURS,
            label: 'Full-Time',
            clause: 'cl 12.2(b)',
            cadence: '/week',
            value: weekly,
            limitText: 'fixed at 38',
            message: 'Full-Time is 38 ordinary hours a week (cl 12.2(b)).',
        };
    }
    if (status === 'Part-Time') {
        return {
            valid: weekly > 0 && weekly < FULL_TIME_WEEKLY_HOURS,
            label: 'Part-Time',
            clause: 'cl 12.3(b)',
            cadence: '/week',
            value: weekly,
            limitText: 'less than 38',
            message: 'Part-Time hours must be more than 0 and less than 38 a week (cl 12.3(b)).',
        };
    }
    if (status === 'Flexible Part-Time') {
        return {
            valid: annual >= FLEXIBLE_PT_ANNUAL_HOURS_MIN && annual <= FLEXIBLE_PT_ANNUAL_HOURS_MAX,
            label: 'Flexible Part-Time',
            clause: 'cl 35.3(a)',
            cadence: '/year',
            value: annual,
            limitText: `${FLEXIBLE_PT_ANNUAL_HOURS_MIN}–${FLEXIBLE_PT_ANNUAL_HOURS_MAX.toLocaleString()}`,
            message: `Flexible Part-Time is engaged for ${FLEXIBLE_PT_ANNUAL_HOURS_MIN}–${FLEXIBLE_PT_ANNUAL_HOURS_MAX.toLocaleString()} ordinary hours a year (cl 35.3(a)).`,
        };
    }
    return null;
}

/** Rule text copied verbatim from AddContractDialog.tsx's mixedPermanentConflict. */
export const MIXED_PERMANENT_MESSAGE =
    'A Full-Time engagement is 38 hours and cannot be combined with another permanent (PT/FPT) engagement. Make additional roles Casual.';

/**
 * A new Full-Time engagement cannot coexist with another Active permanent
 * (non-Casual) contract. Shared by submit() and the orchestrator's live
 * warning display so the two can never disagree.
 */
export function computeMixedPermanentConflict(
    employmentStatus: string,
    existingContracts: readonly ExistingContract[],
): string | null {
    if (employmentStatus !== 'Full-Time') return null;
    const hasOtherPermanent = existingContracts.some(
        c => c.status === 'Active' && c.employment_status && c.employment_status !== 'Casual',
    );
    return hasOtherPermanent ? MIXED_PERMANENT_MESSAGE : null;
}

/** What the pay rules need to know about the chosen role and the EA on the start date. */
export interface WizardPayContext {
    band: RoleBand | null;
    isSecurityRole: boolean;
    /** The EA's highest annual rate (eaTopAnnualRate) — for the cl 2.2 cautions. */
    eaTopAnnualRate: number | null;
}

export const NO_PAY_CONTEXT: WizardPayContext = { band: null, isSecurityRole: false, eaTopAnnualRate: null };

export interface WizardTermsEvaluation {
    pay: PayEvaluation;
    engagement: EngagementEvaluation;
}

/**
 * The pay and engagement rules for the form as it stands. Shared by submit()
 * and the dialog's step gating so the two can never disagree.
 */
export function evaluateWizardTerms(
    formData: ContractWizardFormState,
    existingContracts: readonly ExistingContract[],
    context: WizardPayContext,
): WizardTermsEvaluation {
    const pay = evaluatePayTerms({
        employmentStatus: formData.employment_status,
        payBasis: formData.pay_basis,
        level: formData.remuneration_level,
        annualSalary: formData.annual_salary,
        exclusionReason: formData.eba_exclusion_reason,
        band: context.band,
        levelNote: formData.level_note,
        isSecurityRole: context.isSecurityRole,
        usesWageScheme: formData.is_apprentice || formData.is_trainee || formData.is_sws,
        contractedWeeklyHours: formData.employment_status === 'Full-Time'
            ? FULL_TIME_WEEKLY_HOURS
            : formData.contracted_weekly_hours,
        eaTopAnnualRate: context.eaTopAnnualRate,
    });
    const engagement = evaluateEngagement(
        formData.employment_status,
        formData.role_id,
        existingContracts,
        formData.multi_hire_request_ref,
    );
    return { pay, engagement };
}

export const useContractWizardForm = (employeeId: string, onSuccess?: () => void) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<ContractWizardFormState>(INITIAL_STATE);

    const reset = () => setFormData(INITIAL_STATE);

    const updateField = <K extends keyof ContractWizardFormState>(field: K, value: ContractWizardFormState[K]) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };

            if (field === 'organization_id') {
                next.department_id = '';
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'department_id') {
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'sub_department_id') {
                next.role_id = '';
            }
            if (field === 'organization_id' || field === 'department_id'
                || field === 'sub_department_id' || field === 'role_id') {
                // The note explains a level against ONE role's band.
                next.level_note = '';
            }

            if (field === 'contractClass') {
                if (value === 2) {
                    next.employment_status = 'Casual';
                    next.contracted_weekly_hours = 0;
                    next.annual_guaranteed_hours = 0;
                    // A casual is always on a level (Sch 2 §1).
                    Object.assign(next, onPayBasis(next, 'eba_level'));
                } else if (value === 1 && prev.contractClass === 2) {
                    next.employment_status = '';
                    next.contracted_weekly_hours = 0;
                    next.annual_guaranteed_hours = 0;
                }
            }

            if (field === 'employment_status') {
                const d = defaultHoursFor(value as string);
                next.contracted_weekly_hours = d.contracted_weekly_hours;
                next.annual_guaranteed_hours = d.annual_guaranteed_hours;
                // Back to the EA level; the dialog then applies the role's
                // default basis for this employment type.
                Object.assign(next, onPayBasis(next, 'eba_level'));
            }

            if (field === 'pay_basis') {
                Object.assign(next, onPayBasis(next, value as PayBasis));
            }

            // Mutual exclusivity — same as useContractForm.
            if (field === 'is_apprentice' && value) {
                next.is_trainee = false;
                next.is_sws = false;
            }
            if (field === 'is_trainee' && value) {
                next.is_apprentice = false;
                next.is_sws = false;
            }
            if (field === 'is_sws' && value) {
                next.is_apprentice = false;
                next.is_trainee = false;
            }

            return next;
        });
    };

    const weeklyHoursEquivalent = (): number => {
        if (formData.employment_status === 'Casual' || !formData.employment_status) return 0;
        return formData.contracted_weekly_hours > 0
            ? formData.contracted_weekly_hours
            : formData.annual_guaranteed_hours / 52;
    };

    const hoursRule = evaluateHoursRule(
        formData.employment_status,
        formData.contracted_weekly_hours,
        formData.annual_guaranteed_hours,
    );

    /** Pay and engagement rules are passed in so submit() checks exactly what the dialog showed. */
    const validate = (terms?: WizardTermsEvaluation): string[] => {
        const missing: string[] = [];
        if (!formData.contractClass) missing.push('Contract Class');
        if (!formData.organization_id) missing.push('Organization');
        if (!formData.department_id) missing.push('Department');
        if (!formData.sub_department_id) missing.push('Sub-Department');
        if (!formData.role_id) missing.push('Role');
        if (!formData.employment_status) missing.push('Employment Type');
        if (hoursRule && !hoursRule.valid) missing.push(hoursRule.message);
        for (const issue of [...(terms?.pay.errors ?? []), ...(terms?.engagement.errors ?? [])]) {
            missing.push(`${issue.message} (${issue.clause})`);
        }
        return missing;
    };

    const submit = async (
        existingContracts: readonly ExistingContract[] = [],
        payContext: WizardPayContext = NO_PAY_CONTEXT,
    ): Promise<boolean> => {
        const terms = evaluateWizardTerms(formData, existingContracts, payContext);
        const missing = validate(terms);
        if (missing.length > 0) {
            toast({
                title: 'Validation Error',
                description: `Please select the following: ${missing.join(', ')}`,
                variant: 'destructive',
            });
            return false;
        }

        const weekly = weeklyHoursEquivalent();

        const ceiling = validateContractHours(weekly, formData.employment_status, existingContracts);
        if (!ceiling.valid) {
            toast({
                title: 'Contract Hours Ceiling',
                description: ceiling.message || 'Combined contracted hours would exceed 38h/week.',
                variant: 'destructive',
            });
            return false;
        }

        const mixedConflict = computeMixedPermanentConflict(formData.employment_status, existingContracts);
        if (mixedConflict) {
            toast({
                title: 'Conflicting Engagements',
                description: mixedConflict,
                variant: 'destructive',
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            // Salaried contracts carry no level and no EA wage schemes; EA
            // contracts carry no salary terms (hr.user_contracts CHECKs).
            const isSalary = formData.pay_basis === 'salary';
            const isMultiHire = terms.engagement.kind === 'multi_hire';
            const levelNote = formData.level_note.trim();
            const row = {
                user_id: employeeId,
                position_id: crypto.randomUUID(),
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
                role_id: formData.role_id,
                pay_basis: formData.pay_basis,
                remuneration_level: isSalary ? null : formData.remuneration_level,
                annual_salary: isSalary ? formData.annual_salary : null,
                eba_exclusion_reason: isSalary ? formData.eba_exclusion_reason : null,
                engagement_kind: terms.engagement.kind,
                multi_hire_request_ref: isMultiHire ? formData.multi_hire_request_ref.trim() : null,
                notes: terms.pay.levelOutsideBand && levelNote
                    ? `Level ${formData.remuneration_level} is outside this role's range (${formatBand(payContext.band)}): ${levelNote}`
                    : null,
                employment_status: formData.employment_status,
                contracted_weekly_hours: formData.contracted_weekly_hours,
                annual_guaranteed_hours: formData.annual_guaranteed_hours,
                is_apprentice: !isSalary && formData.is_apprentice,
                apprentice_type: formData.apprentice_type,
                apprentice_year: formData.apprentice_year,
                has_completed_year_12: formData.has_completed_year_12,
                is_trainee: !isSalary && formData.is_trainee,
                trainee_category: formData.trainee_category,
                trainee_level: formData.trainee_level,
                trainee_exit_year: formData.trainee_exit_year,
                trainee_years_out: formData.trainee_years_out,
                trainee_aqf_level: formData.trainee_aqf_level,
                trainee_year: formData.trainee_year,
                is_training_on_job: formData.is_training_on_job,
                prefers_sba_loading: formData.prefers_sba_loading,
                is_sws: !isSalary && formData.is_sws,
                sws_capacity_percentage: formData.sws_capacity_percentage,
                is_sws_trial: !isSalary && formData.is_sws_trial,
                sws_trial_start_date: formData.sws_trial_start_date || null,
            };

            const { error } = await (supabase as any)
                .schema('hr').from('user_contracts').insert([row]);

            if (error) throw error;

            toast({ title: 'Success', description: 'Contract added successfully' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
            reset();
            if (onSuccess) onSuccess();
            return true;
        } catch (error: any) {
            console.error('Error adding contract:', error);
            toast({ title: 'Error', description: error.message || 'Failed to add contract', variant: 'destructive' });
            return false;
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        formData,
        setFormData,
        isSubmitting,
        updateField,
        reset,
        validate,
        submit,
        weeklyHoursEquivalent,
        hoursRule,
    };
};
