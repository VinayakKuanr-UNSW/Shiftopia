// Script to seed 100 shifts via Supabase API
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://srfozdlphoempdattvtx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY1NTE2NSwiZXhwIjoyMDgyMjMxMTY1fQ.950me7itIa7BBRkT2cNr2umVLxeTBfC6jXmjKXpf3DA'
);

const shiftTimes = [
    { start: '07:00', end: '15:00' },
    { start: '09:00', end: '17:00' },
    { start: '14:00', end: '22:00' },
    { start: '17:00', end: '23:00' }
];

async function seedShifts() {
    console.log('Starting shift seeding...');

    // Get organization
    const { data: orgs } = await supabase
        .from('organizations')
        .select('id')
        .eq('name', 'ICC Sydney')
        .single();

    const orgId = orgs?.id;
    console.log('Org ID:', orgId);

    // Get sub-departments
    const { data: subDepts } = await supabase
        .from('sub_departments')
        .select('id, name, department_id');

    // Get roles
    const { data: roles } = await supabase
        .from('roles')
        .select('id, remuneration_level_id');

    // Get employees
    const { data: employees } = await supabase
        .from('employees')
        .select('id');

    // Get roster
    const { data: rosters } = await supabase
        .from('rosters')
        .select('id')
        .limit(1);

    const rosterId = rosters?.[0]?.id;
    if (!rosterId) {
        console.error('No roster found!');
        return;
    }

    console.log(`Found ${subDepts?.length} sub-depts, ${roles?.length} roles, ${employees?.length} employees, roster: ${rosterId}`);

    let created = 0;
    const targetCount = 100;

    while (created < targetCount) {
        // Random selections
        const subDept = subDepts[Math.floor(Math.random() * subDepts.length)];
        const role = roles[Math.floor(Math.random() * roles.length)];
        const time = shiftTimes[Math.floor(Math.random() * shiftTimes.length)];

        // 70% assigned, 30% open
        const employee = Math.random() < 0.7
            ? employees[Math.floor(Math.random() * employees.length)]
            : null;

        // Future date (Jan-Feb 2026)
        const dayOffset = Math.floor(Math.random() * 50) + 2; // 2-52 days from now
        const shiftDate = new Date();
        shiftDate.setDate(shiftDate.getDate() + dayOffset);
        const dateStr = shiftDate.toISOString().split('T')[0];

        const { error } = await supabase
            .from('shifts')
            .insert({
                roster_id: rosterId,
                organization_id: orgId,
                department_id: subDept.department_id,
                sub_department_id: subDept.id,
                shift_date: dateStr,
                start_time: time.start,
                end_time: time.end,
                role_id: role.id,
                remuneration_level_id: role.remuneration_level_id,
                status: 'open',
                is_draft: false
            });

        if (error) {
            console.error('Error creating shift:', error.message);
            continue;
        }

        created++;
        if (created % 20 === 0) console.log(`Created ${created} shifts...`);
    }

    console.log(`Done! Created ${created} shifts.`);
}

seedShifts().catch(console.error);
