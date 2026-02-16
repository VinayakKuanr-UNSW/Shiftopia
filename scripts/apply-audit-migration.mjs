import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = 'https://srfozdlphoempdattvtx.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY1NTE2NSwiZXhwIjoyMDgyMjMxMTY1fQ.950me7itIa7BBRkT2cNr2umVLxeTBfC6jXmjKXpf3DA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function runMigration() {
    console.log('Reading migration file...');
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20260105_create_shift_audit_log.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log('Executing migration...');

    try {
        // Execute the SQL using rpc or direct query
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            // Try alternative method using direct SQL execution
            const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers: {
                    'apikey': serviceRoleKey,
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: sql })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            console.log('✅ Migration executed successfully!');
        } else {
            console.log('✅ Migration executed successfully!');
            console.log('Data:', data);
        }
    } catch (err) {
        console.error('❌ Migration failed:', err);
        throw err;
    }
}

runMigration().catch(console.error);
