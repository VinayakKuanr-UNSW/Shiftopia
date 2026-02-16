// Script to create base templates via Supabase API
// Uses the shift_templates table with JSONB groups column
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://srfozdlphoempdattvtx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY1NTE2NSwiZXhwIjoyMDgyMjMxMTY1fQ.950me7itIa7BBRkT2cNr2umVLxeTBfC6jXmjKXpf3DA'
);

// Sub-group definitions per sub-department
const subGroupDefs = {
    'Event Setups': {
        conv: ['AM Base', 'AM Assist', 'PM Base', 'PM Assist', 'Late', 'DHT-Set', 'DHT-Packdown'],
        exh: ['Bump-In', 'Bump-Out'],
        theatre: ['AM Set', 'AM Set Assist', 'PM Packdown', 'PM Packdown Assist']
    },
    'Logistics': {
        conv: ['Warehouse AM', 'Warehouse PM', 'Dispatch'],
        exh: ['Staging', 'Transport'],
        theatre: ['Load-In', 'Load-Out']
    },
    'Operations': {
        conv: ['Control Room', 'Floor Ops', 'Admin'],
        exh: ['Setup Crew', 'Pack Crew'],
        theatre: ['Stage Crew', 'House Crew']
    },
    'Floor Management': {
        conv: ['Front of House', 'VIP Area', 'Concourse'],
        exh: ['Expo Floor', 'Aisle Mgmt'],
        theatre: ['Stalls', 'Dress Circle', 'Gallery']
    },
    'Guest Services': {
        conv: ['Registration', 'Info Desk', 'Concierge'],
        exh: ['Exhibitor Liaison', 'Visitor Services'],
        theatre: ['Box Office', 'Ushers']
    },
    'Security Operations': {
        conv: ['Entry Points', 'Patrols', 'Control Room'],
        exh: ['Perimeter', 'Hall Security'],
        theatre: ['Stage Door', 'FOH Security']
    },
    'Live Production': {
        conv: ['Stage Manager', 'Crew Chief'],
        exh: ['Rigging', 'Setup'],
        theatre: ['Tech Booth', 'Backstage']
    },
    'Sound Engineering': {
        conv: ['FOH Audio', 'Monitor', 'Comms'],
        exh: ['PA Systems', 'Announcements'],
        theatre: ['Orchestra', 'Stage Monitors']
    },
    'Lighting': {
        conv: ['FOH Lighting', 'Spot Ops'],
        exh: ['Booth Lighting', 'Signage'],
        theatre: ['Follow Spot', 'Stage Lighting']
    },
    'Cleaning Services': {
        conv: ['Day Clean', 'Event Clean', 'Deep Clean'],
        exh: ['Hall Clean', 'Aisle Clean'],
        theatre: ['Auditorium', 'Foyer Clean']
    },
    // Default for others
    '_default': {
        conv: ['AM Shift', 'PM Shift'],
        exh: ['Day Shift', 'Event Shift'],
        theatre: ['Show Call', 'Post-Show']
    }
};

function buildGroupsJson(subDeptName) {
    const def = subGroupDefs[subDeptName] || subGroupDefs['_default'];

    return [
        {
            id: 1,
            name: 'Convention Centre',
            color: 'blue',
            subGroups: def.conv.map((name, i) => ({
                id: i + 1,
                name,
                shifts: []
            }))
        },
        {
            id: 2,
            name: 'Exhibition Centre',
            color: 'green',
            subGroups: def.exh.map((name, i) => ({
                id: i + 1,
                name,
                shifts: []
            }))
        },
        {
            id: 3,
            name: 'Theatre',
            color: 'purple',
            subGroups: def.theatre.map((name, i) => ({
                id: i + 1,
                name,
                shifts: []
            }))
        }
    ];
}

async function createBaseTemplates() {
    console.log('Starting base template creation...');

    // First delete existing base templates
    const { error: deleteError } = await supabase
        .from('shift_templates')
        .delete()
        .eq('is_draft', false);

    if (deleteError) {
        console.log('Note: Could not delete existing templates:', deleteError.message);
    }

    // Get all sub-departments
    const { data: subDepts, error: subDeptError } = await supabase
        .from('sub_departments')
        .select('id, name, department_id');

    if (subDeptError) {
        console.error('Error fetching sub-departments:', subDeptError);
        return;
    }

    console.log(`Found ${subDepts.length} sub-departments`);

    let created = 0;
    let errors = 0;

    for (const subDept of subDepts) {
        const groups = buildGroupsJson(subDept.name);

        const { error: templateError } = await supabase
            .from('shift_templates')
            .insert({
                name: `${subDept.name} - Base Template`,
                description: `Base template for ${subDept.name}`,
                department_id: subDept.department_id,
                sub_department_id: subDept.id,
                groups: groups,
                is_draft: false  // Published template
            });

        if (templateError) {
            console.error(`Error creating template for ${subDept.name}:`, templateError.message);
            errors++;
            continue;
        }

        created++;
        if (created % 10 === 0) console.log(`Created ${created} templates...`);
    }

    console.log(`Done! Created ${created} base templates, ${errors} errors.`);
}

createBaseTemplates().catch(console.error);
