// ARCHIVED 2026-10-05 — verbatim copy of prod v5. NOT DEPLOYED. See ../README.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const { sessionId, snapshotVersion } = await req.json();

    if (!sessionId || !snapshotVersion) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: sessionId, snapshotVersion" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: session, error: sessionError } = await supabase
      .from("autoschedule_sessions")
      .select("id, snapshot_version, status, simulation_result")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    if (session.snapshot_version !== snapshotVersion) {
      return new Response(
        JSON.stringify({ error: "SNAPSHOT_CONFLICT", message: "Snapshot mismatch. Re-run simulation." }),
        { status: 409, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    if (!session.simulation_result) {
      return new Response(
        JSON.stringify({ error: "Session has no simulation result" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const { assignments } = session.simulation_result as {
      assignments: Array<{ shiftId: string; employeeId: string }>;
    };

    await supabase.from("autoschedule_assignments").delete().eq("session_id", sessionId).eq("status", "draft");

    if (assignments.length > 0) {
      const { error: insertError } = await supabase.from("autoschedule_assignments").insert(
        assignments.map((a) => ({ session_id: sessionId, shift_id: a.shiftId, employee_id: a.employeeId, status: "draft" }))
      );
      if (insertError) throw insertError;
    }

    await supabase.from("autoschedule_sessions").update({ status: "draft_saved" }).eq("id", sessionId);

    return new Response(
      JSON.stringify({ success: true, draftCount: assignments.length }),
      { headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  }
});
