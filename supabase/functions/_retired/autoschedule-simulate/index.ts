// ARCHIVED 2026-10-05 — verbatim copy of prod v45 (CRLF normalised to LF).
// NOT DEPLOYED. See ../README.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { estimateCostFromShift, type CostShiftInput } from "./cost.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

/** ISO week key for grouping hours by week */
function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    (((d.getTime() - jan1.getTime()) / 86400000) + jan1.getDay() + 1) / 7
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

/**
 * Resolve the absolute millisecond timestamp for the start/end of a shift.
 *
 * Priority: start_at/end_at (timestamptz) → shift_date + start_time/end_time.
 *
 * If end <= start in text fallback mode, treat as cross-midnight and add 24h.
 */
function resolveShiftMs(
  row: Record<string, unknown>,
  which: "start" | "end"
): number {
  const tsCol = which === "start" ? "start_at" : "end_at";
  const timeCol = which === "start" ? "start_time" : "end_time";

  if (row[tsCol]) return new Date(row[tsCol] as string).getTime();

  const timeRaw =
    (row[timeCol] as string | null) ?? (which === "start" ? "00:00" : "08:00");
  const timeStr = timeRaw.slice(0, 5);
  const ms = new Date(`${row.shift_date as string}T${timeStr}Z`).getTime();

  if (which === "end") {
    const startRaw = (row["start_time"] as string | null) ?? "00:00";
    const startMs = new Date(
      `${row.shift_date as string}T${startRaw.slice(0, 5)}Z`
    ).getTime();

    if (ms <= startMs) return ms + 86_400_000;
  }

  return ms;
}

function isOvernightShift(row: Record<string, unknown>): boolean {
  const startTime = ((row.start_time as string | null) ?? "").slice(0, 5);
  const endTime = ((row.end_time as string | null) ?? "").slice(0, 5);

  if (startTime && endTime) {
    return endTime <= startTime;
  }

  if (row.start_at && row.end_at) {
    const start = new Date(row.start_at as string);
    const end = new Date(row.end_at as string);

    return (
      end.getUTCFullYear() !== start.getUTCFullYear() ||
      end.getUTCMonth() !== start.getUTCMonth() ||
      end.getUTCDate() !== start.getUTCDate()
    );
  }

  return false;
}

/**
 * Compute a deterministic snapshot hash that matches the frontend buildSnapshotHash().
 */
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

  if (departmentId) {
    query = query.eq("department_id", departmentId) as typeof query;
  }
  if (subDepartmentId) {
    query = query.eq("sub_department_id", subDepartmentId) as typeof query;
  }

  const { data: shifts, error } = await query;
  if (error) throw error;

  const hashInput = (shifts || [])
    .map((s: Record<string, unknown>) => `${s.id}:${s.version}:${s.assignment_status}`)
    .join(",");

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(hashInput || "empty")
  );

  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `snap_${hashHex.slice(0, 16)}`;
}

/* =========================
   Fairness helpers
   ========================= */

type EmployeeHours = {
  employeeId: string;
  hours: number;
};

// 1 = perfect fairness, lower = less fair
function calculateProjectedFairness(
  employeeHours: number,
  allEmployeeHours: number[]
): number {
  const n = allEmployeeHours.length;
  if (n <= 1) return 1;

  const avg = allEmployeeHours.reduce((sum, h) => sum + h, 0) / n;
  if (avg === 0) return 1;

  const scale = 1 / (n - 1);
  return 1 - scale * Math.abs((employeeHours - avg) / avg);
}

function buildFairnessPopulation(
  staff: Record<string, unknown>[],
  weeklyMinutes: Map<string, Map<string, number>>,
  weekKey: string,
  roleId?: string | null
): EmployeeHours[] {
  return staff
    .filter((emp) => {
      if (roleId && emp.role_id !== roleId) return false;
      return true;
    })
    .map((emp) => ({
      employeeId: emp.user_id as string,
      hours: (weeklyMinutes.get(emp.user_id as string)?.get(weekKey) ?? 0) / 60,
    }));
}

function getProjectedEmployeeFairness(
  selectedEmployeeId: string,
  candidateShiftHours: number,
  population: EmployeeHours[]
): number {
  const projectedEmployees = population.map((e) =>
    e.employeeId === selectedEmployeeId
      ? { ...e, hours: e.hours + candidateShiftHours }
      : e
  );

  const selectedEmployee = projectedEmployees.find(
    (e) => e.employeeId === selectedEmployeeId
  );

  if (!selectedEmployee) return -Infinity;

  return calculateProjectedFairness(
    selectedEmployee.hours,
    projectedEmployees.map((e) => e.hours)
  );
}

/* =========================
   Fatigue helpers
   ========================= */

type ShiftLike = {
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes?: number | null;
};

type TimedShift = {
  shift: ShiftLike;
  startMs: number;
  endMs: number;
};

const MINUTES_IN_HOUR = 60;
const HOURS_IN_DAY = 24;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function msToTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

function rowToShiftLike(row: Record<string, unknown>): ShiftLike {
  const startMs = resolveShiftMs(row, "start");
  const endMs = resolveShiftMs(row, "end");

  const startTimeRaw = row.start_time as string | null;
  const endTimeRaw = row.end_time as string | null;
  const shiftDateRaw = row.shift_date as string | null;

  return {
    shift_date: shiftDateRaw ?? msToDate(startMs),
    start_time: startTimeRaw ? startTimeRaw.slice(0, 5) : msToTime(startMs),
    end_time: endTimeRaw ? endTimeRaw.slice(0, 5) : msToTime(endMs),
    unpaid_break_minutes: (row.unpaid_break_minutes as number | null) ?? 0,
  };
}

function getShiftTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_IN_HOUR + minutes;
}

function calculateRecoveredHours(restHours: number): number {
  return 38 * (1 - Math.exp(-restHours / 76));
}

function calculateShiftFatigueLoad(shift: ShiftLike): number {
  const breakMinutes = shift.unpaid_break_minutes ?? 0;
  const startTime = getShiftTime(shift.start_time);
  let endTime = getShiftTime(shift.end_time);

  if (endTime <= startTime) {
    endTime += HOURS_IN_DAY * MINUTES_IN_HOUR;
  }

  const intervalStart = [
    0,
    2 * MINUTES_IN_HOUR,
    6 * MINUTES_IN_HOUR,
    8 * MINUTES_IN_HOUR,
    10 * MINUTES_IN_HOUR,
    16 * MINUTES_IN_HOUR,
    22 * MINUTES_IN_HOUR,
  ];

  const intervalEnd = [
    2 * MINUTES_IN_HOUR,
    6 * MINUTES_IN_HOUR,
    8 * MINUTES_IN_HOUR,
    10 * MINUTES_IN_HOUR,
    16 * MINUTES_IN_HOUR,
    22 * MINUTES_IN_HOUR,
    HOURS_IN_DAY * MINUTES_IN_HOUR,
  ];

  const lowest = -0.25;
  const standard = 0;
  const moderate = 0.25;
  const highest = 0.5;

  const penalties = [
    moderate,
    highest,
    moderate,
    standard,
    lowest,
    standard,
    moderate,
  ];

  const totalShiftMinutes = endTime - startTime;
  let totalPenalty = 0;

  const fullIntervalStart = [
    ...intervalStart,
    ...intervalStart.map((x) => x + HOURS_IN_DAY * MINUTES_IN_HOUR),
  ];
  const fullIntervalEnd = [
    ...intervalEnd,
    ...intervalEnd.map((x) => x + HOURS_IN_DAY * MINUTES_IN_HOUR),
  ];
  const fullPenalties = [...penalties, ...penalties];

  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < fullIntervalStart.length; i++) {
    if (fullIntervalStart[i] <= startTime && startTime < fullIntervalEnd[i]) {
      startIndex = i;
    }
    if (fullIntervalStart[i] < endTime && endTime <= fullIntervalEnd[i]) {
      endIndex = i;
    }
  }

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Could not determine shift interval.");
  }

  for (let i = startIndex; i <= endIndex; i++) {
    const overlapStart = Math.max(startTime, fullIntervalStart[i]);
    const overlapEnd = Math.min(endTime, fullIntervalEnd[i]);

    if (overlapEnd > overlapStart) {
      const overlapMinutes = overlapEnd - overlapStart;
      const fraction = overlapMinutes / totalShiftMinutes;
      totalPenalty += fraction * fullPenalties[i];
    }
  }

  const shiftHours = Math.max(0, totalShiftMinutes - breakMinutes) / MINUTES_IN_HOUR;
  const effectiveHours = shiftHours * (1 + totalPenalty);

  if (effectiveHours <= 0) return 0;

  if (effectiveHours >= 37.999999) {
    return 1_000_000;
  }

  return -76 * Math.log(1 - effectiveHours / 38);
}

function calculateProjectedFatigue(
  currentFatigue: number,
  lastEndMs: number | null,
  candidateShift: ShiftLike,
  candidateShiftStartMs: number
): number {
  let fatigue = currentFatigue;

  if (lastEndMs !== null && candidateShiftStartMs > lastEndMs) {
    const restHours = (candidateShiftStartMs - lastEndMs) / 3_600_000;
    fatigue = Math.max(0, fatigue - calculateRecoveredHours(restHours));
  }

  fatigue += calculateShiftFatigueLoad(candidateShift);

  return fatigue;
}

function minMaxNormalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return range === 0 ? values.map(() => 0) : values.map((v) => (v - min) / range);
}

const WEIGHT_PROFILES: Record<string, { cost: number; fairness: number; fatigue: number }> = {
  BALANCED: { cost: 0.35, fairness: 0.45, fatigue: 0.20 },
  COST_OPTIMIZED: { cost: 1.00, fairness: 0.00, fatigue: 0.00 },
  FAIRNESS_OPTIMIZED: { cost: 0.00, fairness: 1.00, fatigue: 0.00 },
  FATIGUE_OPTIMIZED: { cost: 0.00, fairness: 0.00, fatigue: 1.00 },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const body = await req.json();

    const {
      organizationId,
      departmentId = null,
      subDepartmentId = null,
      dateStart,
      dateEnd,
      scope = "ALL_ELIGIBLE",
      selectedShiftIds = [],
      strategy = "BALANCED",
      softConstraints = {},
      snapshotVersion,
    } = body;

    if (!organizationId || !dateStart || !dateEnd || !snapshotVersion) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const currentSnapshot = await computeSnapshotVersion(
      supabase,
      organizationId,
      departmentId,
      subDepartmentId,
      dateStart,
      dateEnd
    );

    if (currentSnapshot !== snapshotVersion) {
      return new Response(
        JSON.stringify({
          error: "SNAPSHOT_CONFLICT",
          message: "Roster changed since baseline was fetched. Please re-fetch.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    let shiftsQuery = supabase
      .from("shifts")
      .select(
        "id, shift_date, start_at, end_at, start_time, end_time, net_length_minutes, unpaid_break_minutes, role_id"
      )
      .eq("organization_id", organizationId)
      .gte("shift_date", dateStart)
      .lte("shift_date", dateEnd)
      .eq("is_cancelled", false)
      .is("deleted_at", null)
      .not("lifecycle_status", "eq", "Cancelled")
      .eq("assignment_status", "unassigned");

    if (departmentId) {
      shiftsQuery = shiftsQuery.eq("department_id", departmentId) as typeof shiftsQuery;
    }
    if (subDepartmentId) {
      shiftsQuery = shiftsQuery.eq("sub_department_id", subDepartmentId) as typeof shiftsQuery;
    }
    if (scope === "SELECTED" && selectedShiftIds.length > 0) {
      shiftsQuery = shiftsQuery.in("id", selectedShiftIds) as typeof shiftsQuery;
    }

    const { data: rawEligibleShifts, error: shiftsError } = await shiftsQuery;
    if (shiftsError) throw shiftsError;

    const eligibleShifts = (rawEligibleShifts || []).sort(
      (a, b) =>
        resolveShiftMs(a as Record<string, unknown>, "start") -
        resolveShiftMs(b as Record<string, unknown>, "start")
    );

    let contractsQuery = supabase
      .from("user_contracts")
      .select(
        "user_id, role_id, rem_level_id, " +
          "profiles!user_contracts_user_id_profiles_fkey(first_name, last_name, hire_date, is_active)"
      )
      .eq("organization_id", organizationId)
      .eq("status", "Active");

    if (departmentId) {
      contractsQuery = contractsQuery.eq("department_id", departmentId) as typeof contractsQuery;
    }
    if (subDepartmentId) {
      contractsQuery = contractsQuery.eq("sub_department_id", subDepartmentId) as typeof contractsQuery;
    }

    const { data: rawContracts, error: contractsError } = await contractsQuery;
    if (contractsError) throw contractsError;

    const remLevelRateMap: Record<string, number | null> = {
      "00000000-0000-0001-0000-000000000000": 25,
      "00000000-0000-0001-0000-000000000001": 30,
      "00000000-0000-0001-0000-000000000002": 35,
      "00000000-0000-0001-0000-000000000003": 42,
      "00000000-0000-0001-0000-000000000004": 50,
      "00000000-0000-0001-0000-000000000005": 60,
      "00000000-0000-0001-0000-000000000006": null,
      "00000000-0000-0001-0000-000000000007": null,
    };

    const staff = (rawContracts || [])
      .filter((c: Record<string, unknown>) => {
        const profile = c.profiles as Record<string, unknown> | null;
        return profile?.is_active !== false;
      })
      .map((c: Record<string, unknown>) => {
        const remLevelId = c.rem_level_id as string | null;

        return {
          ...c,
          custom_hourly_rate: remLevelId ? (remLevelRateMap[remLevelId] ?? 25) : 25,
        };
      });

    const staffIds = staff.map((c: Record<string, unknown>) => c.user_id as string);

    let existingShiftsData: Record<string, unknown>[] = [];
    if (staffIds.length > 0) {
      const fatigueLookbackStart = addDays(dateStart, -27);

      const { data: existing, error: existingError } = await supabase
        .from("shifts")
        .select(
          "assigned_employee_id, shift_date, start_at, end_at, start_time, end_time, net_length_minutes, unpaid_break_minutes"
        )
        .in("assigned_employee_id", staffIds)
        .gte("shift_date", fatigueLookbackStart)
        .lte("shift_date", dateEnd)
        .eq("is_cancelled", false)
        .is("deleted_at", null)
        .eq("assignment_status", "assigned");

      if (existingError) throw existingError;
      existingShiftsData = (existing || []) as Record<string, unknown>[];
    }

    const weeklyMinutes = new Map<string, Map<string, number>>();
    for (const shift of existingShiftsData) {
      const empId = shift.assigned_employee_id as string;
      if (!empId) continue;

      const weekKey = getWeekKey(shift.shift_date as string);
      if (!weeklyMinutes.has(empId)) {
        weeklyMinutes.set(empId, new Map());
      }

      const employeeWeekMap = weeklyMinutes.get(empId)!;
      employeeWeekMap.set(
        weekKey,
        (employeeWeekMap.get(weekKey) || 0) + ((shift.net_length_minutes as number) || 0)
      );
    }

    const assignedFatigueHistory = new Map<string, TimedShift[]>();
    const fatigueMap = new Map<string, { fatigue: number; lastEndMs: number | null }>();
    const assignedFatigueCursor = new Map<string, number>();

    for (const emp of staff) {
      const empId = emp.user_id as string;
      if (!empId) continue;

      const empAssignedShifts: TimedShift[] = existingShiftsData
        .filter((s) => s.assigned_employee_id === empId)
        .map((s) => {
          const startMs = resolveShiftMs(s, "start");
          const endMs = resolveShiftMs(s, "end");

          return {
            shift: rowToShiftLike(s),
            startMs,
            endMs,
          };
        })
        .sort((a, b) => a.startMs - b.startMs);

      assignedFatigueHistory.set(empId, empAssignedShifts);
      assignedFatigueCursor.set(empId, 0);
      fatigueMap.set(empId, { fatigue: 0, lastEndMs: null });
    }

    const existingIntervals = new Map<string, Array<{ start: number; end: number }>>();
    for (const shift of existingShiftsData) {
      const empId = shift.assigned_employee_id as string;
      if (!empId) continue;

      const startMs = resolveShiftMs(shift, "start");
      const endMs = resolveShiftMs(shift, "end");

      if (!existingIntervals.has(empId)) {
        existingIntervals.set(empId, []);
      }
      existingIntervals.get(empId)!.push({ start: startMs, end: endMs });
    }

    const WEEKLY_CAP_MINUTES = 2400;
    const sessionIntervals = new Map<string, Array<{ start: number; end: number }>>();

    const assignments: Array<{
      shiftId: string;
      employeeId: string;
      employeeName: string;
      shiftDate: string;
      startTime: string | null;
      endTime: string | null;
      unpaidBreakMinutes: number;
    }> = [];

    const conflicts: Array<{ shiftId: string; description: string; type: string }> = [];

    const weights = WEIGHT_PROFILES[strategy] ?? WEIGHT_PROFILES["BALANCED"];

    for (const rawShift of eligibleShifts) {
      const shift = rawShift as Record<string, unknown>;
      const shiftStartMs = resolveShiftMs(shift, "start");
      const shiftEndMs = resolveShiftMs(shift, "end");
      const shiftDurMin =
        (shift.net_length_minutes as number) ??
        Math.max((shiftEndMs - shiftStartMs) / 60000, 0);
      const weekKey = getWeekKey(shift.shift_date as string);

      const candidateShift = rowToShiftLike(shift);
      const candidateShiftHours = shiftDurMin / 60;

      for (const emp of staff) {
        const empId = emp.user_id as string;
        if (!empId) continue;

        const history = assignedFatigueHistory.get(empId) ?? [];
        let cursor = assignedFatigueCursor.get(empId) ?? 0;
        let state = fatigueMap.get(empId) ?? { fatigue: 0, lastEndMs: null };

        while (cursor < history.length && history[cursor].startMs < shiftStartMs) {
          const assignedShift = history[cursor];

          state = {
            fatigue: calculateProjectedFatigue(
              state.fatigue,
              state.lastEndMs,
              assignedShift.shift,
              assignedShift.startMs
            ),
            lastEndMs: assignedShift.endMs,
          };

          cursor++;
        }

        assignedFatigueCursor.set(empId, cursor);
        fatigueMap.set(empId, state);
      }

      let candidates = staff.filter((emp: Record<string, unknown>) => {
        if (shift.role_id && emp.role_id !== shift.role_id) return false;

        for (const iv of existingIntervals.get(emp.user_id as string) || []) {
          if (iv.start < shiftEndMs && iv.end > shiftStartMs) return false;
        }

        for (const iv of sessionIntervals.get(emp.user_id as string) || []) {
          if (iv.start < shiftEndMs && iv.end > shiftStartMs) return false;
        }

        const used = weeklyMinutes.get(emp.user_id as string)?.get(weekKey) ?? 0;
        if (used + shiftDurMin > WEEKLY_CAP_MINUTES) return false;

        return true;
      });

      if (
        candidates.length > 1 &&
        (
          strategy === "BALANCED" ||
          strategy === "COST_OPTIMIZED" ||
          strategy === "FAIRNESS_OPTIMIZED" ||
          strategy === "FATIGUE_OPTIMIZED"
        )
      ) {
        const fairnessPopulation = buildFairnessPopulation(
          staff,
          weeklyMinutes,
          weekKey,
          (shift.role_id as string | null) ?? null
        );

        const rawCost: number[] = [];
        const rawFairness: number[] = [];
        const rawFatigue: number[] = [];

        for (const emp of candidates as Record<string, unknown>[]) {
          const empId = emp.user_id as string;
          console.log("[emp] :", emp);

          const costShiftInput: CostShiftInput = {
            net_length_minutes: (shift.net_length_minutes as number) ?? 0,
            start_time: (shift.start_time as string) ?? "00:00",
            end_time: (shift.end_time as string) ?? "00:00",
            unpaid_break_minutes: (shift.unpaid_break_minutes as number) ?? 0,
            remuneration_rate: (emp.custom_hourly_rate as number) ?? 25,
            scheduled_length_minutes: (shift.net_length_minutes as number) ?? 0,
            is_overnight: isOvernightShift(shift),
            is_cancelled: false,
            shift_date: shift.shift_date as string,
            allowances: {
              meal: false,
              firstAid: false,
              proteinSpill: false,
              splitShift: false,
            },
            isAnnualLeave: false,
            isPersonalLeave: false,
            isCarerLeave: false,
            previousWage: null,
          };

          const empCost = estimateCostFromShift(costShiftInput);
          rawCost.push((empCost as number) || 25 * candidateShiftHours);

          const fairnessScore = getProjectedEmployeeFairness(
            empId,
            candidateShiftHours,
            fairnessPopulation
          );
          rawFairness.push(1 - fairnessScore); // lower is better

          const state = fatigueMap.get(empId) ?? { fatigue: 0, lastEndMs: null };
          const projectedFatigue = calculateProjectedFatigue(
            state.fatigue,
            state.lastEndMs,
            candidateShift,
            shiftStartMs
          );
          rawFatigue.push(projectedFatigue);
        }

        const normCost = minMaxNormalise(rawCost);
        const normFairness = minMaxNormalise(rawFairness);
        const normFatigue = minMaxNormalise(rawFatigue);

        candidates = (candidates as Record<string, unknown>[])
          .map((emp, i) => ({
            emp,
            score:
              weights.cost * normCost[i] +
              weights.fairness * normFairness[i] +
              weights.fatigue * normFatigue[i],
          }))
          .sort((a, b) => a.score - b.score)
          .map((x) => x.emp);
      } else if (candidates.length > 1) {
        candidates = (candidates as Record<string, unknown>[]).sort((a, b) => {
          const aH = weeklyMinutes.get(a.user_id as string)?.get(weekKey) ?? 0;
          const bH = weeklyMinutes.get(b.user_id as string)?.get(weekKey) ?? 0;
          return aH - bH;
        });
      }

      if ((softConstraints as Record<string, unknown>).prioritize_senior && candidates.length > 1) {
        candidates = (candidates as Record<string, unknown>[]).sort((a, b) => {
          const aP = a.profiles as Record<string, unknown>;
          const bP = b.profiles as Record<string, unknown>;

          return (
            new Date((aP?.hire_date as string) || "2099").getTime() -
            new Date((bP?.hire_date as string) || "2099").getTime()
          );
        });
      }

      if (candidates.length > 0) {
        const sel = (candidates as Record<string, unknown>[])[0];
        const profile = sel.profiles as Record<string, unknown>;

        const startTimeRaw = shift.start_time as string | null;
        const endTimeRaw = shift.end_time as string | null;

        assignments.push({
          shiftId: shift.id as string,
          employeeId: sel.user_id as string,
          employeeName: `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim(),
          shiftDate: shift.shift_date as string,
          startTime: startTimeRaw ? startTimeRaw.slice(0, 5) : null,
          endTime: endTimeRaw ? endTimeRaw.slice(0, 5) : null,
          unpaidBreakMinutes: (shift.unpaid_break_minutes as number) || 0,
        });

        if (!sessionIntervals.has(sel.user_id as string)) {
          sessionIntervals.set(sel.user_id as string, []);
        }
        sessionIntervals.get(sel.user_id as string)!.push({
          start: shiftStartMs,
          end: shiftEndMs,
        });

        if (!weeklyMinutes.has(sel.user_id as string)) {
          weeklyMinutes.set(sel.user_id as string, new Map());
        }
        const employeeWeekMap = weeklyMinutes.get(sel.user_id as string)!;
        employeeWeekMap.set(
          weekKey,
          (employeeWeekMap.get(weekKey) ?? 0) + shiftDurMin
        );

        const currentState = fatigueMap.get(sel.user_id as string) ?? {
          fatigue: 0,
          lastEndMs: null,
        };

        const newFatigue = calculateProjectedFatigue(
          currentState.fatigue,
          currentState.lastEndMs,
          candidateShift,
          shiftStartMs
        );

        fatigueMap.set(sel.user_id as string, {
          fatigue: newFatigue,
          lastEndMs: shiftEndMs,
        });
      } else {
        conflicts.push({
          shiftId: shift.id as string,
          description: shift.role_id
            ? "No eligible staff with matching role and availability"
            : "All eligible staff are at capacity or have overlapping shifts",
          type: shift.role_id ? "ROLE_MISMATCH" : "CAPACITY",
        });
      }
    }

    const costEstimate = assignments.reduce((sum, asgn) => {
      const emp = staff.find(
        (c: Record<string, unknown>) => c.user_id === asgn.employeeId
      ) as Record<string, unknown> | undefined;

      const shift = eligibleShifts.find(
        (s: Record<string, unknown>) => s.id === asgn.shiftId
      ) as Record<string, unknown> | undefined;

      if (!emp || !shift) return sum;

      const costShiftInput: CostShiftInput = {
        net_length_minutes: (shift.net_length_minutes as number) ?? 0,
        start_time: (shift.start_time as string) ?? "00:00",
        end_time: (shift.end_time as string) ?? "00:00",
        unpaid_break_minutes: (shift.unpaid_break_minutes as number) ?? 0,
        remuneration_rate: (emp.custom_hourly_rate as number) ?? 25,
        scheduled_length_minutes: (shift.net_length_minutes as number) ?? 0,
        is_overnight: isOvernightShift(shift),
        is_cancelled: false,
        shift_date: shift.shift_date as string,
        allowances: {
          meal: false,
          firstAid: false,
          proteinSpill: false,
          splitShift: false,
        },
        isAnnualLeave: false,
        isPersonalLeave: false,
        isCarerLeave: false,
        previousWage: null,
      };

      const empCost = estimateCostFromShift(costShiftInput);

      console.log("[CostEstimate] employeeId:", asgn.employeeId);
      console.log("[CostEstimate] hourlyRate:", emp.custom_hourly_rate);
      console.log("[CostEstimate] shiftHours:", (shift.net_length_minutes) as number /60);
      console.log("[CostEstimate] currentSumBeforeAdd:", sum);
      console.log("[CostEstimate] empCost:", empCost);
      console.log("[CostEstimate] newSumAfterAdd:", sum + empCost);

      return sum + empCost;
    }, 0);

    const summary = {
      total_shifts: eligibleShifts.length,
      assigned_shifts: assignments.length,
      unassigned_shifts: conflicts.length,
      cost_estimate: Math.round(costEstimate * 100) / 100,
    };

    const solverInput = assignments
      .map((a) => `${a.shiftId}:${a.employeeId}`)
      .sort()
      .join(",");

    const sHashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(solverInput || "empty")
    );

    const solverHash = Array.from(new Uint8Array(sHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);

    const { data: session, error: sessionError } = await supabase
      .from("autoschedule_sessions")
      .insert({
        organization_id: organizationId,
        department_id: departmentId || null,
        sub_department_id: subDepartmentId || null,
        date_start: dateStart,
        date_end: dateEnd,
        snapshot_version: snapshotVersion,
        scope,
        selected_shift_ids: selectedShiftIds,
        strategy,
        soft_constraints: softConstraints,
        status: "simulated",
        simulation_result: { assignments, conflicts, summary },
        solver_hash: solverHash,
      })
      .select("id")
      .single();

    if (sessionError) throw sessionError;

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        snapshotVersion,
        solverHash,
        assignments,
        conflicts,
        summary,
      }),
      {
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
