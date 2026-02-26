import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRolesV2() {
    const orgId = '10fce0c7-0efc-40ad-bd1c-19cd471243fa'; // ICC
    const deptId = 'd82ca488-8cd3-4e89-9aae-b7f3ec29a43a'; // Event Delivery
    const subDeptId = '4baed44a-9c7f-4428-a400-f938d227bbfd'; // Event Setups

    const [explicitSubDeptRes, parentDeptAndGlobalRes] = await Promise.all([
        supabase
            .from('roles')
            .select('id, name, department_id, sub_department_id')
            .eq('sub_department_id', subDeptId),
        supabase
            .from('roles')
            .select('id, name, department_id, sub_department_id')
            .is('sub_department_id', null)
            .or(`department_id.eq.${deptId},department_id.is.null`)
    ]);

    const mergedRoles = [
        ...(explicitSubDeptRes.data || []),
        ...(parentDeptAndGlobalRes.data || [])
    ];

    console.log(`\nNew Logic Found ${mergedRoles.length} roles.`);
    const withoutSubDept = mergedRoles.filter(r => !r.sub_department_id);
    console.log(`Of those, ${withoutSubDept.length} have NO sub_department_id (parent dept or global).`);

    const withOtherSubDept = mergedRoles.filter(r => r.sub_department_id && r.sub_department_id !== subDeptId);
    console.log(`Of those, ${withOtherSubDept.length} belong to a DIFFERENT sub-department.`);
    if (withOtherSubDept.length > 0) console.log(withOtherSubDept.slice(0, 5));
}

checkRolesV2();
