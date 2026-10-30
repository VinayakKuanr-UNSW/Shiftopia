/**
 * Group-mode summary cells, built from shifts on the client.
 *
 * The cells normally come from `get_roster_summary`, which knows only
 * organisation, dates and departments. The toolbar's filters (state, lifecycle,
 * assignment, outcome, bidding, trading, role, search) never reached them, so a
 * filtered view still showed every shift's counts. Decision (2026-10-18):
 * filters apply to every cell in the view. With a filter on, the page loads the
 * shifts, runs the SAME `applyAdvancedFilters` every other view uses, and builds
 * the cells here.
 *
 * Mirrors `get_roster_summary` exactly (live definition read 2026-10-18) so a
 * cell reads the same whether it came from the server or from here.
 */
import type { Shift } from './shift.entity';
import type { RosterSummaryCellDTO } from '../api/rosterSummary.queries';

/** The cell key every summary consumer looks up: date :: group :: sub-group. */
export function rosterSummaryKey(shiftDate: string, groupType: string | null | undefined, subGroupName: string | null | undefined): string {
    return `${shiftDate}::${groupType || 'unassigned'}::${subGroupName || ''}`;
}

const PUBLISHED_OR_LATER = new Set(['Published', 'InProgress', 'Completed']);

export function buildRosterSummaryMap(shifts: readonly Shift[]): Map<string, RosterSummaryCellDTO> {
    const cells = new Map<string, RosterSummaryCellDTO & { _employees: Set<string> }>();

    for (const s of shifts) {
        const key = rosterSummaryKey(s.shift_date, s.group_type, s.sub_group_name);
        let cell = cells.get(key);
        if (!cell) {
            cell = {
                shift_date: s.shift_date,
                group_type: s.group_type ?? null,
                sub_group_name: s.sub_group_name ?? null,
                total_shifts: 0,
                assigned_shifts: 0,
                open_shifts: 0,
                published_shifts: 0,
                draft_shifts: 0,
                cancelled_shifts: 0,
                total_net_minutes: 0,
                unique_employees: 0,
                _employees: new Set(),
            };
            cells.set(key, cell);
        }
        cell.total_shifts++;
        if (s.assigned_employee_id) {
            cell.assigned_shifts++;
            cell._employees.add(s.assigned_employee_id);
        } else {
            cell.open_shifts++;
        }
        if (PUBLISHED_OR_LATER.has(s.lifecycle_status)) cell.published_shifts++;
        if (s.lifecycle_status === 'Draft') cell.draft_shifts++;
        if (s.is_cancelled) cell.cancelled_shifts++;
        cell.total_net_minutes += Number((s as { net_length_minutes?: number | null }).net_length_minutes ?? 0);
    }

    const out = new Map<string, RosterSummaryCellDTO>();
    for (const [key, { _employees, ...cell }] of cells) {
        out.set(key, { ...cell, unique_employees: _employees.size });
    }
    return out;
}
