// @ts-ignore
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
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

function isValidUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
  );
}

/** A client that acts as the CALLER (their JWT), so RLS and auth.uid() apply. */
function callerClient(req: Request) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

// ── Authorisation ─────────────────────────────────────────────────────────────
// Every read in this function uses the SERVICE ROLE, so row-level security does
// not protect it. `verify_jwt` alone was never enough: the publishable anon key
// is itself a valid JWT, so until 2026-10-05 an unauthenticated caller could
// read any organisation's roster and staff list just by naming its
// organization_id (verified: 20 shifts + 101 employees with only the anon key).
//
// Require a real signed-in user, and `shift.view` over exactly the scope being
// requested — the rule `shifts_select_rbac` applies row by row. A caller whose
// scope is narrower gets a 403; the planner's prefetch then fails soft and the
// page's own RLS-scoped queries load the data instead.
async function authoriseRosterRead(
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
  orgId: string,
  deptIds: string[],
  subDeptIds: string[],
): Promise<Response | null> {
  const userClient = callerClient(req);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, "Sign in required");

  // Each check must name the department too: DEPT-scoped grants match on it.
  let checks: Array<{ dept: string | null; sub: string | null }>;
  if (subDeptIds.length > 0) {
    const { data, error } = await admin.from("sub_departments").select("id, department_id").in("id", subDeptIds);
    if (error) return jsonError(500, "Could not resolve the requested scope");
    const deptOf = new Map<string, string>(
      ((data ?? []) as { id: string; department_id: string }[]).map((r) => [r.id, r.department_id]),
    );
    if (deptOf.size !== new Set(subDeptIds).size) return jsonError(403, "Not authorised for this roster scope");
    checks = subDeptIds.map((sub) => ({ dept: deptOf.get(sub)!, sub }));
  } else if (deptIds.length > 0) {
    checks = deptIds.map((dept) => ({ dept, sub: null }));
  } else {
    checks = [{ dept: null, sub: null }];
  }

  const results = await Promise.all(checks.map((c) =>
    userClient.rpc("user_has_action_in_scope", {
      p_action_code: "shift.view",
      p_org_id: orgId,
      p_dept_id: c.dept,
      p_sub_dept_id: c.sub,
    })
  ));
  if (results.some((r: { data: unknown; error: unknown }) => r.error || r.data !== true)) {
    return jsonError(403, "Not authorised for this roster scope");
  }
  return null;
}

// `is_first_aid_duty` is a COMPUTED field (cl 28.2, migration 20261005060327):
// `*` never includes computed fields, so it is named explicitly. Without it the
// rows this function seeds into the planner cache price first aid at zero.
const SHIFT_SELECT = `
  *,
  is_first_aid_duty,
  organizations(id, name),
  departments(id, name),
  sub_departments(id, name),
  roles!shifts_role_id_fkey(id, name),
  remuneration_levels(level_number, level_name),
  assigned_profiles:profiles!assigned_employee_id(first_name, last_name)
`;

// ── In-memory TTL cache ───────────────────────────────────────────────────────────────────────────────────
// Module-level maps persist for the lifetime of this Deno isolate.
// Shift data: 15 s TTL  (delta sync on the client corrects stale data)
// Lookup data: 5 min TTL (employees, roles, levels, events change rarely)
//
// Key strategy: different TTLs for mutable vs stable data so lookup caches
// survive many shift-load cycles without re-querying the DB.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shiftCache  = new Map<string, CacheEntry<any>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lookupCache = new Map<string, CacheEntry<any>>();

const SHIFT_TTL_MS  = 15_000;       // 15 s
const LOOKUP_TTL_MS = 5 * 60_000;   // 5 min

function getCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number): void {
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Helper ──────────────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const {
      organization_id,
      department_ids = [],
      sub_department_ids = [],
      start_date,
      end_date,
    } = body as {
      organization_id: string;
      department_ids: string[];
      sub_department_ids: string[];
      start_date: string;
      end_date: string;
    };

    if (!isValidUuid(organization_id) || !start_date || !end_date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: organization_id, start_date, end_date" }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const validDeptIds    = (department_ids as string[]).filter(isValidUuid);
    const validSubDeptIds = (sub_department_ids as string[]).filter(isValidUuid);
    const primaryDeptId   = validDeptIds[0] ?? null;
    const primarySubDeptId = validSubDeptIds[0] ?? null;

    // Authorise BEFORE the shared cache can answer.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const denied = await authoriseRosterRead(req, supabase, organization_id, validDeptIds, validSubDeptIds);
    if (denied) return denied;

    // Cache keys
    const shiftKey  = `${organization_id}:${validDeptIds.sort().join(",")}:${validSubDeptIds.sort().join(",")}:${start_date}:${end_date}`;
    const lookupKey = `${organization_id}:${primaryDeptId ?? ""}:${primarySubDeptId ?? ""}`;

    // ── Cache hit check ────────────────────────────────────────────────────────────────
    const cachedShifts  = getCache(shiftCache,  shiftKey);
    const cachedLookups = getCache(lookupCache, lookupKey);

    if (cachedShifts && cachedLookups) {
      return Response.json(
        { ...cachedLookups, shifts: cachedShifts, _cached: true },
        { headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // ── 1. Shifts query ────────────────────────────────────────────────────────
    const shiftsPromise = cachedShifts
      ? Promise.resolve(null)
      : (() => {
          let q = supabase
            .from("shifts")
            .select(SHIFT_SELECT)
            .eq("organization_id", organization_id)
            .gte("shift_date", start_date)
            .lte("shift_date", end_date)
            .is("deleted_at", null);

          if (validDeptIds.length > 0)    q = q.in("department_id", validDeptIds) as typeof q;
          if (validSubDeptIds.length > 0) q = q.in("sub_department_id", validSubDeptIds) as typeof q;

          return q.order("shift_date").order("display_order").order("start_time");
        })();

    // ── 2. Employees ─────────────────────────────────────────────────────────────────
    const employeesPromise = cachedLookups
      ? Promise.resolve(null)
      : (() => {
          let q = supabase
            .from("user_contracts")
            .select(`
              user_id,
              status,
              employment_status,
              contracted_weekly_hours,
              role_id,
              profiles:profiles(id, first_name, last_name),
              department:departments(name),
              sub_department:sub_departments(name)
            `)
            .eq("status", "Active")
            .eq("organization_id", organization_id);

          if (primarySubDeptId) {
            if (primaryDeptId) q = q.eq("department_id", primaryDeptId) as typeof q;
            q = q.or(`sub_department_id.eq.${primarySubDeptId},sub_department_id.is.null`) as typeof q;
          } else if (primaryDeptId) {
            q = q.eq("department_id", primaryDeptId) as typeof q;
          }

          return q;
        })();

    // ── 3. Roles (hr schema; every role is tied to a subdepartment) ──────────────
    const rolesPromise = cachedLookups
      ? Promise.resolve(null)
      : (async () => {
          // deno-lint-ignore no-explicit-any
          const hr = (supabase as any).schema("hr");
          let subDeptIds: string[] = [];
          if (primarySubDeptId) {
            subDeptIds = [primarySubDeptId];
          } else if (primaryDeptId) {
            const { data } = await hr.from("subdepartments").select("id").eq("department_id", primaryDeptId);
            subDeptIds = ((data ?? []) as { id: string }[]).map((d) => d.id);
          } else {
            const { data: depts } = await hr.from("departments").select("id").eq("organization_id", organization_id);
            const deptIds = ((depts ?? []) as { id: string }[]).map((d) => d.id);
            if (deptIds.length > 0) {
              const { data: sds } = await hr.from("subdepartments").select("id").in("department_id", deptIds);
              subDeptIds = ((sds ?? []) as { id: string }[]).map((d) => d.id);
            }
          }
          if (subDeptIds.length === 0) return { data: [], error: null };
          return hr
            .from("roles")
            .select("id, name, sub_department_id:subdepartment_id, remuneration_level")
            .in("subdepartment_id", subDeptIds)
            .order("name");
        })();

    // ── 4. Remuneration levels ────────────────────────────────────────────────
    const levelsPromise = cachedLookups
      ? Promise.resolve(null)
      : supabase
          .from("remuneration_levels")
          // public.remuneration_levels has no `id` column — naming one 400s the
          // query and the planner silently gets no pay levels (matches prod v11).
          // Nor money columns: hr.remuneration_levels lost hourly_rate_* /
          // salary_* on 2026-10-08 (rates live in eba_rate).
          .select("level_number, level_name, description")
          .order("level_number");

    // ── 5. Events ───────────────────────────────────────────────────────────────
    const eventsPromise = cachedLookups
      ? Promise.resolve(null)
      : supabase
          .from("events")
          .select("id, name, description, event_type, venue, start_date, end_date, status")
          .eq("organization_id", organization_id)
          .eq("is_active", true)
          .order("start_date");

    // Run all un-cached queries in parallel
    const [shiftsRes, employeesRes, rolesRes, levelsRes, eventsRes] = await Promise.all([
      shiftsPromise,
      employeesPromise,
      rolesPromise,
      levelsPromise,
      eventsPromise,
    ]);

    // ── Build shift payload (or use cache) ─────────────────────────────────────────
    let shifts: Record<string, unknown>[];
    if (cachedShifts) {
      shifts = cachedShifts;
    } else {
      shifts = (shiftsRes!.data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        is_trade_requested:
          !!row["trade_requested_at"] || row["trading_status"] === "TradeRequested",
      }));
      setCache(shiftCache, shiftKey, shifts, SHIFT_TTL_MS);
    }

    // ── Build lookup payload (or use cache) ───────────────────────────────────────
    let lookups: { employees: unknown[]; roles: unknown[]; remuneration_levels: unknown[]; events: unknown[] };
    if (cachedLookups) {
      lookups = cachedLookups;
    } else {
      // Deduplicate employees by user_id and build employee profiles with contracted role_ids
      const empMap = new Map<string, Record<string, unknown>>();
      for (const row of (employeesRes!.data ?? []) as Record<string, unknown>[]) {
        const rawProfile = row.profiles as Record<string, unknown>[] | Record<string, unknown> | null;
        const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
        if (!profile || !profile.id) continue;

        const profileId = profile.id as string;
        const roleId = row.role_id as string | null;

        let emp = empMap.get(profileId);
        if (!emp) {
          const empStatus = row.employment_status as string | null;
          const contractType = empStatus === "Full-Time" ? "FT" :
                               empStatus === "Part-Time" ? "PT" :
                               empStatus === "Casual" ? "CASUAL" :
                               empStatus === "Flexible Part-Time" ? "PT" : null;

          const rawDept = row.department as Record<string, unknown>[] | Record<string, unknown> | null;
          const dept = Array.isArray(rawDept) ? rawDept[0] : rawDept;
          const rawSubDept = row.sub_department as Record<string, unknown>[] | Record<string, unknown> | null;
          const subDept = Array.isArray(rawSubDept) ? rawSubDept[0] : rawSubDept;

          emp = {
            id: profileId,
            first_name: profile.first_name,
            last_name: profile.last_name,
            department_name: dept?.name ?? undefined,
            sub_department_name: subDept?.name ?? undefined,
            contract_type: contractType,
            contracted_weekly_hours: Number(row.contracted_weekly_hours ?? 38),
            contracted_role_ids: [] as string[],
          };
          empMap.set(profileId, emp);
        }

        const roleIds = emp.contracted_role_ids as string[];
        if (roleId && !roleIds.includes(roleId)) {
          roleIds.push(roleId);
        }
      }
      const employees = Array.from(empMap.values()).sort((a, b) =>
        (a.last_name as string).localeCompare(b.last_name as string)
      );

      const roles = (rolesRes!.data ?? []).sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (a.name as string).localeCompare(b.name as string)
      );

      lookups = {
        employees,
        roles,
        remuneration_levels: levelsRes!.data ?? [],
        events: eventsRes!.data ?? [],
      };
      setCache(lookupCache, lookupKey, lookups, LOOKUP_TTL_MS);
    }

    return Response.json(
      { ...lookups, shifts },
      { headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[get-roster-view] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  }
});
