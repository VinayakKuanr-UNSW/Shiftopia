// ARCHIVED 2026-10-05 — verbatim copy of prod v7. NOT DEPLOYED. See ../README.md.
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

async function computeSnapshotVersion(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  departmentId: string | null,
  subDepartmentId: string | null,
  dateStart: string,
  dateEnd: string
): Promise<string> {
  let query = supabase
    .from("shifts")
    .select("id, version, assignment_status")
    .eq("organization_id", organizationId)
    .gte("shift_date", dateStart)
    .lte("shift_date", dateEnd)
    .eq("is_cancelled", false)
    .is("deleted_at", null)
    .not("lifecycle_status", "eq", "Cancelled")
    .order("id");

  if (departmentId)    query = query.eq("department_id", departmentId) as typeof query;
  if (subDepartmentId) query = query.eq("sub_department_id", subDepartmentId) as typeof query;

  const { data: shifts } = await query;
  const hashInput = (shifts || [])
    .map((s: Record<string, unknown>) => `${s.id}:${s.version}:${s.assignment_status}`)
    .join(",");

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput || "empty"));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `snap_${hashHex.slice(0, 16)}`;
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
      .select("id, snapshot_version, status, simulation_result, organization_id, department_id, sub_department_id, date_start, date_end")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    if (!session.simulation_result) {
      return new Response(
        JSON.stringify({ error: "Session has no simulation result to commit" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const currentSnapshot = await computeSnapshotVersion(
      supabase,
      session.organization_id,
      session.department_id,
      session.sub_department_id,
      session.date_start,
      session.date_end
    );

    if (currentSnapshot !== snapshotVersion || currentSnapshot !== session.snapshot_version) {
      return new Response(
        JSON.stringify({ error: "SNAPSHOT_CONFLICT", message: "Roster changed during simulation. Re-fetch and re-run." }),
        { status: 409, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const { assignments } = session.simulation_result as {
      assignments: Array<{ shiftId: string; employeeId: string; employeeName: string }>;
    };

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const assignment of assignments) {
      const { error: updateError } = await supabase
        .from("shifts")
        .update({
          assigned_employee_id: assignment.employeeId,
          assignment_status: "assigned",
          assignment_outcome: "confirmed",
          assigned_at: now,
          assignment_source: "autoscheduler",
          updated_at: now,
        })
        .eq("id", assignment.shiftId)
        .eq("assignment_status", "unassigned");

      if (!updateError) updatedCount++;
    }

    await supabase.from("autoschedule_assignments").delete().eq("session_id", sessionId);
    if (assignments.length > 0) {
      await supabase.from("autoschedule_assignments").insert(
        assignments.map((a) => ({
          session_id: sessionId,
          shift_id: a.shiftId,
          employee_id: a.employeeId,
          status: "committed",
          committed_at: now,
        }))
      );
    }

    await supabase.from("autoschedule_sessions").update({ status: "committed" }).eq("id", sessionId);

    return new Response(
      JSON.stringify({ success: true, updatedCount }),
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
