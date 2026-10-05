/**
 * Copy one full-time shift onto a set of dates.
 *
 * THE SAME WRITE PATH AS APPLY, deliberately. `shiftsCommands.createShift` runs
 * the shape gate on every creation — the 7.6h full-time floor, the spread cap,
 * the break rules — and that gate is the ONLY enforcement point for them. A raw
 * insert here would write unchecked rows, which is precisely how the DnD
 * quick-add, Group Mode inline create and the synthesiser all ended up bypassing
 * it once before.
 *
 * SO COMPLIANCE IS NOT RE-IMPLEMENTED HERE. `planCopy` filters the dates it can
 * decide cheaply and deterministically — leave, an existing shift, roster
 * coverage, the cycle ceiling. Everything else is the gate's job, and a rejection
 * from it is a legitimate per-date outcome rather than a crash: the range is
 * written date by date and each failure is reported with the gate's own message.
 *
 * PARTIAL SUCCESS IS THE NORMAL CASE. Ten dates written and one refused is not an
 * error state; it is the answer. The caller reports both halves.
 *
 * WRITTEN A FEW AT A TIME, NOT ONE AFTER ANOTHER. Each create takes ~3s
 * (roster resolve + shape gate + sm_create_shift), so a 19-date copy written
 * serially took ~95s behind a bare "Applying…" — long enough to look broken and
 * be refreshed away. The dates are independent (each a different day, usually a
 * different roster, and `planCopy` already guarantees no two land on one day),
 * so they go `COPY_CONCURRENCY` at a time, with progress reported as they land.
 */
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import { resolveRosterTarget } from './rosterTarget';

export interface CopySourceShift {
    employeeId: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    startTime: string;
    endTime: string;
    unpaidBreakMinutes: number;
    paidBreakMinutes: number;
    roleId: string;
}

export interface CopyOutcome {
    /** Dates written, in date order. */
    created: string[];
    failed: Array<{ date: string; reason: string }>;
}

/** How many creates run at once. Enough to cut a long copy ~4×, few enough not to flood the gate. */
export const COPY_CONCURRENCY = 4;

export async function copyShiftToDates(
    source: CopySourceShift,
    dates: readonly string[],
    options: {
        concurrency?: number;
        /** Called after each date settles, written or refused. */
        onProgress?: (done: number, total: number) => void;
    } = {},
): Promise<CopyOutcome> {
    const created: string[] = [];
    const failed: Array<{ date: string; reason: string }> = [];
    const total = dates.length;
    let done = 0;

    const writeOne = async (date: string) => {
        try {
            /*
             * Resolved PER DATE, not once. Each date can fall in a different
             * roster — and `resolveRosterTarget` is what refuses a missing,
             * published or locked one (cl 38.2) with a message meant for a
             * manager. `planCopy` has usually filtered those already, from the
             * coverage read; this is the authoritative check at write time, when
             * the roster may have been published in between.
             */
            const target = await resolveRosterTarget({
                subDepartmentId: source.subDepartmentId,
                departmentId: source.departmentId,
                organizationId: source.organizationId,
                shiftDate: date,
            });

            await shiftsCommands.createShift({
                roster_id: target.rosterId,
                // The DTO's name for the row's NOT NULL `roster_subgroup_id`.
                shift_subgroup_id: target.rosterSubgroupId,
                organization_id: source.organizationId,
                department_id: source.departmentId,
                sub_department_id: source.subDepartmentId,
                shift_date: date,
                start_time: source.startTime,
                end_time: source.endTime,
                unpaid_break_minutes: source.unpaidBreakMinutes,
                paid_break_minutes: source.paidBreakMinutes,
                role_id: source.roleId,
                target_employment_type: 'FT',
                assigned_employee_id: source.employeeId,
                // Provenance label. The trigger that required it for FT rows
                // was dropped in 20261004170000.
                creation_source: 'baseline_ft',
                assignment_source: 'baseline_ft',
                // The Roster Planner buckets on these, NOT on the structural
                // subgroup id. Omitting them writes a shift that is correctly
                // parented and renders in no group at all.
                group_type: target.groupType as never,
                sub_group_name: target.subGroupName,
            });

            created.push(date);
        } catch (err) {
            failed.push({
                date,
                reason: err instanceof Error ? err.message : 'The shift could not be created.',
            });
        } finally {
            done += 1;
            options.onProgress?.(done, total);
        }
    };

    // A small worker pool over a shared cursor: at most `concurrency` in flight.
    const concurrency = Math.max(1, options.concurrency ?? COPY_CONCURRENCY);
    let cursor = 0;
    const worker = async () => {
        while (cursor < dates.length) {
            const date = dates[cursor++];
            await writeOne(date);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, dates.length) }, worker));

    created.sort();
    failed.sort((a, b) => a.date.localeCompare(b.date));
    return { created, failed };
}
