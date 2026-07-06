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

/** 12.5 hours in milliseconds — auto clock-out threshold */
const AUTO_COMPLETE_MS = 12.5 * 60 * 60 * 1000;

/** Resolve an ISO timestamp to Unix ms, or null. */
function resolveTimeMs(iso: string | null): number | null {
  if (iso) {
    const d = new Date(iso);
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

    // ── LOGIC 1: Auto clock-out — 12.5h after the LATER of clock-in/start ──
    // Mirrors sm_run_state_processor Pass 6 exactly:
    //   • threshold = GREATEST(actual clock-in, scheduled start) + 12.5h
    //   • does NOT fabricate actual_end — no clock-out happened, the raw
    //     actual stays NULL; attendance_status = 'auto_clock_out' is the
    //     terminal signal (unlocks manager review, drives the badge/metric)
    //   • not gated on lifecycle = InProgress (shifts are auto-completed at
    //     scheduled end, so hanging clock-ins are usually 'Completed')
    const { data: hanging, error: hangingError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, attendance_status, start_at, actual_start, actual_end')
      .in('attendance_status', ['checked_in', 'late'])
      .is('actual_end', null)
      .in('lifecycle_status', ['InProgress', 'Completed'])
      .neq('is_cancelled', true);

    if (hangingError) {
      throw hangingError;
    }

    for (const shift of hanging || []) {
      const startMs = resolveTimeMs(shift.start_at);
      if (startMs === null) {
        logs.push(`[SKIP] shift ${shift.id}: cannot resolve scheduled start`);
        continue;
      }
      const clockInMs = resolveTimeMs(shift.actual_start);
      const anchorMs = Math.max(clockInMs ?? startMs, startMs); // later of the two
      if (now.getTime() >= anchorMs + AUTO_COMPLETE_MS) {
        const { error: updateError } = await supabase
          .from('shifts')
          .update({
            lifecycle_status:  'Completed',
            attendance_status: 'auto_clock_out',
            attendance_note:   'Auto-completed by system (12.5hr limit)',
            updated_at:        now.toISOString(),
          })
          .eq('id', shift.id);

        if (updateError) {
          logs.push(`[ERROR] shift ${shift.id} (auto-out): ${updateError.message}`);
        } else {
          updatedCount++;
          logs.push(`[INFO] Auto clock-out shift ${shift.id}: attendance -> auto_clock_out (actual_end stays NULL)`);
        }
      }
    }

    // ── LOGIC 2: Auto-No-Show for missed assigned shifts ────────────
    // If the shift ended and nobody checked in, mark as no-show
    const { data: pendingShifts, error: fetchError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, assigned_employee_id, end_at, actual_start')
      .in('lifecycle_status', ['Published', 'Confirmed'])
      .not('assigned_employee_id', 'is', null)
      .neq('is_cancelled', true);

    if (fetchError) {
      throw fetchError;
    }

    for (const shift of pendingShifts || []) {
      const endMs = resolveTimeMs(shift.end_at);
      if (endMs === null) {
        logs.push(`[SKIP] shift ${shift.id}: cannot resolve scheduled end`);
        continue;
      }
      if (shift.actual_start === null && now.getTime() >= endMs) {
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

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
        totalChecked: (hanging?.length || 0) + (pendingShifts?.length || 0),
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
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error in shift lifecycle updater:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
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
