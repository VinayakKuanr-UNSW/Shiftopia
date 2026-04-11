import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

/** 12.5 hours in milliseconds — auto-completion threshold */
const AUTO_COMPLETE_MS = 12.5 * 60 * 60 * 1000;

/**
 * Resolve a shift's scheduled start time to a Unix timestamp (ms).
 * Priority: start_at (ISO) → shift_date + start_time (local, assumed Sydney UTC+11).
 * Returns null if neither is usable.
 */
function resolveStartMs(shift: {
  start_at: string | null;
  shift_date: string | null;
  start_time: string | null;
}): number | null {
  if (shift.start_at) {
    const d = new Date(shift.start_at);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (shift.shift_date && shift.start_time) {
    const timeStr = shift.start_time.length >= 5 ? shift.start_time.substring(0, 5) : shift.start_time;
    const d = new Date(`${shift.shift_date}T${timeStr}:00+11:00`);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    let updatedCount = 0;
    const logs: string[] = [];

    const { data: shifts, error: fetchError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, shift_date, start_time, end_time, start_at')
      // Only auto-complete shifts that are currently InProgress (S11)
      .eq('lifecycle_status', 'InProgress')
      .neq('is_cancelled', true);

    if (fetchError) {
      throw fetchError;
    }

    for (const shift of shifts || []) {
      const startMs = resolveStartMs(shift);

      // Skip shifts where we can't determine the start time
      if (startMs === null) {
        logs.push(`[SKIP] shift ${shift.id}: cannot resolve start time`);
        continue;
      }

      const autoCompleteAt = startMs + AUTO_COMPLETE_MS;

      if (now.getTime() >= autoCompleteAt) {
        const { error: updateError } = await supabase
          .from('shifts')
          .update({
            lifecycle_status: 'Completed',
            attendance_status: 'auto_clock_out',
            attendance_note: 'Auto-completed by system (12.5hr limit)',
            updated_at: now.toISOString(),
          })
          .eq('id', shift.id);

        if (updateError) {
          logs.push(`[ERROR] shift ${shift.id}: ${updateError.message}`);
        } else {
          updatedCount++;
          logs.push(`[INFO] Auto-completed shift ${shift.id}: InProgress -> Completed (auto_clock_out, 12.5hr limit)`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
        totalChecked: shifts?.length || 0,
        logs,
        timestamp: now.toISOString(),
        note: 'Auto-completion fires at scheduled_start + 12.5 hours. Auto-progression to InProgress (S11) is disabled (manual clock-in required).',
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error in shift lifecycle updater:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
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
