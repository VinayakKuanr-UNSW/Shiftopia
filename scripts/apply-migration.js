const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://srfozdlphoempdattvtx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyZm96ZGxwaG9lbXBkYXR0dnR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY1NTE2NSwiZXhwIjoyMDgyMjMxMTY1fQ.950me7itIa7BBRkT2cNr2umVLxeTBfC6jXmjKXpf3DA';

async function executeSql() {
    console.log('Reading migration file...');
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260105_create_shift_audit_log.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('Executing SQL...');

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ query: sql })
        });

        const text = await response.text();

        if (!response.ok) {
            console.error(`❌ HTTP Error ${response.status}:`, text);
            throw new Error(`Failed with status ${response.status}`);
        }

        console.log('✅ Migration executed successfully!');
        console.log('Response:', text);
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

executeSql();
