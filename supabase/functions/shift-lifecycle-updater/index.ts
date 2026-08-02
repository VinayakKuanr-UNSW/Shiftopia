import { createClient } from '@supabase/supabase-js';

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

    // ── LOGIC 1: Close shift when 12.5h after scheduled start is reached ────
    const AUTO_CLOSE_MS = 12.5 * 60 * 60 * 1000;
    const { data: openShifts, error: openError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, start_at, actual_start, actual_end')
      .neq('lifecycle_status', 'Completed')
      .neq('is_cancelled', true);

    if (!openError) {
      for (const shift of openShifts || []) {
        const startMs = resolveTimeMs(shift.start_at);
        if (startMs !== null && now.getTime() >= startMs + AUTO_CLOSE_MS) {
          const { error: updateError } = await supabase
            .from('shifts')
            .update({
              lifecycle_status: 'Completed',
              updated_at: now.toISOString(),
            })
            .eq('id', shift.id);

          if (!updateError) {
            updatedCount++;
            logs.push(`[INFO] Shift ${shift.id} closed at 12.5h mark: -> Completed`);
          }
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

    // ── LOGIC 3: Zero-Variance Auto-Approve Sweeper ──────────────
    // Constantly sweeps finished shifts and automatically approves clean punches within ±7.5m
    const PUNCH_TOLERANCE_MS = 7.5 * 60 * 1000;
    const { data: finishedShifts, error: finishError } = await supabase
      .from('shifts')
      .select('id, start_at, end_at, actual_start, actual_end, shift_date, start_time, end_time, assigned_employee_id')
      .eq('lifecycle_status', 'Completed')
      .not('actual_start', 'is', null)
      .not('actual_end', 'is', null)
      .not('assigned_employee_id', 'is', null)
      .neq('is_cancelled', true);

    if (!finishError && finishedShifts && finishedShifts.length > 0) {
      const shiftIds = finishedShifts.map((s: any) => s.id);
      const { data: existingTimesheets } = await supabase
        .from('timesheets')
        .select('id, shift_id, status, start_time, end_time')
        .in('shift_id', shiftIds);

      const tsMap = new Map((existingTimesheets || []).map((t: any) => [t.shift_id, t]));

      for (const shift of finishedShifts) {
        const ts = tsMap.get(shift.id);
        const currentTsStatus = (ts?.status || '').toLowerCase();

        // Skip if already settled by human or auto-approved
        if (['approved', 'auto_approved', 'auto_verified', 'rejected', 'denied', 'no_show'].includes(currentTsStatus)) {
          continue;
        }

        // Skip if manual billable overrides exist
        if (ts?.start_time || ts?.end_time) {
          continue;
        }

        const startMs = resolveTimeMs(shift.start_at ?? `${shift.shift_date}T${shift.start_time}`);
        const endMs = resolveTimeMs(shift.end_at ?? `${shift.shift_date}T${shift.end_time}`);
        const clockInMs = resolveTimeMs(shift.actual_start);
        const clockOutMs = resolveTimeMs(shift.actual_end);

        if (startMs === null || endMs === null || clockInMs === null || clockOutMs === null) {
          continue;
        }

        const varInMs = Math.abs(clockInMs - startMs);
        const varOutMs = Math.abs(clockOutMs - endMs);

        if (varInMs <= PUNCH_TOLERANCE_MS && varOutMs <= PUNCH_TOLERANCE_MS) {
          if (ts) {
            await supabase
              .from('timesheets')
              .update({ status: 'auto_approved', updated_at: now.toISOString() })
              .eq('id', ts.id);
          } else {
            await supabase
              .from('timesheets')
              .insert({
                shift_id: shift.id,
                employee_id: shift.assigned_employee_id,
                profile_id: shift.assigned_employee_id,
                work_date: shift.shift_date,
                clock_in: shift.actual_start,
                clock_out: shift.actual_end,
                status: 'auto_approved',
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
              });
          }

          await supabase.from('timesheet_audit_log').insert({
            shift_id: shift.id,
            timesheet_id: ts?.id || null,
            event_type: 'AUTO_APPROVED',
            source: 'system',
            actor_label: 'Auto-Approve Sweeper',
            detail: {
              reason: 'Zero-variance punch within ±7.5m tolerance',
              variance_in_min: Math.round(varInMs / 60000),
              variance_out_min: Math.round(varOutMs / 60000),
            },
            created_at: now.toISOString(),
          });

          updatedCount++;
          logs.push(`[INFO] Shift ${shift.id} auto-approved (zero variance <= 7.5m)`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
        totalChecked: (openShifts?.length || 0) + (pendingShifts?.length || 0) + (finishedShifts?.length || 0),
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
