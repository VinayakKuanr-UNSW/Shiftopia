
import { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

/** What one selected role is engaged on. */
export interface RoleTerms {
    /** '' until chosen. One of the four `public.employment_status` values. */
    employment_status: string;
    /** Always 0 for Casual — casuals carry no contracted-hours floor. */
    contracted_weekly_hours: number;
    /** Flexible Part-Time only (cl 12.4 / 35.3(a): 624–1,976 h/yr). */
    annual_guaranteed_hours: number;
}

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
     * The TERMS each selected role is engaged on — its own employment type and
     * its own hours.
     *
     * WHY THIS IS PER ROLE. The original model made employment type a property
     * of the position, on the measured basis that it never varied between the
     * roles of one appointment. That was true of the data and false of the
     * business: EBA cl 13 (Multi-Hiring) expressly contemplates a permanent
     * Team Member ALSO being engaged casually for work outside their usual job
     * description, paid "the appropriate rate of pay for a casual Team Member
     * engaged in that particular job classification". A Full-Time Event Setups
     * Manager who also ushers casually is one person holding two engagements,
     * and the form has to be able to say so.
     *
     * A POSITION IS STILL A THING — it is just no longer "everything selected".
     * `submit` groups the selected roles by their terms and writes one
     * `position_id` per group, so three Casual roles remain ONE appointment
     * covering three roles, exactly as before, while a Full-Time role picked
     * alongside them becomes its own.
     *
     * Keyed by role id rather than held as an array so that toggling one role
     * can never renumber or overwrite another's terms.
     */
    role_terms: Record<string, RoleTerms>;
    /**
     * Edit mode only. In add mode each row takes the level from its OWN role:
     * L2 Team Member and L4 Team Leader are different levels, which is exactly
     * why the level belongs to the role and not to the position. All 200
     * production roles carry one, so nothing has to be guessed.
     */
    remuneration_level: number | '';
    /**
     * The DEFAULT applied to the next role picked — not a value imposed on the
     * roles already configured. Changing it must never reach back and rewrite
     * a choice someone has already made against a specific role.
     */
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

/** cl 35 — ordinary hours must not exceed an average of 38 per week. */
export const MAX_WEEKLY_HOURS = 38;

/** Hours a status implies when a role is first given it. */
export const defaultTermsFor = (status: string): Omit<RoleTerms, 'employment_status'> => {
    if (status === 'Full-Time') return { contracted_weekly_hours: 38, annual_guaranteed_hours: 0 };
    if (status === 'Part-Time') return { contracted_weekly_hours: 20, annual_guaranteed_hours: 0 };
    if (status === 'Flexible Part-Time') return { contracted_weekly_hours: 0, annual_guaranteed_hours: 624 };
    // Casual, and the not-yet-chosen empty case. Casuals are engaged by the
    // hour with no firm advance commitment (cl 12.5(a)) — there is no weekly
    // figure to contract, which is why the field is locked rather than blank.
    return { contracted_weekly_hours: 0, annual_guaranteed_hours: 0 };
};

/** Casual hours never count toward the 38h ceiling. */
export const countsTowardCeiling = (status: string): boolean =>
    status === 'Full-Time' || status === 'Part-Time' || status === 'Flexible Part-Time';

/** A role's terms, falling back to the form default until it has its own. */
export const termsForRole = (form: ContractFormState, roleId: string): RoleTerms =>
    form.role_terms[roleId] ?? {
        employment_status: form.employment_status,
        ...defaultTermsFor(form.employment_status),
    };

export interface DerivedPosition {
    /** Stable identity of the group — same terms means same appointment. */
    key: string;
    employment_status: string;
    contracted_weekly_hours: number;
    annual_guaranteed_hours: number;
    roleIds: string[];
    /** What this ONE position contributes to the 38h ceiling. */
    weeklyHours: number;
}

/**
 * The appointments implied by the current selection.
 *
 * Roles agreeing on every term are ONE position — that is what the position
 * model has always meant, and it keeps "Team Member, TM3 and Team Leader, all
 * Casual, in Event Setups" a single appointment covering three roles rather
 * than three appointments. Roles that disagree become separate positions,
 * which is what makes a Full-Time role alongside a Casual one expressible.
 *
 * Grouping on hours as well as status matters: a position carries ONE hours
 * figure, so two Part-Time roles at different hours are genuinely two
 * appointments and must be counted twice against the ceiling.
 */
export function derivePositions(form: ContractFormState): DerivedPosition[] {
    const byKey = new Map<string, DerivedPosition>();

    for (const roleId of form.role_ids) {
        const t = termsForRole(form, roleId);
        const key = `${t.employment_status}|${t.contracted_weekly_hours}|${t.annual_guaranteed_hours}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.roleIds.push(roleId);
            continue;
        }
        // Flexible Part-Time may carry its commitment annually rather than
        // weekly; convert so one ceiling can measure both (the same conversion
        // hr.fn_check_user_contract_guardrails does).
        const weekly = !countsTowardCeiling(t.employment_status)
            ? 0
            : t.contracted_weekly_hours > 0
                ? t.contracted_weekly_hours
                : t.annual_guaranteed_hours / 52;
        byKey.set(key, {
            key,
            employment_status: t.employment_status,
            contracted_weekly_hours: t.contracted_weekly_hours,
            annual_guaranteed_hours: t.annual_guaranteed_hours,
            roleIds: [roleId],
            weeklyHours: weekly,
        });
    }

    return [...byKey.values()];
}

/**
 * Contracted hours per week across the whole selection.
 *
 * Counted ONCE PER POSITION, not once per role. Three Full-Time roles in one
 * appointment are 38 hours, not 114 — the person works one 38h week and may be
 * rostered as any of the three. This mirrors `hr.fn_check_user_contract_guardrails`
 * exactly (migration 20260824130000); if the two ever disagree the form will
 * either refuse something the database accepts or promise something it rejects.
 */
export function totalWeeklyHours(form: ContractFormState): number {
    return derivePositions(form).reduce((sum, p) => sum + p.weeklyHours, 0);
}

const INITIAL_STATE: ContractFormState = {
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_ids: [],
    role_terms: {},
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
                next.role_terms = {};
            } else if (field === 'department_id') {
                next.sub_department_id = '';
                next.role_ids = [];
                next.role_terms = {};
            } else if (field === 'sub_department_id') {
                next.role_ids = [];
                next.role_terms = {};
            }

            // The default that the NEXT role picked will inherit. Deliberately
            // does NOT reach into `role_terms`: a role already configured keeps
            // what it was given, which is the whole point of per-role terms.
            if (field === 'employment_status') {
                const d = defaultTermsFor(value);
                next.contracted_weekly_hours = d.contracted_weekly_hours;
                next.annual_guaranteed_hours = d.annual_guaranteed_hours;
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

    /**
     * Add or remove one role.
     *
     * NO SEEDING. A role is added with an EMPTY employment type and the person
     * filling the form states it in the table.
     *
     * There used to be a hint: the first role picked took its type from
     * `roles.employment_type`. Three things were wrong with it. The column knows
     * only 'Casual' and 'Full-Time' in production, so it cannot express
     * Part-Time or Flexible Part-Time at all; it disagreed with the contract
     * actually written in 8 of 122 cases; and because it fired only on the FIRST
     * pick, the first row arrived pre-filled while every row after it did not —
     * which reads as a bug whichever value it guessed.
     *
     * An empty type is not a gap in the form, it is the question the form is
     * asking. `validate` names any role still missing one, and the save button
     * stays disabled until each has been answered.
     */
    const toggleRole = (roleId: string) => {
        setFormData(prev => {
            if (prev.role_ids.includes(roleId)) {
                // Removing drops the terms too, so re-adding starts clean
                // rather than resurrecting a choice made earlier.
                const { [roleId]: _dropped, ...role_terms } = prev.role_terms;
                return { ...prev, role_ids: prev.role_ids.filter(id => id !== roleId), role_terms };
            }
            return {
                ...prev,
                role_ids: [...prev.role_ids, roleId],
                role_terms: {
                    ...prev.role_terms,
                    [roleId]: { employment_status: '', contracted_weekly_hours: 0, annual_guaranteed_hours: 0 },
                },
            };
        });
    };

    /**
     * Change ONE role's terms. Nothing else moves.
     *
     * Switching employment type resets that role's hours to the figure the new
     * type implies, because carrying 38 hours across to a Casual engagement
     * would write a contracted-hours floor that a casual does not have.
     */
    const setRoleTerm = (roleId: string, patch: Partial<RoleTerms>) => {
        setFormData(prev => {
            const current = termsForRole(prev, roleId);
            const next: RoleTerms = { ...current, ...patch };

            if (patch.employment_status !== undefined
                && patch.employment_status !== current.employment_status) {
                Object.assign(next, defaultTermsFor(patch.employment_status));
            }

            // Casual is engaged by the hour (cl 12.5(a)) — never contracted hours.
            if (next.employment_status === 'Casual') {
                next.contracted_weekly_hours = 0;
                next.annual_guaranteed_hours = 0;
            }

            return { ...prev, role_terms: { ...prev.role_terms, [roleId]: next } };
        });
    };

    const validate = (): string[] => {
        const missing: string[] = [];
        if (!formData.organization_id) missing.push('Organization');
        if (!formData.department_id) missing.push('Department');
        if (!formData.sub_department_id) missing.push('Sub-Department');
        if (formData.role_ids.length === 0) missing.push('at least one Role');

        // Every selected role needs a target type of its own. The form default
        // covers the common case, but a role can be picked before one is set.
        const untyped = formData.role_ids.filter(id => !termsForRole(formData, id).employment_status);
        if (untyped.length > 0) {
            missing.push(untyped.length === formData.role_ids.length
                ? 'a Target Employment Type for each role'
                : `a Target Employment Type for ${untyped.length} role(s)`);
        }

        // Remuneration level is NOT checked here any more: each row takes it
        // from its own role. `submit` fails loudly if a selected role has none,
        // which no production role does — all 200 carry one.
        //
        // AUDIT FIX M-2: cl 12.4 bounds Flexible Part-Time annual guaranteed
        // hours to 624-1,976h/year. Checked PER POSITION now, since two roles
        // can be flexible on different commitments.
        const positions = derivePositions(formData);
        const badFpt = positions.filter(p =>
            p.employment_status === 'Flexible Part-Time'
            && (p.annual_guaranteed_hours < FLEXIBLE_PT_ANNUAL_HOURS_MIN
                || p.annual_guaranteed_hours > FLEXIBLE_PT_ANNUAL_HOURS_MAX));
        if (badFpt.length > 0) {
            missing.push(`Annual Guaranteed Hours between ${FLEXIBLE_PT_ANNUAL_HOURS_MIN}-${FLEXIBLE_PT_ANNUAL_HOURS_MAX}h (cl 12.4)`);
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
            // One position per TERMS GROUP. `crypto.randomUUID` rather than
            // letting the column default fire: the default gives each ROW its
            // own position, which would scatter a three-role Casual appointment
            // into three separate ones.
            const positions = derivePositions(formData);
            const positionIds = new Map(positions.map(p => [p.key, crypto.randomUUID()]));

            // Emitted in the user's selection order rather than grouped order,
            // so the rows read back in the order they were picked.
            const rows = formData.role_ids.map(roleId => {
                const t = termsForRole(formData, roleId);
                const key = `${t.employment_status}|${t.contracted_weekly_hours}|${t.annual_guaranteed_hours}`;
                return {
                user_id: employeeId,
                position_id: positionIds.get(key)!,
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
                role_id: roleId,
                // Per ROLE — L2 and L4 are different levels within one position.
                remuneration_level: roleLevels?.[roleId] ?? formData.remuneration_level,
                // Per ROLE — a Full-Time manager may also usher casually (cl 13).
                employment_status: t.employment_status,
                contracted_weekly_hours: t.contracted_weekly_hours,
                annual_guaranteed_hours: t.annual_guaranteed_hours,
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
                };
            });

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
                    : positions.length === 1
                        ? `Position added with ${rows.length} roles`
                        : `${positions.length} positions added covering ${rows.length} roles`,
            });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });

            setFormData(prev => ({
                ...prev,
                role_ids: [],
                role_terms: {},
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

    /**
     * Save an edit to a WHOLE sub-department engagement.
     *
     * The card edits a place, not a row: every role the person holds in that
     * sub-department is ticked when the dialog opens, and unticking one is how
     * it gets removed. So this is a diff, not an insert.
     *
     *   removed  — ticked before, not now      -> DELETE
     *   added    — ticked now, not before      -> INSERT
     *   kept     — ticked both times           -> UPDATE its terms
     *
     * POSITION IDS ARE RECOMPUTED, not preserved per row. A position is "the
     * roles that agree on their terms", so moving one role from Casual to
     * Full-Time genuinely moves it to a different appointment. Where a terms
     * group already contains a row, that row's `position_id` is reused so the
     * appointment keeps its identity; a group made entirely of new or newly
     * regrouped roles gets a fresh one.
     *
     * NOT ATOMIC — three statements, and a failure between them leaves the
     * engagement half-edited. Accepted deliberately: making it atomic needs an
     * RPC, the alternative (a single upsert) cannot express the deletes, and
     * the operation is a rare admin action on a handful of rows. The order is
     * chosen so the visible failure is the safe one: deletes go LAST, so an
     * interruption leaves extra roles rather than silently dropping one.
     */
    const submitScopeUpdate = async (
        originalRows: Array<{ id: string; role_id: string; position_id?: string | null }>,
        roleLevels?: Record<string, number | null | undefined>,
    ) => {
        const missing = validate();
        if (missing.length > 0) {
            toast({
                title: 'Validation Error',
                description: `Please select the following: ${missing.join(', ')}`,
                variant: 'destructive',
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            const byRole = new Map(originalRows.map(r => [r.role_id, r]));
            const selected = new Set(formData.role_ids);

            const removedIds = originalRows.filter(r => !selected.has(r.role_id)).map(r => r.id);

            // One position id per terms group, reusing an existing one so an
            // unchanged appointment keeps its identity.
            //
            // An id may be claimed by AT MOST ONE group. Splitting a Casual
            // position by retyping one of its roles produces two groups that
            // both contain a role carrying the old id, and handing it to both
            // would merge two distinct appointments back into one under the
            // same key — invisible until something grouped by it.
            //
            // The group with the most claims on an id keeps it, so the majority
            // of the original appointment stays put and the role that moved is
            // the one that gets something new. Ties break on the group key so
            // the result is deterministic rather than insertion-ordered.
            const groups = derivePositions(formData);
            const claims = groups.map(p => ({
                key: p.key,
                counts: p.roleIds.reduce((m, id) => {
                    const pid = byRole.get(id)?.position_id;
                    if (pid) m.set(pid, (m.get(pid) ?? 0) + 1);
                    return m;
                }, new Map<string, number>()),
            }));

            const positionIds = new Map<string, string>();
            const taken = new Set<string>();
            for (const { key, counts } of [...claims].sort((a, b) => a.key.localeCompare(b.key))) {
                const best = [...counts.entries()]
                    .filter(([pid]) => !taken.has(pid))
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
                if (best) taken.add(best);
                positionIds.set(key, best ?? crypto.randomUUID());
            }

            const shared = {
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
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
                sws_trial_start_date: formData.sws_trial_start_date || null,
            };

            const rowFor = (roleId: string) => {
                const t = termsForRole(formData, roleId);
                const key = `${t.employment_status}|${t.contracted_weekly_hours}|${t.annual_guaranteed_hours}`;
                return {
                    ...shared,
                    user_id: employeeId,
                    role_id: roleId,
                    position_id: positionIds.get(key)!,
                    remuneration_level: roleLevels?.[roleId] ?? formData.remuneration_level,
                    employment_status: t.employment_status,
                    contracted_weekly_hours: t.contracted_weekly_hours,
                    annual_guaranteed_hours: t.annual_guaranteed_hours,
                };
            };

            const db = (supabase as any).schema('hr').from('user_contracts');

            const added = formData.role_ids.filter(id => !byRole.has(id));
            if (added.length > 0) {
                const { error } = await db.insert(added.map(rowFor));
                if (error) throw error;
            }

            for (const roleId of formData.role_ids.filter(id => byRole.has(id))) {
                const { error } = await db.update(rowFor(roleId)).eq('id', byRole.get(roleId)!.id);
                if (error) throw error;
            }

            // Last, so an interruption leaves extra roles rather than none.
            if (removedIds.length > 0) {
                const { error } = await db.delete().in('id', removedIds);
                if (error) throw error;
            }

            toast({ title: 'Saved', description: 'Engagement updated.' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
            if (onSuccess) onSuccess();
            return true;
        } catch (error: any) {
            console.error('Error updating engagement:', error);
            toast({ title: 'Error', description: error.message || 'Failed to update engagement', variant: 'destructive' });
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
        setRoleTerm,
        submit,
        submitScopeUpdate,
        setFormData,
        /** Derived, so the table and its total can never disagree. */
        positions: derivePositions(formData),
        totalWeeklyHours: totalWeeklyHours(formData),
    };
};
