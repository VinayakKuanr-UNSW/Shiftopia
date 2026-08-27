/**
 * Baseline FT — data hooks.
 *
 * ONE SUB-DEPARTMENT, PICKED EXPLICITLY. Baseline generates for a single team,
 * and the manager chooses which. It deliberately does NOT read `scope`'s first
 * entry: reading `scope.org_ids[0]` is a known defect class in this codebase —
 * thirteen-plus pages silently show one organisation's data to someone who can
 * see several — and a feature that WRITES shifts is the worst place to repeat
 * it. An unpicked sub-department yields no query, not a guess.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import {
    applyBaselineRun,
    generateBaselineRun,
    type ApplyRunResult,
    type GenerateRunInput,
    type GenerateRunResult,
} from '../api/baselineFt.commands';

export const baselineFtKeys = {
    all: ['baseline-ft'] as const,
    subDepartments: (subdeptIds: readonly string[]) =>
        [...baselineFtKeys.all, 'sub-departments', [...subdeptIds].sort()] as const,
    templates: (subDepartmentId: string | null) =>
        [...baselineFtKeys.all, 'templates', subDepartmentId] as const,
    liveRun: (subDepartmentId: string | null, start: string, end: string) =>
        [...baselineFtKeys.all, 'live-run', subDepartmentId, start, end] as const,
};

/* ────────────────────────────────────────────────────────────────────────────
   Sub-departments the manager may roster
   ──────────────────────────────────────────────────────────────────────────── */

export interface SubDepartmentOption {
    id: string;
    name: string;
    departmentId: string;
    organizationId: string;
}

export function useRosterableSubDepartments(subdeptIds: readonly string[]) {
    return useQuery({
        queryKey: baselineFtKeys.subDepartments(subdeptIds),
        enabled: subdeptIds.length > 0,
        queryFn: async (): Promise<SubDepartmentOption[]> => {
            const { data, error } = await supabase
                .from('sub_departments')
                .select('id, name, department_id, departments!inner(id, organization_id)')
                .in('id', subdeptIds as string[])
                .order('name');

            if (error) throw error;

            return (data ?? []).map(row => {
                const dept = (row as { departments?: { organization_id?: string } }).departments;
                return {
                    id: String(row.id),
                    name: String(row.name ?? ''),
                    departmentId: String(row.department_id ?? ''),
                    organizationId: String(dept?.organization_id ?? ''),
                };
            }).filter(s => s.departmentId && s.organizationId);
        },
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Patterns
   ──────────────────────────────────────────────────────────────────────────── */

export interface PatternOption {
    id: string;
    name: string;
    /** Full-time shifts that carry a weekday — the ones a baseline can use. */
    usableShifts: number;
    /** Shifts with `day_of_week = NULL`. A template is unusable while any exist. */
    undatedShifts: number;
    /** Non-FT shifts, which are ignored rather than disqualifying. */
    nonFtShifts: number;
    eligible: boolean;
    /** Why this template cannot be used, in the words the picker shows. */
    reason: string | null;
}

/**
 * Templates for a sub-department, each carrying whether it can serve as a
 * baseline pattern.
 *
 * Eligibility is computed HERE rather than discovered at Generate, because a
 * disabled option with a stated reason is a fixable problem and a missing
 * option is a support ticket. Every `template_shifts` row in production
 * currently has `day_of_week = NULL`, so without this the picker would look
 * full and every run would fail.
 */
export function useBaselinePatterns(subDepartmentId: string | null) {
    return useQuery({
        queryKey: baselineFtKeys.templates(subDepartmentId),
        enabled: Boolean(subDepartmentId),
        queryFn: async (): Promise<PatternOption[]> => {
            const { data, error } = await supabase
                .from('roster_templates')
                .select(`
                    id, name, is_active,
                    template_groups (
                        template_subgroups (
                            template_shifts ( id, day_of_week, target_employment_type )
                        )
                    )
                `)
                .eq('sub_department_id', subDepartmentId!)
                .order('name');

            if (error) throw error;

            return (data ?? []).map(tpl => {
                let usable = 0, undated = 0, nonFt = 0;

                const groups = (tpl as { template_groups?: unknown[] }).template_groups ?? [];
                for (const g of groups) {
                    const subgroups =
                        (g as { template_subgroups?: unknown[] }).template_subgroups ?? [];
                    for (const sg of subgroups) {
                        const shifts =
                            (sg as { template_shifts?: Record<string, unknown>[] })
                                .template_shifts ?? [];
                        for (const s of shifts) {
                            if (s.day_of_week === null || s.day_of_week === undefined) undated++;
                            else if (s.target_employment_type !== 'FT') nonFt++;
                            else usable++;
                        }
                    }
                }

                const reason =
                    undated > 0
                        ? `${undated} shift${undated === 1 ? '' : 's'} ${undated === 1 ? 'has' : 'have'} no day of the week set`
                        : usable === 0
                            ? 'no full-time shifts'
                            : null;

                return {
                    id: String(tpl.id),
                    name: String(tpl.name ?? ''),
                    usableShifts: usable,
                    undatedShifts: undated,
                    nonFtShifts: nonFt,
                    eligible: reason === null,
                    reason,
                };
            });
        },
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Generate / Apply
   ──────────────────────────────────────────────────────────────────────────── */

export function useGenerateBaseline() {
    const qc = useQueryClient();
    return useMutation<GenerateRunResult, Error, GenerateRunInput>({
        mutationFn: input => generateBaselineRun(input),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: baselineFtKeys.all });
        },
    });
}

export interface ApplyBaselineInput {
    runId: string;
    actorId: string;
    resolveTarget: Parameters<typeof applyBaselineRun>[2];
}

export function useApplyBaseline() {
    const qc = useQueryClient();
    return useMutation<ApplyRunResult, Error, ApplyBaselineInput>({
        mutationFn: ({ runId, actorId, resolveTarget }) =>
            applyBaselineRun(runId, actorId, resolveTarget),
        onSuccess: () => {
            // Apply writes real shifts, so every roster view is now stale.
            void qc.invalidateQueries({ queryKey: baselineFtKeys.all });
            void qc.invalidateQueries({ queryKey: ['shifts'] });
            void qc.invalidateQueries({ queryKey: ['rosters'] });
        },
    });
}
