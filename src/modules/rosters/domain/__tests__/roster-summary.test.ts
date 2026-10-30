/**
 * Client-built summary cells must read exactly like `get_roster_summary`'s, so
 * a filtered Group view and an unfiltered one agree on what a number means.
 */
import { describe, it, expect } from 'vitest';
import { buildRosterSummaryMap, rosterSummaryKey } from '../roster-summary';
import type { Shift } from '../shift.entity';

const mk = (over: Partial<Shift>): Shift => ({
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

describe('rosterSummaryKey', () => {
    it('matches the key the summary hook and the grid use', () => {
        expect(rosterSummaryKey('2026-10-05', 'theatre', 'Ushers')).toBe('2026-10-05::theatre::Ushers');
        expect(rosterSummaryKey('2026-10-05', null, null)).toBe('2026-10-05::unassigned::');
    });
});

describe('buildRosterSummaryMap — mirrors get_roster_summary', () => {
    it('counts each cell the way the RPC does', () => {
        const map = buildRosterSummaryMap([
            mk({ assigned_employee_id: 'e1', lifecycle_status: 'Published' }),
            mk({ assigned_employee_id: 'e1', lifecycle_status: 'InProgress' }),
            mk({ assigned_employee_id: 'e2', lifecycle_status: 'Completed' }),
            mk({ lifecycle_status: 'Draft' }),
            mk({ lifecycle_status: 'Cancelled', is_cancelled: true }),
        ]);

        expect(map.get('2026-10-05::theatre::Ushers')).toEqual({
            shift_date: '2026-10-05',
            group_type: 'theatre',
            sub_group_name: 'Ushers',
            total_shifts: 5,          // COUNT(*) — cancelled included, as in SQL
            assigned_shifts: 3,
            open_shifts: 2,
            published_shifts: 3,      // Published | InProgress | Completed
            draft_shifts: 1,
            cancelled_shifts: 1,
            total_net_minutes: 1800,
            unique_employees: 2,      // COUNT(DISTINCT assigned_employee_id)
        });
    });

    it('keeps each date and sub-group in its own cell', () => {
        const map = buildRosterSummaryMap([
            mk({}),
            mk({ sub_group_name: 'Bar' }),
            mk({ shift_date: '2026-10-06' }),
        ]);

        expect([...map.keys()].sort()).toEqual([
            '2026-10-05::theatre::Bar',
            '2026-10-05::theatre::Ushers',
            '2026-10-06::theatre::Ushers',
        ]);
    });
});
