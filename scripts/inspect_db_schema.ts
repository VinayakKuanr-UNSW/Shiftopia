
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) {
        console.error('SQL Error:', error.message);
        return [];
    }
    return data;
}

async function run() {
    console.log('Fetching Schema Info...');

    // 1. Tables & Columns
    const columns = await execSql(`
        SELECT 
            table_name::text, 
            column_name::text, 
            data_type::text, 
            is_nullable::text
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
    `);

    // 2. Relationships
    const relationships = await execSql(`
        SELECT
            tc.table_name::text, 
            kcu.column_name::text,
            ccu.table_name::text AS foreign_table_name,
            ccu.column_name::text AS foreign_column_name,
            tc.constraint_name::text
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
    `);

    // 3. Functions (RPCs)
    const functions = await execSql(`
        SELECT
          p.proname::text as function_name,
          pg_get_function_arguments(p.oid)::text as arguments,
          pg_get_function_result(p.oid)::text as result_type,
          d.description::text as comment
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_description d ON d.objoid = p.oid
        WHERE n.nspname = 'public'
        ORDER BY p.proname
    `);

    const schemaInfo = {
        columns,
        relationships,
        functions
    };

    fs.writeFileSync('schema_dump.json', JSON.stringify(schemaInfo, null, 2), 'utf8');
    console.log('Schema dump saved to schema_dump.json');
}

run().catch(console.error);
