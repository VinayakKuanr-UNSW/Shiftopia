/**
 * Everything the Users page table shows (2026-10-16): people, every contract
 * with its role and place names, skills and licences — grouped per person
 * inside the page's global scope. The page is the Admin suite's, which reads
 * every row, so this loads them all and scopes them here; one refresh after
 * any change reloads the lot.
 */
import { useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { AuthContext } from '@/platform/auth/AuthProvider';
import type { ScopeSelection } from '@/platform/auth/types';
import type { ContractRow } from '../domain/contractRows';
import { groupUsers, type LicenceRef, type PersonRef, type SkillRef } from '../domain/usersTable';
import { attachContractNames } from './useUserContracts';

export const USERS_TABLE_KEY = ['users_table'] as const;

export function useUsersTable(scope: ScopeSelection, options: { includeUnplaced?: boolean } = {}) {
    const { includeUnplaced } = options;
    const queryClient = useQueryClient();
    const refreshPermissions = useContext(AuthContext)?.refreshPermissions;

    const people = useQuery({
        queryKey: [...USERS_TABLE_KEY, 'people'],
        queryFn: async (): Promise<PersonRef[]> => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, full_name, email')
                .order('full_name');
            if (error) throw error;
            return (data ?? []).map((p) => ({
                id: p.id,
                name: (p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim() || p.email || 'Unnamed',
                email: p.email ?? null,
            }));
        },
    });

    const contracts = useQuery({
        queryKey: [...USERS_TABLE_KEY, 'contracts'],
        queryFn: async (): Promise<ContractRow[]> => {
            const { data, error } = await supabase.from('user_contracts').select('*');
            if (error) throw error;
            return (await attachContractNames((data ?? []) as any[])) as ContractRow[];
        },
    });

    const skills = useQuery({
        queryKey: [...USERS_TABLE_KEY, 'skills'],
        queryFn: async (): Promise<SkillRef[]> => {
            const { data, error } = await supabase
                .from('employee_skills')
                .select('employee_id, status, expiration_date, skill:skills(name)');
            if (error) throw error;
            return (data ?? []).map((r: any) => ({
                employee_id: r.employee_id,
                name: r.skill?.name ?? 'Skill',
                status: r.status ?? null,
                expiration_date: r.expiration_date ?? null,
            }));
        },
    });

    const licences = useQuery({
        queryKey: [...USERS_TABLE_KEY, 'licences'],
        queryFn: async (): Promise<LicenceRef[]> => {
            const { data, error } = await supabase
                .from('employee_licenses')
                .select('employee_id, license_type, status, verification_status, expiration_date, has_restricted_work_limit, license:licenses(name)');
            if (error) throw error;
            return (data ?? []).map((r: any) => ({
                employee_id: r.employee_id,
                name: r.license?.name ?? 'Licence',
                license_type: r.license_type ?? null,
                status: r.status ?? null,
                verification_status: r.verification_status ?? null,
                expiration_date: r.expiration_date ?? null,
                has_restricted_work_limit: r.has_restricted_work_limit ?? null,
            }));
        },
    });

    const groups = useMemo(() => groupUsers({
        people: people.data ?? [],
        contracts: contracts.data ?? [],
        skills: skills.data ?? [],
        licences: licences.data ?? [],
        scope,
        includeUnplaced,
    }), [people.data, contracts.data, skills.data, licences.data, scope, includeUnplaced]);

    /** All of a person's contracts, in scope or not: the 38-hour and Full-Time rules weigh every one. */
    const contractsOf = useCallback(
        (personId: string) => (contracts.data ?? []).filter((c) => c.user_id === personId),
        [contracts.data],
    );

    const refresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: USERS_TABLE_KEY });
        // The global scope filter's places are built from the signed-in user's
        // contracts — this table. Editing one of their own moves the filter now,
        // not at the next sign-in. Unchanged permissions are kept as they were.
        void refreshPermissions?.();
    }, [queryClient, refreshPermissions]);

    return {
        groups,
        contractsOf,
        refresh,
        // Skills and licences are extra columns: the table can show without them.
        isLoading: people.isLoading || contracts.isLoading,
        isError: people.isError || contracts.isError,
        refetch: () => { void people.refetch(); void contracts.refetch(); void skills.refetch(); void licences.refetch(); },
    };
}
