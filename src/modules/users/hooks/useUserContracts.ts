/**
 * A person's contracts, with role and place names attached — shared by the
 * Contracts and Access sections of the Users page (one fetch, one cache entry).
 */
import { supabase } from '@/platform/supabase/client';



/**
 * Attach role and place names to contract rows under the keys the tables read
 * (roles, organizations, departments, sub_departments). public.user_contracts is
 * a VIEW over hr.user_contracts with no FK metadata, so PostgREST can't embed them.
 */
export async function attachContractNames(rows: any[]) {
    const roleIds = [...new Set(rows.map(r => r.role_id).filter(Boolean))];
    const orgIds = [...new Set(rows.map(r => r.organization_id).filter(Boolean))];
    const deptIds = [...new Set(rows.map(r => r.department_id).filter(Boolean))];
    const subDeptIds = [...new Set(rows.map(r => r.sub_department_id).filter(Boolean))];

    const [rolesRes, orgsRes, deptsRes, subDeptsRes] = await Promise.all([
        roleIds.length ? supabase.from('roles').select('id, name').in('id', roleIds) : Promise.resolve({ data: [] as any[] }),
        orgIds.length ? supabase.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as any[] }),
        deptIds.length ? supabase.from('departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] as any[] }),
        subDeptIds.length ? supabase.from('sub_departments').select('id, name').in('id', subDeptIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const roleById = new Map((rolesRes.data ?? []).map((r: any) => [r.id, r]));
    const orgById = new Map((orgsRes.data ?? []).map((o: any) => [o.id, o]));
    const deptById = new Map((deptsRes.data ?? []).map((d: any) => [d.id, d]));
    const subDeptById = new Map((subDeptsRes.data ?? []).map((sd: any) => [sd.id, sd]));

    return rows.map(c => ({
        ...c,
        roles: c.role_id ? roleById.get(c.role_id) ?? null : null,
        organizations: c.organization_id ? orgById.get(c.organization_id) ?? null : null,
        departments: c.department_id ? deptById.get(c.department_id) ?? null : null,
        sub_departments: c.sub_department_id ? subDeptById.get(c.sub_department_id) ?? null : null,
    }));
}
