import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';

export interface ReferenceDataState {
    organizations: any[];
    departments: any[];
    subDepartments: any[];
    roles: any[];
    remLevels: any[];
}

export const useReferenceData = (shouldLoad: boolean = false) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<ReferenceDataState>({
        organizations: [],
        departments: [],
        subDepartments: [],
        roles: [],
        remLevels: [],
    });
    const [isLoaded, setIsLoaded] = useState(false);

    const loadReferenceData = useCallback(async () => {
        if (isLoaded || isLoading) return;

        setIsLoading(true);
        try {
            const [orgsRes, deptsRes, subDeptsRes, rolesRes, remLevelsRes] = await Promise.all([
                (supabase as any).schema('hr').from('organizations').select('id, name').order('name'),
                (supabase as any).schema('hr').from('departments').select('id, name, organization_id').order('name'),
                (supabase as any).schema('hr').from('subdepartments').select('id, name, department_id').order('name'),
                (supabase as any).schema('hr').from('roles').select('id, name, subdepartment_id, remuneration_level, employment_type, eba_level_min, eba_level_max, typically_salaried').order('name'),
                (supabase as any).schema('hr').from('remuneration_levels').select('level_number, level_name, description').order('level_number'),
            ]);

            setData({
                organizations: orgsRes.data || [],
                departments: deptsRes.data || [],
                subDepartments: subDeptsRes.data || [],
                roles: (rolesRes.data || []).map((r: any) => ({
                    id: r.id,
                    name: r.name,
                    sub_department_id: r.subdepartment_id,
                    remuneration_level: r.remuneration_level,
                    // Selected AND projected. The column was in the table all
                    // along but neither the query nor this map carried it, so
                    // any consumer reading `role.employment_type` silently got
                    // undefined — the same one-line silent drop that made the
                    // shift employment target inert.
                    employment_type: r.employment_type ?? null,
                    // The role's EA band (both null = no EA guidance) and its
                    // default pay basis for permanent engagements. Level itself
                    // is chosen on the contract.
                    eba_level_min: r.eba_level_min ?? null,
                    eba_level_max: r.eba_level_max ?? null,
                    typically_salaried: r.typically_salaried === true,
                })),
                remLevels: remLevelsRes.data || [],
            });
            setIsLoaded(true);
        } catch (error) {
            console.error('Error loading reference data:', error);
            toast({ title: 'Error', description: 'Failed to load form options', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isLoaded, isLoading, toast]);

    useEffect(() => {
        if (shouldLoad && !isLoaded) {
            loadReferenceData();
        }
    }, [shouldLoad, isLoaded, loadReferenceData]);

    return {
        ...data,
        isLoading,
        loadReferenceData
    };
};
