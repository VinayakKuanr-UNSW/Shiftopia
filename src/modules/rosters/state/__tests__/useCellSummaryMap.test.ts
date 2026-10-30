/**
 * Filters apply to every cell in the view, summary cells included
 * (decision 2026-10-18). Before, Group mode's default summary cells came only
 * from the server aggregate, which never saw the toolbar filters.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCellSummaryMap } from '../useRosterSummary';
import { useRosterStore, DEFAULT_ADVANCED_FILTERS } from '../useRosterStore';
import type { Shift } from '../../domain/shift.entity';
import type { RosterSummaryCellDTO } from '../../api/rosterSummary.queries';

const KEY = '2026-10-05::theatre::Ushers';
const shift = (over: Partial<Shift>): Shift => ({
    id: Math.random().toString(36),
    shift_date: '2026-10-05',
    group_type: 'theatre',
    sub_group_name: 'Ushers',
    lifecycle_status: 'Draft',
    assigned_employee_id: null,
    is_cancelled: false,
    net_length_minutes: 360,
    ...over,
} as unknown as Shift);

const shifts = [
    shift({ assigned_employee_id: 'e1' }),
    shift({ assigned_employee_id: 'e2' }),
    shift({ assigned_employee_id: null }),
];
const serverMap = new Map<string, RosterSummaryCellDTO>([[KEY, {
    shift_date: '2026-10-05', group_type: 'theatre', sub_group_name: 'Ushers',
    total_shifts: 3, assigned_shifts: 2, open_shifts: 1, published_shifts: 0,
    draft_shifts: 3, cancelled_shifts: 0, total_net_minutes: 1080, unique_employees: 2,
}]]);

beforeEach(() => {
    useRosterStore.setState({ advancedFilters: DEFAULT_ADVANCED_FILTERS });
});

describe('useCellSummaryMap', () => {
    it('uses the server aggregate when no filter is on', () => {
        const { result } = renderHook(() => useCellSummaryMap(shifts, serverMap));

        expect(result.current).toBe(serverMap);
    });

    it('counts only the shifts that pass the filter when one is on', () => {
        useRosterStore.setState({ advancedFilters: { ...DEFAULT_ADVANCED_FILTERS, assignmentStatus: 'unassigned' } });

        const { result } = renderHook(() => useCellSummaryMap(shifts, serverMap));

        expect(result.current.get(KEY)).toMatchObject({ total_shifts: 1, assigned_shifts: 0, open_shifts: 1 });
    });

    it('shows a cell as empty when the filter hides every shift in it', () => {
        useRosterStore.setState({ advancedFilters: { ...DEFAULT_ADVANCED_FILTERS, lifecycleStatus: 'published' } });

        const { result } = renderHook(() => useCellSummaryMap(shifts, serverMap));

        expect(result.current.get(KEY)).toBeUndefined();
    });
});
