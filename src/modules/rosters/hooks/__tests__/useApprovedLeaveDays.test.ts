/**
 * Approved leave on the People mode grid (moved from the Office page,
 * 2026-10-04): a leave card on the day, and the day closed to rostering.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { indexApprovedLeaveDays } from '../useApprovedLeaveDays';
import type { RawLeaveDay } from '@/modules/office/domain/types';

const day = (date: string, status: 'approved' | 'pending', leaveType = 'ANNUAL'): RawLeaveDay =>
    ({ date, status, leaveType, credit: 'CREDITS' } as unknown as RawLeaveDay);

describe('indexApprovedLeaveDays', () => {
    it('keeps approved days and drops pending ones', () => {
        // A request nobody has actioned must not take a day off the grid.
        const idx = indexApprovedLeaveDays(new Map([
            ['emp-1', [day('2099-03-10', 'approved'), day('2099-03-11', 'pending')]],
        ]));
        expect(idx.get('emp-1')?.has('2099-03-10')).toBe(true);
        expect(idx.get('emp-1')?.has('2099-03-11')).toBe(false);
    });

    it('takes the first approved record on a day, deterministically', () => {
        const idx = indexApprovedLeaveDays(new Map([
            ['emp-1', [day('2099-03-10', 'approved', 'ANNUAL'), day('2099-03-10', 'approved', 'PERSONAL')]],
        ]));
        expect(idx.get('emp-1')?.get('2099-03-10')?.leaveType).toBe('ANNUAL');
    });

    it('has no prototype to fall through', () => {
        const idx = indexApprovedLeaveDays(new Map());
        expect(idx.get('constructor')).toBeUndefined();
    });
});

describe('the People mode day cell', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/modules/rosters/ui/modes/PeopleModeGrid.tsx'), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const cell = src.slice(src.indexOf('const EmployeeDateCellImpl'), src.indexOf('const EmployeeDateCell = React.memo'));

    it('shows the leave card, flagging any shift still rostered that day', () => {
        expect(cell).toMatch(/<LeaveDayCard leave=\{leave\} hasConflictingShift=\{shifts\.length > 0\} \/>/);
    });

    it('closes an approved-leave day to rostering — both the cell click and the + button', () => {
        expect(cell).toMatch(/const closed = datePast \|\| Boolean\(leave\)/);
        expect(cell).toMatch(/shifts\.length === 0 && !closed/);
        expect(cell).toMatch(/!isBulkMode && canEdit && !closed/);
        expect(cell).not.toMatch(/canEdit && !datePast/);
    });
});
