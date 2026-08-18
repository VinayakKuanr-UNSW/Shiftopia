/**
 * Solution Parser — Converts OR-Tools JSON output → TypeScript domain objects.
 *
 * The parser bridges the raw API response from the Python optimizer
 * to the structured types used by the AutoSchedulerController.
 *
 * Key responsibilities:
 * 1. Group proposals by employee (for multi-shift bulk assignment)
 * 2. Enrich with shift metadata from the local roster cache
 * 3. Validate proposal completeness (reject malformed assignments)
 * 4. Sort by (employee, shiftDate) for deterministic output
 */

import type { AssignmentProposal, OptimizeResponse } from '../types';
import type { TargetEmploymentType } from '@/modules/core/model/employment.types';

// =============================================================================
// SHIFT METADATA (minimal — enough for compliance evaluation)
// =============================================================================

export interface ShiftMeta {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    role_id?: string | null;
    roleName?: string;
    unpaid_break_minutes?: number;
    /**
     * Paid rest-pause allotment. cl 39.2 measures the split-shift spread
     * "excluding meal AND rest breaks", so HC-9 and `dailySpreadRule` both need
     * it; without it the solver measures a longer spread than the labour layer
     * does and refuses pairings V8 would accept.
     */
    paid_break_minutes?: number;
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: TargetEmploymentType | null;
    /** Narrows a 'PT' target to Flexible Part-Time staff only. */
    target_requires_flexible?: boolean;
    level?: number;
    is_training?: boolean;
}

export interface EmployeeMeta {
    id: string;
    name: string;
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
    /**
     * The RAW `user_contracts.employment_status` for the in-scope
     * sub-department contract ('Full-Time' | 'Part-Time' | 'Casual' |
     * 'Flexible Part-Time'). This — not `contract_type` — is what
     * `trg_shift_employment_target_2_enforce` matches a shift's target
     * against, so it is the only value that can keep the solver's
     * eligibility in step with what the database will actually accept.
     * `contract_type` additionally collapses 'Flexible Part-Time' onto 'PT'.
     */
    employment_status?: string | null;
    contracted_role_ids?: string[];
    contracted_weekly_hours?: number;
    remuneration_rate?: number;
    max_weekly_minutes?: number;
    level?: number;
    is_flexible?: boolean;
    is_student?: boolean;
    visa_limit?: number;
}

// =============================================================================
// ENRICHED PROPOSAL
// =============================================================================

export interface EnrichedProposal {
    shiftId: string;
    employeeId: string;
    employeeName: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    cost: number;
    employmentType: string;
    roleName?: string;
    roleId?: string | null;
    unpaidBreakMinutes?: number;
    /** Carried from ShiftMeta so the compliance re-validation can rebuild a
     *  candidate shift that still knows its employment target. Without these,
     *  V8_EMPLOYMENT_TARGET falls through its `if (!target) continue` guard and
     *  the preview cannot see what the DB trigger will reject. */
    targetEmploymentType?: TargetEmploymentType | null;
    targetRequiresFlexible?: boolean;
}

// =============================================================================
// GROUPED ASSIGNMENTS (by employee, for AssignmentValidator)
// =============================================================================

export interface EmployeeProposalGroup {
    employeeId: string;
    employeeName: string;
    shiftIds: string[];
    proposals: EnrichedProposal[];
}

// =============================================================================
// PARSER
// =============================================================================

export class SolutionParser {
    /**
     * Parse the raw optimizer response into enriched, grouped proposals.
     *
     * @param response    - Raw response from the Python optimizer
     * @param shiftMap    - Map of shiftId → ShiftMeta (from local roster data)
     * @param employeeMap - Map of employeeId → EmployeeMeta
     * @returns           - Grouped proposals by employee + list of uncovered shift IDs
     */
    parse(
        response: OptimizeResponse,
        shiftMap: Map<string, ShiftMeta>,
        employeeMap: Map<string, EmployeeMeta>,
    ): {
        groups: EmployeeProposalGroup[];
        uncoveredV8ShiftIds: string[];
        rejected: AssignmentProposal[];
    } {
        const rejected: AssignmentProposal[] = [];
        const enriched: EnrichedProposal[] = [];

        for (const proposal of response.assignments) {
            const shift = shiftMap.get(proposal.shift_id);
            const employee = employeeMap.get(proposal.employee_id);

            if (!shift || !employee) {
                // Stale reference — optimizer had a shift/employee that no longer exists
                rejected.push(proposal);
                continue;
            }

            enriched.push({
                shiftId: proposal.shift_id,
                employeeId: proposal.employee_id,
                employeeName: employee.name,
                shiftDate: shift.shift_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                cost: proposal.cost,
                employmentType: proposal.employment_type,
                roleName: shift.roleName,
                roleId: shift.role_id,
                unpaidBreakMinutes: shift.unpaid_break_minutes,
                targetEmploymentType: shift.target_employment_type ?? null,
                targetRequiresFlexible: shift.target_requires_flexible ?? false,
            });
        }

        // Sort by (employeeId, shiftDate, startTime) for deterministic grouping
        enriched.sort((a, b) => {
            const empCmp = a.employeeId.localeCompare(b.employeeId);
            if (empCmp !== 0) return empCmp;
            const dateCmp = a.shiftDate.localeCompare(b.shiftDate);
            if (dateCmp !== 0) return dateCmp;
            return a.startTime.localeCompare(b.startTime);
        });

        // Group by employee
        const groupMap = new Map<string, EmployeeProposalGroup>();
        for (const p of enriched) {
            if (!groupMap.has(p.employeeId)) {
                groupMap.set(p.employeeId, {
                    employeeId: p.employeeId,
                    employeeName: p.employeeName,
                    shiftIds: [],
                    proposals: [],
                });
            }
            const group = groupMap.get(p.employeeId)!;
            group.shiftIds.push(p.shiftId);
            group.proposals.push(p);
        }

        const groups = Array.from(groupMap.values()).sort((a, b) =>
            a.employeeName.localeCompare(b.employeeName),
        );

        if (rejected.length > 0) {
            console.warn('[SolutionParser] Rejected stale proposals:', rejected.length);
        }

        return {
            groups,
            uncoveredV8ShiftIds: response.unassigned_shift_ids.filter(id => shiftMap.has(id)),
            rejected,
        };
    }

    /**
     * Build ShiftMeta and EmployeeMeta maps from the raw roster data.
     * Call this once before parsing to avoid repeated lookups.
     */
    buildMaps(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): { shiftMap: Map<string, ShiftMeta>; employeeMap: Map<string, EmployeeMeta> } {
        return {
            shiftMap:    new Map(shifts.map(s => [s.id, s])),
            employeeMap: new Map(employees.map(e => [e.id, e])),
        };
    }
}

export const solutionParser = new SolutionParser();
