// Script to create shift_bids table in Supabase
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://srfozdlphoempdattvtx.supabase.co';
// You'll need to provide the service role key via environment variable
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    console.log('Please set it by running:');
    console.log('$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const sql = `
-- Create shift_bids table for the bidding functionality
CREATE TABLE IF NOT EXISTS public.shift_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    bid_priority INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.employees(id),
    UNIQUE(shift_id, employee_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_shift_bids_shift_id ON public.shift_bids(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_employee_id ON public.shift_bids(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_status ON public.shift_bids(status);

-- Enable RLS
ALTER TABLE public.shift_bids ENABLE ROW LEVEL SECURITY;

-- Add bidding columns to shifts table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_enabled'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_start_at'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_start_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_end_at'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_end_at TIMESTAMPTZ;
    END IF;
END $$;
`;

async function runMigration() {
    console.log('Running migration to create shift_bids table...');

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
        // Try splitting into individual statements
        console.log('RPC method not available, trying individual statements...');

        // The anon key cannot run DDL - we need the service role key
        console.error('Error:', error.message);
        console.log('\nNOTE: DDL commands require the Supabase Dashboard SQL Editor.');
        console.log('Please run the SQL manually at:');
        console.log('https://supabase.com/dashboard/project/srfozdlphoempdattvtx/sql/new');
        return;
    }

    console.log('Migration completed successfully!');
}

runMigration();
