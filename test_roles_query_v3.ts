import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRolesV3() {
    const deptId = 'd82ca488-8cd3-4e89-9aae-b7f3ec29a43a'; // Event Delivery
    const subDeptId = '4baed44a-9c7f-4428-a400-f938d227bbfd'; // Event Setups

    const [explicitSubDeptRes, parentDeptRes, globalRes] = await Promise.all([
        // 1. Explicitly mapped to this SubDept
        supabase
            .from('roles')
            .select('id, name, department_id, sub_department_id')
            .eq('sub_department_id', subDeptId),

        // 2. Mapped to Parent Dept, but NO SubDept (meaning it applies to all subdepts)
        supabase
            .from('roles')
            .select('id, name, department_id, sub_department_id')
            .eq('department_id', deptId)
            .is('sub_department_id', null),

        // 3. Global roles (mapped to NO Dept)
        supabase
            .from('roles')
            .select('id, name, department_id, sub_department_id')
            .is('department_id', null)
    ]);

    const mergedRoles = [
        ...(explicitSubDeptRes.data || []),
        ...(parentDeptRes.data || []),
        ...(globalRes.data || [])
    ];

    console.log(`\nV3 Logic Found ${mergedRoles.length} roles.`);
    const explicit = explicitSubDeptRes.data || [];
    const parent = parentDeptRes.data || [];
    const globalR = globalRes.data || [];

    console.log(`Explicit to SubDept: ${explicit.length}`);
    if (explicit.length > 0) console.log(explicit.slice(0, 3));

    console.log(`Parent Dept (No SubDept): ${parent.length}`);
    if (parent.length > 0) console.log(parent.slice(0, 3));

    console.log(`Global (No Dept): ${globalR.length}`);
    if (globalR.length > 0) console.log(globalR.slice(0, 3));
}

checkRolesV3();
