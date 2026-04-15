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
 * Resolve a shift's scheduled time to a Unix timestamp (ms).
 * Priority: timestamp (ISO) → shift_date + local time (assumed Sydney UTC+11).
 */
function resolveTimeMs(iso: string | null, date: string | null, time: string | null): number | null {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (date && time) {
    const timeStr = time.length >= 5 ? time.substring(0, 5) : time;
    const d = new Date(`${date}T${timeStr}:00+11:00`);
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

    // Fetch shifts that are either InProgress (for auto-out) 
    // or Published/Confirmed (for no-show detection)
    const { data: shifts, error: fetchError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, assignment_status, assigned_employee_id, shift_date, start_time, end_time, start_at, end_at')
      .in('lifecycle_status', ['InProgress', 'Published', 'Confirmed'])
      .neq('is_cancelled', true);

    if (fetchError) {
      throw fetchError;
    }

    for (const shift of shifts || []) {
      const startMs = resolveTimeMs(shift.start_at, shift.shift_date, shift.start_time);
      const endMs   = resolveTimeMs(shift.end_at,   shift.shift_date, shift.end_time);

      if (startMs === null || endMs === null) {
        logs.push(`[SKIP] shift ${shift.id}: cannot resolve timing`);
        continue;
      }

      // ── LOGIC 1: Auto-Clock-Out for hanging InProgress shifts ───────
      if (shift.lifecycle_status === 'InProgress') {
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
            logs.push(`[ERROR] shift ${shift.id} (auto-out): ${updateError.message}`);
          } else {
            updatedCount++;
            logs.push(`[INFO] Auto-completed shift ${shift.id}: InProgress -> Completed (auto_clock_out)`);
          }
        }
      }

      // ── LOGIC 2: Auto-No-Show for missed assigned shifts ────────────
      // If the shift ended and nobody checked in, mark as no-show
      else if (
        (shift.lifecycle_status === 'Published' || shift.lifecycle_status === 'Confirmed') &&
        shift.assigned_employee_id !== null
      ) {
        if (now.getTime() >= endMs) {
          const { error: updateError } = await supabase
            .from('shifts')
            .update({
              lifecycle_status: 'Completed',
              attendance_status: 'no_show',
              assignment_outcome: 'no_show',
              attendance_note: 'Auto-no-show: No clock-in recorded by shift end',
              updated_at: now.toISOString(),
            })
            .eq('id', shift.id);

          if (updateError) {
            logs.push(`[ERROR] shift ${shift.id} (no-show): ${updateError.message}`);
          } else {
            updatedCount++;
            logs.push(`[INFO] Auto-no-show shift ${shift.id}: Published -> Completed (no_show)`);
          }
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
