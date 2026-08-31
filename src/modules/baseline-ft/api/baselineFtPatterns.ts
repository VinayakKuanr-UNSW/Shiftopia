/**
 * Baseline FT — reading and writing the standing patterns.
 *
 * ONE UI ROW IS N DATABASE ROWS, and this module is the only place that knows
 * it. `baseline_ft_patterns` stores a row per working day, because that is what
 * the unique index needs in order to make a full-time split shift
 * unrepresentable (cl 39.1). The table shows "Mon–Fri 08:00–16:06", which is
 * one line. Loading groups; saving expands.
 *
 * SAVING UPSERTS BEFORE IT DELETES. A save is a whole-employee replacement, and
 * the two halves cannot be one transaction over PostgREST. Doing it in this
 * order means a failure between them leaves an EXTRA working day — visible in
 * the table, and correctable — rather than a missing one, which would silently
 * under-roster somebody. When only one ordering can be atomic, pick the one
 * whose failure is loud.
 */

import { supabase } from '@/platform/supabase/client';
import { deriveRow, rowToSlots, type PatternRow } from '../domain/patternRow';
import type { Finding, IsoWeekday } from '../domain/types';

const TABLE = 'baseline_ft_patterns';

const COLUMNS =
    'id, organization_id, department_id, sub_department_id, employee_id, user_contract_id, ' +
    'week_in_cycle, iso_day_of_week, start_time, end_time, unpaid_break_minutes, ' +
    'paid_break_minutes, net_minutes, role_id';

/**
 * Days that share everything except the day itself collapse into one row.
 *
 * The key is exactly the set of fields a table row displays, so two saved days
 * with the same shape and role become the single line the manager originally
 * typed — and a day whose start time was later changed on its own splits back
 * out into its own line rather than silently dragging its neighbours with it.
 */
function groupKey(r: {
    employee_id: string; week_in_cycle: number; start_time: string;
    end_time: string; unpaid_break_minutes: number; role_id: string;
}): string {
    return [
        r.employee_id, r.week_in_cycle, r.start_time, r.end_time,
        r.unpaid_break_minutes, r.role_id,
    ].join('|');
}

/** `HH:mm:ss` from Postgres `time`, or `HH:mm` from a form. Always `HH:mm`. */
const hhmm = (t: unknown): string => String(t ?? '').slice(0, 5);

export interface LoadPatternsResult {
    rows: PatternRow[];
    findings: Finding[];
}

/**
 * Every saved pattern line for a sub-department, grouped for the table.
 *
 * Deliberately NOT filtered to the employees currently eligible: a pattern
 * belonging to someone who has since moved teams still has to be loaded, or a
 * save would compute their day set as empty and delete it.
 */
export async function loadBaselinePatterns(subDepartmentId: string): Promise<LoadPatternsResult> {
    const findings: Finding[] = [];

    const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .eq('sub_department_id', subDepartmentId)
        .order('employee_id', { ascending: true })
        .order('iso_day_of_week', { ascending: true });

    if (error) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERNS_READ_FAILED',
            plain: `The team's working patterns could not be read: ${error.message}`,
            overridable: false,
            calculation: { error: error.message, code: (error as { code?: string }).code },
        });
        return { rows: [], findings };
    }

    const byKey = new Map<string, PatternRow>();

    for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const row = {
            employee_id: String(raw.employee_id),
            week_in_cycle: Number(raw.week_in_cycle ?? 1),
            start_time: hhmm(raw.start_time),
            end_time: hhmm(raw.end_time),
            unpaid_break_minutes: Number(raw.unpaid_break_minutes ?? 0),
            role_id: String(raw.role_id ?? ''),
        };
        const key = groupKey(row);
        const day = Number(raw.iso_day_of_week) as IsoWeekday;

        const existing = byKey.get(key);
        if (existing) {
            byKey.set(key, {
                ...existing,
                days: [...existing.days, day].sort((a, b) => a - b),
                slotIdByDay: { ...existing.slotIdByDay, [day]: String(raw.id) },
            });
            continue;
        }

        byKey.set(key, {
            // The group key IS the row identity: stable across reloads, and it
            // changes exactly when the shape changes, which is when React
            // should treat it as a different row.
            rowId: key,
            employeeId: row.employee_id,
            userContractId: String(raw.user_contract_id ?? ''),
            weekInCycle: row.week_in_cycle,
            days: [day],
            startTime: row.start_time,
            endTime: row.end_time,
            unpaidBreakMinutes: row.unpaid_break_minutes,
            roleId: row.role_id,
            slotIdByDay: { [day]: String(raw.id) },
        });
    }

    return { rows: [...byKey.values()], findings };
}

export interface SaveBaselinePatternsInput {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    /** The complete desired state for `employeeIds`. Anything absent is removed. */
    rows: readonly PatternRow[];
    /**
     * Whose patterns this save owns.
     *
     * Passed explicitly rather than derived from `rows`, because an employee
     * whose every day was just switched off has NO rows — and deriving the list
     * from the rows would silently skip exactly the person whose pattern was
     * meant to be cleared.
     */
    employeeIds: readonly string[];
    actorId: string;
}

export interface SaveBaselinePatternsResult {
    written: number;
    removed: number;
    findings: Finding[];
}

export async function saveBaselinePatterns(
    input: SaveBaselinePatternsInput,
): Promise<SaveBaselinePatternsResult> {
    const findings: Finding[] = [];
    const { organizationId, departmentId, subDepartmentId, rows, employeeIds, actorId } = input;

    if (employeeIds.length === 0) return { written: 0, removed: 0, findings };

    // ── What the table now says, expanded to one row per working day ─────────
    const desired = rows.flatMap(row => {
        const { netMinutes, paidBreakMinutes } = deriveRow(row);
        return rowToSlots(row).map(slot => ({
            organization_id: organizationId,
            department_id: departmentId,
            sub_department_id: subDepartmentId,
            employee_id: row.employeeId,
            user_contract_id: row.userContractId,
            week_in_cycle: row.weekInCycle,
            iso_day_of_week: slot.dayOfWeek,
            start_time: row.startTime,
            end_time: row.endTime,
            unpaid_break_minutes: row.unpaidBreakMinutes,
            // Both derived, both stored. `net_minutes` is additionally pinned to
            // start/end/unpaid by a CHECK, so a client that computed it
            // differently is rejected rather than quietly believed.
            paid_break_minutes: paidBreakMinutes,
            net_minutes: netMinutes,
            role_id: row.roleId,
            updated_by: actorId,
            updated_at: new Date().toISOString(),
        }));
    });

    const desiredKeys = new Set(
        desired.map(d => `${d.employee_id}|${d.week_in_cycle}|${d.iso_day_of_week}`),
    );

    // ── What is already stored for these people ──────────────────────────────
    const { data: existing, error: readErr } = await supabase
        .from(TABLE)
        .select('id, employee_id, week_in_cycle, iso_day_of_week')
        .in('employee_id', employeeIds as string[]);

    if (readErr) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERNS_READ_FAILED',
            plain: `The existing patterns could not be read, so nothing was saved: ${readErr.message}`,
            overridable: false,
            calculation: { error: readErr.message },
        });
        return { written: 0, removed: 0, findings };
    }

    const staleIds = ((existing ?? []) as unknown as Array<Record<string, unknown>>)
        .filter(r => !desiredKeys.has(
            `${String(r.employee_id)}|${Number(r.week_in_cycle)}|${Number(r.iso_day_of_week)}`))
        .map(r => String(r.id));

    // ── Write, then prune ────────────────────────────────────────────────────
    let written = 0;
    if (desired.length > 0) {
        const { error: upsertErr, count } = await supabase
            .from(TABLE)
            .upsert(desired as never, {
                // The unique index. Conflicting rows are UPDATED in place, so an
                // edit keeps its id and any applied shift's provenance still
                // resolves.
                onConflict: 'employee_id,week_in_cycle,iso_day_of_week',
                count: 'exact',
            });

        if (upsertErr) {
            findings.push({
                severity: 'BLOCKING',
                code: 'BFT_PATTERNS_WRITE_FAILED',
                // The database's own words. A CHECK violation surfaces through
                // PostgREST as a bare 400, and swallowing the message is how one
                // becomes an unexplainable failure in the UI.
                plain: `The patterns could not be saved: ${upsertErr.message}`,
                overridable: false,
                calculation: { error: upsertErr.message, code: (upsertErr as { code?: string }).code },
            });
            return { written: 0, removed: 0, findings };
        }
        written = count ?? desired.length;
    }

    let removed = 0;
    if (staleIds.length > 0) {
        const { error: delErr, count } = await supabase
            .from(TABLE)
            .delete({ count: 'exact' })
            .in('id', staleIds);

        if (delErr) {
            // Non-fatal by design: the new pattern is already stored, and what
            // remains is a working day that should have gone. Reported as a
            // WARNING so the manager can see and re-save, rather than as a
            // failure that would suggest nothing was written.
            findings.push({
                severity: 'WARNING',
                code: 'BFT_PATTERNS_PRUNE_FAILED',
                plain:
                    `The new pattern was saved, but ${staleIds.length} working day(s) that were ` +
                    `removed could not be deleted. Save again to clear them.`,
                overridable: true,
                calculation: { error: delErr.message, stale_ids: staleIds.length },
            });
        } else {
            removed = count ?? staleIds.length;
        }
    }

    return { written, removed, findings };
}
