/**
 * The editable row: its derivations, and its agreement with the database.
 *
 * The first block is the important one. `baseline_ft_patterns` pins
 * `net_minutes` to `start_time`, `end_time` and `unpaid_break_minutes` with a
 * CHECK constraint, and `grossMinutesBetween` is the client's copy of the same
 * arithmetic. If the two ever disagree, a row the table shows as valid is
 * rejected by Postgres with a constraint name and no explanation — the exact
 * failure mode that made an unrecognised `created_from` value surface as a bare
 * "the pattern could not be saved".
 *
 * The constraint is:
 *     net_minutes = (((end_minutes - start_minutes + 1439) % 1440) + 1)
 *                   - unpaid_break_minutes
 */
import { describe, expect, it } from 'vitest';
import {
    attachLeaveCredit, copyPatternShape, cycleVerdict, deriveRow, grossMinutesBetween,
    patternHoursByWeekday, rowToSlots, rowsToPattern, seedRow,
    type PatternRow,
} from '../patternRow';
import type { EmployeeContractFacts, IsoWeekday, RawLeaveDay } from '../types';

const ROLE = 'role-1';

function row(over: Partial<PatternRow> = {}): PatternRow {
    return {
        rowId: 'r1',
        employeeId: 'emp-1',
        userContractId: 'uc-1',
        weekInCycle: 1,
        days: [1, 2, 3, 4, 5],
        startTime: '08:00',
        endTime: '16:06',
        unpaidBreakMinutes: 30,
        roleId: ROLE,
        slotIdByDay: {},
        ...over,
    };
}

const FACTS: Pick<EmployeeContractFacts, 'contractedWeeklyHours' | 'cycleWeeks'> = {
    contractedWeeklyHours: 38,
    cycleWeeks: 4,
};

/** The database's expression, transcribed. Deliberately a second implementation. */
function checkConstraintGross(startTime: string, endTime: string): number {
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return (((m(endTime) - m(startTime) + 1439) % 1440) + 1);
}

describe('grossMinutesBetween agrees with the CHECK constraint', () => {
    it.each([
        ['a normal day',            '08:00', '16:06', 486],
        ['exactly eight hours',     '09:00', '17:00', 480],
        ['crossing midnight',       '22:00', '06:00', 480],
        ['finishing at midnight',   '16:00', '00:00', 480],
        ['starting at midnight',    '00:00', '08:00', 480],
        ['one minute',              '08:00', '08:01', 1],
        ['one minute short of a day', '00:01', '00:00', 1439],
    ])('%s: %s to %s is %i minutes', (_label, start, end, expected) => {
        expect(grossMinutesBetween(start, end)).toBe(expected);
        expect(grossMinutesBetween(start, end)).toBe(checkConstraintGross(start, end));
    });

    it('treats an identical start and end as a full 24 hours, not zero', () => {
        // Both implementations must agree on this: `% 1440` alone would give 0,
        // which the `net_minutes > 0` constraint would then reject on a row the
        // client believed was fine.
        expect(grossMinutesBetween('08:00', '08:00')).toBe(1440);
        expect(checkConstraintGross('08:00', '08:00')).toBe(1440);
    });
});

describe('deriveRow', () => {
    it('derives gross, net and the paid rest pause from the five typed fields', () => {
        const d = deriveRow(row());
        expect(d.grossMinutes).toBe(486);          // 08:00 → 16:06
        expect(d.netMinutes).toBe(456);            // less the 30m unpaid meal break
        expect(d.paidBreakMinutes).toBe(15);       // cl 37.1 — past four hours
        expect(d.weeklyMinutes).toBe(456 * 5);     // 38h exactly
    });

    it('gives a second paid rest pause once the day passes eight hours', () => {
        // cl 37.2. Not a choice — a consequence, which is why it is derived.
        expect(deriveRow(row({ endTime: '16:30' })).paidBreakMinutes).toBe(30);
        expect(deriveRow(row({ endTime: '16:30' })).netMinutes).toBe(480);
    });

    it('gives none at all on a short day', () => {
        expect(deriveRow(row({ endTime: '11:00', unpaidBreakMinutes: 0 })).paidBreakMinutes).toBe(0);
    });
});

describe('cycleVerdict', () => {
    it('calls the compliant five-day week exact', () => {
        const v = cycleVerdict([row()], FACTS);
        expect(v.patternWeeklyHours).toBeCloseTo(38, 6);
        expect(v.cycleHours).toBeCloseTo(152, 6);
        expect(v.ceilingHours).toBe(152);
        expect(v.status).toBe('balanced');
    });

    it('catches the production breach as it is typed', () => {
        // 08:00–16:30 with a 30-minute break is 8.0h a day and 160h a cycle
        // against a ceiling of 152 — the standing breach every full-time
        // employee in this database was carrying. Eight minutes a day away
        // from lawful, which is why it has to be on screen and not in a report.
        const v = cycleVerdict([row({ endTime: '16:30' })], FACTS);
        expect(v.cycleHours).toBeCloseTo(160, 6);
        expect(v.status).toBe('over');
        expect(v.deltaHours).toBeCloseTo(8, 6);
    });

    it('calls a four-day nine-hour week short, not wrong', () => {
        // 9h × 4 = 36h a week, 144 against 152. A legitimate arrangement that
        // leaves a variance — the product prefers an honest variance to an
        // illegal roster, so this must not read as a breach.
        const v = cycleVerdict([row({ days: [1, 2, 3, 4], endTime: '17:30' })], FACTS);
        expect(v.cycleHours).toBeCloseTo(144, 6);
        expect(v.status).toBe('short');
    });

    it('sums several lines for one employee', () => {
        // Mon–Wed early, Thu–Fri late: two lines, one contract.
        const v = cycleVerdict([
            row({ rowId: 'a', days: [1, 2, 3] }),
            row({ rowId: 'b', days: [4, 5], startTime: '14:00', endTime: '22:06' }),
        ], FACTS);
        expect(v.cycleHours).toBeCloseTo(152, 6);
        expect(v.status).toBe('balanced');
    });

    it('reports an empty pattern as empty rather than as 152 hours short', () => {
        expect(cycleVerdict([], FACTS).status).toBe('empty');
        expect(cycleVerdict([row({ days: [] })], FACTS).status).toBe('empty');
    });

    it('measures each employee against their OWN contract', () => {
        // A pattern lawful for 38h is over the ceiling for a 30h contract.
        const v = cycleVerdict([row()], { contractedWeeklyHours: 30, cycleWeeks: 4 });
        expect(v.ceilingHours).toBe(120);
        expect(v.status).toBe('over');
    });
});

describe('rowToSlots', () => {
    it('expands one line into one slot per day, ordered by weekday', () => {
        const slots = rowToSlots(row({ days: [5, 1, 3] }));
        expect(slots.map(s => s.dayOfWeek)).toEqual([1, 3, 5]);
        expect(slots.every(s => s.netMinutes === 456)).toBe(true);
        expect(slots.every(s => s.paidBreakMinutes === 15)).toBe(true);
    });

    it('carries the saved database id when there is one', () => {
        const slots = rowToSlots(row({ days: [1, 2], slotIdByDay: { 1: 'db-mon' } }));
        expect(slots[0].sourceSlotId).toBe('db-mon');
        // A day that has never been saved gets a synthetic key, never an empty
        // string — `source_slot_id` is the provenance an applied shift points at.
        expect(slots[1].sourceSlotId).toBe('r1:2');
    });
});

describe('rowsToPattern', () => {
    it('takes only the named employee\'s rows', () => {
        const p = rowsToPattern('emp-1', 'uc-1', 'sub-1', [
            row({ rowId: 'a', employeeId: 'emp-1', days: [1] }),
            row({ rowId: 'b', employeeId: 'emp-2', days: [2] }),
        ]);
        expect(p.slots).toHaveLength(1);
        expect(p.slots[0].dayOfWeek).toBe(1);
        expect(p.employeeId).toBe('emp-1');
    });

    it('is order-independent — the determinism guarantee survives the editor', () => {
        const a = row({ rowId: 'a', days: [1, 2] });
        const b = row({ rowId: 'b', days: [4, 5], startTime: '14:00', endTime: '22:06' });
        expect(JSON.stringify(rowsToPattern('emp-1', 'uc-1', 'sub-1', [a, b])))
            .toBe(JSON.stringify(rowsToPattern('emp-1', 'uc-1', 'sub-1', [b, a])));
    });
});

describe('seedRow', () => {
    it('seeds a lawful five-day week for a 38h contract', () => {
        const r = seedRow({
            rowId: 's', employeeId: 'e', userContractId: 'uc', roleId: ROLE, weeklyHours: 38,
        });
        expect(r.days).toEqual([1, 2, 3, 4, 5]);
        expect(r.endTime).toBe('16:06');
        expect(deriveRow(r).netMinutes).toBe(456);
        expect(cycleVerdict([r], FACTS).status).toBe('balanced');
    });

    it('trims to a day count the contract can lawfully hold', () => {
        // 60h across five days is 12h a day, which is exactly cl 35.1(d)'s
        // maximum, so five days survives. Across seven it would be 8.57h — also
        // lawful — so the preferred five is kept rather than overridden.
        const r = seedRow({
            rowId: 's', employeeId: 'e', userContractId: 'uc', roleId: ROLE, weeklyHours: 60,
        });
        expect(r.days.length).toBe(5);
        expect(deriveRow(r).netMinutes).toBe(720);
    });
});

describe('leave credit comes from the pattern, not from an average', () => {
    const isoOf = (date: string) =>
        (['2024-07-15', '2024-07-16', '2024-07-20'].indexOf(date) === 2 ? 6 : 1) as IsoWeekday;

    it('credits a leave day the hours the pattern rosters on that weekday', () => {
        const pattern = rowsToPattern('emp-1', 'uc-1', 'sub-1', [row()]);
        const hours = patternHoursByWeekday(pattern);
        expect(hours.get(1)).toBeCloseTo(7.6, 6);

        const raw: RawLeaveDay[] = [
            { date: '2024-07-15', leaveType: 'annual', credit: 'CREDITS', status: 'approved' },
        ];
        expect(attachLeaveCredit(raw, hours, isoOf)[0].creditHours).toBeCloseTo(7.6, 6);
    });

    it('credits nothing for leave on a day the pattern does not work', () => {
        // cl 44.7 pays the Team Member's ordinary hours for the period. There
        // was no obligation on a Saturday this person never works, so there is
        // nothing for the leave to discharge — correct, not harsh.
        const hours = patternHoursByWeekday(rowsToPattern('emp-1', 'uc-1', 'sub-1', [row()]));
        const raw: RawLeaveDay[] = [
            { date: '2024-07-20', leaveType: 'annual', credit: 'CREDITS', status: 'approved' },
        ];
        expect(attachLeaveCredit(raw, hours, isoOf)[0].creditHours).toBe(0);
    });
});

describe('copyPatternShape', () => {
    const src = (over: Partial<PatternRow> = {}) => row({
        rowId: 'src-1', employeeId: 'emp-src', userContractId: 'uc-src',
        roleId: 'role-manager', ...over,
    });
    const tgt = (over: Partial<PatternRow> = {}) => row({
        rowId: 'tgt-1', employeeId: 'emp-tgt', userContractId: 'uc-tgt',
        roleId: 'role-supervisor', days: [1, 2], startTime: '06:00', endTime: '14:06',
        slotIdByDay: { 1: 'db-mon', 2: 'db-tue' }, ...over,
    });
    const newId = (i: number) => `new-${i}`;

    it('copies the shape and NOTHING else', () => {
        const out = copyPatternShape([src(), tgt()], 'emp-src', 'emp-tgt', newId);
        const moved = out.find(r => r.employeeId === 'emp-tgt')!;

        expect(moved.days).toEqual([1, 2, 3, 4, 5]);
        expect(moved.startTime).toBe('08:00');
        expect(moved.endTime).toBe('16:06');

        // The invariant. Role and contract authorise the work; carrying them
        // across would hand someone a pattern that can never be generated
        // (BFT_PATTERN_ROLE_MISMATCH is BLOCKING) and change their pay rate.
        expect(moved.roleId).toBe('role-supervisor');
        expect(moved.userContractId).toBe('uc-tgt');
        expect(moved.employeeId).toBe('emp-tgt');
    });

    it('keeps the target\'s saved database ids so a save updates rather than churns', () => {
        const out = copyPatternShape([src(), tgt()], 'emp-src', 'emp-tgt', newId);
        expect(out.find(r => r.employeeId === 'emp-tgt')!.slotIdByDay).toEqual(
            { 1: 'db-mon', 2: 'db-tue' });
    });

    it('REPLACES, so a two-line source does not collapse onto one target row', () => {
        // The bug this function exists to prevent: the old inline version
        // looped the source's rows and wrote every one to the target's rows[0],
        // so the first variation was silently lost.
        const out = copyPatternShape(
            [
                src({ rowId: 'src-1', days: [1, 2, 3] }),
                src({ rowId: 'src-2', days: [4, 5], startTime: '14:00', endTime: '22:06' }),
                tgt(),
            ],
            'emp-src', 'emp-tgt', newId,
        );
        const moved = out.filter(r => r.employeeId === 'emp-tgt');

        expect(moved).toHaveLength(2);
        expect(moved.map(r => r.days)).toEqual([[1, 2, 3], [4, 5]]);
        expect(moved[1].startTime).toBe('14:00');
        // The new line still belongs to the target, not the source.
        expect(moved.every(r => r.roleId === 'role-supervisor')).toBe(true);
    });

    it('drops the target\'s surplus lines rather than leaving a hybrid', () => {
        const out = copyPatternShape(
            [src(), tgt({ rowId: 'tgt-1' }), tgt({ rowId: 'tgt-2', days: [6, 7] })],
            'emp-src', 'emp-tgt', newId,
        );
        expect(out.filter(r => r.employeeId === 'emp-tgt')).toHaveLength(1);
    });

    it('leaves the draft untouched when either side has no rows', () => {
        const rows = [src()];
        expect(copyPatternShape(rows, 'emp-src', 'nobody', newId)).toEqual(rows);
        expect(copyPatternShape(rows, 'nobody', 'emp-src', newId)).toEqual(rows);
    });

    it('does not disturb anyone else', () => {
        const other = row({ rowId: 'o1', employeeId: 'emp-other', days: [3] });
        const out = copyPatternShape([src(), tgt(), other], 'emp-src', 'emp-tgt', newId);
        expect(out.find(r => r.employeeId === 'emp-other')).toEqual(other);
    });
});
