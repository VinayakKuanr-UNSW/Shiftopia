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
    const body = await req.json();
    const { organizationId, departmentId, subDepartmentId, dateStart, dateEnd } = body;

    if (!organizationId || !dateStart || !dateEnd) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: organizationId, dateStart, dateEnd" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Fetch all shifts in range ──────────────────────────────────────────
    let shiftsQuery = supabase
      .from("shifts")
      .select("id, version, assignment_status, role_id, shift_date, start_at, end_at, net_length_minutes, assigned_employee_id")
      .eq("organization_id", organizationId)
      .gte("shift_date", dateStart)
      .lte("shift_date", dateEnd)
      .eq("is_cancelled", false)
      .is("deleted_at", null);

    if (departmentId) shiftsQuery = shiftsQuery.eq("department_id", departmentId) as typeof shiftsQuery;
    if (subDepartmentId) shiftsQuery = shiftsQuery.eq("sub_department_id", subDepartmentId) as typeof shiftsQuery;

    const { data: shifts, error: shiftsError } = await shiftsQuery;
    if (shiftsError) throw shiftsError;

    const allShifts = shifts || [];
    const unassignedShifts = allShifts.filter((s: Record<string, unknown>) => s.assignment_status === "unassigned");
    const assignedShifts = allShifts.filter((s: Record<string, unknown>) => s.assignment_status === "assigned");

    // ── Snapshot version ──────────────────────────────────────────────────
    const hashInput = allShifts
      .slice()
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.id as string).localeCompare(b.id as string))
      .map((s: Record<string, unknown>) => `${s.id}:${s.version}:${s.assignment_status}`)
      .join(",");

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(hashInput || "empty"));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const snapshotVersion = `snap_${hashHex.slice(0, 16)}`;

    // ── Available staff via user_contracts ────────────────────────────────
    let staffQuery = supabase
      .from("user_contracts")
      .select("user_id, role_id")
      .eq("organization_id", organizationId)
      .eq("status", "active");

    if (departmentId) staffQuery = staffQuery.eq("department_id", departmentId) as typeof staffQuery;

    const { data: contracts } = await staffQuery;
    const availableContracts = contracts || [];
    const uniqueStaffIds = new Set(availableContracts.map((c: Record<string, unknown>) => c.user_id));
    const staffRoles = new Set(availableContracts.map((c: Record<string, unknown>) => c.role_id).filter(Boolean));

    // ── Potential conflicts: role required but no matching staff ──────────
    let potentialConflicts = 0;
    for (const shift of unassignedShifts) {
      const s = shift as Record<string, unknown>;
      if (s.role_id && !staffRoles.has(s.role_id)) {
        potentialConflicts++;
      }
    }

    // ── Overtime exposure: assigned staff > 35h in period ────────────────
    const assignedMinutesPerStaff = new Map<string, number>();
    for (const shift of assignedShifts) {
      const s = shift as Record<string, unknown>;
      if (s.assigned_employee_id) {
        const current = assignedMinutesPerStaff.get(s.assigned_employee_id as string) || 0;
        assignedMinutesPerStaff.set(s.assigned_employee_id as string, current + ((s.net_length_minutes as number) || 0));
      }
    }
    let overtimeExposure = 0;
    const OVERTIME_THRESHOLD = 2100;
    for (const [, mins] of assignedMinutesPerStaff) {
      if (mins > OVERTIME_THRESHOLD) overtimeExposure++;
    }

    return new Response(
      JSON.stringify({
        snapshot_version: snapshotVersion,
        unassigned_count: unassignedShifts.length,
        assigned_count: assignedShifts.length,
        available_staff_count: uniqueStaffIds.size,
        potential_conflicts: potentialConflicts,
        overtime_exposure: overtimeExposure,
        eligible_shifts: unassignedShifts.map((s: Record<string, unknown>) => s.id),
      }),
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
