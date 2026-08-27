/**
 * Admission runs candidates through the REAL V8 engine, not a stand-in. A fake
 * would drift from the rule it imitates, which is how this codebase ended up
 * with three rival clock formatters and five rival fairness definitions.
 *
 * Two properties matter most here and neither is visible from a single
 * candidate: that a pair of candidates which each pass alone are not both
 * admitted when they breach together, and that a candidate is never rejected
 * for a violation that was already on the roster before it arrived.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidates } from '../admissionEngine';
import type { V8Employee } from '@/modules/compliance/v8/types';
import type { Candidate, ExistingShift } from '../types';

const EMPLOYEE: V8Employee = {
    id: 'emp-1',
    name: 'Test Employee',
    contract_type: 'FULL_TIME',
    contracted_weekly_hours: 38,
    ordinary_hours_cycle_weeks: 4,
    ordinary_hours_cycle_anchor: '2024-01-01',
    is_security_role: false,
};

/** Reference date is passed explicitly — a clock-derived default would break determinism. */
const REF = '2024-07-15';

function candidate(date: string, start: string, end: string, over: Partial<Candidate> = {}): Candidate {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const gross = (eh * 60 + em) - (sh * 60 + sm);
    return {
        employeeId: 'emp-1',
        userContractId: 'uc-1',
        templateShiftId: `ts-${date}`,
        shiftDate: date,
        startTime: start,
        endTime: end,
        unpaidBreakMinutes: 30,
        paidBreakMinutes: 15,
        netMinutes: gross - 30,
        roleId: 'role-1',
        cycleIndex: 7,
        idempotencyKey: `bft:sub-1:p:tmpl:emp-1:${date}:${start}-${end}:role-1`,
        ...over,
    };
}

function existing(date: string, start: string, end: string): ExistingShift {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return {
        id: `s-${date}`,
        date,
        startTime: start,
        endTime: end,
        netMinutes: (eh * 60 + em) - (sh * 60 + sm) - 30,
        subDepartmentId: 'sub-1',
        rosterPublishedOrLocked: false,
    };
}

function admit(candidates: Candidate[], existingShifts: ExistingShift[] = []) {
    return admitCandidates({
        candidates,
        employee: EMPLOYEE,
        existingShifts,
        // Full-timers hold NO declared slots — migration 20260817120000 removed
        // them — and OPT_OUT reads that silence as available by contract.
        availabilitySlots: [],
        availabilityMode: 'OPT_OUT',
        referenceDate: REF,
    });
}

describe('incremental admission', () => {
    it('admits a lawful candidate', () => {
        const { admitted, rejected } = admit([candidate('2024-07-15', '08:00', '16:36')]);

        expect(admitted).toHaveLength(1);
        expect(rejected).toEqual([]);
    });

    it('rejects the SECOND of two candidates that each pass alone but breach together', () => {
        // A late finish followed by an early start. 22:30 to 06:00 is 7.5h of
        // rest, under cl 40.1's ten hours. Neither candidate breaches anything
        // on its own, so only judging each against the pre-existing roster
        // would let both through and write the breach.
        const late = candidate('2024-07-15', '14:00', '22:30');
        const early = candidate('2024-07-16', '06:00', '14:30');

        expect(admit([late]).admitted).toHaveLength(1);
        expect(admit([early]).admitted).toHaveLength(1);

        const { admitted, rejected } = admit([late, early]);

        expect(admitted).toHaveLength(1);
        expect(admitted[0].shiftDate).toBe('2024-07-15');
        expect(rejected).toHaveLength(1);
        expect(rejected[0].candidate.shiftDate).toBe('2024-07-16');
        expect(rejected[0].reasons.some(r => r.code === 'V8_MIN_REST_GAP')).toBe(true);
        expect(rejected[0].reasons.every(r => r.severity === 'BLOCKING')).toBe(true);
    });

    it('rejects a candidate that breaches against an EXISTING shift', () => {
        const { admitted, rejected } = admit(
            [candidate('2024-07-16', '06:00', '14:30')],
            [existing('2024-07-15', '14:00', '22:30')],
        );

        expect(admitted).toEqual([]);
        expect(rejected[0].reasons.some(r => r.code === 'V8_MIN_REST_GAP')).toBe(true);
    });

    it('never applies the eight-hour rest reduction — cl 40.2 needs a written agreement', () => {
        // 23:00 to 08:00 is nine hours: lawful under cl 40.2's reduced minimum,
        // unlawful under cl 40.1's default. Nothing in the schema records the
        // written agreement, so the default must stand.
        const { rejected } = admit([
            candidate('2024-07-15', '14:30', '23:00'),
            candidate('2024-07-16', '08:00', '16:30'),
        ]);

        expect(rejected).toHaveLength(1);
        expect(rejected[0].reasons.some(r => r.code === 'V8_MIN_REST_GAP')).toBe(true);
    });

    it('leaves state untouched when a candidate is rejected, so later ones still fit', () => {
        // The middle candidate breaches; the third is lawful against the first
        // and must still be admitted rather than being dragged down with it.
        const { admitted, rejected } = admit([
            candidate('2024-07-15', '08:00', '16:36'),
            candidate('2024-07-16', '02:00', '10:30'),   // 9.4h after the first
            candidate('2024-07-17', '08:00', '16:36'),
        ]);

        expect(rejected).toHaveLength(1);
        expect(rejected[0].candidate.shiftDate).toBe('2024-07-16');
        expect(admitted.map(c => c.shiftDate)).toEqual(['2024-07-15', '2024-07-17']);
    });
});

describe('attribution — a candidate answers only for what it introduces', () => {
    it('does not reject an unrelated candidate because the roster is already in breach', () => {
        // Two existing shifts already breach the rest gap in early July. A
        // candidate three weeks later has nothing to do with it, and must not
        // inherit the blame — otherwise a single historical breach would block
        // an entire month of baseline generation.
        const preBroken = [
            existing('2024-07-01', '14:00', '22:30'),
            existing('2024-07-02', '06:00', '14:30'),
        ];

        const { admitted, rejected } = admit(
            [candidate('2024-07-22', '08:00', '16:36')],
            preBroken,
        );

        expect(rejected).toEqual([]);
        expect(admitted).toHaveLength(1);
    });

    it('still rejects a candidate that adds a NEW breach to an already-broken roster', () => {
        // The 1st/2nd pair already breaches (22:30 to 06:00 is 7.5h). The
        // candidate on the 11th creates a SEPARATE breach against the shift on
        // the 10th (23:00 to 06:00 is 7h), and must be held responsible for
        // that one even though the roster was already faulty elsewhere.
        const preBroken = [
            existing('2024-07-01', '14:00', '22:30'),
            existing('2024-07-02', '06:00', '14:30'),
            existing('2024-07-10', '14:30', '23:00'),
        ];

        const { rejected } = admit([candidate('2024-07-11', '06:00', '14:30')], preBroken);

        expect(rejected).toHaveLength(1);
        expect(rejected[0].reasons.some(r => r.code === 'V8_MIN_REST_GAP')).toBe(true);
    });
});

describe('availability — the OPT_OUT population', () => {
    it('admits a full-timer with no declared slots, and raises no availability warning', () => {
        // The C4 regression. Full-time availability rows were deliberately
        // deleted; silence means available by contract, and treating it as
        // unavailable would hard-filter every full-timer off every candidate.
        const { admitted, rejected, warnings } = admit([candidate('2024-07-15', '08:00', '16:36')]);

        expect(admitted).toHaveLength(1);
        expect(rejected).toEqual([]);
        expect(warnings.some(w => w.code === 'BFT_UNAVAILABLE')).toBe(false);
    });

    it('honours an EXPLICIT declared window, which is a positive statement either way', () => {
        // A slot that does not contain the shift is a stated restriction, not
        // an absence of one, so it binds under OPT_OUT as much as OPT_IN.
        const { admitted, rejected } = admitCandidates({
            candidates: [candidate('2024-07-15', '08:00', '16:36')],
            employee: EMPLOYEE,
            existingShifts: [],
            availabilitySlots: [{ slot_date: '2024-07-15', start_time: '18:00', end_time: '23:00' }],
            availabilityMode: 'OPT_OUT',
            referenceDate: REF,
        });

        expect(admitted).toEqual([]);
        expect(rejected[0].reasons.some(r => r.code === 'BFT_UNAVAILABLE')).toBe(true);
    });
});

describe('determinism', () => {
    it('returns the same decisions on repeated runs', () => {
        const candidates = [
            candidate('2024-07-15', '14:00', '22:30'),
            candidate('2024-07-16', '06:00', '14:30'),
            candidate('2024-07-17', '08:00', '16:36'),
        ];

        const first = admit(candidates);
        for (let i = 0; i < 10; i++) {
            const again = admit(candidates);
            expect(again.admitted.map(c => c.idempotencyKey))
                .toEqual(first.admitted.map(c => c.idempotencyKey));
            expect(again.rejected.map(r => r.candidate.idempotencyKey))
                .toEqual(first.rejected.map(r => r.candidate.idempotencyKey));
        }
    });
});
