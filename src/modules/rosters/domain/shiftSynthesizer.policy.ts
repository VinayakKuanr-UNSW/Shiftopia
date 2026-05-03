import type { TemplateGroupType } from "./shift.entity";
export { timeToMinutes, minutesToTime } from "./availabilityResolution";

export const MIN_SHIFT_MINUTES = 180; // 3 hrs min
export const MAX_SHIFT_MINUTES = 720; // 12 hrs max
export const SLOT_DURATION_MINUTES = 30;

export type ShiftType = "core" | "peak_buffer"; // core = main shift, peak_buffer = extra shift for busy periods (PRD section 8)

export const SHIFT_POLICY = {
  minMinutes: MIN_SHIFT_MINUTES,
  maxMinutes: MAX_SHIFT_MINUTES,
  slotMinutes: SLOT_DURATION_MINUTES,
  microPeakMinutes: 60, // spikes under 1 hr get merged into nearby shifts (PRD section 7)
} as const;

// 06:00 → 02:00 next-day (covers late concerts), 30-min slots, 40 total.
export const SLOT_MINUTES = Array.from(
  { length: 40 },
  (_, i) => 6 * 60 + i * 30,
);

export interface DemandSlot {
  slotStart: number;
  slotEnd: number;
  requiredHeadcount: number; // how many staff are needed
  residualHeadcount: number; // how many are still needed after existing shifts (float for deletion logic)
  residualHeadcountInt: number; // how many are still needed after existing shifts (int for creation logic)
  contributingEvents?: string[]; // Events that drove this demand slice
  reasons?: string[]; // Explanations for rule-based demand (e.g., L3 rules, L5 multipliers)
}

// Role mapping
export interface DemandTensor {
  roleId: string;
  subDepartmentId: string;
  buildingType: TemplateGroupType; // used to set group_type on generated shifts
  slots: DemandSlot[];
  demandSource?: 'ml_predicted' | 'derived' | 'baseline' | null;
  targetEmploymentType?: 'FT' | 'PT' | 'Casual' | null;
}
// Output of the packing algorithm
export interface SynthesizedShift {
  roleId: string;
  subDepartmentId: string;
  buildingType: TemplateGroupType;
  startMinutes: number; // eg. 420 = 07:00
  endMinutes: number; //eg 720 = 12:00
  type: ShiftType;
  headcount: number; ///how many shifts to create at this time
  reasons?: string[]; // Explainable AI reasoning badge text

  // Labor Forecasting Metadata
  demand_source?: "baseline" | "ml_predicted" | "derived" | null;
  target_employment_type?: "FT" | "PT" | "Casual" | null;
  demand_group_id?: string | null;
}

export interface PeakWindow {
  peakStart: number;
  peakEnd: number;
  maxHeadcount: number;
}

// Merges shifts under 60 min into a contiguous neighbour (shorter result wins, left on tie).
// Orphans are left for enforceMinDuration to pad.
export function mergeMicroPeaks(
  shifts: SynthesizedShift[],
): SynthesizedShift[] {
  if (shifts.length === 0) return [];

  const result = [...shifts].sort((a, b) => a.startMinutes - b.startMinutes);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const shift = result[i];
      if (
        shift.endMinutes - shift.startMinutes >=
        SHIFT_POLICY.microPeakMinutes
      )
        continue;

      const prev = i > 0 ? result[i - 1] : null;
      const next = i < result.length - 1 ? result[i + 1] : null;

      const canMergePrev =
        prev &&
        prev.endMinutes === shift.startMinutes &&
        shift.endMinutes - prev.startMinutes <= SHIFT_POLICY.maxMinutes;
      const canMergeNext =
        next &&
        next.startMinutes === shift.endMinutes &&
        next.endMinutes - shift.startMinutes <= SHIFT_POLICY.maxMinutes;

      const leftResult = canMergePrev
        ? shift.endMinutes - prev!.startMinutes
        : Infinity;
      const rightResult = canMergeNext
        ? next!.endMinutes - shift.startMinutes
        : Infinity;

      if (canMergePrev && leftResult <= rightResult) {
        result[i - 1] = {
          ...prev!,
          endMinutes: shift.endMinutes,
          headcount: Math.max(prev!.headcount, shift.headcount),
        };
        result.splice(i, 1);
        changed = true;
        break;
      }

      if (canMergeNext) {
        result[i + 1] = {
          ...next!,
          startMinutes: shift.startMinutes,
          headcount: Math.max(next!.headcount, shift.headcount),
        };
        result.splice(i, 1);
        changed = true;
        break;
      }
      // Orphan: no contiguous neighbour. Leave it for enforceMinDuration to pad.
    }
  }

  return result;
}

export type EventPhase = "pre" | "during" | "post";

// Which phase each role peaks in. Lowercase keys. Unknown roles default to 'during'.
export const ROLE_PHASE_MAP: Record<string, EventPhase[]> = {
  usher: ["during"],
  security: ["during"],
  "food staff": ["during"],
  supervisor: ["during"],
  "event setup": ["pre", "post"],
  "pack down": ["pre", "post"],
  logistics: ["pre", "post"],
};

const DEFAULT_PHASES: EventPhase[] = ["during"];

// Splits slots into pre/during/post thirds and returns the window covering the role's phase(s).
// Multi-phase roles get the envelope (first start to last end).
export function detectPeaks(
  slots: DemandSlot[],
  roleId: string,
): PeakWindow | null {
  if (slots.length === 0) return null;

  const maxHeadcount = Math.max(...slots.map((s) => s.requiredHeadcount));
  if (maxHeadcount === 0) return null;

  const phases = ROLE_PHASE_MAP[roleId.toLowerCase()] ?? DEFAULT_PHASES;

  const n = slots.length;
  const firstThirdEnd = Math.floor(n / 3);
  const secondThirdEnd = Math.floor((2 * n) / 3);

  const phaseRange: Record<EventPhase, [number, number]> = {
    pre: [0, Math.max(firstThirdEnd - 1, 0)],
    during: [firstThirdEnd, Math.max(secondThirdEnd - 1, firstThirdEnd)],
    post: [secondThirdEnd, n - 1],
  };

  const indices = phases.flatMap((p) => [phaseRange[p][0], phaseRange[p][1]]);
  const first = Math.min(...indices);
  const last = Math.max(...indices);

  return {
    peakStart: slots[first].slotStart,
    peakEnd: slots[last].slotEnd,
    maxHeadcount,
  };
}

// if shift > 12hr, splits at midpoint into two equal halves
//  both stay unassigned (ask client if midpoint is correct split point)
export function splitShift(shift: SynthesizedShift): SynthesizedShift[] {
  const duration = shift.endMinutes - shift.startMinutes;
  if (duration <= SHIFT_POLICY.maxMinutes) return [shift];

  const splitPoint = shift.startMinutes + Math.floor(duration / 2);
  return [
    { ...shift, endMinutes: splitPoint },
    { ...shift, startMinutes: splitPoint },
  ];
}

// Operating hours bounds derived from SLOT_MINUTES
const OP_HOURS_START = SLOT_MINUTES[0]; // 420 (07:00)
const OP_HOURS_END =
  SLOT_MINUTES[SLOT_MINUTES.length - 1] + SLOT_DURATION_MINUTES; // 1230 (20:30)

// Step 8: Enforce 3-hour minimum shift duration.
// Short shifts are merged with adjacent same-role/sub-department neighbours if possible,
// otherwise padded symmetrically to reach MIN_SHIFT_MINUTES, clamped to operating hours.
export function enforceMinDuration(
  shifts: SynthesizedShift[],
): SynthesizedShift[] {
  if (shifts.length === 0) return [];

  const result = [...shifts].sort((a, b) => a.startMinutes - b.startMinutes);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const shift = result[i];
      const duration = shift.endMinutes - shift.startMinutes;
      if (duration >= MIN_SHIFT_MINUTES) continue;

      // Try merging with an adjacent shift (same role + sub-department, contiguous times)
      const prev = i > 0 ? result[i - 1] : null;
      const next = i < result.length - 1 ? result[i + 1] : null;

      const canMergePrev =
        prev &&
        prev.roleId === shift.roleId &&
        prev.subDepartmentId === shift.subDepartmentId &&
        prev.endMinutes === shift.startMinutes &&
        shift.endMinutes - prev.startMinutes <= MAX_SHIFT_MINUTES;

      const canMergeNext =
        next &&
        next.roleId === shift.roleId &&
        next.subDepartmentId === shift.subDepartmentId &&
        next.startMinutes === shift.endMinutes &&
        next.endMinutes - shift.startMinutes <= MAX_SHIFT_MINUTES;

      if (canMergePrev) {
        result[i - 1] = {
          ...prev!,
          endMinutes: shift.endMinutes,
          headcount: Math.max(prev!.headcount, shift.headcount),
        };
        result.splice(i, 1);
        changed = true;
        break;
      }

      if (canMergeNext) {
        result[i + 1] = {
          ...next!,
          startMinutes: shift.startMinutes,
          headcount: Math.max(next!.headcount, shift.headcount),
        };
        result.splice(i, 1);
        changed = true;
        break;
      }

      // No merge candidate — pad symmetrically to MIN_SHIFT_MINUTES
      const deficit = MIN_SHIFT_MINUTES - duration;
      const padBefore = Math.floor(deficit / 2);
      const padAfter = deficit - padBefore;
      let newStart = shift.startMinutes - padBefore;
      let newEnd = shift.endMinutes + padAfter;

      // Clamp to operating hours
      if (newStart < OP_HOURS_START) {
        newEnd += OP_HOURS_START - newStart;
        newStart = OP_HOURS_START;
      }
      if (newEnd > OP_HOURS_END) {
        newStart -= newEnd - OP_HOURS_END;
        newEnd = OP_HOURS_END;
      }
      newStart = Math.max(newStart, OP_HOURS_START);

      result[i] = { ...shift, startMinutes: newStart, endMinutes: newEnd };
      changed = true;
      break;
    }
  }

  return result;
}

// Step 9: Enforce 12-hour maximum shift duration.
// Recursively applies splitShift until all shifts are within MAX_SHIFT_MINUTES.
export function enforceMaxDuration(
  shifts: SynthesizedShift[],
): SynthesizedShift[] {
  return shifts.flatMap(function applySplit(
    s: SynthesizedShift,
  ): SynthesizedShift[] {
    const parts = splitShift(s);
    return parts.length === 1 ? parts : parts.flatMap(applySplit);
  });
}

// --- Step 6: Supervisor Ratio Enforcement ---

export interface SupervisoryRatioRule {
  subDepartmentId: string;
  ratio: number; // 1 supervisor per N staff
  supervisorRoleId: string;
  supervisedRoleIds?: string[]; // Optional: specific roles this supervisor manages. If empty, manages all non-supervisor roles.
}

// For each sub-department with a ratio rule, generates supervisor shifts proportional
// to the staff headcount in each time window. Pure function — rules passed in.
export function applySupervisorRatios(
  shifts: SynthesizedShift[],
  ratios: SupervisoryRatioRule[],
): SynthesizedShift[] {
  if (ratios.length === 0) return shifts;

  let currentShifts = [...shifts];
  let addedInThisPass = true;
  const maxPasses = 5; // Prevent infinite loops
  let passCount = 0;

  while (addedInThisPass && passCount < maxPasses) {
    addedInThisPass = false;
    passCount++;

    const newSupervisors: SynthesizedShift[] = [];

    // Process each ratio rule
    for (const rule of ratios) {
      // Find shifts that this rule supervises
      const staffShifts = currentShifts.filter((s) => {
        if (s.subDepartmentId !== rule.subDepartmentId) return false;
        if (s.roleId === rule.supervisorRoleId) return false;

        if (rule.supervisedRoleIds && rule.supervisedRoleIds.length > 0) {
          return rule.supervisedRoleIds.includes(s.roleId);
        }
        return true; // Default: supervises everything in the sub-dept
      });

      if (staffShifts.length === 0) continue;

      // Group staff shifts by time window (startMinutes, endMinutes)
      // This ensures we have enough supervisors for every time slice
      const windows = new Map<string, { start: number; end: number; headcount: number; buildingType: TemplateGroupType; demand_source: any }>();
      for (const s of staffShifts) {
        const key = `${s.startMinutes}-${s.endMinutes}`;
        const existing = windows.get(key) ?? { 
          start: s.startMinutes, 
          end: s.endMinutes, 
          headcount: 0, 
          buildingType: s.buildingType,
          demand_source: s.demand_source
        };
        existing.headcount += s.headcount;
        windows.set(key, existing);
      }

      // Check if we already have supervisor shifts for these windows in THIS sub-dept
      const existingSupervisors = currentShifts.filter(
        (s) => s.subDepartmentId === rule.subDepartmentId && s.roleId === rule.supervisorRoleId
      );

      for (const [key, win] of windows) {
        const supervisorsNeeded = Math.ceil(win.headcount / rule.ratio);
        const alreadyHave = existingSupervisors
          .filter((s) => s.startMinutes === win.start && s.endMinutes === win.end)
          .reduce((sum, s) => sum + s.headcount, 0);

        if (supervisorsNeeded > alreadyHave) {
          const gap = supervisorsNeeded - alreadyHave;
          newSupervisors.push({
            roleId: rule.supervisorRoleId,
            subDepartmentId: rule.subDepartmentId,
            buildingType: win.buildingType,
            startMinutes: win.start,
            endMinutes: win.end,
            type: "core",
            headcount: gap,
            demand_source: win.demand_source,
            reasons: [`Supervisory Ratio ${rule.ratio}:1 for ${win.headcount} staff`],
          });
          addedInThisPass = true;
        }
      }
    }

    if (addedInThisPass) {
      currentShifts = [...currentShifts, ...newSupervisors];
    }
  }

  return currentShifts;
}

// --- Step 7: Minimum Staff Enforcement ---

export interface MinimumStaffRule {
  subDepartmentId: string;
  roleId: string;
  minimumHeadcount: number;
}

// Ensures each sub-department + role combination meets the minimum headcount.
// If no shifts exist for a rule, creates one covering the full coverage window.
// If shifts exist but headcount is below minimum, increases the widest shift's headcount.
export function applyMinimumStaff(
  shifts: SynthesizedShift[],
  minimums: MinimumStaffRule[],
  coverageWindow: { start: number; end: number },
): SynthesizedShift[] {
  if (minimums.length === 0) return shifts;

  const result = [...shifts];

  for (const rule of minimums) {
    const matching = result.filter(
      (s) =>
        s.subDepartmentId === rule.subDepartmentId && s.roleId === rule.roleId,
    );

    if (matching.length === 0) {
      // No shifts at all for this role+subdept — create one covering the full window
      // Need a buildingType; derive from any shift in the same sub-department, or fall back
      const sameSubDept = result.find(
        (s) => s.subDepartmentId === rule.subDepartmentId,
      );
      const buildingType = sameSubDept?.buildingType ?? "convention_centre";

      result.push({
        roleId: rule.roleId,
        subDepartmentId: rule.subDepartmentId,
        buildingType,
        startMinutes: coverageWindow.start,
        endMinutes: coverageWindow.end,
        type: "core",
        headcount: rule.minimumHeadcount,
        target_employment_type: undefined,
      });
      continue;
    }

    // Find the maximum headcount across matching shifts
    const maxHeadcount = Math.max(...matching.map((s) => s.headcount));
    if (maxHeadcount >= rule.minimumHeadcount) continue;

    // Increase the widest shift's headcount to meet the minimum
    let widestIdx = -1;
    let widestDuration = 0;
    for (let i = 0; i < result.length; i++) {
      const s = result[i];
      if (
        s.subDepartmentId !== rule.subDepartmentId ||
        s.roleId !== rule.roleId
      )
        continue;
      const dur = s.endMinutes - s.startMinutes;
      if (dur > widestDuration) {
        widestDuration = dur;
        widestIdx = i;
      }
    }

    if (widestIdx >= 0) {
      result[widestIdx] = {
        ...result[widestIdx],
        headcount: rule.minimumHeadcount,
      };
    }
  }

  return result;
}
