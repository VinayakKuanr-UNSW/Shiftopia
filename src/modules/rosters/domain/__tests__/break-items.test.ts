import { describe, it, expect, vi } from 'vitest';

vi.mock('@/platform/supabase/client', () => ({ supabase: {} }));

import { completedBreakMinutes, parseScheduledBreaks, parseTimesheetBreaks } from '../break-items';
import { normalizeShiftRow } from '../../api/shifts.queries';

describe('parseScheduledBreaks', () => {
    it('numbers rows, trims times to HH:mm and keeps a numeric duration', () => {
        expect(parseScheduledBreaks([
            { start: '12:00:00', end: '12:30:00', duration: 30 },
            { sno: 7, start: '16:00', end: '16:15' },
        ])).toEqual([
            { sno: 1, start: '12:00', end: '12:30', duration: 30 },
            { sno: 7, start: '16:00', end: '16:15' },
        ]);
    });

    it('treats anything but an array, and junk rows, as no breaks', () => {
        expect(parseScheduledBreaks(null)).toEqual([]);
        expect(parseScheduledBreaks({})).toEqual([]);
        expect(parseScheduledBreaks([null])).toEqual([{ sno: 1, start: '', end: '' }]);
    });
});

describe('parseTimesheetBreaks / completedBreakMinutes', () => {
    const punches = [
        { id: 'b2', timesheet_id: 't', shift_id: 's', break_seq: 2, break_start: '2026-11-04T05:00:00Z', break_end: null, duration_minutes: null },
        { id: 'b1', timesheet_id: 't', shift_id: 's', break_seq: 1, break_start: '2026-11-04T02:00:00Z', break_end: '2026-11-04T02:30:00Z', duration_minutes: 30 },
    ];

    it('orders punches by break_seq', () => {
        expect(parseTimesheetBreaks(punches).map((b) => b.id)).toEqual(['b1', 'b2']);
    });

    it('sums only completed punches, and is null when none were punched (zero-fallback)', () => {
        expect(completedBreakMinutes(parseTimesheetBreaks(punches))).toBe(30);
        expect(completedBreakMinutes(parseTimesheetBreaks([]))).toBeNull();
        expect(completedBreakMinutes(parseTimesheetBreaks(undefined))).toBeNull();
    });
});

describe('normalizeShiftRow — group fields', () => {
    // group_type / sub_group_name are no longer shift columns; Group mode buckets
    // on them, so they must come from the embedded sub-group or every shift
    // falls into Convention Centre → General.
    it('derives them from roster_subgroup → roster_group', () => {
        const shift = normalizeShiftRow({
            id: 's1',
            roster_subgroup: { name: 'AM Base', roster_group: { name: 'Theatre', external_id: 'theatre' } },
        });
        expect(shift.group_type).toBe('theatre');
        expect(shift.sub_group_name).toBe('AM Base');
    });

    it('reads the un-aliased roster_groups embed too', () => {
        const shift = normalizeShiftRow({
            id: 's2',
            roster_subgroup: { name: 'Bar', roster_groups: { external_id: 'the_cutaway' } },
        });
        expect(shift.group_type).toBe('the_cutaway');
    });
});
