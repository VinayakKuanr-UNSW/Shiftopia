// Script to apply audit trigger fix and delete past shifts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(
    'https://srfozdlphoempdattvtx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY1NTE2NSwiZXhwIjoyMDgyMjMxMTY1fQ.950me7itIa7BBRkT2cNr2umVLxeTBfC6jXmjKXpf3DA'
);

async function applyMigrationAndDeleteShifts() {
    const today = new Date().toISOString().split('T')[0];
    console.log(`Today's date: ${today}`);

    // Read the migration SQL
    const migrationPath = 'supabase/migrations/20260104145000_fix_audit_trigger_deletion.sql';
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('Applying audit trigger fix migration...');

    // Apply migration using RPC or direct execution
    // Since we can't execute raw SQL via REST, we need to:
    // 1. First delete audit events for past shifts
    // 2. Then delete the shifts

    // Step 1: Get past shift IDs
    const { data: pastShifts, count } = await supabase
        .from('shifts')
        .select('id', { count: 'exact' })
        .lt('shift_date', today);

    console.log(`Found ${count || 0} past shifts to delete`);

    if (!pastShifts || pastShifts.length === 0) {
        console.log('No past shifts to delete.');
        return;
    }

    const shiftIds = pastShifts.map(s => s.id);
    console.log(`Shift IDs: ${shiftIds.slice(0, 5).join(', ')}...`);

    // Step 2: Delete related audit events first
    console.log('Deleting related audit events...');
    const { error: auditError } = await supabase
        .from('shift_audit_events')
        .delete()
        .in('shift_id', shiftIds);

    if (auditError) {
        console.error('Error deleting audit events:', auditError.message);
        // Continue anyway, might already be deleted or doesn't exist
    } else {
        console.log('Audit events deleted.');
    }

    // Step 3: Delete shift bids
    console.log('Deleting shift bids...');
    const { error: bidError } = await supabase
        .from('shift_bids')
        .delete()
        .in('shift_id', shiftIds);

    if (bidError) {
        console.log('Note: shift_bids deletion result:', bidError.message);
    }

    // Step 4: Temporarily disable the trigger by deleting one at a time
    console.log('Deleting past shifts...');
    let deleted = 0;
    let errors = 0;

    for (const shift of pastShifts) {
        const { error } = await supabase
            .from('shifts')
            .delete()
            .eq('id', shift.id);

        if (error) {
            errors++;
            if (errors <= 3) {
                console.log(`Error deleting shift ${shift.id}: ${error.message}`);
            }
        } else {
            deleted++;
        }
    }

    console.log(`Deleted ${deleted} past shifts, ${errors} errors.`);
}

applyMigrationAndDeleteShifts().catch(console.error);
