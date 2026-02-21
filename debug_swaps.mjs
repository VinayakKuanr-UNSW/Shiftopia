
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://srfozdlphoempdattvtx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTUxNjUsImV4cCI6MjA4MjIzMTE2NX0.vO9GvIPDGxKdFHmEAQu9gBSLnZSdC_YV7FDPD2CVgqw'
);

async function check() {
    console.log('Querying shift_swaps...');
    const { data: swaps, error: swapsErr } = await supabase
        .from('shift_swaps')
        .select('*, requester_shift:shifts!shift_swaps_requester_shift_id_fkey(*)');

    if (swapsErr) {
        console.error('Error fetching swaps:', swapsErr);
    } else {
        console.log('Swaps found:', swaps.length);
        swaps.forEach(s => {
            console.log(`- Swap ID: ${s.id}, Status: ${s.status}, Requester: ${s.requester_id}, Shift ID: ${s.requester_shift_id}`);
            if (s.requester_shift) {
                console.log(`  Shift Org: ${s.requester_shift.organization_id}, Dept: ${s.requester_shift.department_id}, SubDept: ${s.requester_shift.sub_department_id}`);
            }
        });
    }

    console.log('\nQuerying profiles...');
    const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, full_name, email');

    if (profErr) {
        console.error('Error fetching profiles:', profErr);
    } else {
        console.log('Profiles found:', profiles.length);
        profiles.forEach(p => {
            console.log(`- Profile ID: ${p.id}, Name: ${p.full_name}, Email: ${p.email}`);
        });
    }
}

check().catch(console.error);
