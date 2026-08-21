
import { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export interface ContractFormState {
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    /**
     * Every role this ONE position covers.
     *
     * A position is an appointment to a sub-department, and the roles are what
     * the person may be rostered as within it — "Event Setups, and I can work
     * Team Member, TM3 or Team Leader" is one appointment, not three. It was
     * three forms before, producing three rows that agreed on everything except
     * which role they named, with nothing recording that they belonged together.
     *
     * Still one ROW per role, deliberately: `role_id` is read in 168 places
     * across 77 files, and the row-per-role shape is fine. The rows now share a
     * `position_id` (migration 20260821110000), which is the fact that was
     * missing. The database already enforced the grain — (user, org, dept,
     * sub-dept, role) is UNIQUE — so a position can never hold a role twice.
     */
    role_ids: string[];
    /**
     * Edit mode only. In add mode each row takes the level from its OWN role:
     * L2 Team Member and L4 Team Leader are different levels, which is exactly
     * why the level belongs to the role and not to the position. All 200
     * production roles carry one, so nothing has to be guessed.
     */
    remuneration_level: number | '';
    employment_status: string;
    contracted_weekly_hours: number;
    annual_guaranteed_hours?: number;
    is_apprentice?: boolean;
    apprentice_type?: 'standard' | 'adult' | 'school_based';
    apprentice_year?: number;
    has_completed_year_12?: boolean;
    is_trainee?: boolean;
    trainee_category?: 'junior' | 'adult' | 'school_based';
    trainee_level?: 'A' | 'B';
    trainee_exit_year?: number;
    trainee_years_out?: number;
    trainee_aqf_level?: number;
    trainee_year?: number;
    is_training_on_job?: boolean;
    prefers_sba_loading?: boolean;
    is_sws?: boolean;
    sws_capacity_percentage?: number;
    is_sws_trial?: boolean;
    sws_trial_start_date?: string;
}

/** cl 12.4 — Flexible Part-Time annual guaranteed hours bounds (audit M-2). */
export const FLEXIBLE_PT_ANNUAL_HOURS_MIN = 624;
export const FLEXIBLE_PT_ANNUAL_HOURS_MAX = 1976;

const INITIAL_STATE: ContractFormState = {
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_ids: [],
    remuneration_level: '',
    employment_status: '',
    contracted_weekly_hours: 0,
    annual_guaranteed_hours: 0,
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
    sws_trial_start_date: ''
};

export const useContractForm = (employeeId: string, onSuccess?: () => void) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<ContractFormState>(INITIAL_STATE);

    const updateField = (field: keyof ContractFormState, value: any) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };

            // Roles belong to a sub-department, so moving up the tree
            // invalidates the whole selection rather than part of it.
            if (field === 'organization_id') {
                next.department_id = '';
                next.sub_department_id = '';
                next.role_ids = [];
            } else if (field === 'department_id') {
                next.sub_department_id = '';
                next.role_ids = [];
            } else if (field === 'sub_department_id') {
                next.role_ids = [];
            }

            // Auto-update hours based on status
            if (field === 'employment_status') {
                if (value === 'Full-Time') {
                    next.contracted_weekly_hours = 38;
                    next.annual_guaranteed_hours = 0;
                } else if (value === 'Part-Time') {
                    next.contracted_weekly_hours = 20;
                    next.annual_guaranteed_hours = 0;
                } else if (value === 'Flexible Part-Time') {
                    next.contracted_weekly_hours = 0; // FPT usually has no weekly minimum
                    next.annual_guaranteed_hours = 624;
                } else {
                    next.contracted_weekly_hours = 0;
                    next.annual_guaranteed_hours = 0;
                }
            }

            // Apprentice resets
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

            // Trainee resets
            if (field === 'is_trainee' && !value) {
                next.trainee_category = 'junior';
                next.trainee_level = 'A';
                next.trainee_exit_year = 12;
                next.trainee_years_out = 0;
            }
            
            return next;
        });
    };

    /** Weekly / annual hours implied by an employment status. */
    const hoursFor = (status: string): { weekly: number; annual: number } => {
        if (status === 'Full-Time') return { weekly: 38, annual: 0 };
        if (status === 'Part-Time') return { weekly: 20, annual: 0 };
        if (status === 'Flexible Part-Time') return { weekly: 0, annual: 624 };
        return { weekly: 0, annual: 0 };
    };

    /**
     * Add or remove one role from the position.
     *
     * `employmentType` seeds the position's employment status from the FIRST
     * role picked, and only while it is still unset — it is a hint, not a
     * source. `roles.employment_type` knows only 'Casual' and 'Full-Time' in
     * production and cannot express Part-Time or Flexible Part-Time at all, and
     * it disagrees with the contract actually written in 8 of 122 cases. The
     * person filling the form decides; this just saves them a click in the
     * common case.
     */
    const toggleRole = (roleId: string, employmentType?: string | null) => {
        setFormData(prev => {
            const has = prev.role_ids.includes(roleId);
            const role_ids = has
                ? prev.role_ids.filter(id => id !== roleId)
                : [...prev.role_ids, roleId];

            // Seeding only on the first pick, and only into an empty field.
            if (has || prev.role_ids.length > 0 || prev.employment_status || !employmentType) {
                return { ...prev, role_ids };
            }

            const lower = employmentType.toLowerCase();
            let seeded = '';
            if (lower.includes('full')) seeded = 'Full-Time';
            else if (lower.includes('part')) seeded = 'Part-Time';
            else if (lower.includes('casual')) seeded = 'Casual';
            if (!seeded) return { ...prev, role_ids };

            const { weekly, annual } = hoursFor(seeded);
            return {
                ...prev,
                role_ids,
                employment_status: seeded,
                contracted_weekly_hours: weekly,
                annual_guaranteed_hours: annual,
            };
        });
    };

    const validate = (): string[] => {
        const missing: string[] = [];
        if (!formData.organization_id) missing.push('Organization');
        if (!formData.department_id) missing.push('Department');
        if (!formData.sub_department_id) missing.push('Sub-Department');
        if (formData.role_ids.length === 0) missing.push('at least one Role');
        if (!formData.employment_status) missing.push('Employment Status');
        // Remuneration level is NOT checked here any more: each row takes it
        // from its own role. `submit` fails loudly if a selected role has none,
        // which no production role does — all 200 carry one.
        // AUDIT FIX M-2: cl 12.4 bounds Flexible Part-Time annual guaranteed
        // hours to 624-1,976h/year — previously unvalidated, so any value
        // (including 0 or an unrealistic figure) would silently save.
        if (formData.employment_status === 'Flexible Part-Time') {
            const hours = formData.annual_guaranteed_hours ?? 0;
            if (hours < FLEXIBLE_PT_ANNUAL_HOURS_MIN || hours > FLEXIBLE_PT_ANNUAL_HOURS_MAX) {
                missing.push(`Annual Guaranteed Hours between ${FLEXIBLE_PT_ANNUAL_HOURS_MIN}-${FLEXIBLE_PT_ANNUAL_HOURS_MAX}h (cl 12.4)`);
            }
        }
        return missing;
    };

    /**
     * Write the position: one row per selected role, all sharing a position_id.
     *
     * `roleLevels` maps role id → its remuneration level, supplied by the
     * caller because the reference data lives in the dialog. Passing it in
     * rather than re-fetching keeps a single source for what the user saw and
     * what gets written.
     */
    const submit = async (roleLevels?: Record<string, number | null | undefined>) => {
        const missing = validate();
        if (missing.length > 0) {
            toast({
                title: 'Validation Error',
                description: `Please select the following: ${missing.join(', ')}`,
                variant: 'destructive'
            });
            return false;
        }

        // Every role must resolve a level. This cannot happen with production
        // data — all 200 roles carry one — but writing a NULL level here would
        // land silently and then price the person off a missing basis, so it
        // stops at the form instead.
        const unlevelled = formData.role_ids.filter(
            id => (roleLevels?.[id] ?? null) === null,
        );
        if (unlevelled.length > 0 && formData.remuneration_level === '') {
            toast({
                title: 'Missing Remuneration Level',
                description: `${unlevelled.length} selected role(s) have no remuneration level configured. Set one on the role first.`,
                variant: 'destructive',
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            // ONE position, N rows. `crypto.randomUUID` rather than letting the
            // column default fire: the default gives each ROW its own position,
            // which is right for a single-role insert and wrong for this one.
            const positionId = crypto.randomUUID();

            const rows = formData.role_ids.map(roleId => ({
                user_id: employeeId,
                position_id: positionId,
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
                role_id: roleId,
                // Per ROLE — L2 and L4 are different levels within one position.
                remuneration_level: roleLevels?.[roleId] ?? formData.remuneration_level,
                // Per POSITION — measured across production, employment status
                // never varies between the roles of one appointment.
                employment_status: formData.employment_status,
                contracted_weekly_hours: formData.contracted_weekly_hours,
                annual_guaranteed_hours: formData.annual_guaranteed_hours,
                is_apprentice: formData.is_apprentice,
                apprentice_type: formData.apprentice_type,
                apprentice_year: formData.apprentice_year,
                has_completed_year_12: formData.has_completed_year_12,
                is_trainee: formData.is_trainee,
                trainee_category: formData.trainee_category,
                trainee_level: formData.trainee_level,
                trainee_exit_year: formData.trainee_exit_year,
                trainee_years_out: formData.trainee_years_out,
                trainee_aqf_level: formData.trainee_aqf_level,
                trainee_year: formData.trainee_year,
                is_training_on_job: formData.is_training_on_job,
                prefers_sba_loading: formData.prefers_sba_loading,
                is_sws: formData.is_sws,
                sws_capacity_percentage: formData.sws_capacity_percentage,
                is_sws_trial: formData.is_sws_trial,
                sws_trial_start_date: formData.sws_trial_start_date || null
            }));

            // A single insert of all rows, so a partial position is not a
            // reachable state: either the whole appointment lands or none of it
            // does. Inserting in a loop could leave someone holding two of the
            // three roles they were appointed to, with nothing to show it.
            const { error } = await (supabase as any)
                .schema('hr').from('user_contracts').insert(rows);

            if (error) throw error;

            toast({
                title: 'Success',
                description: rows.length === 1
                    ? 'Contract added successfully'
                    : `Position added with ${rows.length} roles`,
            });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });

            setFormData(prev => ({
                ...prev,
                role_ids: [],
                remuneration_level: '',
            }));

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
        isSubmitting,
        updateField,
        toggleRole,
        submit,
        setFormData
    };
};
