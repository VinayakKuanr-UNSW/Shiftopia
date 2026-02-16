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
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 8);

    let updatedCount = 0;
    const logs: string[] = [];

    const { data: shifts, error: fetchError } = await supabase
      .from('shifts')
      .select('id, lifecycle_status, shift_date, start_time, end_time')
      .in('lifecycle_status', ['scheduled', 'active'])
      .neq('lifecycle_status', 'cancelled');

    if (fetchError) {
      throw fetchError;
    }

    for (const shift of shifts || []) {
      let newStatus: string | null = null;

      const shiftDate = shift.shift_date;
      const startTime = shift.start_time;
      const endTime = shift.end_time;

      if (shiftDate < currentDate || (shiftDate === currentDate && endTime <= currentTime)) {
        if (shift.lifecycle_status !== 'completed') {
          newStatus = 'completed';
        }
      } else if (shiftDate === currentDate && startTime <= currentTime) {
        if (shift.lifecycle_status !== 'active') {
          newStatus = 'active';
        }
      }

      if (newStatus && newStatus !== shift.lifecycle_status) {
        const { error: updateError } = await supabase
          .from('shifts')
          .update({
            lifecycle_status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', shift.id);

        if (updateError) {
          logs.push(`Error updating shift ${shift.id}: ${updateError.message}`);
        } else {
          const { error: logError } = await supabase
            .from('shift_lifecycle_log')
            .insert({
              shift_id: shift.id,
              old_status: shift.lifecycle_status,
              new_status: newStatus,
              reason: 'Auto-progression based on time'
            });

          if (logError) {
            logs.push(`Error logging lifecycle change for shift ${shift.id}: ${logError.message}`);
          }

          updatedCount++;
          logs.push(`Updated shift ${shift.id}: ${shift.lifecycle_status} -> ${newStatus}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
        totalChecked: shifts?.length || 0,
        logs,
        timestamp: now.toISOString()
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