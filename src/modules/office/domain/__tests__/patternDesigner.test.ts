/**
 * The designer exists so a pattern is compliant BY CONSTRUCTION rather than
 * validated after the fact. The production template named "Baseline FT" is what
 * happens without it: 8.0h days against a 38h contract, which is 40h a week.
 *
 * The arithmetic is unforgiving and invisible — 38 ÷ 5 is 7.6h exactly, which
 * is also the daily floor — so these pin both ends of the range and the
 * consequences that fall out of the length.
 */
import { describe, expect, it } from 'vitest';
import {
    designPattern, lawfulDayCounts, requiredPaidBreakMinutes,
} from '../patternDesigner';
import { validatePattern } from '../patternValidator';
import type { IsoWeekday } from '../types';

const ROLE = 'role-1';
const MON_FRI: IsoWeekday[] = [1, 2, 3, 4, 5];

const base = {
    weeklyHours: 38,
    days: MON_FRI,
    startTime: '08:00',
    unpaidBreakMinutes: 30,
    roleId: ROLE,
};

describe('lawfulDayCounts', () => {
    it('allows only four or five days for a 38-hour week', () => {
        // 3 days = 12.67h (over the 12h ceiling); 6 days = 6.33h (under the
        // 7.6h floor). The window is genuinely that narrow.
        expect(lawfulDayCounts(38)).toEqual([4, 5]);
    });

    it('widens for a longer week and narrows for a shorter one', () => {
        expect(lawfulDayCounts(45.6)).toEqual([4, 5, 6]);
        expect(lawfulDayCounts(15.2)).toEqual([2]);
    });
});

describe('requiredPaidBreakMinutes — cl 37, a consequence not a choice', () => {
    it('gives 15 minutes past four hours and 30 past eight', () => {
        expect(requiredPaidBreakMinutes(239)).toBe(0);
        expect(requiredPaidBreakMinutes(240)).toBe(15);
        expect(requiredPaidBreakMinutes(456)).toBe(15);   // 7.6h
        expect(requiredPaidBreakMinutes(480)).toBe(30);   // 8.0h
        expect(requiredPaidBreakMinutes(570)).toBe(30);   // 9.5h
    });
});

describe('designPattern', () => {
    it('derives 7.6h days from a 38h contract across five days', () => {
        const d = designPattern(base);

        expect(d.findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
        expect(d.slots).toHaveLength(5);
        expect(d.hoursPerDay).toBe(7.6);
        expect(d.weeklyHours).toBe(38);
        // 08:00 + 7.6h net + 30m unpaid = 16:06.
        expect(d.slots[0]).toMatchObject({
            startTime: '08:00', endTime: '16:06', netMinutes: 456,
            unpaidBreakMinutes: 30, paidBreakMinutes: 15,
        });
    });

    it('derives 9.5h days across four, and the second rest pause with them', () => {
        const d = designPattern({ ...base, days: [1, 2, 3, 4] });

        expect(d.findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
        expect(d.hoursPerDay).toBe(9.5);
        expect(d.weeklyHours).toBe(38);
        // 08:00 + 9.5h + 30m = 18:00, and past eight hours cl 37.2 adds a second pause.
        expect(d.slots[0]).toMatchObject({ endTime: '18:00', paidBreakMinutes: 30 });
    });

    it('REFUSES six days — each would fall below the 7.6h floor', () => {
        const d = designPattern({ ...base, days: [1, 2, 3, 4, 5, 6] });

        const blocked = d.findings.find(f => f.code === 'BFT_DESIGN_DAY_TOO_SHORT');
        expect(blocked?.severity).toBe('BLOCKING');
        expect(blocked?.clause).toBe('ICC EBA cl 35.1(c)');
        expect(blocked?.plain).toContain('4 or 5 days');
        expect(d.slots).toEqual([]);
    });

    it('REFUSES three days — each would exceed the 12h ceiling', () => {
        const d = designPattern({ ...base, days: [1, 2, 3] });

        const blocked = d.findings.find(f => f.code === 'BFT_DESIGN_DAY_TOO_LONG');
        expect(blocked?.severity).toBe('BLOCKING');
        expect(blocked?.clause).toBe('ICC EBA cl 35.1(d)');
        expect(d.slots).toEqual([]);
    });

    it('REFUSES a split that does not land on whole minutes', () => {
        // 38h over 7 days is 5.428…h — unwritable at minute resolution, and
        // below the floor anyway. The uneven check fires first and names the
        // counts that would work.
        const d = designPattern({ ...base, days: [1, 2, 3, 4, 5, 6, 7] });

        expect(d.findings[0].code).toBe('BFT_DESIGN_UNEVEN_DAYS');
        expect(d.findings[0].plain).toContain('4 or 5');
    });

    it('REFUSES a long day without a lawful meal break', () => {
        for (const unpaid of [0, 15, 90]) {
            const d = designPattern({ ...base, unpaidBreakMinutes: unpaid });
            const blocked = d.findings.find(f => f.code === 'BFT_DESIGN_MEAL_BREAK');
            expect(blocked?.severity).toBe('BLOCKING');
            expect(blocked?.clause).toBe('ICC EBA cl 36.1');
        }
        // 30 and 60 are the bounds and both pass.
        expect(designPattern({ ...base, unpaidBreakMinutes: 60 })
            .findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
    });

    it('says out loud when the day sits exactly on the floor', () => {
        const d = designPattern(base);
        const note = d.findings.find(f => f.code === 'BFT_DESIGN_AT_FLOOR');

        expect(note?.severity).toBe('INFO');
        expect(note?.plain).toContain('7.6 hours');
        // Four 9.5h days have slack, so no such note.
        expect(designPattern({ ...base, days: [1, 2, 3, 4] })
            .findings.find(f => f.code === 'BFT_DESIGN_AT_FLOOR')).toBeUndefined();
    });

    it('warns when the design runs past midnight', () => {
        const d = designPattern({ ...base, days: [1, 2, 3, 4], startTime: '20:00' });
        const warn = d.findings.find(f => f.code === 'BFT_DESIGN_CROSSES_MIDNIGHT');

        expect(warn?.severity).toBe('WARNING');
        expect(warn?.clause).toBe('ICC EBA cl 40.1');
        expect(d.slots[0].endTime).toBe('06:00');
    });

    it('requires days, a role and a start time before designing anything', () => {
        expect(designPattern({ ...base, days: [] }).findings[0].code).toBe('BFT_DESIGN_NO_DAYS');
        expect(designPattern({ ...base, roleId: '' }).findings[0].code).toBe('BFT_DESIGN_NO_ROLE');
        expect(designPattern({ ...base, startTime: '' }).findings[0].code).toBe('BFT_DESIGN_NO_START');
    });

    it('deduplicates and orders the chosen days', () => {
        // Four DISTINCT days, one of them repeated. Three distinct days would
        // be refused for length, so the duplicate has to be absorbed before the
        // arithmetic runs -- which is the thing being asserted.
        const d = designPattern({ ...base, days: [5, 1, 1, 3, 4] as IsoWeekday[] });

        expect(d.slots.map(s => s.dayOfWeek)).toEqual([1, 3, 4, 5]);
        expect(d.hoursPerDay).toBe(9.5);
    });
});

describe('what the designer produces PASSES the gate that refused production', () => {
    it.each([
        ['five days', MON_FRI],
        ['four days', [1, 2, 3, 4] as IsoWeekday[]],
    ])('%s survives validatePattern with no blocking findings', (_label, days) => {
        // The designer and the validator are separate code paths reading the
        // same clauses. If they ever disagree, one of them is wrong -- and the
        // validator is the one that guards the write.
        const designed = designPattern({ ...base, days });

        const findings = validatePattern(
            {
                employeeId: 'emp-1', userContractId: 'uc-1',
                subDepartmentId: 'sub-1',
                slots: designed.slots.map((s, i) => ({
                    sourceSlotId: `d-${i}`,
                    dayOfWeek: s.dayOfWeek,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    unpaidBreakMinutes: s.unpaidBreakMinutes,
                    paidBreakMinutes: s.paidBreakMinutes,
                    netMinutes: s.netMinutes,
                    roleId: s.roleId,
                    sortOrder: s.sortOrder,
                })),
            },
            { contractedWeeklyHours: 38, cycleWeeks: 4, roleId: ROLE },
        );

        expect(findings.filter(f => f.severity === 'BLOCKING')).toEqual([]);
        expect(findings.find(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT')).toBeUndefined();
        expect(findings.find(f => f.code === 'BFT_PATTERN_BELOW_CONTRACT')).toBeUndefined();
    });
});
