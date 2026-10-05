// Source of truth for the deployed `evaluate-compliance` edge function.
//
// Until 2026-10-05 this function existed only in prod (v4, verify_jwt OFF) and
// was not in the repo. It runs every check with the SERVICE ROLE, so with no
// authentication anyone on the internet could ask it about any employee and
// learn their weekly hours, whether they were rostered at a given time, their
// rest-period status and their licence expiries. v5 adds the gate below;
// the checks themselves are unchanged from v4.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

// ── Authorisation ─────────────────────────────────────────────────────────────
// A server-side caller presenting the service-role key is trusted. Anyone else
// must be a signed-in user who may already see this employee's shifts:
// themselves, or `shift.view` over one of the employee's active contracts
// (public.can_view_employee_schedule — the same question RLS asks).
async function authorise(req: Request, employeeId: string): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Sign in required");

  const { data: allowed, error } = await userClient.rpc("can_view_employee_schedule", { p_employee_id: employeeId });
  if (error || allowed !== true) return jsonError(403, "Not authorised to check this employee");
  return null;
}

interface QualificationViolation {
  type: string;
  message: string;
  role_id?: string;
  license_id?: string;
  license_name?: string;
  skill_id?: string;
  skill_name?: string;
  expiration_date?: string;
}

interface ComplianceResult {
  status: "passed" | "violated" | "warned" | "unavailable";
  violations: string[];
  warnings: string[];
  weeklyHours: number;
  maxWeeklyHours: number;
  checksPerformed: string[];
  checksSkipped: string[];
  qualificationViolations: QualificationViolation[];
}

const MAX_WEEKLY_HOURS = 48;

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split("T")[0];
}

function isValidUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const {
      employee_id,
      shift_date,
      start_time,
      end_time,
      net_length_minutes,
      exclude_shift_id = null,
      shift_id = null,
      override_role_id = null,
      override_skill_ids = null,
      override_license_ids = null,
    } = body;

    if (!isValidUuid(employee_id)) {
      const result: ComplianceResult = {
        status: "unavailable",
        violations: [],
        warnings: ["Cannot validate compliance without a valid employee assignment"],
        weeklyHours: 0,
        maxWeeklyHours: MAX_WEEKLY_HOURS,
        checksPerformed: [],
        checksSkipped: ["overlap", "weekly_hours", "rest_period", "qualification"],
        qualificationViolations: [],
      };
      return Response.json(result, { headers: corsHeaders() });
    }

    const denied = await authorise(req, employee_id);
    if (denied) return denied;

    // Use service_role to bypass RLS — all checks need full data visibility
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Run overlap, weekly hours, rest period, qualification in parallel
    const [overlapRpc, weeklyRpc, restRpc, qualRpc] = await Promise.allSettled([
      supabase.rpc("check_shift_overlap", {
        p_employee_id: employee_id,
        p_shift_date: shift_date,
        p_start_time: start_time,
        p_end_time: end_time,
        ...(exclude_shift_id ? { p_exclude_shift_id: exclude_shift_id } : {}),
      }),
      supabase.rpc("calculate_weekly_hours", {
        p_employee_id: employee_id,
        p_week_start_date: getWeekStart(shift_date),
      }),
      supabase.rpc("validate_rest_period", {
        p_employee_id: employee_id,
        p_shift_date: shift_date,
        p_start_time: start_time,
        p_end_time: end_time,
        p_minimum_hours: 11,
      }),
      isValidUuid(shift_id)
        ? supabase.rpc("check_shift_compliance", {
            p_roster_shift_id: shift_id,
            p_employee_id: employee_id,
            p_role_id_override: override_role_id,
            p_skill_ids_override: override_skill_ids,
            p_license_ids_override: override_license_ids,
          })
        : Promise.resolve(null),
    ]);

    const violations: string[] = [];
    const warnings: string[] = [];
    const checksPerformed: string[] = [];
    const checksSkipped: string[] = [];
    const qualificationViolations: QualificationViolation[] = [];
    let weeklyHours = 0;

    // Overlap
    if (overlapRpc.status === "fulfilled" && overlapRpc.value && !(overlapRpc.value as Record<string, unknown>).error) {
      checksPerformed.push("overlap");
      if ((overlapRpc.value as Record<string, unknown>).data === true) {
        violations.push("This shift overlaps with an existing shift for the employee");
      }
    } else {
      checksSkipped.push("overlap");
      const msg =
        overlapRpc.status === "fulfilled" && (overlapRpc.value as Record<string, unknown>)?.error
          ? ((overlapRpc.value as Record<string, unknown>).error as Record<string, unknown>).message as string
          : "Network error";
      warnings.push(`Overlap check unavailable — ${msg}`);
    }

    // Weekly hours
    if (weeklyRpc.status === "fulfilled" && weeklyRpc.value && !(weeklyRpc.value as Record<string, unknown>).error) {
      checksPerformed.push("weekly_hours");
      const existingMinutes = Number((weeklyRpc.value as Record<string, unknown>).data ?? 0);
      const projected = existingMinutes / 60 + (net_length_minutes as number) / 60;
      weeklyHours = projected;
      if (projected > MAX_WEEKLY_HOURS) {
        violations.push(
          `Shift would exceed the weekly hours limit (${projected.toFixed(1)}h / ${MAX_WEEKLY_HOURS}h)`
        );
      } else if (projected > MAX_WEEKLY_HOURS * 0.9) {
        warnings.push(
          `Employee is approaching the weekly hours limit (${projected.toFixed(1)}h / ${MAX_WEEKLY_HOURS}h)`
        );
      }
    } else {
      checksSkipped.push("weekly_hours");
      const msg =
        weeklyRpc.status === "fulfilled" && (weeklyRpc.value as Record<string, unknown>)?.error
          ? ((weeklyRpc.value as Record<string, unknown>).error as Record<string, unknown>).message as string
          : "Network error";
      warnings.push(`Weekly hours check unavailable — ${msg}`);
    }

    // Rest period
    if (restRpc.status === "fulfilled" && restRpc.value && !(restRpc.value as Record<string, unknown>).error) {
      checksPerformed.push("rest_period");
      if ((restRpc.value as Record<string, unknown>).data === false) {
        violations.push("Minimum rest period of 11 hours between consecutive shifts is not met");
      }
    } else {
      checksSkipped.push("rest_period");
      const msg =
        restRpc.status === "fulfilled" && (restRpc.value as Record<string, unknown>)?.error
          ? ((restRpc.value as Record<string, unknown>).error as Record<string, unknown>).message as string
          : "Network error";
      warnings.push(`Rest period check unavailable — ${msg}`);
    }

    // Qualification
    if (qualRpc.status === "fulfilled" && qualRpc.value === null) {
      // No shift_id provided — skip silently
      checksSkipped.push("qualification");
    } else if (
      qualRpc.status === "fulfilled" &&
      qualRpc.value !== null &&
      !(qualRpc.value as Record<string, unknown>).error
    ) {
      checksPerformed.push("qualification");
      const raw = (qualRpc.value as Record<string, unknown>).data;
      const row = Array.isArray(raw) ? raw[0] : raw;
      if (row && (row as Record<string, unknown>).is_compliant === false) {
        const rowViolations = (row as Record<string, unknown>).violations;
        if (Array.isArray(rowViolations)) {
          for (const v of rowViolations as QualificationViolation[]) {
            qualificationViolations.push(v);
            violations.push(v.message);
          }
        }
      }
    } else {
      checksSkipped.push("qualification");
      const msg =
        qualRpc.status === "fulfilled" && qualRpc.value !== null && (qualRpc.value as Record<string, unknown>)?.error
          ? ((qualRpc.value as Record<string, unknown>).error as Record<string, unknown>).message as string
          : "Network error";
      warnings.push(`Qualification check unavailable — ${msg}`);
    }

    const totalChecks = 4;
    let status: ComplianceResult["status"];
    if (violations.length > 0) {
      status = "violated";
    } else if (checksSkipped.length === totalChecks) {
      status = "unavailable";
    } else if (warnings.length > 0) {
      status = "warned";
    } else {
      status = "passed";
    }

    const result: ComplianceResult = {
      status,
      violations,
      warnings,
      weeklyHours,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed,
      checksSkipped,
      qualificationViolations,
    };

    return Response.json(result, { headers: corsHeaders() });
  } catch (err: unknown) {
    console.error("[evaluate-compliance] Unexpected error:", err);
    const fallback: ComplianceResult = {
      status: "unavailable",
      violations: [],
      warnings: ["Compliance engine encountered an unexpected error"],
      weeklyHours: 0,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed: [],
      checksSkipped: ["overlap", "weekly_hours", "rest_period", "qualification"],
      qualificationViolations: [],
    };
    return Response.json(fallback, { status: 200, headers: corsHeaders() });
  }
});
