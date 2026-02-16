// @ts-ignore - Deno imports work at runtime in Supabase Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

// Declare Deno global for TypeScript
declare const Deno: {
    env: { get(key: string): string | undefined };
    serve(handler: (req: Request) => Promise<Response>): void;
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// Validate required environment variables at module load
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
    throw new Error('[FATAL] Missing SUPABASE_URL environment variable');
}
if (!supabaseServiceKey) {
    throw new Error('[FATAL] Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

/**
 * Partition Manager Edge Function
 * 
 * Thin wrapper that triggers the ensure_shift_events_partitions() PostgreSQL function.
 * All partition logic lives in the database for reliability and atomicity.
 * 
 * Usage:
 *   - Triggered via pg_cron (preferred) or external cron service
 *   - Can be invoked manually for testing
 * 
 * Endpoint: POST /functions/v1/partition-manager
 */
Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: corsHeaders,
        });
    }

    const startTime = Date.now();
    console.log('[partition-manager] Job started at', new Date().toISOString());

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Call the database function - all logic is in PostgreSQL
        const { error } = await supabase.rpc('ensure_shift_events_partitions');

        if (error) {
            console.error('[partition-manager] Database function error:', error);
            throw error;
        }

        const durationMs = Date.now() - startTime;
        console.log(`[partition-manager] Job completed successfully in ${durationMs}ms`);

        return new Response(
            JSON.stringify({
                success: true,
                message: 'Partition maintenance completed',
                duration_ms: durationMs,
                timestamp: new Date().toISOString(),
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (err) {
        const error = err as Error;
        const durationMs = Date.now() - startTime;
        console.error('[partition-manager] Job failed:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
                duration_ms: durationMs,
                timestamp: new Date().toISOString(),
            }),
            {
                status: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                },
            }
        );
    }
});
