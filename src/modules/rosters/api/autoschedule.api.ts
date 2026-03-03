import { supabase } from '@/platform/realtime/client';

// ── State Machine ──────────────────────────────────────────────────────────────

export type AutoScheduleState =
    | 'BASELINE_LOADING'
    | 'BASELINE_READY'
    | 'SIMULATING'
    | 'SIMULATION_READY'
    | 'SIMULATION_ERROR'
    | 'SNAPSHOT_INVALID';

// ── Context ───────────────────────────────────────────────────────────────────

export interface AutoScheduleContext {
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    dateStart?: string;
    dateEnd?: string;
}

// ── Baseline Scan ─────────────────────────────────────────────────────────────

export interface BaselineScan {
    snapshot_version: string;
    unassigned_count: number;
    assigned_count: number;
    available_staff_count: number;
    potential_conflicts: number;
    overtime_exposure: number;
    eligible_shifts: string[];
}

// ── Simulation ────────────────────────────────────────────────────────────────

export type SimulationScope = 'ALL_ELIGIBLE' | 'SELECTED';
export type SimulationStrategy = 'BALANCED' | 'COST_OPTIMIZED' | 'COVERAGE_MAXIMIZED';

export interface SoftConstraints {
    minimize_overtime: boolean;
    fairness: boolean;
    prioritize_senior: boolean;
    minimize_travel: boolean;
}

export interface SimulationConfig {
    scope: SimulationScope;
    selectedShiftIds?: string[];
    strategy: SimulationStrategy;
    softConstraints: SoftConstraints;
    snapshotVersion: string;
}

export interface SimulationAssignment {
    shiftId: string;
    employeeId: string;
    employeeName: string;
}

export interface SimulationConflict {
    shiftId: string;
    description: string;
    type: 'ROLE_MISMATCH' | 'CAPACITY' | 'UNASSIGNABLE';
}

export interface SimulationSummary {
    total_shifts: number;
    assigned_shifts: number;
    unassigned_shifts: number;
    cost_estimate: number;
}

export interface SimulationResult {
    sessionId: string;
    snapshotVersion: string;
    solverHash: string;
    assignments: SimulationAssignment[];
    conflicts: SimulationConflict[];
    summary: SimulationSummary;
}

// ── Commit ────────────────────────────────────────────────────────────────────

export interface CommitResult {
    success: boolean;
    updatedCount: number;
}

// ── Snapshot conflict error ───────────────────────────────────────────────────

export class SnapshotConflictError extends Error {
    readonly code = 'SNAPSHOT_CONFLICT';
    constructor() {
        super('Roster changed during simulation. Please re-fetch baseline and re-run.');
        this.name = 'SnapshotConflictError';
    }
}

// ── Edge function caller ──────────────────────────────────────────────────────

async function invokeEdgeFunction<T>(
    functionName: string,
    body: Record<string, unknown>
): Promise<T> {
    const { data, error } = await supabase.functions.invoke<T>(functionName, { body });

    if (error) {
        // Attempt to extract error payload from the HTTP response
        let errorPayload: { error?: string; message?: string } = {};
        try {
            // FunctionsHttpError exposes `.context` as the Response object
            const ctx = (error as unknown as { context?: Response }).context;
            if (ctx?.json) {
                errorPayload = await ctx.json();
            }
        } catch {
            // Ignore parse failures
        }

        if (
            errorPayload?.error === 'SNAPSHOT_CONFLICT' ||
            (error as unknown as { status?: number }).status === 409
        ) {
            throw new SnapshotConflictError();
        }

        throw new Error(errorPayload?.message || error.message || `${functionName} failed`);
    }

    return data as T;
}

// ── Snapshot hash helper (Web Crypto API — available in all modern browsers) ──

async function buildSnapshotHash(
    rows: Array<{ id: string; version: number; assignment_status: string }>
): Promise<string> {
    const input = rows
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(r => `${r.id}:${r.version}:${r.assignment_status}`)
        .join(',');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input || 'empty'));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `snap_${hex.slice(0, 16)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Phase 1 — Direct Supabase query (no edge function).
 *
 * Gaps fixed vs. prior edge-function approach:
 *   • user_contracts.status is 'Active' (capital A), not 'active'
 *   • shifts.start_at is NULL on seed data; uses shift_date + start_time instead
 *   • lifecycle_status = 'Cancelled' shifts are excluded in addition to is_cancelled flag
 *   • Potential conflicts = shifts whose role_id has zero matching Active contracts
 *   • Overtime exposure = distinct employees already assigned > 35h in the date range
 */
export async function fetchBaseline(context: AutoScheduleContext): Promise<BaselineScan> {
    const { organizationId, departmentId, subDepartmentId, dateStart, dateEnd } = context;

    if (!organizationId || !dateStart || !dateEnd) {
        throw new Error('organizationId, dateStart, and dateEnd are required for baseline scan');
    }

    // ── 1. All shifts in scope ─────────────────────────────────────────────
    let shiftsQ = supabase
        .from('shifts')
        .select('id, version, assignment_status, role_id, shift_date, net_length_minutes, assigned_employee_id')
        .eq('organization_id', organizationId)
        .gte('shift_date', dateStart)
        .lte('shift_date', dateEnd)
        .eq('is_cancelled', false)
        .is('deleted_at', null)
        .not('lifecycle_status', 'eq', 'Cancelled');   // guard against lifecycle-cancelled shifts

    if (departmentId)    shiftsQ = shiftsQ.eq('department_id', departmentId);
    if (subDepartmentId) shiftsQ = shiftsQ.eq('sub_department_id', subDepartmentId);

    const { data: shifts, error: shiftsError } = await shiftsQ;
    if (shiftsError) throw new Error(shiftsError.message);

    const allShifts = shifts ?? [];
    const unassignedShifts = allShifts.filter(s => s.assignment_status === 'unassigned');
    const assignedShifts   = allShifts.filter(s => s.assignment_status === 'assigned');

    // ── 2. Deterministic snapshot hash ────────────────────────────────────
    const snapshotVersion = await buildSnapshotHash(allShifts as Parameters<typeof buildSnapshotHash>[0]);

    // ── 3. Active staff contracts (note: 'Active', capital A) ─────────────
    let staffQ = supabase
        .from('user_contracts')
        .select('user_id, role_id')
        .eq('organization_id', organizationId)
        .eq('status', 'Active');            // ← capital A — verified against live data

    if (departmentId)    staffQ = staffQ.eq('department_id', departmentId);
    if (subDepartmentId) staffQ = staffQ.eq('sub_department_id', subDepartmentId);

    const { data: contracts, error: contractsError } = await staffQ;
    if (contractsError) throw new Error(contractsError.message);

    const activeContracts = contracts ?? [];

    // ── 4. Available staff pool + potential conflicts ──────────────────────
    //
    // "Available staff" = distinct staff who can fill AT LEAST ONE unassigned
    // shift by role.  A staff member qualifies for a shift when:
    //   • the shift has no role requirement (role_id IS NULL), OR
    //   • their contract role_id matches the shift's role_id
    //
    // This is intentionally role-scoped so the count reflects actionable
    // capacity, not headcount of the whole department.
    //
    // "Potential conflict" = an unassigned shift for which zero active
    // contracts can fill the role requirement.

    const eligibleStaffIds = new Set<string>();
    let potentialConflicts = 0;

    for (const shift of unassignedShifts) {
        const shiftRoleId = (shift as Record<string, unknown>).role_id as string | null;
        const eligibleForShift = activeContracts.filter(c =>
            !shiftRoleId || c.role_id === shiftRoleId
        );
        if (eligibleForShift.length === 0) {
            potentialConflicts++;
        } else {
            for (const c of eligibleForShift) eligibleStaffIds.add(c.user_id);
        }
    }

    // ── 5. Overtime exposure: staff already > 35h assigned in the period ──
    const minutesByEmp = new Map<string, number>();
    for (const shift of assignedShifts) {
        if (!shift.assigned_employee_id) continue;
        minutesByEmp.set(
            shift.assigned_employee_id,
            (minutesByEmp.get(shift.assigned_employee_id) ?? 0) + (shift.net_length_minutes ?? 0)
        );
    }
    let overtimeExposure = 0;
    for (const [, mins] of minutesByEmp) {
        if (mins > 2100) overtimeExposure++;   // 35h in minutes
    }

    return {
        snapshot_version:     snapshotVersion,
        unassigned_count:     unassignedShifts.length,
        assigned_count:       assignedShifts.length,
        available_staff_count: eligibleStaffIds.size,
        potential_conflicts:  potentialConflicts,
        overtime_exposure:    overtimeExposure,
        eligible_shifts:      unassignedShifts.map(s => s.id),
    };
}

export async function runSimulation(
    context: AutoScheduleContext,
    config: SimulationConfig
): Promise<SimulationResult> {
    return invokeEdgeFunction<SimulationResult>('autoschedule-simulate', {
        organizationId: context.organizationId,
        departmentId: context.departmentId,
        subDepartmentId: context.subDepartmentId,
        dateStart: context.dateStart,
        dateEnd: context.dateEnd,
        scope: config.scope,
        selectedShiftIds: config.selectedShiftIds ?? [],
        strategy: config.strategy,
        softConstraints: config.softConstraints,
        snapshotVersion: config.snapshotVersion,
    });
}

export async function saveAsDraft(
    sessionId: string,
    snapshotVersion: string
): Promise<{ success: boolean; draftCount: number }> {
    return invokeEdgeFunction('autoschedule-save-draft', { sessionId, snapshotVersion });
}

export async function commitAssignments(
    sessionId: string,
    snapshotVersion: string
): Promise<CommitResult> {
    return invokeEdgeFunction<CommitResult>('autoschedule-commit', { sessionId, snapshotVersion });
}
